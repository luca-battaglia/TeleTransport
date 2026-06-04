#!/usr/bin/env python3
import argparse
import os
import sys
import getpass
import requests
from datetime import date
from typing import List, Optional, Tuple
from core.flights import build_rows_multi, dedup_rows, print_table, interactive_wizard, load_config_dict, parse_flights_config, parse_date_range_human, ROUTE_PRESETS, eprint

# ---------- CLI ----------

def _preparse_config(argv: List[str]) -> Tuple[Optional[str], bool]:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--config", type=str, default=None)
    ns, _ = p.parse_known_args(argv)
    return ns.config, False


def main() -> int:
    argv = sys.argv[1:]
    cfg_path, _ = _preparse_config(argv)

    try:
        cfg_dict = load_config_dict(cfg_path, verbose=False)
    except Exception as e:
        eprint(f"ERRORE CONFIG: {e}")
        return 2

    cfg_defaults, cfg_scoring = parse_flights_config(cfg_dict)
    
    if cfg_defaults.reminders:
        eprint("*" * 65)
        for name, text in cfg_defaults.reminders.items():
            eprint(f"* {text} *")
        eprint("*" * 65)

    # Interactive wizard
    if len(sys.argv) == 1 and sys.stdin.isatty():
        api_key = os.getenv("SERPAPI_KEY", "").strip()
        if not api_key:
            api_key = getpass.getpass("SERPAPI_KEY (input nascosto): ").strip()
        if not api_key:
            eprint("ERRORE: manca SERPAPI_KEY")
            return 2

        try:
            sel, (dep_start, dep_end), ret_rng, one_way = interactive_wizard()
        except Exception as e:
            eprint(f"ERRORE: {e}")
            return 2

        eprint("Search avviata")

        session = requests.Session()
        try:
            deep_search = cfg_defaults.deep_search
            show_hidden = cfg_defaults.show_hidden
            no_cache = cfg_defaults.no_cache
            dedup = cfg_defaults.dedup

            rows = build_rows_multi(
                session=session,
                api_key=api_key,
                origins=sel.origins,
                destinations=sel.destinations,
                dep_start=dep_start,
                dep_end=dep_end,
                ret_rng=ret_rng,
                one_way=one_way or (ret_rng is None),
                currency=cfg_defaults.currency,
                hl=cfg_defaults.hl,
                gl=cfg_defaults.gl,
                deep_search=deep_search,
                top_outbounds=cfg_defaults.top_outbounds,
                top_returns=cfg_defaults.top_returns,
                top_flights=cfg_defaults.top_flights,
                min_ticket_price=cfg_defaults.min_price,
                show_hidden=show_hidden,
                no_cache=no_cache,
                scoring=cfg_scoring,
            )

            if dedup:
                rows = dedup_rows(rows, one_way=one_way or (ret_rng is None))
            print_table(rows, limit=cfg_defaults.limit, one_way=one_way or (ret_rng is None))
            return 0
        except Exception as e:
            eprint(f"ERRORE: {e}")
            return 1

    # CLI mode
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--config", type=str, default=cfg_path, help="Path file TOML (default: auto)")

    ap.add_argument("route", nargs="?", help=f"Preset: {', '.join(sorted(set(ROUTE_PRESETS.keys())))}")
    ap.add_argument("dep", nargs="?", help="Range andata. Es: 3-6/03, oppure 30/05..03/06 (mesi diversi)")
    ap.add_argument("ret", nargs="?", help="Range ritorno. Es: 8-11/03, oppure 05/06..10/06")

    ap.add_argument("--api-key", default=os.getenv("SERPAPI_KEY"))
    ap.add_argument("--from", dest="origin")
    ap.add_argument("--to", dest="destination")

    ap.add_argument("--dep-start")
    ap.add_argument("--dep-end")
    ap.add_argument("--ret-start")
    ap.add_argument("--ret-end")

    ap.add_argument("--one-way", action="store_true")
    ap.add_argument("--currency", default=cfg_defaults.currency)
    ap.add_argument("--hl", default=cfg_defaults.hl)
    ap.add_argument("--gl", default=cfg_defaults.gl)

    # deep-search: ON di default
    deep_group = ap.add_mutually_exclusive_group()
    deep_group.add_argument("--deep-search", dest="deep_search", action="store_true", help="Enable deep_search")
    deep_group.add_argument("--no-deep-search", dest="deep_search", action="store_false", help="Disable deep_search")
    ap.set_defaults(deep_search=cfg_defaults.deep_search)

    ap.add_argument("--top-outbounds", type=int, default=cfg_defaults.top_outbounds)
    ap.add_argument("--top-returns", type=int, default=cfg_defaults.top_returns)
    ap.add_argument("--top-flights", type=int, default=cfg_defaults.top_flights)

    ap.add_argument("--min-price", type=int, default=cfg_defaults.min_price)
    ap.add_argument("--limit", type=int, default=cfg_defaults.limit)

    # SerpApi extras
    hidden_group = ap.add_mutually_exclusive_group()
    hidden_group.add_argument("--show-hidden", dest="show_hidden", action="store_true", help="Include hidden flights")
    hidden_group.add_argument("--no-show-hidden", dest="show_hidden", action="store_false", help="Do not include hidden flights")
    ap.set_defaults(show_hidden=cfg_defaults.show_hidden)

    ap.add_argument("--no-cache", action="store_true", default=cfg_defaults.no_cache, help="Force refresh (no cache)")

    # Dedup output
    dedup_group = ap.add_mutually_exclusive_group()
    dedup_group.add_argument("--dedup", dest="dedup", action="store_true", help="Deduplicate identical rows")
    dedup_group.add_argument("--no-dedup", dest="dedup", action="store_false", help="Do not deduplicate identical rows")
    ap.set_defaults(dedup=cfg_defaults.dedup)

    args = ap.parse_args()

    if not args.api_key:
        eprint("ERRORE: manca --api-key (o SERPAPI_KEY)")
        return 2

    # resolve route selection (preset may be multi)
    origins: List[str] = []
    destinations: List[str] = []

    route_key = (args.route or "").strip().lower()
    if route_key in ROUTE_PRESETS:
        preset = ROUTE_PRESETS[route_key]
        origins = list(preset.origins)
        destinations = list(preset.destinations)
    else:
        origin = (args.origin or "").strip().upper() if args.origin else ""
        dest = (args.destination or "").strip().upper() if args.destination else ""
        if origin and dest:
            origins = [origin]
            destinations = [dest]

    if not origins or not destinations:
        eprint("ERRORE: manca route o from/to")
        return 2

    try:
        if args.dep:
            dep_start, dep_end = parse_date_range_human(args.dep)
        else:
            if not args.dep_start or not args.dep_end:
                eprint("ERRORE: manca range andata")
                return 2
            dep_start = date.fromisoformat(args.dep_start)
            dep_end = date.fromisoformat(args.dep_end)
    except Exception as e:
        eprint(f"ERRORE: date andata {e}")
        return 2

    one_way = bool(args.one_way)
    ret_rng: Optional[Tuple[date, date]] = None
    if (not one_way) and args.ret:
        try:
            ret_rng = parse_date_range_human(args.ret)
        except Exception as e:
            eprint(f"ERRORE: date ritorno {e}")
            return 2
    elif (not one_way) and (args.ret_start and args.ret_end):
        try:
            ret_rng = (date.fromisoformat(args.ret_start), date.fromisoformat(args.ret_end))
        except Exception as e:
            eprint(f"ERRORE: date ritorno {e}")
            return 2
    else:
        one_way = True

    deep_search = bool(args.deep_search)
    show_hidden = bool(args.show_hidden)
    no_cache = bool(args.no_cache)

    eprint("Search avviata")

    session = requests.Session()
    try:
        rows = build_rows_multi(
            session=session,
            api_key=args.api_key,
            origins=origins,
            destinations=destinations,
            dep_start=dep_start,
            dep_end=dep_end,
            ret_rng=ret_rng,
            one_way=one_way or (ret_rng is None),
            currency=args.currency,
            hl=args.hl,
            gl=args.gl,
            deep_search=deep_search,
            top_outbounds=args.top_outbounds,
            top_returns=args.top_returns,
            top_flights=args.top_flights,
            min_ticket_price=args.min_price,
            show_hidden=show_hidden,
            no_cache=no_cache,
            scoring=cfg_scoring,
        )
        if args.dedup:
            rows = dedup_rows(rows, one_way=one_way or (ret_rng is None))
        print_table(rows, limit=args.limit, one_way=one_way or (ret_rng is None))
        return 0
    except Exception as e:
        eprint(f"ERRORE: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
