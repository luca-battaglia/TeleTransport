import pytest

from core.config import merge_overrides
from core.flights import parse_flights_config
from core.trains import TrainScoringConfig, parse_trains_config


def test_missing_keys_keep_defaults():
    _, scoring = parse_trains_config({})
    assert scoring == TrainScoringConfig()


def test_explicit_zero_is_not_replaced_by_the_default():
    _, scoring = parse_trains_config({"trains": {"scoring": {"change_penalty_eur": 0, "early_departure_ref_hour": 0}}})
    assert scoring.change_penalty_eur == 0.0
    assert scoring.early_departure_ref_hour == 0


def test_wrong_types_are_rejected():
    with pytest.raises(ValueError, match="trains.scoring.change_penalty_eur"):
        parse_trains_config({"trains": {"scoring": {"change_penalty_eur": "five"}}})
    with pytest.raises(ValueError, match="flights.deep_search"):
        parse_flights_config({"flights": {"deep_search": 1}})


def test_airport_extras_come_from_their_own_section():
    _, scoring = parse_flights_config({"flights": {"airport_extras": {"BDS": {"fuel_eur": 30.0}}}})
    assert scoring.airport_extras == {"BDS": {"fuel_eur": 30.0}}


def test_merge_overrides_is_recursive_and_does_not_mutate():
    base = {"trains": {"scoring": {"a": 1, "b": 2}, "min_price": 5}}
    merged = merge_overrides(base, {"trains": {"scoring": {"b": 3}}})
    assert merged == {"trains": {"scoring": {"a": 1, "b": 3}, "min_price": 5}}
    assert base["trains"]["scoring"]["b"] == 2
