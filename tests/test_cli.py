from datetime import date

import pytest

from cli.app import order_rows, parse_span, reminders_for

TODAY = date(2026, 9, 21)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-10-03", (date(2026, 10, 3), date(2026, 10, 3))),
        ("3/10", (date(2026, 10, 3), date(2026, 10, 3))),
        ("3-5/10", (date(2026, 10, 3), date(2026, 10, 5))),
        ("30/9..2/10", (date(2026, 9, 30), date(2026, 10, 2))),
        ("03-10-2026", (date(2026, 10, 3), date(2026, 10, 3))),
        # A date already past this year means next year.
        ("20/9", (date(2027, 9, 20), date(2027, 9, 20))),
    ],
)
def test_parse_span(text, expected):
    assert parse_span(text, TODAY) == expected


def test_parse_span_rejects_garbage():
    with pytest.raises(ValueError):
        parse_span("next friday", TODAY)


def row(dep: str, cost: float) -> dict:
    return {"dep": dep, "adjusted_cost": cost, "duration_min": 60}


def test_order_by_day_takes_the_best_of_each_day():
    rows = [row("2026-10-02T09:00", 50), row("2026-10-01T09:00", 80), row("2026-10-01T12:00", 60), row("2026-10-02T15:00", 70)]
    ordered = order_rows(rows, "day", 1)
    assert [(r["dep"], r["adjusted_cost"]) for r in ordered] == [("2026-10-01T12:00", 60), ("2026-10-02T09:00", 50)]


def test_reminders_follow_their_target():
    cfg = {"reminders": {
        "a": "flights by default",
        "b": {"text": "trains only", "target": "trains"},
        "c": {"text": "all", "target": "both"},
    }}
    assert reminders_for(cfg, "trains") == ["trains only", "all"]
    assert reminders_for(cfg, "flights") == ["flights by default", "all"]
