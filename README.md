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

Search requests take `origins`, `destinations`, `dep_start`, `dep_end`, optional `ret_start` / `ret_end`, and `one_way`.

Two optional headers customise a request: `x-config` carries a JSON scoring override for that call, and `x-serpapi-key` supplies the SerpApi key for flight searches.

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
