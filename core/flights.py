"""Google Flights search through SerpApi, and flight ranking."""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlencode

import httpx

from core.cache import app_cache, generate_cache_key
from core.config import build_settings, section

log = logging.getLogger(__name__)

SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
SERPAPI_CACHE_TTL_S = 2 * 3600

# Google Flights encodes a precise search in an opaque protobuf blob (tfs=), which
# nothing documents and which breaks without warning. The natural-language q= form
# is the stable public one: it resolves IATA codes and dates reliably.
GOOGLE_FLIGHTS_URL = "https://www.google.com/travel/flights"

AIRPORT_LIST = re.compile(r"[A-Z]{3}(,[A-Z]{3})*", re.IGNORECASE)

class SerpApiError(RuntimeError):
    """An error reported by SerpApi. Messages never contain the API key."""


@dataclass(frozen=True)
class FlightsScoringConfig:
    time_value_eur_per_hour: float = 20.0
    early_departure_ref_hour: int = 9
    early_departure_penalty_eur_per_hour: float = 20.0
    late_arrival_start_hour: int = 22
    overnight_end_hour: int = 5
    late_arrival_penalty_eur_per_hour: float = 15.0
    connection_penalty_eur: float = 5.0
    companions_time_value_eur_per_hour: float = 8.0
    # IATA code -> {fuel_eur, personal_drive_hours, companions_drive_hours}
    airport_extras: Dict[str, Dict[str, float]] = field(default_factory=dict)


@dataclass(frozen=True)
class FlightsDefaultsConfig:
    currency: str = "EUR"
    hl: str = "it"
    gl: str = "it"

    deep_search: bool = True
    show_hidden: bool = True
    no_cache: bool = False
    dedup: bool = True

    min_price: int = 3
    top_flights: int = 80


def parse_flights_config(cfg: Mapping[str, Any]) -> Tuple[FlightsDefaultsConfig, FlightsScoringConfig]:
    defaults = build_settings(FlightsDefaultsConfig, section(cfg, "flights"), "flights")
    scoring = build_settings(FlightsScoringConfig, section(cfg, "flights", "scoring"), "flights.scoring")
    scoring = dataclasses.replace(scoring, airport_extras=section(cfg, "flights", "airport_extras"))
    return defaults, scoring


def build_booking_url(origin: str, destination: str, dep: datetime, *, lang: str = "it") -> str:
    """Link to the Google Flights results for the day and route of a ranked row."""
    query = f"Flights to {destination} from {origin} on {dep.date().isoformat()} one-way"
    return f"{GOOGLE_FLIGHTS_URL}?{urlencode({'q': query, 'hl': lang})}"


def resolve_iata(name: str, mapping: Mapping[str, str]) -> str:
    """Map a free-text place to IATA codes through substring rules.

    A city with several airports maps to all of them ("FCO,CIA"): Google Flights
    takes a comma-separated list, but not metropolitan codes such as ROM. Rules
    are tried in order, so specific ones ("linate") must come before generic
    ones ("milan"). Anything unmatched that looks like codes passes through.
    """
    lowered = name.strip().lower()
    for key, iata in mapping.items():
        if key.lower() in lowered:
            return iata.upper()
    compact = re.sub(r"\s+", "", name)
    return compact.upper() if AIRPORT_LIST.fullmatch(compact) else name.strip()


def daterange(d1: date, d2: date) -> List[date]:
    out: List[date] = []
    cur = d1
    while cur <= d2:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def _try_fromiso(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def parse_dt(s: str, fallback_day: date) -> Tuple[datetime, bool]:
    """Return (dt, had_explicit_date)."""
    s = (s or "").strip()
    if not s:
        raise ValueError("empty datetime string")

    dt = _try_fromiso(s)
    if dt:
        return dt, True

    for fmt in ("%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M", "%Y-%m-%d %I:%M %p", "%I:%M %p", "%H:%M"):
        try:
            parsed = datetime.strptime(s, fmt)
        except ValueError:
            continue
        if parsed.year == 1900:
            return datetime.combine(fallback_day, parsed.time()), False
        return parsed, True

    raise ValueError(f"cannot parse datetime: {s!r}")


def hour_float(dt: datetime) -> float:
    return dt.hour + dt.minute / 60.0


def early_departure_penalty(dep: datetime, scoring: FlightsScoringConfig) -> float:
    t = hour_float(dep)
    ref = float(scoring.early_departure_ref_hour)
    return 0.0 if t >= ref else (ref - t) * float(scoring.early_departure_penalty_eur_per_hour)


def late_arrival_penalty(arr: datetime, scoring: FlightsScoringConfig) -> float:
    t = hour_float(arr)
    start = float(scoring.late_arrival_start_hour)
    if t >= start:
        return (t - start) * float(scoring.late_arrival_penalty_eur_per_hour)
    if t < float(scoring.overnight_end_hour):
        return ((24.0 - start) + t) * float(scoring.late_arrival_penalty_eur_per_hour)
    return 0.0


def time_value_cost(duration_min: int, scoring: FlightsScoringConfig) -> float:
    return (duration_min / 60.0) * float(scoring.time_value_eur_per_hour)


def connections_count(item: Dict[str, Any]) -> int:
    lay = item.get("layovers")
    if isinstance(lay, list):
        return len(lay)
    flights = item.get("flights") or []
    if isinstance(flights, list) and flights:
        return len(flights) - 1
    return 0


def airport_transfer_cost(scoring: FlightsScoringConfig, airports: Iterable[str]) -> float:
    """Ground cost of getting to and from the airports a flight uses."""
    total = 0.0
    for iata in airports:
        extras = scoring.airport_extras.get(iata)
        if not extras:
            continue
        total += (
            float(extras.get("fuel_eur", 0.0))
            + float(extras.get("personal_drive_hours", 0.0)) * float(scoring.time_value_eur_per_hour)
            + float(extras.get("companions_drive_hours", 0.0)) * float(scoring.companions_time_value_eur_per_hour)
        )
    return total


async def serpapi_get_async(client: httpx.AsyncClient, params: Dict[str, Any], timeout: int = 60) -> Dict[str, Any]:
    api_key = str(params.get("api_key", ""))

    def redact(message: str) -> str:
        return message.replace(api_key, "***") if api_key else message

    no_cache = params.get("no_cache") == "true"
    # The key is not part of the cache key: results are the same for everyone.
    cache_key = generate_cache_key("serpapi", {k: v for k, v in params.items() if k not in ("api_key", "no_cache")})
    if not no_cache:
        cached = app_cache.get(cache_key)
        if cached is not None:
            return cached

    last_exc: Optional[Exception] = None
    for attempt in range(3):
        try:
            r = await client.get(SERPAPI_ENDPOINT, params=params, timeout=timeout)
        except httpx.HTTPError as exc:
            last_exc = SerpApiError(redact(f"{type(exc).__name__}: {exc}"))
        else:
            if r.status_code >= 500:
                last_exc = SerpApiError(f"HTTP {r.status_code}")
            else:
                try:
                    data = r.json()
                except ValueError:
                    raise SerpApiError(f"HTTP {r.status_code}, body is not JSON") from None
                status = (data.get("search_metadata") or {}).get("status")
                if r.status_code >= 400 or status == "Error":
                    raise SerpApiError(redact(str(data.get("error") or f"HTTP {r.status_code}")))
                # "No results" comes back as a successful search carrying an error
                # message; it is an empty day, not a failure.
                if not no_cache:
                    app_cache.set(cache_key, data, expire=SERPAPI_CACHE_TTL_S)
                return data
        if attempt < 2:
            await asyncio.sleep(1.0 * (2 ** attempt))
    raise last_exc or SerpApiError("request failed")


def flights_list(resp: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for k in ("best_flights", "other_flights"):
        v = resp.get(k)
        if isinstance(v, list):
            out.extend(v)
    return out


def first_last_times(item: Dict[str, Any], fallback_day: date) -> Tuple[datetime, datetime]:
    fl = item.get("flights") or []
    if not isinstance(fl, list) or not fl:
        raise ValueError("missing flights[]")

    dep, _ = parse_dt((fl[0].get("departure_airport") or {}).get("time"), fallback_day)
    arr, arr_has_date = parse_dt((fl[-1].get("arrival_airport") or {}).get("time"), fallback_day)
    if not arr_has_date and arr < dep:
        arr += timedelta(days=1)
    return dep, arr


def end_airports(item: Dict[str, Any], origin: str, destination: str) -> Tuple[str, str]:
    """The airports a result actually leaves from and lands at, which may be any of those searched."""
    fl = item.get("flights") or []
    first = (fl[0].get("departure_airport") or {}).get("id") if fl else None
    last = (fl[-1].get("arrival_airport") or {}).get("id") if fl else None
    return first or origin, last or destination


def get_total_duration(item: Dict[str, Any]) -> int:
    d = item.get("total_duration")
    if isinstance(d, int) and d > 0:
        return d
    total = 0
    for key in ("flights", "layovers"):
        for seg in item.get(key) or []:
            if isinstance(seg, dict) and isinstance(seg.get("duration"), int):
                total += seg["duration"]
    return total


def get_price(item: Dict[str, Any]) -> Optional[int]:
    p = item.get("price")
    if isinstance(p, int):
        return p
    if not isinstance(p, str) or not p.strip():
        return None

    m = re.search(r"(\d[\d\.,\s]*)", p)
    if not m:
        return None
    num = m.group(1).strip().replace(" ", "")

    if "." in num and "," in num:
        # Whichever separator comes last is the decimal one.
        dec_sep, thou_sep = (".", ",") if num.rfind(".") > num.rfind(",") else (",", ".")
        num = num.replace(thou_sep, "").replace(dec_sep, ".")
    else:
        sep = "." if "." in num else ("," if "," in num else "")
        if sep:
            parts = num.split(sep)
            if len(parts) > 2:
                num = num.replace(sep, "")
            elif len(parts[1]) == 3 and parts[0]:
                num = parts[0] + parts[1]  # thousands separator
            else:
                num = num.replace(sep, ".")  # decimal separator

    try:
        return int(round(float(num)))
    except ValueError:
        digits = "".join(ch for ch in p if ch.isdigit())
        return int(digits) if digits else None


def select_top_items(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    if limit <= 0:
        return []

    def sort_key(it: Dict[str, Any]) -> Tuple[float, int, int]:
        price = get_price(it)
        duration = get_total_duration(it)
        return (
            float(price) if price is not None else float("inf"),
            duration if duration > 0 else 10**9,
            connections_count(it),
        )

    return sorted(items, key=sort_key)[:limit]


@dataclass
class RankedRow:
    origin: str
    destination: str
    dep: datetime
    arr: datetime
    duration_min: int
    changes: int
    price_eur: int
    adjusted_cost: float


def dedup_rows(rows: List[RankedRow]) -> List[RankedRow]:
    seen = set()
    out: List[RankedRow] = []
    for r in rows:
        key = (r.origin, r.destination, r.dep, r.arr, r.duration_min, r.price_eur)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


async def gather_rows(jobs: Iterable[Awaitable[List[RankedRow]]]) -> List[RankedRow]:
    """Run jobs concurrently and keep partial results.

    A failed day is logged and skipped, but when every job fails the first error
    is raised, so an invalid key surfaces as an error rather than as "no flights".
    """
    results = await asyncio.gather(*jobs, return_exceptions=True)
    errors = [r for r in results if isinstance(r, Exception)]
    if results and len(errors) == len(results):
        raise errors[0]
    for err in errors:
        log.warning("flight lookup failed: %s", err)
    return [row for r in results if not isinstance(r, BaseException) for row in r]


def _search_params(api_key: str, origin: str, destination: str, day: date, defaults: FlightsDefaultsConfig) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "engine": "google_flights",
        "api_key": api_key,
        "type": "2",
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": day.isoformat(),
        "currency": defaults.currency,
        "hl": defaults.hl,
        "gl": defaults.gl,
        "stops": "0",
        "sort_by": "2",
    }
    if defaults.deep_search:
        params["deep_search"] = "true"
    if defaults.show_hidden:
        params["show_hidden"] = "true"
    if defaults.no_cache:
        params["no_cache"] = "true"
    return params


async def search_day(
    client: httpx.AsyncClient,
    api_key: str,
    origin: str,
    destination: str,
    day: date,
    defaults: FlightsDefaultsConfig,
    scoring: FlightsScoringConfig,
) -> List[RankedRow]:
    """Rank the one-way flights of one route on one day, which costs one SerpApi search."""
    resp = await serpapi_get_async(client, _search_params(api_key, origin, destination, day, defaults))

    rows: List[RankedRow] = []
    for item in select_top_items(flights_list(resp), defaults.top_flights):
        price = get_price(item)
        if price is None or price < defaults.min_price:
            continue
        try:
            dep, arr = first_last_times(item, day)
        except ValueError:
            continue

        duration = get_total_duration(item)
        changes = connections_count(item)
        dep_airport, arr_airport = end_airports(item, origin, destination)
        adjusted = (
            float(price)
            + time_value_cost(duration, scoring)
            + early_departure_penalty(dep, scoring)
            + late_arrival_penalty(arr, scoring)
            + changes * float(scoring.connection_penalty_eur)
            + airport_transfer_cost(scoring, (dep_airport, arr_airport))
        )
        rows.append(RankedRow(dep_airport, arr_airport, dep, arr, duration, changes, price, adjusted))
    return rows


def expand_pairs(origins: Sequence[str], destinations: Sequence[str]) -> List[Tuple[str, str]]:
    return [(o, d) for o in origins for d in destinations if o and d and o != d]
