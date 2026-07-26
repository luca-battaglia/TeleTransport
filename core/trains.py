#!/usr/bin/env python3
# trains.py
# Trenitalia (LeFrecce) travel solutions ranker built on Playwright.
#
# Update: parameters are configurable through a single TOML file (e.g. travel_ranker.toml).
# CLI > TOML > original defaults. With no TOML present, behaviour is unchanged.

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote_plus
from zoneinfo import ZoneInfo

from playwright.async_api import async_playwright

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

TZ = ZoneInfo("Europe/Rome")

BFF_BASE = "https://www.lefrecce.it/Channels.Website.BFF.WEB"
SOLUTIONS_URL = f"{BFF_BASE}/website/ticket/solutions"
LOC_SEARCH_URL = f"{BFF_BASE}/website/locations/search"

# Station presets (scope is limited to Zurigo/Torino/Alessandria)
ZURIGO = "Zurigo HB"
TORINO = "Torino ( All Stations )"
ALESSANDRIA = "Alessandria"

ROUTES_PRESET: Dict[str, Tuple[str, str]] = {
    "torino-zurigo": (TORINO, ZURIGO),
    "trn-zrh": (TORINO, ZURIGO),
    "alessandria-zurigo": (ALESSANDRIA, ZURIGO),
    "ale-zrh": (ALESSANDRIA, ZURIGO),
    "zurigo-torino": (ZURIGO, TORINO),
    "zrh-trn": (ZURIGO, TORINO),
    "zurigo-alessandria": (ZURIGO, ALESSANDRIA),
    "zrh-ale": (ZURIGO, ALESSANDRIA),
}


# ---------------- stderr utils ----------------

def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


# ---------------- TOML config ----------------

def _load_toml_file(path: Path) -> Dict[str, Any]:
    try:
        import tomllib  # py>=3.11
    except Exception:
        import tomli as tomllib  # type: ignore

    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _deep_get(d: Dict[str, Any], keys: Sequence[str]) -> Any:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def _as_int(v: Any) -> Optional[int]:
    try:
        if v is None:
            return None
        return int(v)
    except Exception:
        return None


def _as_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def _as_bool(v: Any) -> Optional[bool]:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "1", "yes", "y", "on", "si", "sì", "s"):
            return True
        if s in ("false", "0", "no", "n", "off"):
            return False
    return None


def _as_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    try:
        return str(v)
    except Exception:
        return None


def _default_config_paths() -> List[Path]:
    paths: List[Path] = []
    env = os.getenv("TRAVEL_RANKER_CONFIG", "").strip()
    if env:
        paths.append(Path(env).expanduser())
    paths.append(Path("travel_ranker.toml"))
    paths.append(Path.home() / ".config" / "travel_ranker.toml")
    return paths


def load_config_dict(config_path: Optional[str], *, verbose: bool) -> Dict[str, Any]:
    if config_path:
        p = Path(config_path).expanduser()
        if not p.exists():
            raise FileNotFoundError(f"Config not found: {p}")
        return _load_toml_file(p)

    for p in _default_config_paths():
        try:
            if p.exists():
                return _load_toml_file(p)
        except Exception as e:
            if verbose:
                eprint(f"[WARN] Error reading config {p}: {e}")
            continue
    return {}


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
    limit: int = 50

    wizard_min_price: float = 30.0

    poll_empty_retries: int = 6
    poll_dup_retries: int = 4
    poll_sleep_base: float = 0.6
    scan_cap_mult: int = 25
    api_timeout_ms: int = 45_000
    api_retries: int = 6


def parse_trains_config(cfg: Dict[str, Any]) -> Tuple[TrainsDefaultsConfig, TrainScoringConfig]:
    trains_cfg = _deep_get(cfg, ["trains"])
    trains_cfg = trains_cfg if isinstance(trains_cfg, dict) else {}

    scoring = _deep_get(cfg, ["trains", "scoring"])
    scoring = scoring if isinstance(scoring, dict) else {}

    dflt = TrainsDefaultsConfig(
        min_price=_as_float(trains_cfg.get("min_price")) or 20.0,
        max_per_day=_as_int(trains_cfg.get("max_per_day")) or 120,
        page_size=_as_int(trains_cfg.get("page_size")) or 40,
        limit=_as_int(trains_cfg.get("limit")) or 50,
        wizard_min_price=_as_float(trains_cfg.get("wizard_min_price")) or 30.0,
        poll_empty_retries=_as_int(trains_cfg.get("poll_empty_retries")) or 6,
        poll_dup_retries=_as_int(trains_cfg.get("poll_dup_retries")) or 4,
        poll_sleep_base=_as_float(trains_cfg.get("poll_sleep_base")) or 0.6,
        scan_cap_mult=_as_int(trains_cfg.get("scan_cap_mult")) or 25,
        api_timeout_ms=_as_int(trains_cfg.get("api_timeout_ms")) or 45_000,
        api_retries=_as_int(trains_cfg.get("api_retries")) or 6,
    )

    s = TrainScoringConfig(
        time_value_eur_per_hour=_as_float(scoring.get("time_value_eur_per_hour")) or 20.0,
        early_departure_ref_hour=_as_int(scoring.get("early_departure_ref_hour")) or 9,
        early_departure_penalty_eur_per_hour=_as_float(scoring.get("early_departure_penalty_eur_per_hour")) or 20.0,
        late_arrival_start_hour=_as_int(scoring.get("late_arrival_start_hour")) or 22,
        overnight_end_hour=_as_int(scoring.get("overnight_end_hour")) or 5,
        late_arrival_penalty_eur_per_hour=_as_float(scoring.get("late_arrival_penalty_eur_per_hour")) or 15.0,
        change_penalty_eur=_as_float(scoring.get("change_penalty_eur")) or 5.0,
    )
    return dflt, s


# ---------------- date parsing ----------------

def _today_local() -> date:
    return datetime.now(tz=TZ).date()


def _infer_year_if_missing(month: int, day: int) -> int:
    today = _today_local()
    y = today.year
    try:
        candidate = date(y, month, day)
        if candidate >= today:
            return y
    except ValueError:
        pass
    return y + 1


def parse_date_human(s: str) -> date:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty date")

    try:
        return date.fromisoformat(s)
    except Exception:
        pass

    # dd/mm[/yyyy] or dd-mm[-yyyy]
    m = re.match(r"^\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*$", s)
    if m:
        dd = int(m.group(1))
        mm = int(m.group(2))
        yy_raw = m.group(3)
        if yy_raw is None:
            yy = _infer_year_if_missing(mm, dd)
        else:
            yy_i = int(yy_raw)
            yy = (2000 + yy_i) if yy_i < 100 else yy_i
        return date(yy, mm, dd)

    raise ValueError(f"invalid date: {s!r}")


def parse_date_range_human(s: str) -> Tuple[date, date]:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty range")

    # ISO range: 2026-02-11..2026-02-13
    if ".." in s:
        a, b = s.split("..", 1)
        d1 = parse_date_human(a)
        d2 = parse_date_human(b)
        return (d1, d2) if d1 <= d2 else (d2, d1)

    # dd-dd/mm[/yyyy]
    m = re.match(r"^\s*(\d{1,2})-(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*$", s)
    if m:
        d1 = int(m.group(1))
        d2 = int(m.group(2))
        mm = int(m.group(3))
        yy_raw = m.group(4)
        if yy_raw is None:
            yy = _infer_year_if_missing(mm, min(d1, d2))
        else:
            yy_i = int(yy_raw)
            yy = (2000 + yy_i) if yy_i < 100 else yy_i
        start = date(yy, mm, min(d1, d2))
        end = date(yy, mm, max(d1, d2))
        return start, end

    d = parse_date_human(s)
    return d, d


def parse_two_ranges_human(s: str, *, reverse: bool) -> Tuple[Tuple[date, date], Optional[Tuple[date, date]]]:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty range")

    parts = s.split()
    if not reverse:
        if len(parts) != 1:
            raise ValueError(f"invalid range: {s!r} (expected a single range)")
        return parse_date_range_human(parts[0]), None

    if len(parts) == 1:
        r = parse_date_range_human(parts[0])
        return r, r
    if len(parts) == 2:
        return parse_date_range_human(parts[0]), parse_date_range_human(parts[1])

    raise ValueError(f"invalid range: {s!r} (expected 1 or 2 ranges)")


def daterange(d1: date, d2: date) -> Iterable[date]:
    if d2 < d1:
        d1, d2 = d2, d1
    cur = d1
    while cur <= d2:
        yield cur
        cur += timedelta(days=1)


# ---------------- time/format utils ----------------

def parse_iso_dt(s: str) -> datetime:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty datetime")
    # compat: "...Z"
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def fmt_dt_local_compact(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M")


def fmt_duration(td: timedelta) -> str:
    total_minutes = int(round(td.total_seconds() / 60))
    h = total_minutes // 60
    m = total_minutes % 60
    return f"{h}h{m:02d}" if h > 0 else f"{m}m"


def round2(x: float) -> float:
    return round(x + 1e-12, 2)


# ---------------- output table ----------------

def _tabulate_github(rows: List[List[Any]], headers: List[str]) -> str:
    try:
        from tabulate import tabulate  # type: ignore
        return tabulate(rows, headers=headers, tablefmt="github")
    except ImportError:
        def esc(s: str) -> str:
            return s.replace("|", "\\|")

        out: List[str] = []
        out.append("| " + " | ".join(esc(h) for h in headers) + " |")
        out.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for r in rows:
            rr = ["" if v is None else str(v) for v in r]
            out.append("| " + " | ".join(esc(c) for c in rr) + " |")
        return "\n".join(out)


# ---------------- model ----------------

@dataclass(frozen=True)
class Route:
    from_name: str
    to_name: str


@dataclass(frozen=True)
class SearchTask:
    route: Route
    d1: date
    d2: date

    @property
    def route_label(self) -> str:
        return f"{self.route.from_name} -> {self.route.to_name}"


@dataclass
class RankedSolution:
    route_label: str
    dep: datetime
    arr: datetime
    duration: timedelta
    changes: int
    price_eur: float
    adjusted_cost: float


# ---------------- API helpers ----------------

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
    # light jitter + soft backoff
    return min(8.0, base * factor * (0.85 + random.random() * 0.3))


async def _read_body_snippet(resp, limit: int = 600) -> str:
    try:
        txt = await resp.text()
        txt = (txt or "").strip().replace("\n", " ")
        return txt[:limit]
    except Exception:
        return ""


def _normalize_station_key(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()


async def api_get_json(
    request_ctx,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout_ms: int = 45_000,
    retries: int = 6,
    verbose: bool = False,
    sniff_log: Optional[List[Dict[str, Any]]] = None,
) -> Any:
    hdrs = dict(_DEFAULT_HEADERS)
    if headers:
        hdrs.update(headers)

    last_err: Optional[Exception] = None

    for attempt in range(1, retries + 1):
        t0 = datetime.now(tz=TZ)
        try:
            if verbose:
                eprint(f"[API] GET {url}")
            if sniff_log is not None:
                sniff_log.append({"type": "request", "method": "GET", "url": url})

            resp = await request_ctx.get(url, headers=hdrs, timeout=timeout_ms)
            status = int(resp.status)
            elapsed_ms = int((datetime.now(tz=TZ) - t0).total_seconds() * 1000)

            if sniff_log is not None:
                sniff_log.append(
                    {"type": "response", "method": "GET", "url": url, "status": status, "elapsed_ms": elapsed_ms}
                )

            if status in _RETRYABLE_STATUSES:
                snippet = await _read_body_snippet(resp)
                if verbose:
                    eprint(f"[API] RETRY GET status={status} attempt={attempt}/{retries} body='{snippet}'")
                await asyncio.sleep(_jitter_sleep(0.6, factor=attempt))
                continue

            if status >= 400:
                snippet = await _read_body_snippet(resp)
                raise RuntimeError(f"HTTP {status} GET {url} body='{snippet}'")

            try:
                return await resp.json()
            except Exception as je:
                snippet = await _read_body_snippet(resp)
                if verbose:
                    eprint(f"[API] JSON fail GET status={status} attempt={attempt}/{retries} body='{snippet}'")
                last_err = je
                await asyncio.sleep(_jitter_sleep(0.6, factor=attempt))
                continue

        except Exception as e:
            last_err = e
            if verbose:
                eprint(f"[API] EXC GET attempt={attempt}/{retries}: {e}")
            await asyncio.sleep(_jitter_sleep(0.6, factor=attempt))
            continue

    if last_err:
        raise last_err
    raise RuntimeError(f"GET failed {url}")


async def api_post_json(
    request_ctx,
    url: str,
    payload: Dict[str, Any],
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout_ms: int = 45_000,
    retries: int = 6,
    verbose: bool = False,
    sniff_log: Optional[List[Dict[str, Any]]] = None,
) -> Any:
    hdrs = dict(_DEFAULT_HEADERS)
    if headers:
        hdrs.update(headers)

    last_err: Optional[Exception] = None

    for attempt in range(1, retries + 1):
        t0 = datetime.now(tz=TZ)
        try:
            if verbose:
                eprint(f"[API] POST {url}")
            if sniff_log is not None:
                sniff_log.append({"type": "request", "method": "POST", "url": url})

            resp = await request_ctx.post(url, headers=hdrs, data=json.dumps(payload), timeout=timeout_ms)
            status = int(resp.status)
            elapsed_ms = int((datetime.now(tz=TZ) - t0).total_seconds() * 1000)

            if sniff_log is not None:
                sniff_log.append(
                    {"type": "response", "method": "POST", "url": url, "status": status, "elapsed_ms": elapsed_ms}
                )

            if status in _RETRYABLE_STATUSES:
                snippet = await _read_body_snippet(resp)
                if verbose:
                    eprint(f"[API] RETRY POST status={status} attempt={attempt}/{retries} body='{snippet}'")
                await asyncio.sleep(_jitter_sleep(0.7, factor=attempt))
                continue

            if status >= 400:
                snippet = await _read_body_snippet(resp)
                raise RuntimeError(f"HTTP {status} POST {url} body='{snippet}'")

            try:
                return await resp.json()
            except Exception as je:
                snippet = await _read_body_snippet(resp)
                if verbose:
                    eprint(f"[API] JSON fail POST status={status} attempt={attempt}/{retries} body='{snippet}'")
                last_err = je
                await asyncio.sleep(_jitter_sleep(0.7, factor=attempt))
                continue

        except Exception as e:
            last_err = e
            if verbose:
                eprint(f"[API] EXC POST attempt={attempt}/{retries}: {e}")
            await asyncio.sleep(_jitter_sleep(0.7, factor=attempt))
            continue

    if last_err:
        raise last_err
    raise RuntimeError(f"POST failed {url}")


# ---------------- station helpers ----------------

async def fetch_locations(
    request_ctx,
    name: str,
    *,
    limit: int = 25,
    verbose: bool = False,
    sniff_log: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    q = quote_plus(name)
    url = f"{LOC_SEARCH_URL}?name={q}&limit={int(limit)}"
    data = await api_get_json(request_ctx, url, verbose=verbose, sniff_log=sniff_log)
    return data if isinstance(data, list) else []


def pick_location_id(name_query: str, locations: List[Dict[str, Any]]) -> int:
    nq = (name_query or "").strip().casefold()

    # exact match
    for loc in locations:
        n = str(loc.get("name", "")).casefold()
        dn = str(loc.get("displayName", "")).casefold()
        if n == nq or dn == nq:
            return int(loc["id"])

    # Heuristics for Zurigo
    if any(k in nq for k in ("zur", "zuri", "zurigo", "zür", "zuer")):
        for loc in locations:
            n = str(loc.get("name", "")).casefold()
            dn = str(loc.get("displayName", "")).casefold()
            if any(k in n or k in dn for k in ("hb", "hauptbahnhof", "centrale")):
                return int(loc["id"])

    # Heuristics for Torino ("Tutte le stazioni")
    if "torino" in nq:
        for loc in locations:
            n = str(loc.get("name", "")).casefold()
            dn = str(loc.get("displayName", "")).casefold()
            if "tutte" in n or "tutte" in dn or "all" in n:
                return int(loc["id"])

    if not locations:
        raise RuntimeError(f"No station found for: {name_query}")
    return int(locations[0]["id"])


def build_departure_iso(d: date, hh: int = 0, mm: int = 0) -> str:
    dt = datetime.combine(d, time(hh, mm), TZ)
    return dt.isoformat(timespec="milliseconds")


# ---------------- scoring logic ----------------

def _late_arrival_penalty(arr_local: datetime, scoring: TrainScoringConfig) -> float:
    arr_t = arr_local.time()
    late_start = time(int(scoring.late_arrival_start_hour), 0)
    overnight_end = time(int(scoring.overnight_end_hour), 0)

    if arr_t >= late_start:
        ref = datetime.combine(arr_local.date(), late_start, TZ)
        hours = (arr_local - ref).total_seconds() / 3600.0
        return max(0.0, hours) * float(scoring.late_arrival_penalty_eur_per_hour)

    if arr_t < overnight_end:
        # arrival after midnight -> counts relative to 22:00 yesterday (or configured)
        ref = datetime.combine(arr_local.date() - timedelta(days=1), late_start, TZ)
        hours = (arr_local - ref).total_seconds() / 3600.0
        return max(0.0, hours) * float(scoring.late_arrival_penalty_eur_per_hour)

    return 0.0


def compute_solution_metrics(
    solution_item: Dict[str, Any],
    scoring: TrainScoringConfig,
) -> Optional[Tuple[datetime, datetime, timedelta, int, float, float]]:
    sol = solution_item.get("solution") or {}
    if str(sol.get("status", "")) != "SALEABLE":
        return None

    price = sol.get("price") or {}
    amount = price.get("amount", None)
    if amount is None:
        return None

    try:
        # sometimes it comes through as a string
        base_price = float(str(amount).replace(",", ".").strip())
    except Exception:
        return None

    try:
        dep = parse_iso_dt(str(sol.get("departureTime", "")))
        arr = parse_iso_dt(str(sol.get("arrivalTime", "")))
    except Exception:
        return None

    if dep.tzinfo is None:
        dep = dep.replace(tzinfo=TZ)
    if arr.tzinfo is None:
        arr = arr.replace(tzinfo=TZ)

    dep_local = dep.astimezone(TZ)
    arr_local = arr.astimezone(TZ)

    duration = arr_local - dep_local
    if duration.total_seconds() <= 0:
        return None

    # Travel time value (€/h)
    travel_hours = duration.total_seconds() / 3600.0
    time_value = travel_hours * float(scoring.time_value_eur_per_hour)

    # Early departure penalty (before the reference hour) (€/h)
    ref_hour = int(scoring.early_departure_ref_hour)
    ref_dt = datetime.combine(dep_local.date(), time(ref_hour, 0), TZ)
    early_pen = 0.0
    if dep_local < ref_dt:
        early_pen = ((ref_dt - dep_local).total_seconds() / 3600.0) * float(scoring.early_departure_penalty_eur_per_hour)

    # Late arrival penalty
    late_pen = _late_arrival_penalty(arr_local, scoring)

    # Changes penalty (€/cambio)
    nodes = sol.get("nodes") or []
    try:
        changes = max(0, int(len(nodes)) - 1)
    except Exception:
        changes = 0
    change_pen = changes * float(scoring.change_penalty_eur)

    adjusted = base_price + time_value + early_pen + late_pen + change_pen
    return dep_local, arr_local, duration, changes, base_price, adjusted


def solution_key(solution_item: Dict[str, Any]) -> str:
    sol = (solution_item.get("solution") or {})
    sid = sol.get("id", None)
    if sid is not None and str(sid).strip():
        return f"id:{sid}"

    dep = str(sol.get("departureTime", "")).strip()
    arr = str(sol.get("arrivalTime", "")).strip()

    nodes = sol.get("nodes") or []
    node_bits: List[str] = []
    if isinstance(nodes, list):
        for n in nodes:
            if not isinstance(n, dict):
                continue
            node_bits.append(
                str(
                    n.get("trainNumber")
                    or n.get("trainName")
                    or n.get("serviceName")
                    or n.get("id")
                    or ""
                ).strip()
            )

    cat = str(sol.get("category", "") or sol.get("trainCategory", "") or "").strip()
    fp = "|".join([dep, arr, cat, ",".join(node_bits)])
    return "fp:" + fp


# ---------------- core search ----------------

async def search_ranked_solutions(
    tasks: List[SearchTask],
    max_solutions_per_day: int,
    page_size: int,
    min_price: float,
    verbose: bool,
    sniff_out: Optional[str],
    *,
    scoring: TrainScoringConfig,
    no_cache: bool = False,
    api_timeout_ms: int = 45_000,
    api_retries: int = 6,
    poll_empty_retries: int = 6,
    poll_dup_retries: int = 4,
    poll_sleep_base: float = 0.6,
    scan_cap_multiplier: int = 25,
) -> List[RankedSolution]:
    sniff_log: List[Dict[str, Any]] = []

    _pw = None
    _browser = None
    _request_ctx = None
    _init_lock = asyncio.Lock()

    async def get_request_ctx():
        nonlocal _pw, _browser, _request_ctx
        if _request_ctx is not None:
            return _request_ctx

        async with _init_lock:
            if _request_ctx is not None:
                return _request_ctx

            from playwright.async_api import async_playwright
        if verbose:
            eprint("[INIT] Avvio headless browser...")
        _pw = await async_playwright().start()
        try:
            _browser = await _pw.chromium.launch(headless=True, channel="chrome")
        except Exception:
            if verbose:
                eprint("[WARN] Chrome non trovato, uso Chromium bundled.")
            _browser = await _pw.chromium.launch(headless=True)

        context = await _browser.new_context(
            locale="it-IT",
            timezone_id="Europe/Rome",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        page = await context.new_page()

        if verbose:
            eprint("[INIT] Loading homepage for cookie...")
        try:
            await page.goto("https://www.lefrecce.it/Channels.Website.WEB/", wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
            if verbose:
                eprint(f"[WARN] Loading homepage failed ({e}), continuing.")

        _request_ctx = context.request
        return _request_ctx

    try:
        async def _post_json(url: str, payload: Dict[str, Any]) -> Tuple[Any, bool, str]:
            from core.cache import app_cache, generate_cache_key
            
            cache_key = generate_cache_key("trains_api", {"url": url, "payload": payload})
            if not no_cache:
                cached = app_cache.get(cache_key)
                if cached is not None:
                    return cached, True, cache_key

            ctx = await get_request_ctx()
            res = await api_post_json(
                ctx,
                url,
                payload,
                timeout_ms=api_timeout_ms,
                retries=api_retries,
                verbose=verbose,
                sniff_log=sniff_log if (sniff_out or verbose) else None,
            )
            return res, False, cache_key

        loc_cache: Dict[str, int] = {}

        async def resolve_id(station_name: str) -> int:
            key = _normalize_station_key(station_name)
            if key in loc_cache:
                return loc_cache[key]

            from core.cache import app_cache, generate_cache_key
            from urllib.parse import quote_plus
            q = quote_plus(station_name)
            url = f"{LOC_SEARCH_URL}?name={q}&limit=50"
            
            cache_key = generate_cache_key("trains_loc", {"url": url})
            locs = None
            if not no_cache:
                locs = app_cache.get(cache_key)

            if locs is None:
                ctx = await get_request_ctx()
                locs = await api_get_json(ctx, url, verbose=verbose, sniff_log=sniff_log if (sniff_out or verbose) else None)
                if not isinstance(locs, list):
                    locs = []
                if not no_cache:
                    app_cache.set(cache_key, locs, expire=86400)
                    
            loc_id = pick_location_id(station_name, locs)
            loc_cache[key] = loc_id
            if verbose:
                eprint(f"[LOC] {station_name} -> {loc_id}")
            return loc_id

        ranked: List[RankedSolution] = []
        sem = asyncio.Semaphore(6)

        async def fetch_day(t: SearchTask, route_label: str, dep_id: int, arr_id: int, day: date) -> List[RankedSolution]:
            async with sem:
                day_ranked: List[RankedSolution] = []
                departure_iso = build_departure_iso(day, 0, 0)

                seen_keys: set[str] = set()
                collected = 0
                offset = 0
                scanned = 0

                # anti-loop cap: preserves behaviour but avoids a runaway if the endpoint changes or a page is dirty
                scan_cap = max(300, int(max_solutions_per_day) * max(1, int(scan_cap_multiplier)))

                empty_tries = 0
                dup_tries = 0
                passed_day = False

                while collected < max_solutions_per_day and scanned < scan_cap and not passed_day:
                    # "full" request (page_size) to reduce looping when many rows are discarded
                    limit = int(min(page_size, max(1, page_size)))

                    payload = {
                        "departureLocationId": dep_id,
                        "arrivalLocationId": arr_id,
                        "departureTime": departure_iso,
                        "adults": 1,
                        "children": 0,
                        "criteria": {
                            "frecceOnly": False,
                            "regionalOnly": False,
                            "noChanges": False,
                            "order": "DEPARTURE_DATE",
                            "limit": limit,
                            "offset": int(offset),
                        },
                        "advancedSearchRequest": {"bestFare": False},
                    }

                    data, is_cached, cache_key = await _post_json(SOLUTIONS_URL, payload)
                    sols = data.get("solutions") if isinstance(data, dict) else []
                    if not isinstance(sols, list):
                        sols = []

                    if not sols:
                        if not is_cached and empty_tries < poll_empty_retries:
                            empty_tries += 1
                            if verbose:
                                eprint(f"[POLL] empty page day={day} offset={offset} try {empty_tries}")
                            await asyncio.sleep(_jitter_sleep(poll_sleep_base, factor=empty_tries))
                            continue
                        if not is_cached and not no_cache:
                            from core.cache import app_cache
                            app_cache.set(cache_key, data, expire=1800)
                        break

                    empty_tries = 0
                    returned = len(sols)
                    scanned += returned

                    unique_in_call = 0
                    added_in_call = 0

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

                        dep_day = dep_local.date()
                        if dep_day < day:
                            continue
                        if dep_day > day:
                            passed_day = True
                            break

                        if base_price < min_price:
                            continue

                        day_ranked.append(
                            RankedSolution(
                                route_label=route_label,
                                dep=dep_local,
                                arr=arr_local,
                                duration=duration,
                                changes=changes,
                                price_eur=round2(base_price),
                                adjusted_cost=round2(adjusted),
                            )
                        )
                        collected += 1
                        added_in_call += 1
                        if collected >= max_solutions_per_day:
                            break

                    if passed_day:
                        if not is_cached and not no_cache:
                            from core.cache import app_cache
                            app_cache.set(cache_key, data, expire=1800)
                        break

                    # if the page is entirely duplicated, wait a moment and retry (the endpoint sometimes repeats)
                    if unique_in_call == 0:
                        if not is_cached and dup_tries < poll_dup_retries:
                            dup_tries += 1
                            if verbose:
                                eprint(f"[POLL] dup-only day={day} offset={offset} try {dup_tries}")
                            await asyncio.sleep(_jitter_sleep(poll_sleep_base, factor=dup_tries))
                            continue
                        if not is_cached and not no_cache:
                            from core.cache import app_cache
                            app_cache.set(cache_key, data, expire=1800)
                        break

                    # if we found unique rows but added none, bump the offset anyway to make progress
                    dup_tries = 0
                    offset += returned
                    
                    if not is_cached and not no_cache:
                        from core.cache import app_cache
                        app_cache.set(cache_key, data, expire=1800)

                    # micro-throttle when firing many calls in quick succession
                    if not is_cached and added_in_call == 0 and (empty_tries == 0):
                        await asyncio.sleep(_jitter_sleep(0.12, factor=1.0))
                if scanned >= scan_cap and verbose:
                    eprint(f"[WARN] scan cap reached day={day} route={route_label}")
                
                return day_ranked

        day_tasks = []
        for t in tasks:
            dep_id = await resolve_id(t.route.from_name)
            arr_id = await resolve_id(t.route.to_name)
            route_label = t.route_label

            if verbose:
                eprint(f"--- Processing {route_label} : {t.d1} -> {t.d2} ---")

            for day in daterange(t.d1, t.d2):
                day_tasks.append(fetch_day(t, route_label, dep_id, arr_id, day))
                
        results = await asyncio.gather(*day_tasks)
        for res in results:
            ranked.extend(res)


    finally:
        if _browser:
            await _browser.close()
        if _pw:
            await _pw.stop()

    if sniff_out:
        try:
            with open(sniff_out, "w", encoding="utf-8") as f:
                json.dump(sniff_log, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    ranked.sort(key=lambda x: (x.adjusted_cost, x.duration.total_seconds(), x.dep))
    return ranked


def print_table(
    ranked: List[RankedSolution],
    limit: int,
    show_route: bool,
) -> None:
    rows: List[List[Any]] = []
    for r in ranked[: max(0, limit)]:
        row: List[Any] = []
        if show_route:
            row.append(r.route_label)
        row.extend(
            [
                fmt_dt_local_compact(r.dep),
                fmt_dt_local_compact(r.arr),
                fmt_duration(r.duration),
                r.changes,
                f"{r.price_eur:.2f}",
                f"{r.adjusted_cost:.2f}",
            ]
        )
        rows.append(row)

    headers = (["Tratta"] if show_route else []) + ["Partenza", "Arrivo", "Durata", "Cambi", "Prezzo", "Costo Adj"]
    print(_tabulate_github(rows, headers=headers))


# ---------------- wizard (interactive) ----------------

def _ask(prompt: str) -> str:
    eprint(prompt, end="")
    return input().strip()


def interactive_wizard() -> Tuple[List[SearchTask], bool]:
    eprint("=== Trenitalia Ranker (wizard) ===")
    eprint("Scegli una tratta:")

    menu: List[Tuple[str, Optional[Tuple[str, str]]]] = [
        ("Zurigo - Torino", ROUTES_PRESET["zurigo-torino"]),
        ("Zurigo - Alessandria", ROUTES_PRESET["zurigo-alessandria"]),
        ("Torino - Zurigo", ROUTES_PRESET["torino-zurigo"]),
        ("Alessandria - Zurigo", ROUTES_PRESET["alessandria-zurigo"]),
        ("Custom", None),
    ]

    for i, (label, pair) in enumerate(menu, 1):
        if pair:
            eprint(f"{i}) {label}  ({pair[0]} -> {pair[1]})")
        else:
            eprint(f"{i}) {label}")

    choice: Optional[int] = None
    while choice is None:
        s = _ask(f"Scegli [1-{len(menu)}]: ")
        try:
            idx = int(s)
            if 1 <= idx <= len(menu):
                choice = idx
        except Exception:
            pass
        if choice is None:
            eprint("Scelta non valida.")

    if choice in (1, 2, 3, 4):
        a, b = menu[choice - 1][1]  # type: ignore[misc]
        base_route = Route(a, b)
    else:
        a = _ask("From (es 'Torino ( All Stations )'): ").strip()
        b = _ask("To   (es 'Zurigo HB'): ").strip()
        if not a or not b:
            raise ValueError("stazioni non valide")
        base_route = Route(a, b)

    rev = _ask("Aggiungere anche la tratta inversa? [S/N]: ").strip().lower()
    reverse = rev in ("s", "si", "sì", "y", "yes")

    if reverse:
        rng_s = _ask("Giorno/range ANDATA e (opz) RITORNO (es '3-6/03 8-11/03' oppure '3-6/03'): ")
        (d1a, d2a), rret = parse_two_ranges_human(rng_s, reverse=True)
        if rret is None:
            rret = (d1a, d2a)
        (d1r, d2r) = rret

        tasks = [
            SearchTask(route=base_route, d1=d1a, d2=d2a),
            SearchTask(route=Route(base_route.to_name, base_route.from_name), d1=d1r, d2=d2r),
        ]
        return tasks, True

    rng_s = _ask("Giorno o range (es 11-13/02 o 2026-02-11..2026-02-13): ")
    (d1, d2), _ = parse_two_ranges_human(rng_s, reverse=False)
    tasks = [SearchTask(route=base_route, d1=d1, d2=d2)]
    return tasks, False


