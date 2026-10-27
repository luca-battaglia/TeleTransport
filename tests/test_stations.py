import asyncio
from datetime import date

import pytest

from core.trains import (
    Route,
    SearchTask,
    Station,
    StationNotFoundError,
    TrainScoringConfig,
    TrainsDefaultsConfig,
    location_search_url,
    pick_station,
    search_ranked_solutions,
)

ZURICH = [
    {"id": 1, "name": "Zuerich (city)", "displayName": "Zuerich (city)"},
    {"id": 2, "name": "Zuerich Hb", "displayName": "Zuerich Hb"},
]


def test_a_city_resolves_to_its_main_station_under_lefrecces_own_name():
    # Under "Zurigo" a booking link would open LeFrecce's first hit, the city.
    assert pick_station("Zurigo", ZURICH) == Station(2, "Zuerich Hb")


def test_an_exact_match_wins_wherever_it_is_listed():
    assert pick_station("zuerich (city)", list(reversed(ZURICH))) == Station(1, "Zuerich (city)")


def test_a_name_with_umlauts_matches_its_ascii_spelling():
    assert pick_station("Zürich HB", list(reversed(ZURICH))) == Station(2, "Zuerich Hb")


def test_a_lookup_asks_for_the_ascii_spelling_lefrecce_finds():
    assert location_search_url("Zürich HB", 50).endswith("?name=Zuerich+HB&limit=50")
    assert location_search_url("Genève", 50).endswith("?name=Geneve&limit=50")


def test_the_upper_case_stops_listed_before_a_citys_stations_are_passed_over():
    verona = [
        {"id": 1, "name": "VERONA AEROPORTO"},
        {"id": 2, "name": "VERONA BUS"},
        {"id": 3, "name": "Verona Porta Nuova"},
        {"id": 4, "name": "Verona Porta Vescovo"},
    ]
    assert pick_station("Verona", verona) == Station(3, "Verona Porta Nuova")


def test_an_alias_beats_a_longer_word_that_starts_with_the_name():
    berna = [{"id": 1, "name": "Bernalda"}, {"id": 2, "name": "Bernau A. Chiemsee"}, {"id": 3, "name": "Bern"}]
    assert pick_station("Berna", berna) == Station(3, "Bern")


def test_with_only_upper_case_stops_the_first_is_taken():
    reggio = [{"id": 1, "name": "REGGIO CALABRIA AEROPORTO BUS"}, {"id": 2, "name": "REGGIO CALABRIA LIDO BUS"}]
    assert pick_station("Reggio Calabria", reggio) == Station(1, "REGGIO CALABRIA AEROPORTO BUS")


def test_a_location_without_a_name_keeps_the_name_as_typed():
    assert pick_station("Lecce", [{"id": 7}]) == Station(7, "Lecce")


def test_no_location_is_an_error():
    with pytest.raises(StationNotFoundError):
        pick_station("Atlantide", [])


def test_a_lookup_that_finds_nothing_is_asked_again_next_time(monkeypatch):
    lookups = []

    class NoBrowser:
        async def request_context(self):
            return None

        async def close(self):
            pass

    async def no_locations(ctx, method, url, *args, **kwargs):
        lookups.append(url)
        return []

    monkeypatch.setattr("core.trains.BrowserSession", NoBrowser)
    monkeypatch.setattr("core.trains.api_request_json", no_locations)
    task = SearchTask(Route("Zurich", "Milano Centrale"), date(2026, 11, 2), date(2026, 11, 2))

    for _ in range(2):
        with pytest.raises(StationNotFoundError):
            asyncio.run(search_ranked_solutions([task], TrainsDefaultsConfig(), TrainScoringConfig()))

    assert len(lookups) == 2
