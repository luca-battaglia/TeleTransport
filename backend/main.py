"""HTTP API over core/. The web app reaches it through a same-origin Next.js rewrite."""

from __future__ import annotations

import asyncio
import copy
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, NoReturn, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from backend.limits import UsageLimits  # noqa: E402
from backend.schemas import ConfigOverrides, SearchRequest  # noqa: E402
from core import flights, trains  # noqa: E402
from core.cache import app_cache  # noqa: E402
from core.config import CONFIG_ENV_VAR, CONFIG_FILENAME, deep_get, load_config_dict, merge_overrides  # noqa: E402
from core.search import (  # noqa: E402
    Row,
    SearchQuery,
    count_days,
    estimate_flight_calls,
    iata_mapping,
    search_flights,
    search_trains,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
# httpx logs every request URL at INFO, and SerpApi takes the API key in the query string.
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("teletransport")


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


# A search may cover several disjoint stretches of days, and every day costs one
# upstream lookup per route, so the total is capped.
MAX_SEARCH_DAYS = 14

# Each train search drives a headless browser; this bounds how many run at once.
MAX_CONCURRENT_TRAIN_SEARCHES = _env_int("MAX_CONCURRENT_TRAIN_SEARCHES", 2)
QUEUE_TIMEOUT_S = 60

# Visitors without their own SerpApi key share SERPAPI_DEMO_KEY. Demo searches are
# kept small (one route, a few days, fewer round-trip candidates) and the daily
# call budget is sized under the free plan, so the key can never be drained.
DEMO_KEY = os.getenv("SERPAPI_DEMO_KEY", "").strip()
DEMO_MAX_CALLS_PER_SEARCH = 3
DEMO_TOP_OUTBOUNDS = 2

SERPAPI_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")

_config_path = os.getenv(CONFIG_ENV_VAR) or str(ROOT / CONFIG_FILENAME)
BASE_CONFIG: Dict[str, Any] = load_config_dict(_config_path if Path(_config_path).exists() else None)

limits = UsageLimits(
    app_cache,
    searches_per_hour=_env_int("RATE_LIMIT_SEARCHES_PER_HOUR", 40),
    demo_daily_calls=_env_int("DEMO_DAILY_CALLS", 8),
    demo_client_daily_searches=_env_int("DEMO_CLIENT_DAILY_SEARCHES", 2),
)
train_slots = asyncio.Semaphore(MAX_CONCURRENT_TRAIN_SEARCHES)

app = FastAPI(title="TeleTransport API")
app.add_middleware(GZipMiddleware, minimum_size=1000)


def fail(status: int, code: str, message: str, **params: Any) -> NoReturn:
    """Raise an error the web app can translate: it keys its message on `code`."""
    raise HTTPException(status_code=status, detail={"code": code, "message": message, **params})


def config_for(x_config: Optional[str]) -> Dict[str, Any]:
    """The server config with the client's validated overrides applied."""
    cfg = copy.deepcopy(BASE_CONFIG)
    if not x_config:
        return cfg
    try:
        overrides = ConfigOverrides.model_validate_json(x_config).model_dump(exclude_none=True)
    except ValidationError as exc:
        error = exc.errors()[0]
        where = ".".join(str(part) for part in error["loc"])
        fail(400, "invalid_config", f"Invalid setting {where}: {error['msg']}")

    # These two are whole lookups the user edits as a unit: merging them key by
    # key would keep server entries the user deleted, and the IATA rules are
    # order-sensitive, so the user's version replaces the server's.
    for path in (("flights", "airport_extras"), ("ui", "flights", "iata_mapping")):
        if deep_get(overrides, path) is not None:
            parent = deep_get(cfg, path[:-1])
            if isinstance(parent, dict):
                parent.pop(path[-1], None)
    return merge_overrides(cfg, overrides)


def build_query(req: SearchRequest) -> SearchQuery:
    ret_ranges = [] if req.one_way else [(r.start, r.end) for r in req.ret_ranges]
    query = SearchQuery.create(
        req.origins,
        req.destinations,
        [(r.start, r.end) for r in req.dep_ranges],
        ret_ranges,
        lang=req.lang,
    )
    for spans in (query.dep_ranges, query.ret_ranges):
        if count_days(spans) > MAX_SEARCH_DAYS:
            fail(400, "too_many_days", f"A search may cover at most {MAX_SEARCH_DAYS} days.", days=MAX_SEARCH_DAYS)
    return query


def check_rate(request: Request) -> str:
    client = limits.client_id(request)
    if not limits.allow_search(client):
        fail(429, "rate_limited", "Too many searches from this address. Try again in an hour.")
    return client


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def get_config() -> Dict[str, Any]:
    ui = BASE_CONFIG.get("ui", {})
    return {
        "trains": {
            "default_origin": deep_get(ui, ["trains", "default_origin"]) or "Milano Centrale",
            "default_destination": deep_get(ui, ["trains", "default_destination"]) or "Roma Termini",
        },
        "flights": {
            "default_origin": deep_get(ui, ["flights", "default_origin"]) or "Zurich",
            "default_destination": deep_get(ui, ["flights", "default_destination"]) or "Rome",
            "iata_mapping": iata_mapping(BASE_CONFIG),
        },
    }


@app.get("/api/flights/demo")
def get_flight_demo(request: Request) -> Dict[str, Any]:
    if not DEMO_KEY:
        return {"enabled": False, "searches_left": 0}
    return {"enabled": True, "searches_left": limits.demo_searches_left(limits.client_id(request))}


@app.post("/api/trains")
async def post_trains(req: SearchRequest, request: Request, x_config: Optional[str] = Header(None)) -> Dict[str, Any]:
    check_rate(request)
    cfg = config_for(x_config)
    query = build_query(req)

    try:
        await asyncio.wait_for(train_slots.acquire(), timeout=QUEUE_TIMEOUT_S)
    except asyncio.TimeoutError:
        fail(503, "server_busy", "The server is busy with other train searches. Try again in a minute.")
    try:
        return {"data": await search_trains(query, cfg)}
    except trains.StationNotFoundError as exc:
        fail(400, "station_not_found", str(exc), name=exc.name)
    except Exception:
        log.exception("train search failed")
        fail(502, "trains_upstream", "Trenitalia did not answer as expected. Try again shortly.")
    finally:
        train_slots.release()


@app.post("/api/flights")
async def post_flights(
    req: SearchRequest,
    request: Request,
    x_serpapi_key: Optional[str] = Header(None),
    x_config: Optional[str] = Header(None),
) -> Dict[str, Any]:
    client = check_rate(request)
    cfg = config_for(x_config)
    query = build_query(req)

    api_key = (x_serpapi_key or "").strip()
    if api_key:
        if not SERPAPI_KEY_PATTERN.match(api_key):
            fail(400, "invalid_api_key", "That does not look like a SerpApi key.")
        return {"data": await run_flight_search(query, cfg, api_key)}

    if not DEMO_KEY:
        fail(400, "api_key_required", "To search for flights, enter your SerpApi key in Settings.")
    return await demo_flight_search(query, cfg, client)


async def run_flight_search(
    query: SearchQuery, cfg: Dict[str, Any], api_key: str, http: Optional[httpx.AsyncClient] = None
) -> List[Row]:
    try:
        return await search_flights(query, cfg, api_key, client=http)
    except flights.SerpApiError as exc:
        fail(502, "serpapi_error", f"SerpApi: {exc}", reason=str(exc))
    except Exception:
        log.exception("flight search failed")
        fail(502, "flights_upstream", "The flight search failed. Try again shortly.")


async def demo_flight_search(query: SearchQuery, cfg: Dict[str, Any], client: str) -> Dict[str, Any]:
    if len(query.origins) != 1 or len(query.destinations) != 1:
        fail(400, "demo_single_route", "Demo searches cover a single origin and destination.")

    cfg = merge_overrides(cfg, {"flights": {"top_outbounds": DEMO_TOP_OUTBOUNDS}})
    estimate = estimate_flight_calls(query, cfg)
    if estimate > DEMO_MAX_CALLS_PER_SEARCH:
        fail(400, "demo_search_too_large", "Demo searches cover up to 3 days one-way, or one outbound and one return day.")

    reservation = limits.reserve_demo(client, estimate)
    if reservation is None:
        fail(429, "demo_exhausted", "The shared demo quota is used up for today. Add your own free SerpApi key in Settings.")

    upstream_calls = 0

    async def count_call(_: httpx.Request) -> None:
        nonlocal upstream_calls
        upstream_calls += 1

    succeeded = False
    try:
        async with httpx.AsyncClient(timeout=120, event_hooks={"request": [count_call]}) as http:
            rows = await run_flight_search(query, cfg, DEMO_KEY, http)
        succeeded = True
    finally:
        limits.settle_demo(reservation, upstream_calls, succeeded)

    return {"data": rows, "demo": {"searches_left": limits.demo_searches_left(client)}}
