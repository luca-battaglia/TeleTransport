"""Search orchestration shared by the HTTP API and the CLI.

Both front ends build a SearchQuery and get back the same serialized rows, so the
web app and the terminal always search and rank identically. Every search is
one-way: the way back is another search, with origin and destination swapped.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import httpx

from core import flights, trains
from core.config import deep_get

DateSpan = Tuple[date, date]
Row = Dict[str, Any]

# SerpApi answers a burst of parallel searches with 429s, so a flight search
# fetches its route-days a few at a time.
MAX_CONCURRENT_FLIGHT_LOOKUPS = 4

# Substring rules from place names to IATA codes, tried in order: specific
# airports ("linate") before the city that contains them ("milan").
DEFAULT_IATA_MAPPING: Dict[str, str] = {
    "zurigo": "ZRH", "zurich": "ZRH",
    "bari": "BRI", "brindisi": "BDS",
    "torino": "TRN", "turin": "TRN",
    "linate": "LIN", "malpensa": "MXP", "milan": "MXP,LIN,BGY",
    "genova": "GOA", "genoa": "GOA",
    "roma": "FCO,CIA", "rome": "FCO,CIA",
    "napol": "NAP", "naples": "NAP",
    "catania": "CTA", "palermo": "PMO",
    "venezia": "VCE", "venice": "VCE",
    "bologna": "BLQ",
    "geneva": "GVA", "ginevra": "GVA",
    "basel": "BSL", "basilea": "BSL",
    "london": "LHR,LGW,STN,LTN,LCY", "londra": "LHR,LGW,STN,LTN,LCY",
    "paris": "CDG,ORY", "parigi": "CDG,ORY",
    "amsterdam": "AMS",
    "berlin": "BER",
    "munich": "MUC", "monaco di baviera": "MUC",
    "frankfurt": "FRA", "francoforte": "FRA",
    "vienna": "VIE",
    "barcelona": "BCN", "barcellona": "BCN",
    "madrid": "MAD",
    "lisbon": "LIS",
    "athens": "ATH", "atene": "ATH",
    "new york": "JFK,EWR,LGA",
}


def normalize_ranges(spans: Iterable[DateSpan]) -> List[DateSpan]:
    """Sort spans and merge the ones that overlap or touch, so no day is searched twice."""
    ordered = sorted((a, b) if a <= b else (b, a) for a, b in spans)
    merged: List[DateSpan] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1] + timedelta(days=1):
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def days_of(spans: Iterable[DateSpan]) -> List[date]:
    return [d for start, end in spans for d in flights.daterange(start, end)]


def count_days(spans: Iterable[DateSpan]) -> int:
    return sum((end - start).days + 1 for start, end in spans)


@dataclass(frozen=True)
class SearchQuery:
    origins: Tuple[str, ...]
    destinations: Tuple[str, ...]
    dep_ranges: Tuple[DateSpan, ...]
    # Language of the booking links, so they open in the language the user reads.
    lang: str = "it"

    @classmethod
    def create(
        cls,
        origins: Sequence[str],
        destinations: Sequence[str],
        dep_ranges: Iterable[DateSpan],
        lang: str = "it",
    ) -> "SearchQuery":
        return cls(
            origins=tuple(o.strip() for o in origins if o and o.strip()),
            destinations=tuple(d.strip() for d in destinations if d and d.strip()),
            dep_ranges=tuple(normalize_ranges(dep_ranges)),
            lang=lang,
        )

    @property
    def route_days(self) -> int:
        """Every origin paired with every destination on every day: one upstream lookup each."""
        return len(self.origins) * len(self.destinations) * count_days(self.dep_ranges)


def _row(
    origin: str,
    destination: str,
    dep: datetime,
    arr: datetime,
    duration_min: int,
    changes: int,
    price_eur: float,
    adjusted_cost: float,
    booking_url: str,
) -> Row:
    """The shape of a ranked solution, the same for trains and flights."""
    return {
        "origin": origin,
        "destination": destination,
        "dep": dep.isoformat(),
        "arr": arr.isoformat(),
        "duration_min": duration_min,
        "changes": changes,
        "price_eur": price_eur,
        "adjusted_cost": round(adjusted_cost, 2),
        "booking_url": booking_url,
    }


async def search_trains(query: SearchQuery, cfg: Mapping[str, Any]) -> List[Row]:
    defaults, scoring = trains.parse_trains_config(cfg)
    tasks = [
        trains.SearchTask(trains.Route(origin, destination), d1, d2)
        for origin in query.origins
        for destination in query.destinations
        for d1, d2 in query.dep_ranges
    ]

    ranked = await trains.search_ranked_solutions(tasks, defaults, scoring)
    return [
        _row(
            r.origin, r.destination, r.dep, r.arr, int(r.duration.total_seconds() // 60), r.changes,
            r.price_eur, r.adjusted_cost, trains.build_booking_url(r.origin, r.destination, r.dep, lang=query.lang),
        )
        for r in ranked
    ]


def iata_mapping(cfg: Mapping[str, Any]) -> Dict[str, str]:
    mapping = deep_get(cfg, ["ui", "flights", "iata_mapping"])
    return dict(mapping) if isinstance(mapping, Mapping) and mapping else dict(DEFAULT_IATA_MAPPING)


def flight_endpoints(query: SearchQuery, cfg: Mapping[str, Any]) -> Tuple[List[str], List[str]]:
    mapping = iata_mapping(cfg)
    return (
        [flights.resolve_iata(o, mapping) for o in query.origins],
        [flights.resolve_iata(d, mapping) for d in query.destinations],
    )


def estimate_flight_calls(query: SearchQuery, cfg: Mapping[str, Any]) -> int:
    """SerpApi searches a query costs at most, before caching: one per route and day."""
    origins, destinations = flight_endpoints(query, cfg)
    return len(flights.expand_pairs(origins, destinations)) * count_days(query.dep_ranges)


async def search_flights(
    query: SearchQuery,
    cfg: Mapping[str, Any],
    api_key: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Row]:
    """Rank the flights of every route and day together."""
    defaults, scoring = flights.parse_flights_config(cfg)
    origins, destinations = flight_endpoints(query, cfg)
    slots = asyncio.Semaphore(MAX_CONCURRENT_FLIGHT_LOOKUPS)

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=120)

    async def lookup(origin: str, destination: str, day: date) -> List[flights.RankedRow]:
        async with slots:
            return await flights.search_day(http, api_key, origin, destination, day, defaults, scoring)

    try:
        rows = await flights.gather_rows(
            lookup(o, d, day)
            for o, d in flights.expand_pairs(origins, destinations)
            for day in days_of(query.dep_ranges)
        )
    finally:
        if owns_client:
            await http.aclose()

    if defaults.dedup:
        rows = flights.dedup_rows(rows)
    rows.sort(key=lambda r: (r.adjusted_cost, r.duration_min))

    return [
        _row(
            r.origin, r.destination, r.dep, r.arr, r.duration_min, r.changes,
            r.price_eur, r.adjusted_cost, flights.build_booking_url(r.origin, r.destination, r.dep, lang=query.lang),
        )
        for r in rows
    ]
