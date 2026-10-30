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


def calculate_los(average_delay_sec: float, v_c_ratio: float = 0.0) -> str:
    """
    Evaluates Highway Capacity Manual Level of Service (LoS Grade A through F)
    using the project specification thresholds:
    - Grade A: d <= 10s
    - Grade B: 10 < d <= 20s
    - Grade C: 20 < d <= 35s
    - Grade D: 35 < d <= 55s
    - Grade E: 55 < d <= 80s
    - Grade F: d > 80s or v/c > 1.0
    """
    if v_c_ratio > 1.0 or average_delay_sec > 80.0:
        return "F"
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
    1. Merge Friction Factor: f_merge = 1.0 - (0.12 * n_closed)
    2. Lane Specific Penalty (f_lane):
       - Closing Lane 1 (rightmost heavy lane): f_lane = 0.88
       - Closing Center Lanes (2 or 3): f_lane = 0.90
       - Closing Lane 4 (leftmost fast lane): f_lane = 0.93
    3. Heavy Vehicle factor: f_hv = 1 / (1 + P_hv * 1.5)
    4. C_wz = C_base * (total_lanes - n_closed) * f_merge * f_lane * f_hv
    Returns (C_wz, f_merge, f_lane, f_hv).
    """
    n_closed = len(closed_lanes)
    open_lanes = max(1, total_lanes - n_closed)

    # 1. Merge friction
    f_merge = max(0.40, 1.0 - (0.12 * n_closed))

    # 2. Specific lane penalty
    if 1 in closed_lanes:
        f_lane = 0.88
    elif 2 in closed_lanes or 3 in closed_lanes:
        f_lane = 0.90
    else:
        f_lane = 0.93

    # 3. Heavy vehicle adjustment
    f_hv = compute_heavy_vehicle_factor(heavy_vehicle_proportion)

    # 4. Effective capacity
    c_wz = base_capacity_per_lane * open_lanes * f_merge * f_lane * f_hv
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
