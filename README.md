# TeleTransport 🚄✈️

*Time is money.*

TeleTransport searches, ranks and compares travel options across **trains** (Trenitalia / LeFrecce) and **flights** (Google Flights via SerpApi).

Most search engines sort by ticket price. TeleTransport sorts by what a trip actually costs you: it converts travel time, awkward departure hours, late arrivals, connections and airport transfers into euros, and ranks everything by a single **adjusted cost**. A €30 flight leaving at 05:40 that needs a two-hour drive to the airport is rarely cheaper than a €55 train leaving after breakfast — this tool makes that comparison explicit.

---

## Features

- **Web app** — Next.js frontend with light/dark themes, animated transitions and a glassmorphism UI.
- **Multi-origin / multi-destination** — compare up to 5 origins against 5 destinations in one search; every pair is searched concurrently.
- **Date ranges** — search a span of up to 14 days per direction instead of a single date, with a scrollable 12-month calendar.
- **Fully configurable scoring** — every weight and penalty is exposed, both in `travel_ranker.toml` and in the in-app settings panel.
- **Per-airport extra costs** — attach fuel cost and driving time (yours and your companions') to specific IATA codes, folded into the adjusted cost.
- **State persistence** — results, settings, active tab and inputs survive a page reload via `localStorage` / `sessionStorage`.
- **Reminders** — custom notes that surface at search time (e.g. "use the Booking.com credit").
- **Bilingual** — full English and Italian UI, including an in-app guide to the scoring model.
- **Markdown export** — copy the result table straight into notes or chat.
- **Deep links to the operator** — the route of every result links to Trenitalia or Google Flights with the search already filled in for that route on that day. See [Booking deep links](#booking-deep-links).
- **Keyboard shortcuts** — `Alt+1` trains, `Alt+2` flights, `Ctrl+Enter` search, `Esc` close.
- **CLI** — the original terminal tools are still present and fully functional.

---

## How the ranking works

Solutions are sorted by ascending `adjusted_cost`, then by duration, then by departure time.

**Trains**

```text
adjusted_cost = base_price
              + (duration_hours * time_value_eur_per_hour)
              + early_departure_penalty
              + late_arrival_penalty
              + (changes * change_penalty_eur)
```

**Flights**

```text
adjusted_cost = price
              + (duration_hours * time_value_eur_per_hour)
              + early_departure_penalty
              + late_arrival_penalty
              + (connections * connection_penalty_eur)
              + airport_extras (fuel + your drive time + companions' drive time)
```

For round trips the flight scoring uses the return leg's price, matching the original CLI behaviour. Airport extras are applied once for one-way trips and twice for round trips.

Every term above maps to a key in `travel_ranker.toml` and to a field in the app's settings panel.

---

## Architecture

```
TeleTransport/
├── core/                 Shared engine — scoring, parsing, upstream API clients
│   ├── trains.py         LeFrecce BFF client (Playwright-assisted) + train ranking
│   ├── flights.py        SerpApi Google Flights client + flight ranking
│   └── cache.py          diskcache store, backed by backend/backend_cache/
├── backend/              FastAPI service wrapping core/ over HTTP
│   ├── main.py
│   └── requirements.txt  Server dependencies
├── cli/                  Terminal entry points (Italian prompts)
│   ├── trains_cli.py
│   └── flights_cli.py
├── frontend/             Next.js 16 web app (React 19)
├── travel_ranker.toml    Unified configuration for both engines
├── requirements.txt      CLI dependencies
├── trains.bat            CLI shortcut → cli/trains_cli.py
└── flights.bat           CLI shortcut → cli/flights_cli.py
```

`core/` holds all the logic. The backend and the CLI are two thin front ends over the same code, so the web app and the terminal always rank identically.

---

## Requirements

| | Version | Notes |
|---|---|---|
| Python | 3.11+ recommended | 3.9+ works — `tomli` is installed automatically as the `tomllib` fallback |
| Node.js | 20.9+ | required by Next.js 16 |
| SerpApi key | — | flights only; train search needs no key |

---

## Setup

### 1. Python environment

Create the virtual environment **in the repository root** — the `.bat` shortcuts expect it at `.venv/`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt           # CLI dependencies
pip install -r backend/requirements.txt   # web backend dependencies
playwright install
```

There are two dependency files on purpose: `requirements.txt` covers the CLI, `backend/requirements.txt` covers the HTTP service. Install both to run everything locally; a server only needs the second one.

### 2. SerpApi key

Copy `.env.example` to `.env` and fill it in:

```ini
SERPAPI_KEY=your_serpapi_api_key
```

The web app can take the key from its settings panel instead — see [Security notes](#security-notes).

### 3. Backend

```powershell
uvicorn backend.main:app --reload --port 8000
```

### 4. Frontend

```powershell
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:3000`. The frontend proxies `/api/*` to the backend through a Next.js rewrite, so there are no CORS issues in development. Point it elsewhere with `NEXT_PUBLIC_BACKEND_URL` (default `http://127.0.0.1:8000`).

### 5. CLI (optional)

```powershell
.\trains.bat
.\flights.bat
```

Run with no arguments for an interactive wizard, or pass flags to override the TOML. The CLI prompts are in Italian.

---

## Configuration

`travel_ranker.toml` configures both engines. Precedence is **CLI arguments > TOML > built-in defaults**, so the file is optional — delete it and everything still runs on defaults.

It is discovered automatically, in order:

1. `./travel_ranker.toml`
2. `~/.config/travel_ranker.toml`
3. the path in the `TRAVEL_RANKER_CONFIG` environment variable

Main sections: `[trains]` and `[trains.scoring]`, `[flights]` and `[flights.scoring]`, `[flights.airport_extras.<IATA>]`, `[reminders]`, and `[ui]` for the web app's default origins, destinations and dropdown entries.

---

## API

The backend exposes three endpoints.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/config` | UI defaults — origins, destinations, dropdown options, IATA mapping |
| `POST` | `/api/trains` | Rank train solutions |
| `POST` | `/api/flights` | Rank flight solutions |

Search requests take `origins`, `destinations`, `dep_start`, `dep_end`, optional `ret_start` / `ret_end`, `one_way`, and `lang` (`it` by default, used only for the booking links).

Two optional headers customise a request: `x-config` carries a JSON scoring override for that call, and `x-serpapi-key` supplies the SerpApi key for flight searches.

Every result row carries a `booking_url` alongside its prices — see below.

---

## Booking deep links

Each row's route is an anchor to the operator's own results for that route on that departure day. The URLs are built server-side (`build_booking_url` in `core/trains.py` and `core/flights.py`) rather than in the browser, because the backend has already resolved stations and IATA codes, and it redeploys on its own — a change in either provider's URL format is a one-file backend fix with no frontend release.

**Flights** use the natural-language `q=` form of Google Flights, the same one behind the *Open Google Flights* button on the form. The precise `tfs=` parameter is an undocumented protobuf blob and is not worth depending on.

**Trains** are the interesting case. LeFrecce's own search page cannot be linked to: its criteria live in an internal store and its route (`#/search-results`) takes no parameters. Its **white-label entry point** does read them from the query string:

```text
https://www.lefrecce.it/Channels.Website.WEB/#/white-label/MINISITI/
    ?departureStation=Zurigo HB
    &arrivalStation=Alessandria
    &departureDate=15-09-2026      # DD-MM-YYYY, strict; past dates snap to today
    &departureTime=07:00           # HH:mm or HH
    &isRoundTrip=false
    &noOfAdults=1&noOfChildren=0   # integers below 8
    &searchSolutions=true          # runs the search and lands on the results
    &lang=it
```

Station names are resolved through the same locations endpoint this project uses, taking the first hit, so the names you search with resolve to the same stations. The link is anchored to the top of the departure hour so the row's own solution is certain to be on the page, and it always asks for one adult — refine passengers and fares on Trenitalia.

`lang` is honoured only in part: with `lang=en` the site chrome switches to English but the solution list itself stays Italian. That is LeFrecce's behaviour, not something this project can set.

This is an undocumented entry point. It is one HTTP call away from being verified if it ever breaks: open a link, confirm you land on `#/search-results`. Nothing else in the app depends on it.

### Why the links carry no `rel`

Each link opens into a **named** target (`trenitalia`, `googleflights`) rather than `_blank`, so a session of clicking works through one operator tab instead of leaving a tab per solution behind. That tab keeps its `sessionStorage` across navigations, including the state LeFrecce parks under its own `session` key.

The named target and `rel="noopener"` are mutually exclusive: per the HTML spec `noopener` picks a fresh browsing context and does not apply the name, and `noreferrer` implies `noopener`. Measured — with `rel="noopener noreferrer"` two clicks produce two tabs, without it they reuse one. So the links carry no `rel`, and the cost is that the destination gets a `window.opener` handle on the app's tab. The only two destinations are Trenitalia and Google.

Ctrl+click, ⌘+click and middle click are unaffected: the browser overrides the target and opens a separate background tab.

---

## Security notes

- The SerpApi key is **never stored on the server**. The browser keeps it in `localStorage` and sends it per request in the `x-serpapi-key` header, so a shared deployment never holds anyone else's key.
- `.env` and any local config overrides stay out of git — check what you commit before publishing a fork.
- Responses are cached on disk under `backend/backend_cache/`, which is git-ignored.

---

## Deployment

The repository ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that deploys the backend on push to `main`, but only when `backend/`, `core/`, `travel_ranker.toml` or the workflow itself changed — frontend-only commits skip it.

It rsyncs `backend/` and `core/` to the server, installs `backend/requirements.txt` and restarts a systemd unit. It expects three repository secrets: `VPS_HOST`, `VPS_USERNAME` and `VPS_SSH_KEY`.

The frontend deploys to Vercel; set `NEXT_PUBLIC_BACKEND_URL` there to the backend's public URL.

---

## Roadmap

- [ ] Italo Treno support (notably Milan–Turin)
- [ ] Replace the disk cache with Redis for multi-instance deployments
- [ ] A dedicated domain in place of the default platform subdomains

---

## License

No license has been chosen yet, so all rights are reserved by default. Add a `LICENSE` file before inviting outside contributions.
