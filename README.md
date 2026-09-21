# TeleTransport

Train and flight search that ranks trips by what they cost you, not by the ticket price.

[![CI](https://github.com/luca-battaglia/TeleTransport/actions/workflows/ci.yml/badge.svg)](https://github.com/luca-battaglia/TeleTransport/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**Live:** [teletransport.vercel.app](https://teletransport.vercel.app)

![TeleTransport ranking trains between Milan and Rome](docs/demo.gif)

A €30 flight at 05:40 with a two-hour drive to the airport is rarely cheaper than a €55 train after breakfast. TeleTransport puts a number on that. It searches Trenitalia and Google Flights over a range of dates, turns travel time, early starts, late arrivals, changes and airport transfers into euros, and sorts every option by the resulting **adjusted cost**.

- Trains from Trenitalia, flights from Google Flights (through [SerpApi](https://serpapi.com))
- Up to 5 origins × 5 destinations and up to 14 days per direction in one search, non-consecutive days included
- Every weight is configurable, in the web app or in [`travel_ranker.toml`](travel_ranker.toml)
- Each result links to the operator's own search for that route and day, ready to book
- A web app in English and Italian, and a CLI with the same options, both on one engine

## How the ranking works

```text
adjusted_cost = price
              + duration_hours × time_value_eur_per_hour
              + hours before early_departure_ref_hour × early_departure_penalty_eur_per_hour
              + hours after late_arrival_start_hour × late_arrival_penalty_eur_per_hour
              + changes × change_penalty_eur
              + airport transfers (flights only: fuel, plus driving hours at your and your companions' time value)
```

Ties are broken by duration. A round-trip flight is priced as a whole, with the penalties of both legs; train searches with a return list outbound and return trains in one table.

## Architecture

```text
 Browser ──► Next.js (Vercel) ──/api rewrite──► Cloudflare Tunnel ──► FastAPI (ARM VM)
                                                                          │
 CLI ─────────────────────────────────────────────────────────────► core/search.py
                                                                          │
                                         ┌────────────────────────────────┴──────┐
                                   core/trains.py                          core/flights.py
                             LeFrecce JSON endpoints                  SerpApi Google Flights
                             (headless browser context)
```

| Path | Contents |
|---|---|
| [`core/`](core) | The engine: upstream clients, scoring, ranking, disk cache |
| [`backend/`](backend) | FastAPI service: request validation, rate limits, the flight demo quota |
| [`cli/`](cli) | Command-line front end |
| [`frontend/`](frontend) | Next.js 16 / React 19 web app |
| [`tests/`](tests) | pytest suite, upstream services mocked |

Some decisions worth knowing about:

- **One engine, two front ends.** The API and the CLI build the same `SearchQuery` and call the same functions in `core/search.py`, so they cannot rank differently.
- **Trenitalia has no public API.** The client calls the two JSON endpoints the Trenitalia website itself uses (station lookup and solution search) from a headless browser context that holds the site's cookies. The browser only starts on a cache miss.
- **Caching.** Upstream responses are cached in SQLite through `diskcache`: flight searches for 2 hours, Trenitalia result pages for 30 minutes, station lookups for a day. Repeating a search costs nothing upstream.
- **No public HTTP port on the server.** The API is reachable only through a Cloudflare Tunnel, and the browser only ever talks to the Vercel origin, which proxies `/api`.

## Running it locally

Requirements: Python 3.11+, Node.js 20.9+, and a free [SerpApi key](https://serpapi.com/users/sign_up) for flight searches (trains need no key).

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env               # add SERPAPI_KEY for the CLI

uvicorn backend.main:app --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev                        # http://localhost:3000
```

The web app proxies `/api/*` to `NEXT_PUBLIC_BACKEND_URL` (default `http://127.0.0.1:8000`). In the web app the SerpApi key goes in Settings.

## CLI

```bash
python -m cli trains --from "Milano Centrale" --to "Roma Termini" --dep 3-5/10 --ret 10/10
python -m cli flights --from Zurich --to Rome --to Naples --dep 2026-10-03 --sort day --links
```

```text
| Route                           | Departure        | Arrival          | Duration   |   Changes |   Price (EUR) |   Adj. cost (EUR) |
|---------------------------------|------------------|------------------|------------|-----------|---------------|-------------------|
| Milano Centrale -> Roma Termini | 2026-10-02 19:35 | 2026-10-02 22:39 | 3h04       |         0 |         50.90 |            121.98 |
| Milano Centrale -> Roma Termini | 2026-10-02 17:35 | 2026-10-02 20:45 | 3h10       |         0 |         62.90 |            126.23 |
```

Dates take the forms `2026-10-03`, `3/10`, `3-5/10` or `30/9..2/10`; repeat `--dep` or `--ret` for non-consecutive days. `--sort day` groups by departure day, `--limit` sets the rows shown (in total, or per day), `--links` adds booking links and `--json` prints machine-readable rows. Train stations take their Italian names, which is what Trenitalia's station lookup matches. Run `python -m cli trains --help` for everything else.

## Configuration

Scoring weights, search limits and the web app's defaults live in [`travel_ranker.toml`](travel_ranker.toml), found through `TRAVEL_RANKER_CONFIG`, then `./travel_ranker.toml`, then `~/.config/travel_ranker.toml`. Every key is optional. Server settings (demo quota, rate limits) are environment variables, documented in [`.env.example`](.env.example).

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/trains` | Ranked train solutions |
| `POST` | `/api/flights` | Ranked flights |
| `GET` | `/api/config` | Default routes and the IATA lookup for the web app |
| `GET` | `/api/flights/demo` | Whether the shared demo quota is on, and what is left of it today |
| `GET` | `/api/health` | Liveness |

Search bodies carry `origins`, `destinations`, `dep_ranges`, `ret_ranges` (`[{"start": "2026-10-03", "end": "2026-10-05"}]`), `one_way` and `lang`. Two optional headers: `X-SerpApi-Key`, and `X-Config` with scoring overrides. Errors come back as `{"detail": {"code": ..., "message": ...}}`, and the web app translates them by `code`.

## Security and privacy

- A SerpApi key entered in the web app stays in that browser and is sent only with flight searches. The server neither stores nor logs it.
- `X-Config` is validated against a whitelist: clients can change scoring weights and their own lookups, never limits, retries or caching.
- Every client gets an hourly search budget, and concurrent train searches are capped. Client IP addresses are kept only as salted hashes, in counters that expire within two days.
- Visitors without a key can try flights on a shared demo quota: small searches only (one route, up to three days), a few per visitor per day, under a global daily cap sized below the SerpApi free plan. Failed and cached searches are refunded.
- Deploys run the test suite first, then sync over SSH to a pinned host key.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
ruff check .
cd frontend && npm run lint && npm run build
```

CI runs all of the above on every push to `main` and on pull requests.

## Notes

- The Trenitalia endpoints and the booking-link entry point are undocumented and can change without notice.
- Trenitalia keeps its login state per browser tab, so a booking link opens logged out unless a Trenitalia tab is already open. [`userscripts/lefrecce-session-restore.user.js`](userscripts/lefrecce-session-restore.user.js) is an optional Tampermonkey script that fixes this on your own browser.

## Disclaimer

TeleTransport is an independent project, not affiliated with Trenitalia, Google or SerpApi. It reads publicly available timetables and fares at low volume, with caching, to plan trips; it does not book, sell or republish anything. Prices and times on the operators' sites are the ones that count.

## License

[AGPL-3.0-or-later](LICENSE). You can use, modify and host it, provided that the source of a modified version you run as a service is available to its users.
