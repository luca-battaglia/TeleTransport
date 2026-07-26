#!/usr/bin/env python3
import argparse
import asyncio
import os
import sys
from datetime import date
from typing import List, Optional, Sequence, Tuple
from core.trains import Route, SearchTask, load_config_dict, parse_trains_config, parse_date_range_human, search_ranked_solutions, print_table, interactive_wizard, TrainsDefaultsConfig, TrainScoringConfig, ROUTES_PRESET, eprint

# ---------------- CLI ----------------

def build_tasks_from_args(args: argparse.Namespace) -> List[SearchTask]:
    route_key = (args.route or "").strip().lower()

    if route_key in ROUTES_PRESET:
        a, b = ROUTES_PRESET[route_key]
        base_route = Route(a, b)
    elif args.from_station and args.to_station:
        base_route = Route(args.from_station, args.to_station)
    else:
        raise ValueError("Manca la tratta: usa un preset (route) oppure --from/--to")

    pos_dep = args.dep
    pos_ret = args.ret

    out_range: Optional[Tuple[date, date]] = None
    back_range: Optional[Tuple[date, date]] = None

    if pos_dep:
        out_range = parse_date_range_human(pos_dep)
    elif getattr(args, "dep_start", None) and getattr(args, "dep_end", None):
        out_range = (date.fromisoformat(args.dep_start), date.fromisoformat(args.dep_end))
    else:
        raise ValueError("Manca la data/range andata: usa <dep> oppure --dep-start/--dep-end")

    one_way: bool = getattr(args, "one_way", False)

    if (not one_way) and pos_ret:
        back_range = parse_date_range_human(pos_ret)
    elif (not one_way) and getattr(args, "ret_start", None) and getattr(args, "ret_end", None):
        back_range = (date.fromisoformat(args.ret_start), date.fromisoformat(args.ret_end))
    else:
        one_way = True

    tasks: List[SearchTask] = [SearchTask(route=base_route, d1=out_range[0], d2=out_range[1])]
    if (not one_way) and back_range:
        tasks.append(SearchTask(route=Route(base_route.to_name, base_route.from_name), d1=back_range[0], d2=back_range[1]))

    return tasks


def _preparse_config_and_verbose(argv: Optional[Sequence[str]]) -> Tuple[Optional[str], bool]:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--config", type=str, default=None)
    p.add_argument("--verbose", action="store_true")
    ns, _ = p.parse_known_args(list(argv) if argv is not None else sys.argv[1:])
    return ns.config, bool(ns.verbose)


async def amain(argv: Optional[Sequence[str]] = None) -> int:
    cfg_path, pre_verbose = _preparse_config_and_verbose(argv)

    try:
        cfg_dict = load_config_dict(cfg_path, verbose=pre_verbose)
    except Exception as e:
        eprint(f"ERRORE CONFIG: {e}")
        return 2

    cfg_defaults, cfg_scoring = parse_trains_config(cfg_dict)

    ap = argparse.ArgumentParser(add_help=True)

    ap.add_argument("--config", type=str, default=cfg_path, help="Path file TOML (default: auto)")

    ap.add_argument("route", nargs="?", help=f"Preset: {', '.join(list(ROUTES_PRESET.keys()))}")
    ap.add_argument("dep", nargs="?", help="Range andata")
    ap.add_argument("ret", nargs="?", help="Range ritorno")

    ap.add_argument("--from", dest="from_station", default=None, help="Stazione di partenza")
    ap.add_argument("--to", dest="to_station", default=None, help="Stazione di arrivo")

    ap.add_argument("--dep-start", type=str)
    ap.add_argument("--dep-end", type=str)
    ap.add_argument("--ret-start", type=str)
    ap.add_argument("--ret-end", type=str)

    ap.add_argument("--one-way", action="store_true", help="One way")

    ap.add_argument("--max-per-day", type=int, default=cfg_defaults.max_per_day, help="Max soluzioni (tenute) per giorno e per tratta")
    ap.add_argument("--page-size", type=int, default=cfg_defaults.page_size, help="Page size per offset")
    ap.add_argument("--min-price", type=float, default=cfg_defaults.min_price, help="Ignora soluzioni con prezzo < X")
    ap.add_argument("--limit", type=int, default=cfg_defaults.limit, help="Max righe in output")

    ap.add_argument("--verbose", action="store_true", help="Log su stderr")
    ap.add_argument("--sniff-out", type=str, default=None, help="Scrive log sniffing in JSON")

    ap.add_argument("--poll-empty-retries", type=int, default=cfg_defaults.poll_empty_retries)
    ap.add_argument("--poll-dup-retries", type=int, default=cfg_defaults.poll_dup_retries)
    ap.add_argument("--poll-sleep-base", type=float, default=cfg_defaults.poll_sleep_base)
    ap.add_argument("--scan-cap-mult", type=int, default=cfg_defaults.scan_cap_mult)

    ap.add_argument("--api-timeout-ms", type=int, default=cfg_defaults.api_timeout_ms)
    ap.add_argument("--api-retries", type=int, default=cfg_defaults.api_retries)

    args = ap.parse_args(argv)

    try:
        tasks = build_tasks_from_args(args)
    except Exception as e:
        eprint(f"ERRORE CONFIG: {e}")
        return 2

    eprint("Search avviata...")

    try:
        ranked = await search_ranked_solutions(
            tasks=tasks,
            max_solutions_per_day=int(args.max_per_day),
            page_size=int(args.page_size),
            min_price=float(args.min_price),
            verbose=bool(args.verbose),
            sniff_out=args.sniff_out,
            scoring=cfg_scoring,
            api_timeout_ms=int(args.api_timeout_ms),
            api_retries=int(args.api_retries),
            poll_empty_retries=int(args.poll_empty_retries),
            poll_dup_retries=int(args.poll_dup_retries),
            poll_sleep_base=float(args.poll_sleep_base),
            scan_cap_multiplier=int(args.scan_cap_mult),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        eprint(f"ERRORE RUNTIME: {e}")
        return 1

    show_route = len(tasks) > 1
    print_table(ranked, limit=int(args.limit), show_route=show_route)
    return 0


def main() -> int:
    # For the wizard: load the config using automatic (silent) discovery.
    try:
        cfg_dict = load_config_dict(None, verbose=False)
        cfg_defaults, cfg_scoring = parse_trains_config(cfg_dict)
    except Exception:
        cfg_defaults, cfg_scoring = TrainsDefaultsConfig(), TrainScoringConfig()

    if len(sys.argv) == 1 and sys.stdin.isatty():
        try:
            tasks, show_route = interactive_wizard()
        except Exception as e:
            eprint(f"ERRORE: {e}")
            return 2

        eprint("Search avviata...")

        try:
            ranked = asyncio.run(
                search_ranked_solutions(
                    tasks=tasks,
                    max_solutions_per_day=cfg_defaults.max_per_day,
                    page_size=cfg_defaults.page_size,
                    min_price=cfg_defaults.wizard_min_price,
                    verbose=False,
                    sniff_out=None,
                    scoring=cfg_scoring,
                    api_timeout_ms=cfg_defaults.api_timeout_ms,
                    api_retries=cfg_defaults.api_retries,
                    poll_empty_retries=cfg_defaults.poll_empty_retries,
                    poll_dup_retries=cfg_defaults.poll_dup_retries,
                    poll_sleep_base=cfg_defaults.poll_sleep_base,
                    scan_cap_multiplier=cfg_defaults.scan_cap_mult,
                )
            )
        except Exception as e:
            eprint(f"ERRORE: {e}")
            return 1

        print_table(ranked, limit=cfg_defaults.limit, show_route=show_route)
        return 0

    return asyncio.run(amain())


if __name__ == "__main__":
    raise SystemExit(main())
