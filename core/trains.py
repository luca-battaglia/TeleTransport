"""Trenitalia (LeFrecce) client and train ranking.

LeFrecce has no public API. Its website talks to a JSON backend (the BFF), and
this module calls the two endpoints the site itself uses: station lookup and
solution search. Requests run inside a headless browser context because the BFF
expects the cookies the site sets on first load.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import quote_plus, urlencode
from zoneinfo import ZoneInfo

from core.cache import app_cache, generate_cache_key
from core.config import build_settings, section

log = logging.getLogger(__name__)

TZ = ZoneInfo("Europe/Rome")

SITE_URL = "https://www.lefrecce.it/Channels.Website.WEB/"
BFF_BASE = "https://www.lefrecce.it/Channels.Website.BFF.WEB"
SOLUTIONS_URL = f"{BFF_BASE}/website/ticket/solutions"
LOC_SEARCH_URL = f"{BFF_BASE}/website/locations/search"

# LeFrecce's own search page cannot be linked to: its criteria live in an internal
# store and its route (#/search-results) accepts no parameters. The white-label
# entry point does read them from the query string, and with searchSolutions=true
# it runs the search and lands straight on the results. It resolves station names
# through the same locations endpoint as LOC_SEARCH_URL, taking the first hit, so
# the names we searched with resolve to the same stations.
WHITE_LABEL_SEARCH_URL = "https://www.lefrecce.it/Channels.Website.WEB/#/white-label/MINISITI/"

LOCATIONS_TTL_S = 24 * 3600
SOLUTIONS_PAGE_TTL_S = 30 * 60
MAX_CONCURRENT_DAYS = 6


class StationNotFoundError(LookupError):
    def __init__(self, name: str) -> None:
        super().__init__(f"No station found for: {name}")
        self.name = name


class UpstreamError(RuntimeError):
    """A response from LeFrecce that retrying will not fix."""


@dataclass(frozen=True)
class TrainScoringConfig:
    time_value_eur_per_hour: float = 20.0
    early_departure_ref_hour: int = 9
    early_departure_penalty_eur_per_hour: float = 20.0
    late_arrival_start_hour: int = 22
    overnight_end_hour: int = 5
    late_arrival_penalty_eur_per_hour: float = 15.0
    change_penalty_eur: float = 5.0


@dataclass(frozen=True)
class TrainsDefaultsConfig:
    min_price: float = 20.0
    max_per_day: int = 120
    page_size: int = 40

    poll_empty_retries: int = 6
    poll_dup_retries: int = 4
    poll_sleep_base: float = 0.6
    scan_cap_mult: int = 25
    api_timeout_ms: int = 45_000
    api_retries: int = 6
    no_cache: bool = False


def parse_trains_config(cfg: Mapping[str, Any]) -> Tuple[TrainsDefaultsConfig, TrainScoringConfig]:
    defaults = build_settings(TrainsDefaultsConfig, section(cfg, "trains"), "trains")
    scoring = build_settings(TrainScoringConfig, section(cfg, "trains", "scoring"), "trains.scoring")
    return defaults, scoring


@dataclass(frozen=True)
class Route:
    from_name: str
    to_name: str

    @property
    def label(self) -> str:
        return f"{self.from_name} -> {self.to_name}"


@dataclass(frozen=True)
class SearchTask:
    route: Route
    d1: date
    d2: date


@dataclass
class RankedSolution:
    route_label: str
    origin: str
    destination: str
    dep: datetime
    arr: datetime
    duration: timedelta
    changes: int
    price_eur: float
    adjusted_cost: float


def build_booking_url(origin: str, destination: str, dep: datetime, *, lang: str = "it") -> str:
    """Link to the LeFrecce results for the day and route of a ranked solution."""
    params = {
        "isRoundTrip": "false",
        "departureStation": origin,
        "arrivalStation": destination,
        "departureDate": dep.strftime("%d-%m-%Y"),
        # Anchored to the top of the hour rather than the exact minute, so the
        # solution the user clicked is certain to be on the page it opens.
        "departureTime": dep.strftime("%H:00"),
        "noOfAdults": "1",
        "noOfChildren": "0",
        "searchSolutions": "true",
        "lang": lang,
    }
    return f"{WHITE_LABEL_SEARCH_URL}?{urlencode(params)}"


def daterange(d1: date, d2: date) -> Iterable[date]:
    if d2 < d1:
        d1, d2 = d2, d1
    cur = d1
    while cur <= d2:
        yield cur
        cur += timedelta(days=1)


def parse_iso_dt(s: str) -> datetime:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty datetime")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def round2(x: float) -> float:
    return round(x + 1e-12, 2)


_RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504}
_DEFAULT_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "accept-language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "referer": "https://www.lefrecce.it/",
}


def _jitter_sleep(base: float, factor: float = 1.0) -> float:
    return min(8.0, base * factor * (0.85 + random.random() * 0.3))


async def _body_snippet(resp: Any, limit: int = 300) -> str:
    try:
        return ((await resp.text()) or "").strip().replace("\n", " ")[:limit]
    except Exception:
        return ""


async def api_request_json(
    request_ctx: Any,
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    timeout_ms: int = 45_000,
    retries: int = 6,
) -> Any:
    """Call the BFF, retrying transient statuses and unparseable bodies with backoff."""
    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            if method == "POST":
                resp = await request_ctx.post(
                    url, headers=_DEFAULT_HEADERS, data=json.dumps(payload), timeout=timeout_ms
                )
            else:
                resp = await request_ctx.get(url, headers=_DEFAULT_HEADERS, timeout=timeout_ms)
            status = int(resp.status)

            if status in _RETRYABLE_STATUSES:
                last_err = RuntimeError(f"HTTP {status} {method} {url}")
                log.debug("retry %s %s status=%s attempt=%s/%s", method, url, status, attempt, retries)
            elif status >= 400:
                raise UpstreamError(f"HTTP {status} {method} {url}: {await _body_snippet(resp)}")
            else:
                try:
                    return await resp.json()
                except Exception as exc:
                    last_err = exc
                    log.debug("unparseable body %s %s attempt=%s/%s", method, url, attempt, retries)
        except UpstreamError:
            raise
        except Exception as exc:
            last_err = exc
            log.debug("request failed %s %s attempt=%s/%s: %s", method, url, attempt, retries, exc)
        if attempt < retries:
            await asyncio.sleep(_jitter_sleep(0.6, factor=attempt))

    raise last_err or RuntimeError(f"{method} {url} failed")


class BrowserSession:
    """A headless browser started on first use, so fully cached searches never launch one."""

    def __init__(self) -> None:
        self._pw: Any = None
        self._browser: Any = None
        self._request_ctx: Any = None
        self._lock = asyncio.Lock()

    async def request_context(self) -> Any:
        # The whole startup runs under the lock: concurrent day tasks that all miss
        # the cache would otherwise each launch their own browser.
        async with self._lock:
            if self._request_ctx is None:
                self._request_ctx = await self._start()
        return self._request_ctx

    async def _start(self) -> Any:
        from playwright.async_api import async_playwright

        log.debug("starting headless browser")
        self._pw = await async_playwright().start()
        try:
            self._browser = await self._pw.chromium.launch(headless=True, channel="chrome")
        except Exception:
            log.debug("Chrome not found, using the bundled Chromium")
            self._browser = await self._pw.chromium.launch(headless=True)

        context = await self._browser.new_context(
            locale="it-IT",
            timezone_id="Europe/Rome",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()
        try:
            await page.goto(SITE_URL, wait_until="domcontentloaded", timeout=60_000)
        except Exception as exc:
            log.warning("loading the LeFrecce homepage failed (%s), continuing without it", exc)
        return context.request

    async def close(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()


def _normalize_station_key(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()


def pick_location_id(name_query: str, locations: List[Dict[str, Any]]) -> int:
    nq = (name_query or "").strip().casefold()

    for loc in locations:
        n = str(loc.get("name", "")).casefold()
        dn = str(loc.get("displayName", "")).casefold()
        if n == nq or dn == nq:
            return int(loc["id"])

    # "Zurigo" alone would otherwise resolve to whichever Zurich stop comes first.
    if any(k in nq for k in ("zur", "zür", "zuer")):
        for loc in locations:
            n = str(loc.get("name", "")).casefold()
            dn = str(loc.get("displayName", "")).casefold()
            if any(k in n or k in dn for k in ("hb", "hauptbahnhof", "centrale")):
                return int(loc["id"])

    # Turin has a meta-station covering all of its stations; prefer it.
    if "torino" in nq:
        for loc in locations:
            n = str(loc.get("name", "")).casefold()
            dn = str(loc.get("displayName", "")).casefold()
            if "tutte" in n or "tutte" in dn or "all" in n:
                return int(loc["id"])

    if not locations:
        raise StationNotFoundError(name_query)
    return int(locations[0]["id"])


def build_departure_iso(d: date, hh: int = 0, mm: int = 0) -> str:
    return datetime.combine(d, time(hh, mm), TZ).isoformat(timespec="milliseconds")


def _late_arrival_penalty(arr_local: datetime, scoring: TrainScoringConfig) -> float:
    arr_t = arr_local.time()
    late_start = time(int(scoring.late_arrival_start_hour), 0)
    overnight_end = time(int(scoring.overnight_end_hour), 0)

    if arr_t >= late_start:
        ref = datetime.combine(arr_local.date(), late_start, TZ)
    elif arr_t < overnight_end:
        # Past midnight the penalty keeps counting from the previous evening.
        ref = datetime.combine(arr_local.date() - timedelta(days=1), late_start, TZ)
    else:
        return 0.0
    hours = (arr_local - ref).total_seconds() / 3600.0
    return max(0.0, hours) * float(scoring.late_arrival_penalty_eur_per_hour)


def compute_solution_metrics(
    solution_item: Dict[str, Any],
    scoring: TrainScoringConfig,
) -> Optional[Tuple[datetime, datetime, timedelta, int, float, float]]:
    sol = solution_item.get("solution") or {}
    if str(sol.get("status", "")) != "SALEABLE":
        return None

    amount = (sol.get("price") or {}).get("amount")
    if amount is None:
        return None
    try:
        # The amount sometimes arrives as a string with a decimal comma.
        base_price = float(str(amount).replace(",", ".").strip())
    except ValueError:
        return None

    try:
        dep = parse_iso_dt(str(sol.get("departureTime", "")))
        arr = parse_iso_dt(str(sol.get("arrivalTime", "")))
    except ValueError:
        return None

    dep_local = (dep if dep.tzinfo else dep.replace(tzinfo=TZ)).astimezone(TZ)
    arr_local = (arr if arr.tzinfo else arr.replace(tzinfo=TZ)).astimezone(TZ)

    duration = arr_local - dep_local
    if duration.total_seconds() <= 0:
        return None

    time_value = duration.total_seconds() / 3600.0 * float(scoring.time_value_eur_per_hour)

    ref_dt = datetime.combine(dep_local.date(), time(int(scoring.early_departure_ref_hour), 0), TZ)
    early_pen = 0.0
    if dep_local < ref_dt:
        early_pen = (ref_dt - dep_local).total_seconds() / 3600.0 * float(scoring.early_departure_penalty_eur_per_hour)

    late_pen = _late_arrival_penalty(arr_local, scoring)

    nodes = sol.get("nodes") or []
    changes = max(0, len(nodes) - 1) if isinstance(nodes, list) else 0
    change_pen = changes * float(scoring.change_penalty_eur)

    adjusted = base_price + time_value + early_pen + late_pen + change_pen
    return dep_local, arr_local, duration, changes, base_price, adjusted


def solution_key(solution_item: Dict[str, Any]) -> str:
    sol = solution_item.get("solution") or {}
    sid = sol.get("id")
    if sid is not None and str(sid).strip():
        return f"id:{sid}"

    node_bits: List[str] = []
    nodes = sol.get("nodes") or []
    if isinstance(nodes, list):
        for n in nodes:
            if isinstance(n, dict):
                node_bits.append(str(
                    n.get("trainNumber") or n.get("trainName") or n.get("serviceName") or n.get("id") or ""
                ).strip())

    dep = str(sol.get("departureTime", "")).strip()
    arr = str(sol.get("arrivalTime", "")).strip()
    cat = str(sol.get("category", "") or sol.get("trainCategory", "") or "").strip()
    return "fp:" + "|".join([dep, arr, cat, ",".join(node_bits)])


async def search_ranked_solutions(
    tasks: Sequence[SearchTask],
    defaults: TrainsDefaultsConfig,
    scoring: TrainScoringConfig,
) -> List[RankedSolution]:
    """Search every day of every task and rank all solutions together."""
    browser = BrowserSession()
    no_cache = defaults.no_cache

    def store(cache_key: str, data: Any, from_cache: bool, ttl: int) -> None:
        if not from_cache and not no_cache:
            app_cache.set(cache_key, data, expire=ttl)

    async def post_solutions(payload: Dict[str, Any]) -> Tuple[Any, bool, str]:
        cache_key = generate_cache_key("trains_api", {"url": SOLUTIONS_URL, "payload": payload})
        if not no_cache:
            cached = app_cache.get(cache_key)
            if cached is not None:
                return cached, True, cache_key
        ctx = await browser.request_context()
        data = await api_request_json(
            ctx, "POST", SOLUTIONS_URL, payload,
            timeout_ms=defaults.api_timeout_ms, retries=defaults.api_retries,
        )
        return data, False, cache_key

    station_ids: Dict[str, int] = {}

    async def resolve_id(station_name: str) -> int:
        key = _normalize_station_key(station_name)
        if key in station_ids:
            return station_ids[key]

        url = f"{LOC_SEARCH_URL}?name={quote_plus(station_name)}&limit=50"
        cache_key = generate_cache_key("trains_loc", {"url": url})
        locs = None if no_cache else app_cache.get(cache_key)
        if locs is None:
            ctx = await browser.request_context()
            locs = await api_request_json(ctx, "GET", url, timeout_ms=defaults.api_timeout_ms, retries=defaults.api_retries)
            if not isinstance(locs, list):
                locs = []
            store(cache_key, locs, False, LOCATIONS_TTL_S)

        station_ids[key] = pick_location_id(station_name, locs)
        log.debug("station %s -> %s", station_name, station_ids[key])
        return station_ids[key]

    sem = asyncio.Semaphore(MAX_CONCURRENT_DAYS)
    # A dirty or changed endpoint could keep returning pages forever; this bounds it.
    scan_cap = max(300, defaults.max_per_day * max(1, defaults.scan_cap_mult))

    async def fetch_day(task: SearchTask, dep_id: int, arr_id: int, day: date) -> List[RankedSolution]:
        async with sem:
            found: List[RankedSolution] = []
            seen_keys: set[str] = set()
            offset = scanned = 0
            empty_tries = dup_tries = 0
            passed_day = False

            while len(found) < defaults.max_per_day and scanned < scan_cap and not passed_day:
                payload = {
                    "departureLocationId": dep_id,
                    "arrivalLocationId": arr_id,
                    "departureTime": build_departure_iso(day),
                    "adults": 1,
                    "children": 0,
                    "criteria": {
                        "frecceOnly": False,
                        "regionalOnly": False,
                        "noChanges": False,
                        "order": "DEPARTURE_DATE",
                        "limit": max(1, defaults.page_size),
                        "offset": offset,
                    },
                    "advancedSearchRequest": {"bestFare": False},
                }

                data, from_cache, cache_key = await post_solutions(payload)
                sols = data.get("solutions") if isinstance(data, dict) else None
                sols = sols if isinstance(sols, list) else []

                # The endpoint sometimes answers with an empty page before it has
                # results ready, so a live empty page is polled a few times.
                if not sols:
                    if not from_cache and empty_tries < defaults.poll_empty_retries:
                        empty_tries += 1
                        log.debug("empty page day=%s offset=%s try=%s", day, offset, empty_tries)
                        await asyncio.sleep(_jitter_sleep(defaults.poll_sleep_base, factor=empty_tries))
                        continue
                    store(cache_key, data, from_cache, SOLUTIONS_PAGE_TTL_S)
                    break

                empty_tries = 0
                scanned += len(sols)
                unique_in_call = added_in_call = 0

                for item in sols:
                    if not isinstance(item, dict):
                        continue
                    k = solution_key(item)
                    if k in seen_keys:
                        continue
                    seen_keys.add(k)
                    unique_in_call += 1

                    metrics = compute_solution_metrics(item, scoring=scoring)
                    if metrics is None:
                        continue
                    dep_local, arr_local, duration, changes, base_price, adjusted = metrics

                    # Results are ordered by departure, so the first one on a later
                    # day means this day is exhausted.
                    if dep_local.date() < day:
                        continue
                    if dep_local.date() > day:
                        passed_day = True
                        break
                    if base_price < defaults.min_price:
                        continue

                    found.append(RankedSolution(
                        route_label=task.route.label,
                        origin=task.route.from_name,
                        destination=task.route.to_name,
                        dep=dep_local,
                        arr=arr_local,
                        duration=duration,
                        changes=changes,
                        price_eur=round2(base_price),
                        adjusted_cost=round2(adjusted),
                    ))
                    added_in_call += 1
                    if len(found) >= defaults.max_per_day:
                        break

                if passed_day:
                    store(cache_key, data, from_cache, SOLUTIONS_PAGE_TTL_S)
                    break

                # A page of nothing but repeats also tends to be transient.
                if unique_in_call == 0:
                    if not from_cache and dup_tries < defaults.poll_dup_retries:
                        dup_tries += 1
                        log.debug("duplicate-only page day=%s offset=%s try=%s", day, offset, dup_tries)
                        await asyncio.sleep(_jitter_sleep(defaults.poll_sleep_base, factor=dup_tries))
                        continue
                    store(cache_key, data, from_cache, SOLUTIONS_PAGE_TTL_S)
                    break

                dup_tries = 0
                offset += len(sols)
                store(cache_key, data, from_cache, SOLUTIONS_PAGE_TTL_S)

                if not from_cache and added_in_call == 0:
                    await asyncio.sleep(_jitter_sleep(0.12))

            if scanned >= scan_cap:
                log.warning("scan cap reached day=%s route=%s", day, task.route.label)
            return found

    try:
        day_jobs = []
        for task in tasks:
            dep_id = await resolve_id(task.route.from_name)
            arr_id = await resolve_id(task.route.to_name)
            log.debug("searching %s: %s -> %s", task.route.label, task.d1, task.d2)
            day_jobs.extend(fetch_day(task, dep_id, arr_id, day) for day in daterange(task.d1, task.d2))

        ranked = [sol for day_result in await asyncio.gather(*day_jobs) for sol in day_result]
    finally:
        await browser.close()

    ranked.sort(key=lambda x: (x.adjusted_cost, x.duration.total_seconds(), x.dep))
    return ranked
