#!/usr/bin/env python3
# flights.py
#
# Output: SOLO tabella su stdout. Prompt/errori/warning/progress su stderr.
#
# Config via TOML unico (es. travel_ranker.toml).
# Precedenza: CLI > TOML > default.
# Se TOML assente, comportamento invariato.
#
# Update:
# - preset multi-aeroporto: Zurigo -> Bari/Brindisi e viceversa
# - per Brindisi (BDS) aggiunge costi terra:
#     +30€ benzina
#     +1.5h * valore del tempo (time_value_eur_per_hour)
#     +3h * valore tempo accompagnatori (companions_time_value_eur_per_hour)
#   Applicazione:
#     one-way: 1x
#     round-trip: 2x

from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
import time
import asyncio
import httpx
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from tabulate import tabulate

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

SERPAPI_ENDPOINT = "https://serpapi.com/search.json"

IATA_BARI = "BRI"
IATA_BRINDISI = "BDS"
IATA_ZURICH = "ZRH"


def eprint(*a: Any, **k: Any) -> None:
    print(*a, file=sys.stderr, **k)


# ---------------- Preset routes ----------------

@dataclass(frozen=True)
class RoutePreset:
    label: str
    origins: Tuple[str, ...]
    destinations: Tuple[str, ...]


# Preset (IATA)
ROUTE_PRESETS: Dict[str, RoutePreset] = {
    # legacy single-airport
    "zrh-bri": RoutePreset(label="zrh -> bari", origins=(IATA_ZURICH,), destinations=(IATA_BARI,)),
    "zurigo-bari": RoutePreset(label="zrh -> bari", origins=(IATA_ZURICH,), destinations=(IATA_BARI,)),
    "trn-bri": RoutePreset(label="trn -> bari", origins=("TRN",), destinations=(IATA_BARI,)),
    "torino-bari": RoutePreset(label="trn -> bari", origins=("TRN",), destinations=(IATA_BARI,)),
    "bri-zrh": RoutePreset(label="bari -> zrh", origins=(IATA_BARI,), destinations=(IATA_ZURICH,)),
    "bari-zurigo": RoutePreset(label="bari -> zrh", origins=(IATA_BARI,), destinations=(IATA_ZURICH,)),
    "bri-trn": RoutePreset(label="bari -> trn", origins=(IATA_BARI,), destinations=("TRN",)),
    "bari-torino": RoutePreset(label="bari -> trn", origins=(IATA_BARI,), destinations=("TRN",)),

    # NEW: zurigo <-> bari/brindisi (multi)
    "zrh-bari-brindisi": RoutePreset(
        label="zurigo -> bari/brindisi",
        origins=(IATA_ZURICH,),
        destinations=(IATA_BARI, IATA_BRINDISI),
    ),
    "bari-brindisi-zrh": RoutePreset(
        label="bari/brindisi -> zurigo",
        origins=(IATA_BARI, IATA_BRINDISI),
        destinations=(IATA_ZURICH,),
    ),

    # alias opzionali comodi
    "zrh-puglia": RoutePreset(
        label="zurigo -> bari/brindisi",
        origins=(IATA_ZURICH,),
        destinations=(IATA_BARI, IATA_BRINDISI),
    ),
    "puglia-zrh": RoutePreset(
        label="bari/brindisi -> zurigo",
        origins=(IATA_BARI, IATA_BRINDISI),
        destinations=(IATA_ZURICH,),
    ),
}


# ---------------- TOML config ----------------

def _load_toml_file(path: Path) -> Dict[str, Any]:
    try:
        import tomllib  # py>=3.11
    except Exception:
        import tomli as tomllib  # type: ignore

    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _deep_get(d: Dict[str, Any], keys: List[str]) -> Any:
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
class VoliScoringConfig:
    time_value_eur_per_hour: float = 20.0
    early_departure_ref_hour: int = 9
    early_departure_penalty_eur_per_hour: float = 20.0
    late_arrival_start_hour: int = 22
    overnight_end_hour: int = 5
    late_arrival_penalty_eur_per_hour: float = 15.0
    connection_penalty_eur: float = 5.0

    # Costo orario accompagnatori (€/h)
    companions_time_value_eur_per_hour: float = 8.0
    
    # Generic airport extra costs
    airport_extras: Dict[str, Dict[str, float]] = None


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
    top_outbounds: int = 10
    top_returns: int = 20
    top_flights: int = 80
    limit: int = 50
    
    reminders: Dict[str, str] = None


def parse_flights_config(cfg: Dict[str, Any]) -> Tuple[FlightsDefaultsConfig, VoliScoringConfig]:
    voli = _deep_get(cfg, ["flights"])
    voli = voli if isinstance(voli, dict) else {}

    scoring = _deep_get(cfg, ["flights", "scoring"])
    scoring = scoring if isinstance(scoring, dict) else {}

    dflt = FlightsDefaultsConfig(
        currency=_as_str(voli.get("currency")) or "EUR",
        hl=_as_str(voli.get("hl")) or "it",
        gl=_as_str(voli.get("gl")) or "it",
        deep_search=_as_bool(voli.get("deep_search")) if _as_bool(voli.get("deep_search")) is not None else True,
        show_hidden=_as_bool(voli.get("show_hidden")) if _as_bool(voli.get("show_hidden")) is not None else True,
        no_cache=_as_bool(voli.get("no_cache")) if _as_bool(voli.get("no_cache")) is not None else False,
        dedup=_as_bool(voli.get("dedup")) if _as_bool(voli.get("dedup")) is not None else True,
        min_price=_as_int(voli.get("min_price")) or 3,
        top_outbounds=_as_int(voli.get("top_outbounds")) or 10,
        top_returns=_as_int(voli.get("top_returns")) or 20,
        top_flights=_as_int(voli.get("top_flights")) or 80,
        limit=_as_int(voli.get("limit")) or 50,
        reminders=_deep_get(cfg, ["reminders"]) or {},
    )

    s = VoliScoringConfig(
        time_value_eur_per_hour=_as_float(scoring.get("time_value_eur_per_hour")) or 20.0,
        early_departure_ref_hour=_as_int(scoring.get("early_departure_ref_hour")) or 9,
        early_departure_penalty_eur_per_hour=_as_float(scoring.get("early_departure_penalty_eur_per_hour")) or 20.0,
        late_arrival_start_hour=_as_int(scoring.get("late_arrival_start_hour")) or 22,
        overnight_end_hour=_as_int(scoring.get("overnight_end_hour")) or 5,
        late_arrival_penalty_eur_per_hour=_as_float(scoring.get("late_arrival_penalty_eur_per_hour")) or 15.0,
        connection_penalty_eur=_as_float(scoring.get("connection_penalty_eur")) or 5.0,
        companions_time_value_eur_per_hour=_as_float(scoring.get("companions_time_value_eur_per_hour")) or 8.0,
        airport_extras=voli.get("airport_extras", {})
    )
    return dflt, s


# ---------- util date/time ----------

def daterange(d1: date, d2: date) -> List[date]:
    if d2 < d1:
        return []
    out: List[date] = []
    cur = d1
    while cur <= d2:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def _try_fromiso(s: str) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)  # normalize to naive
    except Exception:
        return None


def parse_dt(s: str, fallback_day: date) -> Tuple[datetime, bool]:
    """Return (dt, had_explicit_date)."""
    s = (s or "").strip()
    if not s:
        raise ValueError("empty datetime string")

    dt = _try_fromiso(s)
    if dt:
        return dt, True

    fmts = [
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M%z",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M%z",
        "%Y/%m/%d %H:%M",
        "%Y-%m-%d %I:%M %p",
        "%I:%M %p",
        "%H:%M",
    ]
    for fmt in fmts:
        try:
            parsed = datetime.strptime(s, fmt).replace(tzinfo=None)
            if parsed.year == 1900:
                return datetime.combine(fallback_day, parsed.time()), False
            return parsed, True
        except Exception:
            continue

    # fallback: "YYYY-MM-DDTHH:MM..."
    if len(s) >= 16 and s[4] == "-" and s[7] == "-" and s[10] in (" ", "T"):
        core = s[:16].replace("T", " ")
        try:
            parsed = datetime.strptime(core, "%Y-%m-%d %H:%M")
            return parsed.replace(tzinfo=None), True
        except Exception:
            pass

    raise ValueError(f"cannot parse datetime: {s!r}")


def fmt_dt(d: datetime) -> str:
    return d.strftime("%d %b %H:%M")


def fmt_minutes(total_min: int) -> str:
    h = total_min // 60
    m = total_min % 60
    return f"{h}h{m:02d}"


def hour_float(dt: datetime) -> float:
    return dt.hour + (dt.minute / 60.0)


# ---------- parse date range (human) ----------

def _infer_year_if_missing(month: int, day: int) -> int:
    today = date.today()
    y = today.year
    try:
        candidate = date(y, month, day)
    except Exception:
        return y
    return y + 1 if candidate < today else y


def parse_date_human(s: str) -> date:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty date")
    try:
        return date.fromisoformat(s)
    except Exception:
        pass

    # dd/mm[/yy] or dd-mm[-yy]
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

    raise ValueError(f"date non valida: {s!r}")


def parse_date_range_human(s: str) -> Tuple[date, date]:
    s = (s or "").strip()
    if not s:
        raise ValueError("empty range")

    # ISO range: 2026-04-03..2026-04-05
    if ".." in s:
        a, b = s.split("..", 1)
        d1 = parse_date_human(a)
        d2 = parse_date_human(b)
        return (d1, d2) if d1 <= d2 else (d2, d1)

    # range: 3-5/04[/2026]
    m = re.match(r"^\s*(\d{1,2})-(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*$", s)
    if m:
        d1 = int(m.group(1))
        d2 = int(m.group(2))
        mm = int(m.group(3))
        yy_raw = m.group(4)
        if yy_raw is None:
            yy = _infer_year_if_missing(mm, d1)
        else:
            yy_i = int(yy_raw)
            yy = (2000 + yy_i) if yy_i < 100 else yy_i
        start = date(yy, mm, min(d1, d2))
        end = date(yy, mm, max(d1, d2))
        return start, end

    d = parse_date_human(s)
    return d, d


# ---------- costo attualizzato (configurabile) ----------

def early_departure_penalty(dep: datetime, scoring: VoliScoringConfig) -> float:
    t = hour_float(dep)
    ref = float(scoring.early_departure_ref_hour)
    return 0.0 if t >= ref else (ref - t) * float(scoring.early_departure_penalty_eur_per_hour)


def late_arrival_penalty(arr: datetime, scoring: VoliScoringConfig) -> float:
    t = hour_float(arr)
    start = float(scoring.late_arrival_start_hour)
    end_overnight = float(scoring.overnight_end_hour)
    
    if t >= start:
        return (t - start) * float(scoring.late_arrival_penalty_eur_per_hour)
        
    if t < end_overnight:
        hours = (24.0 - start) + t
        return hours * float(scoring.late_arrival_penalty_eur_per_hour)
        
    return 0.0


def time_value_cost(total_duration_min: int, scoring: VoliScoringConfig) -> float:
    return (total_duration_min / 60.0) * float(scoring.time_value_eur_per_hour)


def connections_count(item: Dict[str, Any]) -> int:
    lay = item.get("layovers")
    if isinstance(lay, list):
        return len(lay)
    flights = item.get("flights") or []
    if isinstance(flights, list) and len(flights) >= 1:
        return max(0, len(flights) - 1)
    return 0


# ---------- extra costi aeroporti ----------

def airport_transfer_cost(scoring: VoliScoringConfig, one_way: bool, origin: str, destination: str) -> float:
    if not scoring.airport_extras:
        return 0.0
    
    total_extra = 0.0
    uses_map = {}
    
    if origin in scoring.airport_extras:
        uses_map[origin] = uses_map.get(origin, 0) + 1
    if destination in scoring.airport_extras:
        uses_map[destination] = uses_map.get(destination, 0) + 1
        
    if not one_way:
        # Double the uses for round-trip
        for k in uses_map:
            uses_map[k] *= 2
            
    for iata, uses in uses_map.items():
        if uses > 0:
            extras = scoring.airport_extras.get(iata, {})
            fuel = float(extras.get("fuel_eur", 0.0))
            pers_hours = float(extras.get("personal_drive_hours", 0.0))
            comp_hours = float(extras.get("companions_drive_hours", 0.0))
            
            cost = (
                fuel
                + pers_hours * float(scoring.time_value_eur_per_hour)
                + comp_hours * float(scoring.companions_time_value_eur_per_hour)
            )
            total_extra += (cost * uses)
            
    return total_extra


# ---------- SerpApi helpers ----------

async def serpapi_get_async(client: httpx.AsyncClient, params: Dict[str, Any], timeout: int = 60) -> Dict[str, Any]:
    last_exc: Optional[Exception] = None
    for attempt in range(3):
        try:
            r = await client.get(SERPAPI_ENDPOINT, params=params, timeout=timeout)
            r.raise_for_status()
            data = r.json()
            if data.get("search_metadata", {}).get("status") == "Error" or "error" in data:
                raise RuntimeError(str(data.get("error") or data))
            return data
        except httpx.HTTPStatusError as e:
            last_exc = e
            status = e.response.status_code
            if status in (429, 500, 502, 503, 504) and attempt < 2:
                await asyncio.sleep(1.0 * (2 ** attempt))
                continue
            raise
        except Exception as e:
            last_exc = e
            if attempt < 2:
                await asyncio.sleep(1.0 * (2 ** attempt))
                continue
            raise
    raise RuntimeError(str(last_exc) if last_exc else "unknown error")


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

    first = fl[0]
    last = fl[-1]

    dep_s = (first.get("departure_airport") or {}).get("time")
    arr_s = (last.get("arrival_airport") or {}).get("time")

    dep, dep_has_date = parse_dt(dep_s, fallback_day)
    arr, arr_has_date = parse_dt(arr_s, fallback_day)

    if (not arr_has_date) and arr < dep:
        arr = arr + timedelta(days=1)

    return dep, arr


def get_total_duration(item: Dict[str, Any]) -> int:
    d = item.get("total_duration")
    if isinstance(d, int) and d > 0:
        return d
    tot = 0
    fl = item.get("flights") or []
    if isinstance(fl, list):
        for seg in fl:
            if isinstance(seg, dict) and isinstance(seg.get("duration"), int):
                tot += seg["duration"]
    lay = item.get("layovers") or []
    if isinstance(lay, list):
        for l in lay:
            if isinstance(l, dict) and isinstance(l.get("duration"), int):
                tot += l["duration"]
    return tot


def get_price(item: Dict[str, Any]) -> Optional[int]:
    p = item.get("price")
    if isinstance(p, int):
        return p
    if isinstance(p, str):
        s = p.strip()
        if not s:
            return None

        m = re.search(r"(\d[\d\.,\s]*)", s)
        if not m:
            return None

        num = m.group(1).strip().replace(" ", "")

        if "." in num and "," in num:
            last_dot = num.rfind(".")
            last_com = num.rfind(",")
            if last_dot > last_com:
                dec_sep, thou_sep = ".", ","
            else:
                dec_sep, thou_sep = ",", "."
            num = num.replace(thou_sep, "").replace(dec_sep, ".")
        else:
            sep = "." if "." in num else ("," if "," in num else "")
            if sep:
                parts = num.split(sep)
                if len(parts) > 2:
                    num = num.replace(sep, "")
                else:
                    left = parts[0]
                    right = parts[1] if len(parts) == 2 else ""
                    if right and len(right) == 3 and left:
                        num = left + right  # migliaia
                    else:
                        num = num.replace(sep, ".")  # decimale

        try:
            return int(round(float(num)))
        except Exception:
            digits = "".join(ch for ch in s if ch.isdigit())
            return int(digits) if digits else None

    return None


def _score_item(it: Dict[str, Any]) -> Tuple[float, int, int]:
    p = get_price(it)
    price_key = float(p) if p is not None else float("inf")
    dur = get_total_duration(it)
    dur_key = dur if dur > 0 else 10**9
    conns = connections_count(it)
    return (price_key, dur_key, conns)


def select_top_from_items(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    if limit <= 0:
        return []
    scored = [(_score_item(it), it) for it in items]
    scored.sort(key=lambda x: x[0])
    return [it for _, it in scored[:limit]]


def select_top_items(resp: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    return select_top_from_items(flights_list(resp), limit)


def apply_serpapi_extras(params: Dict[str, Any], *, show_hidden: bool, no_cache: bool) -> None:
    if show_hidden:
        params["show_hidden"] = "true"
    if no_cache:
        params["no_cache"] = "true"


# ---------- output model ----------

@dataclass
class RankedRow:
    origin: str
    destination: str
    out_dep: datetime
    out_arr: datetime
    in_dep: Optional[datetime]
    in_arr: Optional[datetime]
    total_duration_min: int
    price_eur: int
    adjusted_cost: float


def dedup_rows(rows: List[RankedRow], one_way: bool) -> List[RankedRow]:
    seen = set()
    out: List[RankedRow] = []
    for r in rows:
        if one_way:
            key = (
                r.origin, r.destination,
                r.out_dep, r.out_arr,
                r.total_duration_min,
                r.price_eur,
            )
        else:
            key = (
                r.origin, r.destination,
                r.out_dep, r.out_arr,
                r.in_dep, r.in_arr,
                r.total_duration_min,
                r.price_eur,
            )
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


# ---------- core logic (single pair) ----------

async def build_roundtrip_rows(
    client: httpx.AsyncClient,
    api_key: str,
    origin: str,
    destination: str,
    dep_start: date,
    dep_end: date,
    ret_start: date,
    ret_end: date,
    currency: str,
    hl: str,
    gl: str,
    deep_search: bool,
    top_outbounds: int,
    top_returns: int,
    min_ticket_price: int,
    show_hidden: bool,
    no_cache: bool,
    scoring: VoliScoringConfig,
    ground_extra_eur: float,
) -> List[RankedRow]:

    dep_days = daterange(dep_start, dep_end)
    ret_days = daterange(ret_start, ret_end)
    serp_stops = "0"

    async def fetch_pair(dep_day: date, ret_day: date) -> List[RankedRow]:
        if ret_day <= dep_day:
            return []
            
        base_params: Dict[str, Any] = {
            "engine": "google_flights",
            "api_key": api_key,
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": dep_day.isoformat(),
            "return_date": ret_day.isoformat(),
            "type": "1",
            "currency": currency,
            "hl": hl,
            "gl": gl,
            "stops": serp_stops,
            "sort_by": "2",
        }
        if deep_search:
            base_params["deep_search"] = "true"
        apply_serpapi_extras(base_params, show_hidden=show_hidden, no_cache=no_cache)

        try:
            resp_out = await serpapi_get_async(client, base_params)
        except Exception as e:
            eprint(f"Errore API (andata) {origin}->{destination}: {e}")
            return []

        out_all = flights_list(resp_out)
        out_all = [it for it in out_all if it.get("departure_token")]
        out_items = select_top_from_items(out_all, top_outbounds)

        pair_rows = []
        for out_item in out_items:
            dep_token = out_item.get("departure_token")
            if not dep_token:
                continue

            try:
                out_dep, out_arr = first_last_times(out_item, dep_day)
            except Exception:
                continue

            out_dur = get_total_duration(out_item)
            out_conns = connections_count(out_item)

            ret_params = dict(base_params)
            ret_params["departure_token"] = dep_token

            try:
                resp_ret = await serpapi_get_async(client, ret_params)
            except Exception as e:
                eprint(f"Errore API (ritorno) {origin}->{destination}: {e}")
                continue

            ret_items = select_top_items(resp_ret, top_returns)

            for ret_item in ret_items:
                price = get_price(ret_item)
                if price is None or price < min_ticket_price:
                    continue

                try:
                    in_dep, in_arr = first_last_times(ret_item, ret_day)
                except Exception:
                    continue

                in_dur = get_total_duration(ret_item)
                in_conns = connections_count(ret_item)

                total_dur = out_dur + in_dur
                conns_penalty = (out_conns + in_conns) * float(scoring.connection_penalty_eur)

                adjusted = (
                    float(price)
                    + time_value_cost(total_dur, scoring)
                    + early_departure_penalty(out_dep, scoring)
                    + early_departure_penalty(in_dep, scoring)
                    + late_arrival_penalty(out_arr, scoring)
                    + late_arrival_penalty(in_arr, scoring)
                    + conns_penalty
                    + float(ground_extra_eur)
                )

                pair_rows.append(
                    RankedRow(
                        origin=origin,
                        destination=destination,
                        out_dep=out_dep,
                        out_arr=out_arr,
                        in_dep=in_dep,
                        in_arr=in_arr,
                        total_duration_min=total_dur,
                        price_eur=price,
                        adjusted_cost=adjusted,
                    )
                )
        return pair_rows

    tasks = [fetch_pair(d, r) for d in dep_days for r in ret_days if r > d]
    if not tasks:
        return []
    
    results = await asyncio.gather(*tasks)
    rows: List[RankedRow] = []
    for res in results:
        rows.extend(res)

    rows.sort(key=lambda x: (x.adjusted_cost, x.total_duration_min))
    return rows


async def build_oneway_rows(
    client: httpx.AsyncClient,
    api_key: str,
    origin: str,
    destination: str,
    dep_start: date,
    dep_end: date,
    currency: str,
    hl: str,
    gl: str,
    deep_search: bool,
    top_flights: int,
    min_ticket_price: int,
    show_hidden: bool,
    no_cache: bool,
    scoring: VoliScoringConfig,
    ground_extra_eur: float,
) -> List[RankedRow]:

    dep_days = daterange(dep_start, dep_end)
    serp_stops = "0"

    async def fetch_day(dep_day: date) -> List[RankedRow]:
        params: Dict[str, Any] = {
            "engine": "google_flights",
            "api_key": api_key,
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": dep_day.isoformat(),
            "type": "2",
            "currency": currency,
            "hl": hl,
            "gl": gl,
            "stops": serp_stops,
            "sort_by": "2",
        }
        if deep_search:
            params["deep_search"] = "true"
        apply_serpapi_extras(params, show_hidden=show_hidden, no_cache=no_cache)

        try:
            resp = await serpapi_get_async(client, params)
        except Exception as e:
            eprint(f"Errore API {origin}->{destination}: {e}")
            return []

        day_rows = []
        items = select_top_items(resp, top_flights)

        for item in items:
            price = get_price(item)
            if price is None or price < min_ticket_price:
                continue

            try:
                dep, arr = first_last_times(item, dep_day)
            except Exception:
                continue

            dur = get_total_duration(item)
            conns = connections_count(item)

            adjusted = (
                float(price)
                + time_value_cost(dur, scoring)
                + early_departure_penalty(dep, scoring)
                + late_arrival_penalty(arr, scoring)
                + (conns * float(scoring.connection_penalty_eur))
                + float(ground_extra_eur)
            )

            day_rows.append(
                RankedRow(
                    origin=origin,
                    destination=destination,
                    out_dep=dep,
                    out_arr=arr,
                    in_dep=None,
                    in_arr=None,
                    total_duration_min=dur,
                    price_eur=price,
                    adjusted_cost=adjusted,
                )
            )
        return day_rows

    tasks = [fetch_day(d) for d in dep_days]
    if not tasks:
        return []
        
    results = await asyncio.gather(*tasks)
    rows: List[RankedRow] = []
    for res in results:
        rows.extend(res)

    rows.sort(key=lambda x: (x.adjusted_cost, x.total_duration_min))
    return rows


# ---------- multi route runner ----------

def expand_pairs(origins: List[str], destinations: List[str]) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for o in origins:
        for d in destinations:
            if o and d and o != d:
                out.append((o, d))
    return out


async def build_rows_multi(
    *,
    client: httpx.AsyncClient,
    api_key: str,
    origins: List[str],
    destinations: List[str],
    dep_start: date,
    dep_end: date,
    ret_rng: Optional[Tuple[date, date]],
    one_way: bool,
    currency: str,
    hl: str,
    gl: str,
    deep_search: bool,
    top_outbounds: int,
    top_returns: int,
    top_flights: int,
    min_ticket_price: int,
    show_hidden: bool,
    no_cache: bool,
    scoring: VoliScoringConfig,
) -> List[RankedRow]:

    pairs = expand_pairs(origins, destinations)
    if not pairs:
        return []

    tasks = []

    for (o, d) in pairs:
        extra = airport_transfer_cost(scoring, one_way=one_way or (ret_rng is None), origin=o, destination=d)

        if one_way or ret_rng is None:
            tasks.append(
                build_oneway_rows(
                    client=client,
                    api_key=api_key,
                    origin=o,
                    destination=d,
                    dep_start=dep_start,
                    dep_end=dep_end,
                    currency=currency,
                    hl=hl,
                    gl=gl,
                    deep_search=deep_search,
                    top_flights=top_flights,
                    min_ticket_price=min_ticket_price,
                    show_hidden=show_hidden,
                    no_cache=no_cache,
                    scoring=scoring,
                    ground_extra_eur=extra,
                )
            )
        else:
            ret_start, ret_end = ret_rng
            tasks.append(
                build_roundtrip_rows(
                    client=client,
                    api_key=api_key,
                    origin=o,
                    destination=d,
                    dep_start=dep_start,
                    dep_end=dep_end,
                    ret_start=ret_start,
                    ret_end=ret_end,
                    currency=currency,
                    hl=hl,
                    gl=gl,
                    deep_search=deep_search,
                    top_outbounds=top_outbounds,
                    top_returns=top_returns,
                    min_ticket_price=min_ticket_price,
                    show_hidden=show_hidden,
                    no_cache=no_cache,
                    scoring=scoring,
                    ground_extra_eur=extra,
                )
            )

    results = await asyncio.gather(*tasks)
    rows: List[RankedRow] = []
    for res in results:
        rows.extend(res)

    rows.sort(key=lambda x: (x.adjusted_cost, x.total_duration_min))
    return rows


def build_oneway_rows(
    session: requests.Session,
    api_key: str,
    origin: str,
    destination: str,
    dep_start: date,
    dep_end: date,
    currency: str,
    hl: str,
    gl: str,
    deep_search: bool,
    top_flights: int,
    min_ticket_price: int,
    show_hidden: bool,
    no_cache: bool,
    scoring: VoliScoringConfig,
    ground_extra_eur: float,
) -> List[RankedRow]:

    rows: List[RankedRow] = []
    dep_days = daterange(dep_start, dep_end)

    serp_stops = "0"  # any stops

    for dep_day in dep_days:
        params: Dict[str, Any] = {
            "engine": "google_flights",
            "api_key": api_key,
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": dep_day.isoformat(),
            "type": "2",
            "currency": currency,
            "hl": hl,
            "gl": gl,
            "stops": serp_stops,
            "sort_by": "2",
        }
        if deep_search:
            params["deep_search"] = "true"
        apply_serpapi_extras(params, show_hidden=show_hidden, no_cache=no_cache)

        try:
            resp = serpapi_get(session, params)
        except Exception as e:
            eprint(f"Errore API {origin}->{destination}: {e}")
            continue

        items = select_top_items(resp, top_flights)

        for item in items:
            price = get_price(item)
            if price is None or price < min_ticket_price:
                continue

            try:
                dep, arr = first_last_times(item, dep_day)
            except Exception:
                continue

            dur = get_total_duration(item)
            conns = connections_count(item)

            adjusted = (
                float(price)
                + time_value_cost(dur, scoring)
                + early_departure_penalty(dep, scoring)
                + late_arrival_penalty(arr, scoring)
                + (conns * float(scoring.connection_penalty_eur))
                + float(ground_extra_eur)
            )

            rows.append(
                RankedRow(
                    origin=origin,
                    destination=destination,
                    out_dep=dep,
                    out_arr=arr,
                    in_dep=None,
                    in_arr=None,
                    total_duration_min=dur,
                    price_eur=price,
                    adjusted_cost=adjusted,
                )
            )

    rows.sort(key=lambda x: (x.adjusted_cost, x.total_duration_min))
    return rows


# ---------- multi route runner ----------

def expand_pairs(origins: List[str], destinations: List[str]) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for o in origins:
        for d in destinations:
            if o and d and o != d:
                out.append((o, d))
    return out


def build_rows_multi(
    *,
    session: requests.Session,
    api_key: str,
    origins: List[str],
    destinations: List[str],
    dep_start: date,
    dep_end: date,
    ret_rng: Optional[Tuple[date, date]],
    one_way: bool,
    currency: str,
    hl: str,
    gl: str,
    deep_search: bool,
    top_outbounds: int,
    top_returns: int,
    top_flights: int,
    min_ticket_price: int,
    show_hidden: bool,
    no_cache: bool,
    scoring: VoliScoringConfig,
) -> List[RankedRow]:

    pairs = expand_pairs(origins, destinations)
    if not pairs:
        return []

    rows: List[RankedRow] = []

    for (o, d) in pairs:
        extra = airport_transfer_cost(scoring, one_way=one_way or (ret_rng is None), origin=o, destination=d)

        if one_way or ret_rng is None:
            rows.extend(
                build_oneway_rows(
                    session=session,
                    api_key=api_key,
                    origin=o,
                    destination=d,
                    dep_start=dep_start,
                    dep_end=dep_end,
                    currency=currency,
                    hl=hl,
                    gl=gl,
                    deep_search=deep_search,
                    top_flights=top_flights,
                    min_ticket_price=min_ticket_price,
                    show_hidden=show_hidden,
                    no_cache=no_cache,
                    scoring=scoring,
                    ground_extra_eur=extra,
                )
            )
            continue

        ret_start, ret_end = ret_rng
        rows.extend(
            build_roundtrip_rows(
                session=session,
                api_key=api_key,
                origin=o,
                destination=d,
                dep_start=dep_start,
                dep_end=dep_end,
                ret_start=ret_start,
                ret_end=ret_end,
                currency=currency,
                hl=hl,
                gl=gl,
                deep_search=deep_search,
                top_outbounds=top_outbounds,
                top_returns=top_returns,
                min_ticket_price=min_ticket_price,
                show_hidden=show_hidden,
                no_cache=no_cache,
                scoring=scoring,
                ground_extra_eur=extra,
            )
        )

    rows.sort(key=lambda x: (x.adjusted_cost, x.total_duration_min))
    return rows


# ---------- printing ----------

def print_table(rows: List[RankedRow], limit: int, one_way: bool) -> None:
    if one_way:
        table = []
        for r in rows[:limit]:
            table.append([
                f"{r.origin}->{r.destination} {fmt_dt(r.out_dep)}->{fmt_dt(r.out_arr)}",
                fmt_minutes(r.total_duration_min),
                f"{r.price_eur}",
                f"{r.adjusted_cost:.2f}",
            ])
        print(tabulate(
            table,
            headers=["Volo", "Durata", "Prezzo (€)", "Costo Adj"],
            tablefmt="github"
        ))
        return

    table = []
    for r in rows[:limit]:
        table.append([
            f"{r.origin}->{r.destination} {fmt_dt(r.out_dep)}->{fmt_dt(r.out_arr)}",
            f"{r.destination}->{r.origin} {fmt_dt(r.in_dep)}->{fmt_dt(r.in_arr)}" if r.in_dep and r.in_arr else "",
            fmt_minutes(r.total_duration_min),
            f"{r.price_eur}",
            f"{r.adjusted_cost:.2f}",
        ])
    print(tabulate(
        table,
        headers=["Andata", "Ritorno", "Tot h", "€", "Costo Adj"],
        tablefmt="github"
    ))


# ---------- wizard (interactive) ----------

def _ask(prompt: str) -> str:
    eprint(prompt, end="")
    return input().strip()


@dataclass(frozen=True)
class RouteSelection:
    origins: List[str]
    destinations: List[str]


def interactive_wizard() -> Tuple[RouteSelection, Tuple[date, date], Optional[Tuple[date, date]], bool]:
    eprint("=== Flights Ranker (wizard) ===")

    keys = list(ROUTE_PRESETS.keys())

    # per evitare doppioni (alias), mostriamo una sola volta per label+origins+destinations
    shown: List[Tuple[str, Tuple[str, ...], Tuple[str, ...], str]] = []
    unique_keys: List[str] = []
    for k in keys:
        p = ROUTE_PRESETS[k]
        sig = (p.label, p.origins, p.destinations)
        if sig in [(x[0], x[1], x[2]) for x in shown]:
            continue
        shown.append((p.label, p.origins, p.destinations, k))
        unique_keys.append(k)

    for i, k in enumerate(unique_keys, 1):
        p = ROUTE_PRESETS[k]
        # descrizione: origini -> destinazioni (se multi, con /)
        o_txt = "/".join(p.origins)
        d_txt = "/".join(p.destinations)
        eprint(f"{i}) {p.label}  ({o_txt} -> {d_txt})")
    eprint(f"{len(unique_keys) + 1}) custom (inserisci IATA)")

    while True:
        choice = _ask(f"Scegli tratta [1-{len(unique_keys) + 1}]: ")
        try:
            idx = int(choice)
            if 1 <= idx <= len(unique_keys):
                preset = ROUTE_PRESETS[unique_keys[idx - 1]]
                sel = RouteSelection(origins=list(preset.origins), destinations=list(preset.destinations))
                break
            if idx == len(unique_keys) + 1:
                origin = _ask("From (IATA, es ZRH): ").upper()
                dest = _ask("To   (IATA, es BRI): ").upper()
                sel = RouteSelection(origins=[origin], destinations=[dest])
                break
        except Exception:
            pass
        eprint("Scelta non valida.")

    mode = _ask("Modalità: 1) A/R   2) Solo andata  [1/2]: ")
    one_way = (mode.strip() == "2")

    dep_s = _ask("Range andata (es 11-13/02 o 2026-02-11..2026-02-13): ")
    dep_rng = parse_date_range_human(dep_s)

    ret_rng: Optional[Tuple[date, date]] = None
    if not one_way:
        ret_s = _ask("Range ritorno (es 24-25/02 o 2026-02-24..2026-02-25): ")
        ret_rng = parse_date_range_human(ret_s)

    return sel, dep_rng, ret_rng, one_way


