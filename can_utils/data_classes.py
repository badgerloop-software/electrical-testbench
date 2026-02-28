from dataclasses import dataclass


@dataclass
class SignalInfo:
    name: str
    bytes: int
    type: str
    units: str
    nominal_min: int
    nominal_max: int
    subsystem: str


@dataclass
class ParsedData:
    can_id: int
    signal_name: str
    value: float | bool | str
    timestamp: float
    is_unknown: bool = False
