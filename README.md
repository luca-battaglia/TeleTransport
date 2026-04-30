# TeleTransport 🚄✈️

TeleTransport (also known as Travel Ranker) is a powerful, highly configurable CLI tool suite designed to search, rank, and compare travel solutions for both trains and flights. 

Instead of just sorting by the lowest base price, TeleTransport uses a **smart scoring system** that evaluates the *actual* cost of a trip by factoring in travel time, early departure penalties, late arrival penalties, and connection inconveniences.

## Features

- **🚂 `treni`**: Scrapes and ranks Trenitalia (LeFrecce BFF API) train solutions using Playwright.
- **✈️ `voli`**: Fetches and ranks flight solutions using Google Flights via SerpApi.
- **📊 Smart Scoring**: Automatically ranks solutions by an `adjusted_cost` considering your personal value of time (€/h) and schedule preferences.
- **🛠️ Highly Configurable**: Tweak all scoring parameters, limits, and API settings globally via a plain `travel_ranker.toml` file.
- **🧙‍♂️ Interactive Wizard**: Run the tools without arguments for a step-by-step guided prompt, or use fast CLI positional arguments.
- **📅 Flexible Dates**: Support for exact dates (e.g., `10/05`) or date ranges (e.g., `10-12/05`) to find the best option across multiple days.

---

## Installation & Setup

### 1. Requirements
- **Python 3.9+**
- **SerpApi API Key** (Required for Flights)

### 2. Environment Setup
Clone or place the source code in your desired directory (e.g., `C:\TeleTransport`).

Set up a virtual environment and install dependencies:
```powershell
cd C:\TeleTransport
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install
```

### 3. Make it Portable (Windows)
To use the `voli` and `treni` commands natively from any directory:
1. Open your Windows **Environment Variables**.
2. Add `C:\TeleTransport` to your `Path` variable.
3. *(Optional)* Add a new System/User variable named `SERPAPI_KEY` and paste your SerpApi key. Although using the `.env` file (step below) is the recommended approach.

Now, thanks to the included `.bat` files, you can simply type `voli` or `treni` in any PowerShell or Command Prompt window.

### 4. Secrets Management (API Keys)
To manage sensitive data safely (like `SERPAPI_KEY`), simply duplicate the `.env.example` file and rename it to `.env`:
```powershell
copy .env.example .env
```
Open `.env` and paste your actual SerpApi key inside `SERPAPI_KEY=...`. The system will automatically pick it up without you needing to modify global Windows variables.

---

## Usage

You can use the commands interactively or by passing positional arguments.

### Interactive Wizard
If you don't remember the syntax, simply run the tool without arguments:
```powershell
voli
# or
treni
```
An interactive menu will guide you through selecting the route, departure, and return dates.

### CLI Positional Arguments
The tools accept fast positional arguments. The standard order is:
1. **Route** (e.g., `zrh-bri`, explicit keys, or `--from`/`--to`)
2. **Departure Date / Range** 
3. **Return Date / Range** *(Optional for Round-Trip)*

#### Date Formats
- Exact Date: `10/05` (May 10th)
- Date Range: `10-12/05` (May 10th to May 12th)

#### Examples (`voli`)
- **Round trip with date ranges:**
  ```powershell
  voli zrh-bri 10-12/05 15-16/05
  ```
- **Exact round trip:**
  ```powershell
  voli zrh-bri 10/05 15/05
  ```
- **One-way with date range:**
  ```powershell
  voli zrh-bri 10-12/05
  ```
- **Using custom IATA codes instead of route presets:**
  ```powershell
  voli --from LIN --to LHR 10/05 15/05
  ```

*(The `treni` command works similarly for supported train station presets like `torino-zurigo`, `ale-zrh`, etc.)*

---

## Configuration (`travel_ranker.toml`)

The internal ranking algorithm can be drastically customized. The system looks for `travel_ranker.toml` in your current directory, or in `~/.config/travel_ranker.toml`, or via the `TRAVEL_RANKER_CONFIG` environment variable.

### Scoring Logic Overview
The tools rank solutions based on the lowest `adjusted_cost`, defined as:
```text
adjusted_cost = base_price
              + (duration_hours * time_value_eur_per_hour)
              + early_departure_penalty
              + late_arrival_penalty
              + (connections * change_penalty_eur)
```

In the TOML file, you can adjust:
- **`time_value_eur_per_hour`**: How much you value your time (default: 20€/h).
- **`early_departure_ref_hour`**: Hour before which a penalty is applied (default: 09:00).
- **`late_arrival_start_hour`**: Hour after which a penalty is applied (default: 22:00).
- **`change_penalty_eur`**: Fixed penalty per connection (default: 5€).

*See `travel_ranker.toml` in the repository for all available configuration options regarding API behaviors, caching, deep search flags, and pagination.*

---

## Future Improvements / Roadmap
- [ ] Incorporate **Italo Treno** support (specifically for routes like Milan-Turin).
