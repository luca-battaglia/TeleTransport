import asyncio
from datetime import date

import httpx
import pytest

from core.flights import SerpApiError
from core.search import (
    MAX_CONCURRENT_FLIGHT_LOOKUPS,
    SearchQuery,
    count_days,
    estimate_flight_calls,
    normalize_ranges,
    search_flights,
)

NO_CACHE = {"flights": {"no_cache": True, "deep_search": False}}
API_KEY = "k" * 64


def d(day: int) -> date:
    return date(2026, 10, day)


def test_overlapping_and_touching_ranges_merge():
    spans = [(d(10), d(12)), (d(1), d(3)), (d(4), d(4)), (d(11), d(14))]
    assert normalize_ranges(spans) == [(d(1), d(4)), (d(10), d(14))]


def test_reversed_range_is_straightened():
    assert normalize_ranges([(d(5), d(2))]) == [(d(2), d(5))]
    assert count_days([(d(2), d(5)), (d(9), d(9))]) == 5


def test_query_drops_blank_places():
    query = SearchQuery.create(["Zurich", " ", ""], ["Rome"], [(d(1), d(1))])
    assert query.origins == ("Zurich",)
    assert query.route_days == 1


def flight(dep: str, arr: str, minutes: int, price: int, route: tuple = ()) -> dict:
    departure = {"time": dep, **({"id": route[0]} if route else {})}
    arrival = {"time": arr, **({"id": route[1]} if route else {})}
    return {
        "flights": [{"departure_airport": departure, "arrival_airport": arrival, "duration": minutes}],
        "total_duration": minutes,
        "price": price,
    }


def serpapi(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


def test_rows_are_ranked_by_adjusted_cost_not_price():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "search_metadata": {"status": "Success"},
            "best_flights": [flight("2026-10-08 05:00", "2026-10-08 06:30", 90, 50)],
            "other_flights": [flight("2026-10-08 11:00", "2026-10-08 12:30", 90, 70)],
        })

    query = SearchQuery.create(["ZRH"], ["FCO"], [(d(8), d(8))])
    rows = run(search_flights(query, NO_CACHE, API_KEY, client=serpapi(handler)))
    # The 05:00 flight is 20 EUR cheaper but four hours before 09:00 costs 80.
    assert [r["price_eur"] for r in rows] == [70, 50]
    best = rows[0]
    assert (best["dep"], best["arr"]) == ("2026-10-08T11:00:00", "2026-10-08T12:30:00")
    assert (best["duration_min"], best["changes"]) == (90, 0)
    assert best["booking_url"].startswith("https://www.google.com/travel/flights?")


def test_a_city_is_searched_on_all_its_airports_and_rows_name_the_one_used():
    searched = []

    def handler(request: httpx.Request) -> httpx.Response:
        searched.append(request.url.params.get("arrival_id"))
        return httpx.Response(200, json={
            "search_metadata": {"status": "Success"},
            "best_flights": [flight("2026-10-08 10:00", "2026-10-08 11:30", 90, 80, route=("ZRH", "CIA"))],
        })

    cfg = {**NO_CACHE, "flights": {**NO_CACHE["flights"], "airport_extras": {"CIA": {"fuel_eur": 25}}}}
    query = SearchQuery.create(["Zurich"], ["Rome"], [(d(8), d(8))])
    rows = run(search_flights(query, cfg, API_KEY, client=serpapi(handler)))
    assert searched == ["FCO,CIA"]
    assert (rows[0]["origin"], rows[0]["destination"]) == ("ZRH", "CIA")
    assert "CIA" in rows[0]["booking_url"] and "FCO" not in rows[0]["booking_url"]
    assert rows[0]["adjusted_cost"] == pytest.approx(80 + 1.5 * 20 + 25)


def test_flight_lookups_run_a_few_at_a_time():
    in_flight = peak = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        return httpx.Response(200, json={"search_metadata": {"status": "Success"}})

    query = SearchQuery.create(["ZRH"], ["FCO", "NAP"], [(d(1), d(7))])
    run(search_flights(query, NO_CACHE, API_KEY, client=serpapi(handler)))
    assert peak == MAX_CONCURRENT_FLIGHT_LOOKUPS


def test_an_empty_day_is_not_an_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "search_metadata": {"status": "Success"},
            "error": "Google Flights hasn't returned any results for this query.",
        })

    query = SearchQuery.create(["ZRH"], ["FCO"], [(d(8), d(9))])
    assert run(search_flights(query, NO_CACHE, API_KEY, client=serpapi(handler))) == []


def test_when_every_lookup_fails_the_error_surfaces_without_the_key():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": f"Invalid API key {API_KEY}"})

    query = SearchQuery.create(["ZRH"], ["FCO"], [(d(8), d(9))])
    with pytest.raises(SerpApiError) as info:
        run(search_flights(query, NO_CACHE, API_KEY, client=serpapi(handler)))
    assert API_KEY not in str(info.value)
    assert "***" in str(info.value)


def test_call_estimate_is_one_search_per_route_and_day():
    assert estimate_flight_calls(SearchQuery.create(["Zurich"], ["Rome"], [(d(1), d(3))]), {}) == 3
    # Rome to Rome is no route, so it costs nothing.
    query = SearchQuery.create(["Zurich", "Rome"], ["Rome", "Naples"], [(d(1), d(2)), (d(5), d(5))])
    assert estimate_flight_calls(query, {}) == 3 * 3
