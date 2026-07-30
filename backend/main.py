import asyncio
import json
import hashlib
from datetime import date, timedelta
from typing import List, Optional, Tuple

import typing
if hasattr(typing, "_eval_type"):
    _original_eval_type = getattr(typing, "_eval_type")
    def _patched_eval_type(*args, **kwargs):
        kwargs.pop("prefer_fwd_module", None)
        return _original_eval_type(*args, **kwargs)
    typing._eval_type = _patched_eval_type

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
import httpx

import sys
from pathlib import Path

# Add the project root to sys.path so we can import core
sys.path.append(str(Path(__file__).resolve().parent.parent))

from core.trains import (
    SearchTask as TrainSearchTask,
    Route as TrainRoute,
    build_booking_url as build_train_booking_url,
    search_ranked_solutions,
    load_config_dict as load_trains_config,
    parse_trains_config,
)
from core.flights import (
    build_booking_url as build_flight_booking_url,
    build_rows_multi,
    load_config_dict as load_flights_config,
    parse_flights_config,
)

app = FastAPI(title="TeleTransport API")

# Add Gzip middleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Allow frontend to access the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# A search may cover several disjoint stretches of days (e.g. 24-26 Aug plus
# 31 Aug-2 Sep), so every day in the pool costs one upstream lookup per route.
# The cap keeps a single request from fanning out without bound.
MAX_SEARCH_DAYS = 14


class DateRange(BaseModel):
    start: date
    end: date


class SearchRequest(BaseModel):
    origins: List[str]
    destinations: List[str]
    dep_ranges: Optional[List[DateRange]] = None
    ret_ranges: Optional[List[DateRange]] = None
    # Single-range form. Superseded by *_ranges but still accepted: the frontend
    # and this backend deploy independently, so one can be a version behind.
    dep_start: Optional[date] = None
    dep_end: Optional[date] = None
    ret_start: Optional[date] = None
    ret_end: Optional[date] = None
    one_way: bool = False
    # UI language, so the booking links open in the language the user is reading.
    lang: str = "it"


class TrainRequest(SearchRequest):
    pass


class FlightRequest(SearchRequest):
    pass


def resolve_ranges(
    ranges: Optional[List[DateRange]],
    start: Optional[date],
    end: Optional[date],
) -> List[Tuple[date, date]]:
    """Normalize a date pool into sorted, non-overlapping (start, end) pairs."""
    raw: List[Tuple[date, date]] = []
    if ranges:
        raw = [(r.start, r.end) if r.start <= r.end else (r.end, r.start) for r in ranges]
    elif start:
        raw = [(start, end or start)]
    if not raw:
        return []

    raw.sort()
    merged = [raw[0]]
    for cur_start, cur_end in raw[1:]:
        last_start, last_end = merged[-1]
        # Touching ranges merge as well: two adjacent stretches are one search,
        # otherwise the shared boundary day would be looked up twice.
        if cur_start <= last_end + timedelta(days=1):
            merged[-1] = (last_start, max(last_end, cur_end))
        else:
            merged.append((cur_start, cur_end))
    return merged


def count_days(ranges: List[Tuple[date, date]]) -> int:
    return sum((end - start).days + 1 for start, end in ranges)


def resolve_search_window(req: SearchRequest) -> Tuple[List[Tuple[date, date]], List[Tuple[date, date]]]:
    """Outbound and return pools for a request, rejecting anything unusable."""
    dep_ranges = resolve_ranges(req.dep_ranges, req.dep_start, req.dep_end)
    if not dep_ranges:
        raise HTTPException(status_code=400, detail="An outbound date is required.")

    ret_ranges: List[Tuple[date, date]] = []
    if not req.one_way:
        ret_ranges = resolve_ranges(req.ret_ranges, req.ret_start, req.ret_end)

    for pool in (dep_ranges, ret_ranges):
        if count_days(pool) > MAX_SEARCH_DAYS:
            raise HTTPException(
                status_code=400,
                detail=f"A search may cover at most {MAX_SEARCH_DAYS} days.",
            )

    return dep_ranges, ret_ranges


def override_config(base_dict: dict, overrides: dict) -> dict:
    import copy
    out = copy.deepcopy(base_dict)
    for k, v in overrides.items():
        if isinstance(v, dict) and k in out and isinstance(out[k], dict):
            out[k] = override_config(out[k], v)
        else:
            out[k] = v
    return out

@app.get("/api/config")
def get_config():
    try:
        cfg_dict = load_flights_config(None, verbose=False)
    except Exception:
        cfg_dict = {}
    
    ui_cfg = cfg_dict.get("ui", {})
    
    # Fallbacks in case config is missing
    trains_ui = ui_cfg.get("trains", {})
    flights_ui = ui_cfg.get("flights", {})
    
    return {
        "trains": {
            "default_origin": trains_ui.get("default_origin", "Zurigo HB"),
            "default_destination": trains_ui.get("default_destination", "Alessandria"),
            "options": trains_ui.get("options", [
                "Torino ( All Stations )", "Alessandria", "Zurigo HB", 
                "Bari Centrale", "Lecce", "Milano Centrale", "Roma Termini", 
                "Napoli Centrale", "Venezia S. Lucia", "Bologna Centrale"
            ])
        },
        "flights": {
            "default_origin": flights_ui.get("default_origin", "Zurigo"),
            "default_destination": flights_ui.get("default_destination", "Bari"),
            "options": flights_ui.get("options", [
                "Zurigo", "Bari", "Brindisi", "Torino", "Milano Linate", "Milano Malpensa", 
                "Genova", "Roma", "Napoli", "Catania", "Palermo", "Venezia", "Bologna"
            ]),
            "iata_mapping": flights_ui.get("iata_mapping", {
                "zurigo": "ZRH", "zurich": "ZRH", "bari": "BRI", "brindisi": "BDS",
                "torino": "TRN", "milan": "MIL", "linate": "LIN", "malpensa": "MXP",
                "genova": "GOA", "genoa": "GOA",
                "roma": "ROM", "rome": "ROM",
                "napol": "NAP", "naples": "NAP", "catania": "CTA", "palermo": "PMO",
                "venezia": "VCE", "venice": "VCE", "bologna": "BLQ"
            })
        }
    }

@app.post("/api/trains")
async def get_trains(
    req: TrainRequest,
    x_config: Optional[str] = Header(None)
):
    try:
        cfg_dict = load_trains_config(None, verbose=False)
    except Exception:
        cfg_dict = {}

    overrides = {}
    if x_config:
        try:
            overrides = json.loads(x_config)
            cfg_dict = override_config(cfg_dict, overrides)
        except Exception:
            pass
            
    cfg_defaults, cfg_scoring = parse_trains_config(cfg_dict)

    force_no_cache = cfg_dict.get("no_cache", False) or overrides.get("no_cache", False)

    dep_ranges, ret_ranges = resolve_search_window(req)

    tasks = []
    # One task per origin/dest pair per stretch of days: search_ranked_solutions
    # walks each task day by day and ranks everything it collects together.
    for origin in req.origins:
        for dest in req.destinations:
            route = TrainRoute(origin, dest)
            for d1, d2 in dep_ranges:
                tasks.append(TrainSearchTask(route=route, d1=d1, d2=d2))

            if ret_ranges:
                ret_route = TrainRoute(dest, origin)
                for d1, d2 in ret_ranges:
                    tasks.append(TrainSearchTask(route=ret_route, d1=d1, d2=d2))

    try:
        ranked = await search_ranked_solutions(
            tasks=tasks,
            max_solutions_per_day=cfg_defaults.max_per_day,
            page_size=cfg_defaults.page_size,
            min_price=cfg_defaults.min_price,
            verbose=False,
            sniff_out=None,
            scoring=cfg_scoring,
            no_cache=force_no_cache,
            api_timeout_ms=cfg_defaults.api_timeout_ms,
            api_retries=cfg_defaults.api_retries,
            poll_empty_retries=cfg_defaults.poll_empty_retries,
            poll_dup_retries=cfg_defaults.poll_dup_retries,
            poll_sleep_base=cfg_defaults.poll_sleep_base,
            scan_cap_multiplier=cfg_defaults.scan_cap_mult,
        )
        
        # Serialize datetime objects
        results = []
        for r in ranked:
            results.append({
                "route": r.route_label,
                "dep": r.dep.isoformat(),
                "arr": r.arr.isoformat(),
                "duration_min": int(r.duration.total_seconds() / 60),
                "changes": r.changes,
                "price_eur": r.price_eur,
                "adjusted_cost": round(r.adjusted_cost, 2),
                "booking_url": build_train_booking_url(
                    r.origin, r.destination, r.dep, lang=req.lang
                ),
            })
            
        return {"data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/flights")
async def get_flights(
    req: FlightRequest,
    x_serpapi_key: Optional[str] = Header(None),
    x_config: Optional[str] = Header(None)
):
    api_key = x_serpapi_key
    if not api_key:
        raise HTTPException(status_code=400, detail="To search for flights, you must enter your SerpApi Key in Settings.")

    try:
        cfg_dict = load_flights_config(None, verbose=False)
    except Exception:
        cfg_dict = {}

    overrides = {}
    if x_config:
        try:
            overrides = json.loads(x_config)
            cfg_dict = override_config(cfg_dict, overrides)
        except Exception:
            pass
            
    cfg_defaults, cfg_scoring = parse_flights_config(cfg_dict)

    dep_ranges, ret_ranges = resolve_search_window(req)
    one_way = req.one_way or not ret_ranges

    def map_to_iata(name: str) -> str:
        n = name.lower()
        ui_cfg = cfg_dict.get("ui", {}).get("flights", {})
        mapping = ui_cfg.get("iata_mapping", {
            "zurigo": "ZRH", "zurich": "ZRH", "bari": "BRI", "brindisi": "BDS",
            "torino": "TRN", "linate": "LIN", "malpensa": "MXP", "milan": "MIL",
            "roma": "ROM", "rome": "ROM", "napol": "NAP", "naples": "NAP",
            "catania": "CTA", "palermo": "PMO", "venezia": "VCE", "venice": "VCE",
            "bologna": "BLQ"
        })
        for key, iata in mapping.items():
            if key in n:
                return iata
        return name.upper() if len(name.strip()) == 3 else name

    mapped_origins = [map_to_iata(o) for o in req.origins]
    mapped_destinations = [map_to_iata(d) for d in req.destinations]

    # A round trip pairs an outbound stretch with a return stretch, so every
    # combination is its own lookup. Day counts are capped, which bounds the fan-out
    # to what a single contiguous range of the same length already cost.
    ret_combos: List[Optional[Tuple[date, date]]] = list(ret_ranges) if ret_ranges else [None]

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            chunks = await asyncio.gather(*[
                build_rows_multi(
                    client=client,
                    api_key=api_key,
                    origins=mapped_origins,
                    destinations=mapped_destinations,
                    dep_start=dep_start,
                    dep_end=dep_end,
                    ret_rng=ret_rng,
                    one_way=one_way,
                    currency=cfg_defaults.currency,
                    hl=cfg_defaults.hl,
                    gl=cfg_defaults.gl,
                    deep_search=cfg_defaults.deep_search,
                    top_outbounds=cfg_defaults.top_outbounds,
                    top_returns=cfg_defaults.top_returns,
                    top_flights=cfg_defaults.top_flights,
                    min_ticket_price=cfg_defaults.min_price,
                    show_hidden=cfg_defaults.show_hidden,
                    no_cache=cfg_defaults.no_cache,
                    scoring=cfg_scoring,
                )
                for dep_start, dep_end in dep_ranges
                for ret_rng in ret_combos
            ])

        rows = [row for chunk in chunks for row in chunk]

        # Deduplicate
        from core.flights import dedup_rows
        if cfg_defaults.dedup:
            rows = dedup_rows(rows, one_way=one_way)

        # Each chunk arrives sorted on its own, so the merge has to be re-ranked.
        rows.sort(key=lambda r: (r.adjusted_cost, r.total_duration_min))

        # Serialize datetime objects
        results = []
        for r in rows:
            results.append({
                "origin": r.origin,
                "destination": r.destination,
                "out_dep": r.out_dep.isoformat(),
                "out_arr": r.out_arr.isoformat(),
                "in_dep": r.in_dep.isoformat() if r.in_dep else None,
                "in_arr": r.in_arr.isoformat() if r.in_arr else None,
                "total_duration_min": r.total_duration_min,
                "price_eur": r.price_eur,
                "adjusted_cost": round(r.adjusted_cost, 2),
                "booking_url": build_flight_booking_url(
                    r.origin, r.destination, r.out_dep, r.in_dep, lang=req.lang
                ),
            })
            
        return {"data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
