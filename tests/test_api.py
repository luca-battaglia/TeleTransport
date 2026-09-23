import json
import logging
from datetime import date, timedelta

import diskcache
import httpx
import pytest
from fastapi.testclient import TestClient

import backend.main as api
from backend.limits import UsageLimits


def days(from_now: int, count: int = 1) -> list:
    first = date.today() + timedelta(days=from_now)
    return [{"start": str(first), "end": str(first + timedelta(days=count - 1))}]


SEARCH = {"origins": ["Zurich"], "destinations": ["Rome"], "dep_ranges": days(7), "lang": "en"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "limits", UsageLimits(
        diskcache.Cache(str(tmp_path)),
        searches_per_hour=100,
        demo_daily_calls=4,
        demo_client_daily_searches=2,
    ))
    monkeypatch.setattr(api, "DEMO_KEY", "")
    return TestClient(api.app)


def fake_flight_search(calls: int):
    """Stand-in for search_flights that makes `calls` requests through the client it is given."""
    async def search(query, cfg, api_key, *, client=None):
        for _ in range(calls):
            await client.send(httpx.Request("GET", "https://serpapi.test/search.json"))
        return [{"price_eur": 99}]
    return search


def offline(monkeypatch, response: httpx.Response) -> None:
    """Route every httpx client the app creates to a canned SerpApi response."""
    real_client = httpx.AsyncClient

    def client_factory(**kwargs):
        return real_client(transport=httpx.MockTransport(lambda r: response), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)


@pytest.fixture
def offline_serpapi(monkeypatch):
    offline(monkeypatch, httpx.Response(200, json={}))


def test_unknown_config_keys_are_rejected(client):
    headers = {"x-config": json.dumps({"trains": {"max_per_day": 100000}})}
    response = client.post("/api/trains", json=SEARCH, headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_config"


def test_scoring_overrides_reach_the_search(client, monkeypatch):
    seen = {}

    async def fake_search_trains(query, cfg):
        seen.update(cfg)
        return []

    monkeypatch.setattr(api, "search_trains", fake_search_trains)
    headers = {"x-config": json.dumps({"trains": {"scoring": {"change_penalty_eur": 0}}})}
    assert client.post("/api/trains", json=SEARCH, headers=headers).status_code == 200
    assert seen["trains"]["scoring"]["change_penalty_eur"] == 0


def test_user_airport_extras_replace_the_server_ones(client, monkeypatch):
    monkeypatch.setitem(api.BASE_CONFIG, "flights", {"airport_extras": {"BDS": {"fuel_eur": 30.0}}})
    cfg = api.config_for(json.dumps({"flights": {"airport_extras": {"BRI": {"fuel_eur": 5}}}}))
    assert list(cfg["flights"]["airport_extras"]) == ["BRI"]


def test_search_window_is_capped(client):
    body = {**SEARCH, "dep_ranges": days(7, count=20)}
    response = client.post("/api/trains", json=body)
    assert response.status_code == 400
    assert response.json()["detail"] == {"code": "too_many_days", "message": "A search may cover at most 14 days.", "days": 14}


def test_every_route_counts_against_the_route_day_cap(client):
    body = {**SEARCH, "origins": ["Zurich", "Basel", "Geneva"], "dep_ranges": days(7, count=11)}
    detail = client.post("/api/trains", json=body).json()["detail"]
    assert (detail["code"], detail["route_days"], detail["max"]) == ("too_many_route_days", 33, 30)


def test_past_dates_are_rejected_but_yesterday_is_not(client, monkeypatch):
    async def no_trains(query, cfg):
        return []

    monkeypatch.setattr(api, "search_trains", no_trains)
    past = client.post("/api/trains", json={**SEARCH, "dep_ranges": days(-3, count=5)})
    assert past.json()["detail"]["code"] == "past_dates"
    # Yesterday in UTC is still today somewhere west of here.
    assert client.post("/api/trains", json={**SEARCH, "dep_ranges": days(-1)}).status_code == 200


def test_flights_need_a_key_when_the_demo_is_off(client):
    response = client.post("/api/flights", json=SEARCH)
    assert response.json()["detail"]["code"] == "api_key_required"
    assert client.get("/api/flights/demo").json() == {"enabled": False, "searches_left": 0}


def test_demo_search_is_limited_and_charged_by_real_calls(client, monkeypatch, offline_serpapi):
    monkeypatch.setattr(api, "DEMO_KEY", "demo-key-0000000000")
    monkeypatch.setattr(api, "search_flights", fake_flight_search(calls=1))

    response = client.post("/api/flights", json=SEARCH)
    assert response.status_code == 200
    assert response.json()["demo"] == {"searches_left": 1}

    too_wide = {**SEARCH, "dep_ranges": days(7, count=4)}
    assert client.post("/api/flights", json=too_wide).json()["detail"]["code"] == "demo_search_too_large"

    two_routes = {**SEARCH, "destinations": ["Rome", "Naples"]}
    assert client.post("/api/flights", json=two_routes).json()["detail"]["code"] == "demo_single_route"

    assert client.post("/api/flights", json=SEARCH).status_code == 200
    third = client.post("/api/flights", json=SEARCH)
    assert third.status_code == 429
    assert third.json()["detail"]["code"] == "demo_exhausted"


def test_own_key_bypasses_the_demo_budget(client, monkeypatch):
    monkeypatch.setattr(api, "search_flights", fake_flight_search(calls=0))
    headers = {"x-serpapi-key": "a" * 64}
    for _ in range(3):
        response = client.post("/api/flights", json=SEARCH, headers=headers)
        assert response.status_code == 200
        assert "demo" not in response.json()


def test_api_keys_never_reach_the_logs(client, monkeypatch, caplog):
    offline(monkeypatch, httpx.Response(401, json={"error": "Invalid API key."}))
    caplog.set_level(logging.DEBUG)
    key = "secret" + "0" * 20
    response = client.post("/api/flights", json=SEARCH, headers={"x-serpapi-key": key})
    assert response.json()["detail"]["code"] == "serpapi_error"
    assert key not in caplog.text
