import json
import hashlib
from datetime import date
from typing import List, Optional

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
    SearchTask as TreniSearchTask,
    Route as TreniRoute,
    search_ranked_solutions,
    load_config_dict as load_treni_config,
    parse_trains_config,
)
from core.flights import (
    build_rows_multi,
    load_config_dict as load_voli_config,
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

class TrainRequest(BaseModel):
    origins: List[str]
    destinations: List[str]
    dep_start: date
    dep_end: date
    ret_start: Optional[date] = None
    ret_end: Optional[date] = None
    one_way: bool = False

class FlightRequest(BaseModel):
    origins: List[str]
    destinations: List[str]
    dep_start: date
    dep_end: date
    ret_start: Optional[date] = None
    ret_end: Optional[date] = None
    one_way: bool = False

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
        cfg_dict = load_voli_config(None, verbose=False)
    except Exception:
        cfg_dict = {}
    
    ui_cfg = cfg_dict.get("ui", {})
    
    # Fallbacks in case config is missing
    treni_ui = ui_cfg.get("trains", {})
    voli_ui = ui_cfg.get("flights", {})
    
    return {
        "trains": {
            "default_origin": treni_ui.get("default_origin", "Zurigo HB"),
            "default_destination": treni_ui.get("default_destination", "Alessandria"),
            "options": treni_ui.get("options", [
                "Torino ( All Stations )", "Alessandria", "Zurigo HB", 
                "Bari Centrale", "Lecce", "Milano Centrale", "Roma Termini", 
                "Napoli Centrale", "Venezia S. Lucia", "Bologna Centrale"
            ])
        },
        "flights": {
            "default_origin": voli_ui.get("default_origin", "Zurigo"),
            "default_destination": voli_ui.get("default_destination", "Bari"),
            "options": voli_ui.get("options", [
                "Zurigo", "Bari", "Brindisi", "Torino", "Milano Linate", "Milano Malpensa", 
                "Genova", "Roma", "Napoli", "Catania", "Palermo", "Venezia", "Bologna"
            ]),
            "iata_mapping": voli_ui.get("iata_mapping", {
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
        cfg_dict = load_treni_config(None, verbose=False)
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
    
    tasks = []
    # Build tasks for all origin/dest pairs
    for origin in req.origins:
        for dest in req.destinations:
            route = TreniRoute(origin, dest)
            tasks.append(TreniSearchTask(route=route, d1=req.dep_start, d2=req.dep_end))
            
            if not req.one_way and req.ret_start and req.ret_end:
                ret_route = TreniRoute(dest, origin)
                tasks.append(TreniSearchTask(route=ret_route, d1=req.ret_start, d2=req.ret_end))

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
                "adjusted_cost": round(r.adjusted_cost, 2)
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
        cfg_dict = load_voli_config(None, verbose=False)
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
    
    ret_rng = None
    if not req.one_way and req.ret_start and req.ret_end:
        ret_rng = (req.ret_start, req.ret_end)

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

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            rows = await build_rows_multi(
                client=client,
                api_key=api_key,
                origins=mapped_origins,
                destinations=mapped_destinations,
                dep_start=req.dep_start,
                dep_end=req.dep_end,
                ret_rng=ret_rng,
                one_way=req.one_way or (ret_rng is None),
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
        
        # Deduplicate
        from core.flights import dedup_rows
        if cfg_defaults.dedup:
            rows = dedup_rows(rows, one_way=req.one_way or (ret_rng is None))
            
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
                "adjusted_cost": round(r.adjusted_cost, 2)
            })
            
        return {"data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
