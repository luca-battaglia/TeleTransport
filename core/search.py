"""Search orchestration shared by the HTTP API and the CLI.

Both front ends build a SearchQuery and get back the same serialized rows, so the
web app and the terminal always search and rank identically.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import httpx

from core import flights, trains
from core.config import deep_get

DateSpan = Tuple[date, date]
Row = Dict[str, Any]

# Substring rules from place names to IATA codes, tried in order: specific
# airports ("linate") before the city that contains them ("milan").
DEFAULT_IATA_MAPPING: Dict[str, str] = {
    "zurigo": "ZRH", "zurich": "ZRH",
    "bari": "BRI", "brindisi": "BDS",
    "torino": "TRN", "turin": "TRN",
    "linate": "LIN", "malpensa": "MXP", "milan": "MIL",
    "genova": "GOA", "genoa": "GOA",
    "roma": "ROM", "rome": "ROM",
    "napol": "NAP", "naples": "NAP",
    "catania": "CTA", "palermo": "PMO",
    "venezia": "VCE", "venice": "VCE",
    "bologna": "BLQ",
    "geneva": "GVA", "ginevra": "GVA",
    "basel": "BSL", "basilea": "BSL",
    "london": "LON", "londra": "LON",
    "paris": "PAR", "parigi": "PAR",
    "amsterdam": "AMS",
    "berlin": "BER",
    "munich": "MUC", "monaco di baviera": "MUC",
    "frankfurt": "FRA", "francoforte": "FRA",
    "vienna": "VIE",
    "barcelona": "BCN", "barcellona": "BCN",
    "madrid": "MAD",
    "lisbon": "LIS",
    "athens": "ATH", "atene": "ATH",
    "new york": "NYC",
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
    ret_ranges: Tuple[DateSpan, ...] = ()
    # Language of the booking links, so they open in the language the user reads.
    lang: str = "it"

    @classmethod
    def create(
        cls,
        origins: Sequence[str],
        destinations: Sequence[str],
        dep_ranges: Iterable[DateSpan],
        ret_ranges: Iterable[DateSpan] = (),
        lang: str = "it",
    ) -> "SearchQuery":
        return cls(
            origins=tuple(o.strip() for o in origins if o and o.strip()),
            destinations=tuple(d.strip() for d in destinations if d and d.strip()),
            dep_ranges=tuple(normalize_ranges(dep_ranges)),
            ret_ranges=tuple(normalize_ranges(ret_ranges)),
            lang=lang,
        )

    @property
    def one_way(self) -> bool:
        return not self.ret_ranges


async def search_trains(query: SearchQuery, cfg: Mapping[str, Any]) -> List[Row]:
    """Rank train solutions. Return journeys are searched as their own routes and ranked alongside."""
    defaults, scoring = trains.parse_trains_config(cfg)

    tasks: List[trains.SearchTask] = []
    for origin in query.origins:
        for destination in query.destinations:
            outbound = trains.Route(origin, destination)
            tasks += [trains.SearchTask(outbound, d1, d2) for d1, d2 in query.dep_ranges]
            back = trains.Route(destination, origin)
            tasks += [trains.SearchTask(back, d1, d2) for d1, d2 in query.ret_ranges]

    ranked = await trains.search_ranked_solutions(tasks, defaults, scoring)
    return [
        {
            "route": r.route_label,
            "origin": r.origin,
            "destination": r.destination,
            "dep": r.dep.isoformat(),
            "arr": r.arr.isoformat(),
            "duration_min": int(r.duration.total_seconds() // 60),
            "changes": r.changes,
            "price_eur": r.price_eur,
            "adjusted_cost": round(r.adjusted_cost, 2),
            "booking_url": trains.build_booking_url(r.origin, r.destination, r.dep, lang=query.lang),
        }
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
    defaults, _ = flights.parse_flights_config(cfg)
    origins, destinations = flight_endpoints(query, cfg)
    return flights.estimate_calls(origins, destinations, days_of(query.dep_ranges), days_of(query.ret_ranges), defaults)


async def search_flights(
    query: SearchQuery,
    cfg: Mapping[str, Any],
    api_key: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Row]:
    """Rank flights. Each outbound span is paired with each return span, then everything is re-ranked."""
    defaults, scoring = flights.parse_flights_config(cfg)
    origins, destinations = flight_endpoints(query, cfg)
    ret_spans: List[Optional[DateSpan]] = list(query.ret_ranges) or [None]

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=120)
    try:
        rows = await flights.gather_rows(
            flights.build_rows_multi(http, api_key, origins, destinations, dep, ret, defaults, scoring)
            for dep in query.dep_ranges
            for ret in ret_spans
        )
    finally:
        if owns_client:
            await http.aclose()

    if defaults.dedup:
        rows = flights.dedup_rows(rows)
    rows.sort(key=lambda r: (r.adjusted_cost, r.total_duration_min))

    return [
        {
            "origin": r.origin,
            "destination": r.destination,
            "out_dep": r.out_dep.isoformat(),
            "out_arr": r.out_arr.isoformat(),
            "in_dep": r.in_dep.isoformat() if r.in_dep else None,
            "in_arr": r.in_arr.isoformat() if r.in_arr else None,
            "total_duration_min": r.total_duration_min,
            "price_eur": r.price_eur,
            "adjusted_cost": round(r.adjusted_cost, 2),
            "booking_url": flights.build_booking_url(r.origin, r.destination, r.out_dep, r.in_dep, lang=query.lang),
        }
        for r in rows
    ]
