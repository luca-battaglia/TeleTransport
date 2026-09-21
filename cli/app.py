"""Command-line front end: the same searches and ranking as the web app."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence

from dotenv import load_dotenv
from tabulate import tabulate

from core import flights, trains
from core.config import load_config_dict, merge_overrides
from core.search import DateSpan, Row, SearchQuery, search_flights, search_trains

ROOT = Path(__file__).resolve().parent.parent

# Same defaults as the result selector in the web app.
DEFAULT_LIMIT = {"best": 10, "day": 3}

DATES_HELP = "a day or a range: 2026-10-03, 3/10, 3-5/10, 30/9..2/10. Repeat for disjoint days."


def parse_day(text: str, today: date) -> date:
    """ISO or day/month[/year]. Without a year, the next occurrence of that date."""
    text = text.strip()
    try:
        return date.fromisoformat(text)
    except ValueError:
        pass
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?", text)
    if not m:
        raise ValueError(f"invalid date: {text!r}")
    day, month = int(m[1]), int(m[2])
    if m[3]:
        year = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
    else:
        year = today.year if (month, day) >= (today.month, today.day) else today.year + 1
    return date(year, month, day)


def parse_span(text: str, today: Optional[date] = None) -> DateSpan:
    today = today or date.today()
    if ".." in text:
        first, last = (parse_day(part, today) for part in text.split("..", 1))
    else:
        m = re.fullmatch(r"(\d{1,2})-(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?", text.strip())
        if m:
            low, high = sorted((int(m[1]), int(m[2])))
            year = f"/{m[4]}" if m[4] else ""
            first = parse_day(f"{low}/{m[3]}{year}", today)
            # The year comes from the first day, so a range never straddles two guesses.
            last = first.replace(day=high)
        else:
            first = last = parse_day(text, today)
    return (first, last) if first <= last else (last, first)


def _departure(row: Row) -> datetime:
    return datetime.fromisoformat(row.get("out_dep") or row["dep"])


def _duration(row: Row) -> int:
    return row.get("duration_min", row.get("total_duration_min", 0))


def order_rows(rows: Sequence[Row], sort: str, limit: int) -> List[Row]:
    """Best first overall, or grouped by departure day with `limit` rows per day."""
    if sort == "best":
        return list(rows[:limit])
    by_day = sorted(rows, key=lambda r: (_departure(r).date(), r["adjusted_cost"], _duration(r)))
    taken: Dict[date, int] = {}
    out: List[Row] = []
    for row in by_day:
        day = _departure(row).date()
        if taken.get(day, 0) < limit:
            taken[day] = taken.get(day, 0) + 1
            out.append(row)
    return out


def _fmt_time(value: Optional[str]) -> str:
    return datetime.fromisoformat(value).strftime("%Y-%m-%d %H:%M") if value else ""


def _fmt_duration(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}"


def render_table(rows: Sequence[Row], mode: str, links: bool) -> str:
    table: List[List[Any]] = []
    if mode == "trains":
        headers = ["Route", "Departure", "Arrival", "Duration", "Changes", "Price (EUR)", "Adj. cost (EUR)"]
        for r in rows:
            table.append([r["route"], _fmt_time(r["dep"]), _fmt_time(r["arr"]), _fmt_duration(r["duration_min"]),
                          r["changes"], r["price_eur"], r["adjusted_cost"]])
    else:
        round_trip = any(r["in_dep"] for r in rows)
        headers = ["Route", "Outbound"] + (["Return"] if round_trip else []) + ["Duration", "Price (EUR)", "Adj. cost (EUR)"]
        for r in rows:
            line = [f"{r['origin']} -> {r['destination']}", f"{_fmt_time(r['out_dep'])} -> {_fmt_time(r['out_arr'])[-5:]}"]
            if round_trip:
                line.append(f"{_fmt_time(r['in_dep'])} -> {_fmt_time(r['in_arr'])[-5:]}" if r["in_dep"] else "")
            line += [_fmt_duration(r["total_duration_min"]), r["price_eur"], r["adjusted_cost"]]
            table.append(line)
    if links:
        headers.append("Link")
        for line, r in zip(table, rows, strict=True):
            line.append(r["booking_url"])
    return tabulate(table, headers=headers, tablefmt="github", floatfmt=".2f")


def reminders_for(cfg: Mapping[str, Any], mode: str) -> List[str]:
    """[reminders] entries: plain strings apply to flights, tables pick a target."""
    out = []
    for value in (cfg.get("reminders") or {}).values():
        text, target = (value, "flights") if isinstance(value, str) else (value.get("text", ""), value.get("target", "flights"))
        if text and target in (mode, "both"):
            out.append(text)
    return out


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--from", dest="origins", action="append", required=True, metavar="PLACE",
                        help="origin; repeat the flag for several origins")
    common.add_argument("--to", dest="destinations", action="append", required=True, metavar="PLACE",
                        help="destination; repeat the flag for several destinations")
    common.add_argument("--dep", action="append", required=True, metavar="DATES", help=f"outbound dates, {DATES_HELP}")
    common.add_argument("--ret", action="append", default=[], metavar="DATES",
                        help="return dates, same format; omit for a one-way search")
    common.add_argument("--sort", choices=("best", "day"), default="best",
                        help="best: ranked overall; day: grouped by departure day (default: best)")
    common.add_argument("--limit", type=int, metavar="N",
                        help="rows in total, or per day with --sort day (default: 10, or 3 per day)")
    common.add_argument("--links", action="store_true", help="add a column with the booking link of each row")
    common.add_argument("--json", action="store_true", help="print the rows as JSON instead of a table")
    common.add_argument("--lang", choices=("en", "it"), default="en", help="language of the booking links")
    common.add_argument("--config", metavar="PATH", help="travel_ranker.toml to use instead of the auto-discovered one")
    common.add_argument("--no-cache", action="store_true", help="ignore cached upstream responses")
    common.add_argument("-v", "--verbose", action="store_true", help="log upstream requests to stderr")

    parser = argparse.ArgumentParser(
        prog="python -m cli",
        description="Rank trains and flights by what they really cost you, not just the ticket price.",
    )
    modes = parser.add_subparsers(dest="mode", required=True)
    modes.add_parser("trains", parents=[common], help="Trenitalia trains (station names in Italian)",
                     description="Rank Trenitalia train solutions. Station names must be in Italian, e.g. 'Milano Centrale'.")
    modes.add_parser("flights", parents=[common], help="flights from Google Flights via SerpApi",
                     description="Rank flights from Google Flights. Needs SERPAPI_KEY in the environment or in .env.")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    load_dotenv(ROOT / ".env")
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # httpx logs every request URL, and SerpApi takes the API key in the query string.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    try:
        cfg = load_config_dict(args.config)
        query = SearchQuery.create(
            args.origins,
            args.destinations,
            [parse_span(s) for s in args.dep],
            [parse_span(s) for s in args.ret],
            lang=args.lang,
        )
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.no_cache:
        cfg = merge_overrides(cfg, {args.mode: {"no_cache": True}})

    for text in reminders_for(cfg, args.mode):
        print(f"* {text}", file=sys.stderr)

    try:
        if args.mode == "trains":
            rows = asyncio.run(search_trains(query, cfg))
        else:
            api_key = os.getenv("SERPAPI_KEY", "").strip()
            if not api_key:
                print("error: set SERPAPI_KEY in the environment or in .env", file=sys.stderr)
                return 2
            rows = asyncio.run(search_flights(query, cfg, api_key))
    except (trains.StationNotFoundError, flights.SerpApiError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    rows = order_rows(rows, args.sort, args.limit or DEFAULT_LIMIT[args.sort])
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    elif rows:
        print(render_table(rows, args.mode, args.links))
    else:
        print("No solutions found.", file=sys.stderr)
    return 0
