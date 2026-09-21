"""Request models. Everything a client sends is validated here before it reaches core/."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

MAX_ENDPOINTS = 5

Place = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
IataCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
Money = Annotated[float, Field(ge=0, le=10_000)]
Hours = Annotated[float, Field(ge=0, le=48)]
HourOfDay = Annotated[int, Field(ge=0, le=24)]


class DateRange(BaseModel):
    start: date
    end: date


class SearchRequest(BaseModel):
    origins: List[Place] = Field(min_length=1, max_length=MAX_ENDPOINTS)
    destinations: List[Place] = Field(min_length=1, max_length=MAX_ENDPOINTS)
    dep_ranges: List[DateRange] = Field(min_length=1, max_length=14)
    ret_ranges: List[DateRange] = Field(default_factory=list, max_length=14)
    one_way: bool = False
    lang: Literal["it", "en"] = "it"


class _Strict(BaseModel):
    # Unknown keys are rejected rather than ignored: a misspelled setting should
    # fail loudly instead of silently doing nothing.
    model_config = ConfigDict(extra="forbid")


class TrainScoringOverrides(_Strict):
    time_value_eur_per_hour: Optional[Money] = None
    early_departure_ref_hour: Optional[HourOfDay] = None
    early_departure_penalty_eur_per_hour: Optional[Money] = None
    late_arrival_start_hour: Optional[HourOfDay] = None
    overnight_end_hour: Optional[HourOfDay] = None
    late_arrival_penalty_eur_per_hour: Optional[Money] = None
    change_penalty_eur: Optional[Money] = None


class FlightScoringOverrides(_Strict):
    time_value_eur_per_hour: Optional[Money] = None
    early_departure_ref_hour: Optional[HourOfDay] = None
    early_departure_penalty_eur_per_hour: Optional[Money] = None
    late_arrival_start_hour: Optional[HourOfDay] = None
    overnight_end_hour: Optional[HourOfDay] = None
    late_arrival_penalty_eur_per_hour: Optional[Money] = None
    connection_penalty_eur: Optional[Money] = None
    companions_time_value_eur_per_hour: Optional[Money] = None


class AirportExtra(_Strict):
    fuel_eur: Money = 0
    personal_drive_hours: Hours = 0
    companions_drive_hours: Hours = 0


class TrainOverrides(_Strict):
    scoring: Optional[TrainScoringOverrides] = None


class FlightOverrides(_Strict):
    scoring: Optional[FlightScoringOverrides] = None
    airport_extras: Optional[Dict[IataCode, AirportExtra]] = Field(default=None, max_length=20)


class FlightUiOverrides(_Strict):
    iata_mapping: Optional[Dict[Place, IataCode]] = Field(default=None, max_length=100)


class UiOverrides(_Strict):
    flights: Optional[FlightUiOverrides] = None


class ConfigOverrides(_Strict):
    """The only settings a client may change: scoring weights and personal lookups.

    Limits, retries, page sizes and caching stay server-side, because they decide
    how much load one request puts on the server and on the upstream sites.
    """

    trains: Optional[TrainOverrides] = None
    flights: Optional[FlightOverrides] = None
    ui: Optional[UiOverrides] = None
