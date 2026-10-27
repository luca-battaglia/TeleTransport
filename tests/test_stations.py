import pytest

from core.trains import Station, StationNotFoundError, pick_station

ZURICH = [
    {"id": 1, "name": "Zuerich (city)", "displayName": "Zuerich (city)"},
    {"id": 2, "name": "Zuerich Hb", "displayName": "Zuerich Hb"},
]


def test_a_city_resolves_to_its_main_station_under_lefrecces_own_name():
    # Under "Zurigo" a booking link would open LeFrecce's first hit, the city.
    assert pick_station("Zurigo", ZURICH) == Station(2, "Zuerich Hb")


def test_an_exact_match_wins_wherever_it_is_listed():
    assert pick_station("zuerich (city)", list(reversed(ZURICH))) == Station(1, "Zuerich (city)")


def test_a_location_without_a_name_keeps_the_name_as_typed():
    assert pick_station("Lecce", [{"id": 7}]) == Station(7, "Lecce")


def test_no_location_is_an_error():
    with pytest.raises(StationNotFoundError):
        pick_station("Atlantide", [])
