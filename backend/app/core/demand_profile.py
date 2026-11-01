"""
Authoritative 24-hour directional demand profile for a 4-lane Egyptian arterial.

Each value is an independent hourly flow rate in PCE/h, not a cumulative count.
The profile is shared by the synthetic telemetry seeder, the defect-ROI engine,
and any other module that needs the same diurnal demand. Keeping one source of
truth prevents the dashboard and the analytical engines from disagreeing about
what "the 15:00 demand" means.
"""

from typing import Tuple

# Planning envelopes for a 4-lane directional arterial (PCE/h).
# Night is deliberately wide because freight shifts into the small hours.
DEMAND_BANDS = {
    "night": (900.0, 1800.0),       # 00:00 - 05:00
    "transition": (3000.0, 5600.0),  # 06:00 shoulder hour
    "morning": (6200.0, 7400.0),     # 07:00 - 10:00
    "midday": (4500.0, 5400.0),      # 11:00 - 13:00
    "afternoon": (6500.0, 7600.0),   # 14:00 - 18:00
    "evening": (3200.0, 5200.0),     # 19:00 - 23:00
}

# 24 independent hourly flow rates (PCE/h). Values sit inside the bands above
# so that a corridor-specific factor can move them up or down without leaving
# the physically calibrated envelope.
BASE_HOURLY_PCE = [
    1450.0, 1200.0, 980.0, 920.0, 1150.0, 1650.0,   # 00 - 05 night
    4200.0,                                           # 06 transition
    6800.0, 7200.0, 7000.0, 6600.0,                  # 07 - 10 morning
    4900.0, 4700.0, 5100.0,                          # 11 - 13 midday
    6900.0, 7300.0, 7200.0, 6900.0, 6700.0,          # 14 - 18 afternoon
    4400.0, 4100.0, 3800.0, 3500.0, 3300.0,          # 19 - 23 evening
]

CORRIDOR_PROFILE_FACTORS = {
    "corridor_26july": 1.00,
    "corridor_ring": 1.03,
    "corridor_salah_salem": 0.97,
}


def band_for_hour(hour: int) -> Tuple[float, float]:
    """Returns the calibrated (min, max) PCE/h envelope for an hour."""
    hour = int(hour) % 24
    if 0 <= hour <= 5:
        return DEMAND_BANDS["night"]
    if hour == 6:
        return DEMAND_BANDS["transition"]
    if 7 <= hour <= 10:
        return DEMAND_BANDS["morning"]
    if 11 <= hour <= 13:
        return DEMAND_BANDS["midday"]
    if 14 <= hour <= 18:
        return DEMAND_BANDS["afternoon"]
    return DEMAND_BANDS["evening"]


def _safe_clamp(value: float, low: float, high: float, margin: float = 3.0) -> float:
    """
    Clamps a target inside a band with a small inner margin.

    Integer vehicle counts and class-mix rounding can move the realised PCE by
    a fraction of a vehicle. The margin keeps that rounding from pushing an
    hourly total over the published physical envelope.
    """
    inner_low = low + margin
    inner_high = high - margin
    if inner_low > inner_high:
        return (low + high) / 2.0
    return max(inner_low, min(inner_high, value))


def hourly_pce_target(
    hour: int,
    day_of_week: int = 0,
    corridor_factor: float = 1.0,
) -> float:
    """
    Returns the calibrated independent hourly flow rate (PCE/h) for one hour.

    ``day_of_week`` uses the project convention Sunday=0 ... Saturday=6.
    Thursday evening (19:00-23:00) carries the weekend-eve surge; Friday
    morning is lower within the same calibrated envelope.
    """
    value = BASE_HOURLY_PCE[int(hour) % 24]
    day = int(day_of_week) % 7

    if day == 4 and 19 <= hour <= 23:
        value *= 1.10
    elif day == 5:
        if 7 <= hour <= 10:
            value *= 0.96
        elif 14 <= hour <= 22:
            value *= 1.03

    value *= max(0.85, min(1.15, corridor_factor))
    low, high = band_for_hour(hour)
    return round(_safe_clamp(value, low, high), 1)


def corridor_hourly_target(
    corridor_id: str,
    hour: int,
    day_of_week: int = 0,
) -> float:
    """Convenience wrapper that applies the corridor's demand profile factor."""
    factor = CORRIDOR_PROFILE_FACTORS.get(corridor_id, 1.0)
    return hourly_pce_target(hour, day_of_week, factor)
