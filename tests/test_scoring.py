from datetime import datetime

import pytest

from core.flights import FlightsScoringConfig, airport_transfer_cost, late_arrival_penalty
from core.trains import TrainScoringConfig, compute_solution_metrics


def train_solution(dep: str, arr: str, price: str = "40,00", legs: int = 1) -> dict:
    return {
        "solution": {
            "status": "SALEABLE",
            "price": {"amount": price},
            "departureTime": dep,
            "arrivalTime": arr,
            "nodes": [{} for _ in range(legs)],
        }
    }


def test_train_cost_adds_time_value_and_change_penalty():
    scoring = TrainScoringConfig(time_value_eur_per_hour=20, change_penalty_eur=5)
    metrics = compute_solution_metrics(train_solution("2026-10-02T10:00:00+02:00", "2026-10-02T13:00:00+02:00", legs=2), scoring)
    assert metrics is not None
    *_, changes, price, adjusted = metrics
    assert (changes, price) == (1, 40.0)
    assert adjusted == pytest.approx(40 + 3 * 20 + 5)


def test_train_early_departure_is_charged_per_hour_before_the_reference():
    scoring = TrainScoringConfig(time_value_eur_per_hour=0, early_departure_ref_hour=9, early_departure_penalty_eur_per_hour=10)
    metrics = compute_solution_metrics(train_solution("2026-10-02T06:30:00+02:00", "2026-10-02T08:00:00+02:00"), scoring)
    assert metrics[-1] == pytest.approx(40 + 2.5 * 10)


def test_train_arrival_after_midnight_counts_from_the_evening_before():
    scoring = TrainScoringConfig(time_value_eur_per_hour=0, late_arrival_start_hour=22, late_arrival_penalty_eur_per_hour=10)
    metrics = compute_solution_metrics(train_solution("2026-10-02T21:00:00+02:00", "2026-10-03T01:00:00+02:00"), scoring)
    assert metrics[-1] == pytest.approx(40 + 3 * 10)


def test_unsaleable_train_solutions_are_skipped():
    item = train_solution("2026-10-02T10:00:00+02:00", "2026-10-02T13:00:00+02:00")
    item["solution"]["status"] = "SOLD_OUT"
    assert compute_solution_metrics(item, TrainScoringConfig()) is None


def test_flight_late_arrival_wraps_past_midnight():
    scoring = FlightsScoringConfig(late_arrival_start_hour=22, overnight_end_hour=5, late_arrival_penalty_eur_per_hour=10)
    assert late_arrival_penalty(datetime(2026, 10, 2, 23, 0), scoring) == pytest.approx(10)
    assert late_arrival_penalty(datetime(2026, 10, 3, 1, 30), scoring) == pytest.approx(35)
    assert late_arrival_penalty(datetime(2026, 10, 3, 12, 0), scoring) == 0


def test_airport_extras_apply_once_one_way_and_twice_round_trip():
    scoring = FlightsScoringConfig(
        time_value_eur_per_hour=20,
        companions_time_value_eur_per_hour=8,
        airport_extras={"BDS": {"fuel_eur": 30, "personal_drive_hours": 1.5, "companions_drive_hours": 3}},
    )
    one_leg = 30 + 1.5 * 20 + 3 * 8
    assert airport_transfer_cost(scoring, True, "ZRH", "BDS") == pytest.approx(one_leg)
    assert airport_transfer_cost(scoring, False, "ZRH", "BDS") == pytest.approx(2 * one_leg)
    assert airport_transfer_cost(scoring, True, "ZRH", "BRI") == 0
