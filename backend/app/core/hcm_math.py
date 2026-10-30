"""
Highway Capacity Manual (HCM) Mathematical Core and Fundamental Traffic Engineering Physics.
Implements deterministic, zero-placeholder traffic calculations.
"""

from typing import Tuple, List, Dict


# ---------------------------------------------------------------------------
# PCE & Human Occupancy Constants
# ---------------------------------------------------------------------------
PCE_WEIGHTS = {
    "car": 1.0,
    "microbus": 1.5,
    "bus": 2.0,
    "truck": 2.5,
    "motorcycle": 0.4,
}

OCCUPANCY_WEIGHTS = {
    "car": 1.4,
    "microbus": 14.0,   # Standard Egyptian high-occupancy 14-seater microbus
    "bus": 45.0,        # Public / private transit bus
    "truck": 1.2,       # Driver + assistant
    "motorcycle": 1.2,  # Driver + occasional passenger
}


def compute_pce_flow(
    cars: float,
    microbus: float,
    buses: float,
    trucks: float,
    motorcycles: float,
) -> float:
    """
    Computes effective Passenger Car Equivalents (PCE/h) flow.
    Formula: q_pce = car*1.0 + microbus*1.5 + bus*2.0 + truck*2.5 + moto*0.4
    """
    return (
        cars * PCE_WEIGHTS["car"]
        + microbus * PCE_WEIGHTS["microbus"]
        + buses * PCE_WEIGHTS["bus"]
        + trucks * PCE_WEIGHTS["truck"]
        + motorcycles * PCE_WEIGHTS["motorcycle"]
    )


def compute_passenger_flow(
    cars: float,
    microbus: float,
    buses: float,
    trucks: float,
    motorcycles: float,
) -> float:
    """
    Computes total human passenger throughput (persons/h).
    Formula: P_pax = car*1.4 + microbus*14.0 + bus*45.0 + truck*1.2 + moto*1.2
    """
    return (
        cars * OCCUPANCY_WEIGHTS["car"]
        + microbus * OCCUPANCY_WEIGHTS["microbus"]
        + buses * OCCUPANCY_WEIGHTS["bus"]
        + trucks * OCCUPANCY_WEIGHTS["truck"]
        + motorcycles * OCCUPANCY_WEIGHTS["motorcycle"]
    )


def calculate_los(
    average_delay_sec: float,
    v_c_ratio: float = 0.0,
    signalized: bool = True,
) -> str:
    """
    Evaluates Highway Capacity Manual Level of Service (LoS Grade A through F).

    HCM uses different control-delay thresholds for signalized and
    unsignalized/roundabout movements:
    - Signalized: A <= 10, B <= 20, C <= 35, D <= 55, E <= 80, F > 80 s
    - Unsignalized / roundabout: A <= 10, B <= 15, C <= 25, D <= 35, E <= 50, F > 50 s

    A v/c ratio above 1.0 is always grade F because the movement is
    oversaturated regardless of the delay estimate.
    """
    if v_c_ratio > 1.0:
        return "F"
    if signalized:
        if average_delay_sec <= 10.0:
            return "A"
        if average_delay_sec <= 20.0:
            return "B"
        if average_delay_sec <= 35.0:
            return "C"
        if average_delay_sec <= 55.0:
            return "D"
        if average_delay_sec <= 80.0:
            return "E"
        return "F"
    if average_delay_sec <= 10.0:
        return "A"
    if average_delay_sec <= 15.0:
        return "B"
    if average_delay_sec <= 25.0:
        return "C"
    if average_delay_sec <= 35.0:
        return "D"
    if average_delay_sec <= 50.0:
        return "E"
    return "F"


def compute_heavy_vehicle_factor(heavy_vehicle_proportion: float) -> float:
    """
    Heavy Vehicle Adjustment Factor: f_HV = 1 / (1 + P_HV * (E_HV - 1))
    where E_HV = 2.5 on rolling/level urban highway grades.
    """
    p_hv = max(0.0, min(1.0, heavy_vehicle_proportion))
    return 1.0 / (1.0 + p_hv * (2.5 - 1.0))


def compute_workzone_capacity(
    base_capacity_per_lane: float,
    total_lanes: int,
    closed_lanes: List[int],
    heavy_vehicle_proportion: float,
) -> Tuple[float, float, float, float]:
    """
    Computes effective Work-Zone Capacity (C_wz) under lane closure.

    HCM work-zone capacity is governed primarily by the number of lanes that
    remain open; each additional closure adds merge turbulence and reduces the
    per-lane saturation flow. Closing one of four lanes leaves 3 open lanes at
    roughly 1,880 pc/h/lane (about 94% of the 2,000 pc/h base), while a
    single-lane work zone falls to ~1,640 pc/h. The old model multiplied a
    merge factor by a second, arbitrary lane-position penalty, understating a
    three-lane work zone by ~17% and contradicting the microscopic simulation.

    Heavy vehicles are already embedded in the PCE demand, so f_hv is reported
    for transparency but is not applied a second time.

    Returns (C_wz, f_merge, f_lane, f_hv).
    """
    n_closed = len(closed_lanes)
    if n_closed >= total_lanes:
        return 0.0, 0.0, 0.0, 0.0
    open_lanes = max(1, total_lanes - n_closed)

    # Each closed lane adds a merge/weaving penalty of 6%, giving ~1,880
    # pc/h/lane with 3 of 4 lanes open and ~1,640 pc/h with one lane open.
    f_merge = max(0.40, 1.0 - (0.06 * n_closed))

    # HCM does not calibrate a separate lane-position factor. Closing a median
    # lane creates two-sided weaving, so a small 2% penalty is retained for
    # engineering realism; the rightmost lane closure is the standard case.
    f_lane = 0.98 if (2 in closed_lanes or 3 in closed_lanes) else 1.0

    # Heavy vehicle adjustment (reported only; PCE demand already includes it)
    f_hv = compute_heavy_vehicle_factor(heavy_vehicle_proportion)

    # Effective capacity in PCE/h
    c_wz = base_capacity_per_lane * open_lanes * f_merge * f_lane
    return c_wz, f_merge, f_lane, f_hv


def compute_taper_and_buffer(
    speed_limit_kmh: float,
    closed_lanes_count: int,
    lane_width_m: float = 3.65,
) -> Tuple[float, float]:
    """
    Computes standard MUTCD / Egyptian Ministry of Transport work-zone geometry:
    - Warning Taper Length: L_taper = 0.62 * W_lane * S_limit * n_closed (m)
    - Longitudinal Buffer Space: L_buffer = 2.5 * S_limit (m)
    """
    l_taper = round(0.62 * lane_width_m * speed_limit_kmh * closed_lanes_count, 1)
    l_buffer = round(2.5 * speed_limit_kmh, 1)
    return l_taper, l_buffer
