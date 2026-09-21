import asyncio
from datetime import date

import httpx
import pytest

from core.flights import SerpApiError
from core.search import SearchQuery, count_days, estimate_flight_calls, normalize_ranges, search_flights

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
    assert query.one_way


def flight(dep: str, arr: str, minutes: int, price: int, token: str = "") -> dict:
    item = {
        "flights": [{"departure_airport": {"time": dep}, "arrival_airport": {"time": arr}, "duration": minutes}],
        "total_duration": minutes,
        "price": price,
    }
    if token:
        item["departure_token"] = token
    return item


def serpapi(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


def test_one_way_rows_are_ranked_by_adjusted_cost_not_price():
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
    assert rows[0]["booking_url"].startswith("https://www.google.com/travel/flights?")


def test_round_trip_uses_the_total_price_from_the_return_leg():
    seen_tokens = []

    def handler(request: httpx.Request) -> httpx.Response:
        token = request.url.params.get("departure_token")
        if token:
            seen_tokens.append(token)
            return httpx.Response(200, json={
                "search_metadata": {"status": "Success"},
                "best_flights": [flight("2026-10-12 18:00", "2026-10-12 19:30", 90, 210)],
            })
        return httpx.Response(200, json={
            "search_metadata": {"status": "Success"},
            "best_flights": [flight("2026-10-08 10:00", "2026-10-08 11:30", 90, 99, token="out-1")],
        })

    query = SearchQuery.create(["ZRH"], ["FCO"], [(d(8), d(8))], [(d(12), d(12))])
    rows = run(search_flights(query, NO_CACHE, API_KEY, client=serpapi(handler)))
    assert seen_tokens == ["out-1"]
    assert rows[0]["price_eur"] == 210
    assert rows[0]["in_dep"] == "2026-10-12T18:00:00"


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


def test_call_estimate_matches_the_request_pattern():
    cfg = {"flights": {"top_outbounds": 2}}
    one_way = SearchQuery.create(["Zurich"], ["Rome"], [(d(1), d(3))])
    assert estimate_flight_calls(one_way, cfg) == 3
    # Only return days after the outbound day form a pair.
    round_trip = SearchQuery.create(["Zurich"], ["Rome"], [(d(1), d(2))], [(d(2), d(3))])
    assert estimate_flight_calls(round_trip, cfg) == 3 * (1 + 2)
