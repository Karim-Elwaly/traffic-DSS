"""
Synthetic Corridor Telemetry Seeder for IT-DSS.
Generates realistic 7-day x 24-hour per-lane baseline telemetry for 3 major Egyptian corridors:
1. 26th of July Corridor (محور ٢٦ يوليو)
2. Ring Road - Giza Sector (الطريق الدائري - قطاع الجيزة)
3. Salah Salem Axis (محور صلاح سالم)
Total: 3 corridors x 7 days x 24 hours x 4 lanes = 2,016 hourly records.

Every hour is an independent flow rate in PCE/h. The seeder calibrates the
integer vehicle mix until the realised PCE total matches the calibrated target
for that corridor/day/hour, so the dashboard, the work-zone engine, and the
shockwave engine all read the same demand.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import math
from typing import List, Tuple
from sqlmodel import Session, select
from backend.app.models.domain import Corridor, HourlyTelemetry, SeedState
from backend.app.core.demand_profile import (
    CORRIDOR_PROFILE_FACTORS,
    corridor_hourly_target,
)
from backend.app.core.hcm_math import compute_pce_flow, compute_passenger_flow


# Bump whenever the calibrated demand profile or the vehicle mix changes. The
# startup seeder replaces the old baseline exactly once for each version.
SEED_VERSION = "4"
SEED_STATE_KEY = "telemetry_profile_version"


CORRIDOR_METADATA = [
    {
        "id": "corridor_26july",
        "name_en": "26th of July Corridor",
        "name_ar": "محور ٢٦ يوليو",
        "num_lanes": 4,
        "speed_limit_kmh": 80.0,
        "upstream_exit_distance_m": 600.0,
        "base_capacity_per_lane": 2000.0,
        "description_en": "Strategic arterial linking Lebanon Square (Giza) with Sheikh Zayed and 6th of October City.",
        "description_ar": "المحور الرابط بين ميدان لبنان ومناطق الجيزة والشيخ زايد والسادس من أكتوبر.",
        "microbus_ratio": 0.28,
        "truck_ratio": 0.08,
    },
    {
        "id": "corridor_ring",
        "name_en": "Ring Road - Giza Sector",
        "name_ar": "الطريق الدائري - قطاع الجيزة",
        "num_lanes": 4,
        "speed_limit_kmh": 90.0,
        "upstream_exit_distance_m": 750.0,
        "base_capacity_per_lane": 2000.0,
        "description_en": "High-capacity orbital expressway accommodating extensive intercity transit and heavy regional logistics.",
        "description_ar": "الطريق الدائري حول القاهرة الكبرى مع كثافة عالية من سيارات النقل والميكروباص وخطوط الأقاليم.",
        "microbus_ratio": 0.32,
        "truck_ratio": 0.16,
    },
    {
        "id": "corridor_salah_salem",
        "name_en": "Salah Salem Axis",
        "name_ar": "محور صلاح سالم",
        "num_lanes": 4,
        "speed_limit_kmh": 70.0,
        "upstream_exit_distance_m": 450.0,
        "base_capacity_per_lane": 2000.0,
        "description_en": "High-density urban spine connecting Cairo International Airport, Heliopolis, and Central Cairo.",
        "description_ar": "شريان مروري حيوي يربط مطار القاهرة الدولي ومصر الجديدة بوسط العاصمة وميدان العباسية.",
        "microbus_ratio": 0.22,
        "truck_ratio": 0.05,
    },
]


# Lane shares and class-propensity weights. Lane 1 is the rightmost/heavy lane;
# lane 4 is the leftmost/fast lane.
LANE_DISTRIBUTIONS = [
    {"lane": 1, "share": 0.22, "mb_p": 0.45, "bus_p": 0.12, "truck_p": 0.25, "moto_p": 0.08, "speed_ratio": 0.68, "weaving": 0.58},
    {"lane": 2, "share": 0.26, "mb_p": 0.30, "bus_p": 0.06, "truck_p": 0.10, "moto_p": 0.05, "speed_ratio": 0.82, "weaving": 0.35},
    {"lane": 3, "share": 0.28, "mb_p": 0.12, "bus_p": 0.02, "truck_p": 0.02, "moto_p": 0.03, "speed_ratio": 0.94, "weaving": 0.18},
    {"lane": 4, "share": 0.24, "mb_p": 0.04, "bus_p": 0.01, "truck_p": 0.00, "moto_p": 0.02, "speed_ratio": 1.05, "weaving": 0.12},
]


def _get_hourly_demand_factor(hour: int, day_of_week: int) -> float:
    """
    Backwards-compatible normalised factor (0.0 - 1.0) relative to the old
    9,000 PCE/h planning peak. New code should use the absolute PCE targets in
    ``backend.app.core.demand_profile``.
    """
    from backend.app.core.demand_profile import hourly_pce_target

    return hourly_pce_target(hour, day_of_week, 1.0) / 9000.0


def get_corridor_hourly_target_pce(
    hour: int,
    day_of_week: int,
    multiplier: float = 1.0,
) -> float:
    """Returns the calibrated 4-lane directional hourly flow rate (PCE/h)."""
    return corridor_hourly_target("corridor_26july", hour, day_of_week) * multiplier


def _allocate_largest_remainder(total: int, weights: List[float]) -> List[int]:
    """
    Splits ``total`` into integer counts proportional to ``weights`` using the
    largest-remainder method. The returned counts always sum exactly to
    ``total``.
    """
    total = max(0, int(total))
    positive = [max(0.0, float(w)) for w in weights]
    weight_sum = sum(positive)
    if total == 0 or weight_sum <= 0.0:
        return [0 for _ in positive]

    raw = [total * w / weight_sum for w in positive]
    counts = [int(math.floor(value)) for value in raw]
    remaining = total - sum(counts)
    order = sorted(
        range(len(raw)),
        key=lambda i: raw[i] - counts[i],
        reverse=True,
    )
    for i in range(remaining):
        counts[order[i % len(order)]] += 1
    return counts


def _lane_class_weights(
    lane: dict,
    microbus_ratio: float,
    truck_ratio: float,
    hour: int,
    day_of_week: int,
) -> List[float]:
    """Class weights in (microbus, bus, truck, motorcycle, car) order."""
    # Weekend-eve / night freight shift: heavy trucks are over-represented in
    # the right-hand lanes between 00:00 and 05:00.
    night_freight_boost = 1.7 if 0 <= hour <= 5 and lane["lane"] <= 2 else 1.0
    if day_of_week == 4 and 0 <= hour <= 5 and lane["lane"] <= 2:
        night_freight_boost *= 1.1

    mb_weight = lane["mb_p"] * (microbus_ratio / 0.25)
    truck_weight = lane["truck_p"] * (truck_ratio / 0.10) * night_freight_boost
    bus_weight = lane["bus_p"]
    moto_weight = lane["moto_p"]
    car_weight = max(0.02, 1.0 - (mb_weight + truck_weight + bus_weight + moto_weight))
    return [mb_weight, bus_weight, truck_weight, moto_weight, car_weight]


def _materialise_hour(
    total_veh: int,
    class_weights: List[List[float]],
) -> Tuple[List[dict], float, float]:
    """
    Builds the four lane records for a candidate corridor vehicle total.

    Returns ``(lanes, total_pce, total_passengers)`` where each lane dict has
    the five class counts plus its PCE and passenger flow.
    """
    lane_totals = _allocate_largest_remainder(
        total_veh, [lane["share"] for lane in LANE_DISTRIBUTIONS]
    )
    lanes: List[dict] = []
    total_pce = 0.0
    total_pax = 0.0

    for lane_index, lane in enumerate(LANE_DISTRIBUTIONS):
        lane_veh = lane_totals[lane_index]
        n_microbus, n_buses, n_trucks, n_moto, n_cars = _allocate_largest_remainder(
            lane_veh, class_weights[lane_index]
        )
        pce = compute_pce_flow(n_cars, n_microbus, n_buses, n_trucks, n_moto)
        pax = compute_passenger_flow(n_cars, n_microbus, n_buses, n_trucks, n_moto)
        total_pce += pce
        total_pax += pax
        lanes.append(
            {
                "lane": lane["lane"],
                "count_cars": n_cars,
                "count_microbus": n_microbus,
                "count_buses": n_buses,
                "count_trucks": n_trucks,
                "count_motorcycles": n_moto,
                "pce": pce,
                "passengers": pax,
            }
        )

    return lanes, total_pce, total_pax


def _calibrate_hour(
    target_pce: float,
    class_weights: List[List[float]],
) -> Tuple[List[dict], float, float, int]:
    """
    Finds the integer vehicle total whose realised PCE flow is closest to the
    calibrated hourly target. PCE per vehicle depends on the mix, so a simple
    ``target / 1.2`` conversion would miss the band by several percent.
    """
    target_pce = max(1.0, float(target_pce))
    best = None
    low, high = 1, 16000

    while low <= high:
        mid = (low + high) // 2
        lanes, pce, pax = _materialise_hour(mid, class_weights)
        error = abs(pce - target_pce)
        if best is None or error < best[0]:
            best = (error, mid, lanes, pce, pax)
        if pce < target_pce:
            low = mid + 1
        else:
            high = mid - 1

    assert best is not None
    _, best_total, _, _, _ = best
    # Quantisation can make the PCE curve locally non-monotonic; check a small
    # neighbourhood so the closest integer fleet is always selected.
    for candidate in range(max(1, best_total - 4), best_total + 5):
        lanes, pce, pax = _materialise_hour(candidate, class_weights)
        error = abs(pce - target_pce)
        if error < best[0]:
            best = (error, candidate, lanes, pce, pax)

    _, total_veh, lanes, total_pce, total_pax = best
    return lanes, total_pce, total_pax, total_veh


def _seed_state_matches(session: Session, corridors, records) -> bool:
    state = session.get(SeedState, SEED_STATE_KEY)
    return (
        state is not None
        and state.value == SEED_VERSION
        and len(corridors) == len(CORRIDOR_METADATA)
        and len(records) == len(CORRIDOR_METADATA) * 7 * 24 * 4
    )


def seed_corridors_and_telemetry(session: Session) -> None:
    """
    Seeds all 3 corridors and their 7-day x 24-hour per-lane telemetry.

    The seeder is versioned: an existing database is replaced once when the
    calibrated demand profile changes, then left alone so live CV updates and
    user edits survive restarts.
    """
    existing_corridors = session.exec(select(Corridor)).all()
    existing_records = session.exec(select(HourlyTelemetry)).all()

    if _seed_state_matches(session, existing_corridors, existing_records):
        return

    # Clean stale / duplicated tables and replace them with the calibrated set.
    for record in existing_records:
        session.delete(record)
    for corridor in existing_corridors:
        session.delete(corridor)
    session.commit()

    # 1. Insert Corridors
    for meta in CORRIDOR_METADATA:
        corridor = Corridor(
            id=meta["id"],
            name_en=meta["name_en"],
            name_ar=meta["name_ar"],
            num_lanes=meta["num_lanes"],
            speed_limit_kmh=meta["speed_limit_kmh"],
            upstream_exit_distance_m=meta["upstream_exit_distance_m"],
            base_capacity_per_lane=meta["base_capacity_per_lane"],
            description_en=meta["description_en"],
            description_ar=meta["description_ar"],
        )
        session.add(corridor)

    session.commit()

    # 2. Insert Hourly Telemetry Records
    records: List[HourlyTelemetry] = []

    for meta in CORRIDOR_METADATA:
        corridor_id = meta["id"]
        speed_limit = meta["speed_limit_kmh"]
        microbus_ratio = meta["microbus_ratio"]
        truck_ratio = meta["truck_ratio"]
        corridor_factor = CORRIDOR_PROFILE_FACTORS.get(corridor_id, 1.0)

        for day in range(7):  # Sunday=0 ... Saturday=6
            for hour in range(24):
                target_pce = corridor_hourly_target(corridor_id, hour, day)
                class_weights = [
                    _lane_class_weights(lane, microbus_ratio, truck_ratio, hour, day)
                    for lane in LANE_DISTRIBUTIONS
                ]
                lanes, realised_pce, realised_pax, total_veh = _calibrate_hour(
                    target_pce, class_weights
                )

                # Congestion slows the right-hand lanes first. The load ratio is
                # relative to the corridor's 4-lane physical capacity.
                load_ratio = target_pce / max(1.0, 4.0 * meta["base_capacity_per_lane"])
                congestion_drop = max(0.0, (load_ratio - 0.60) * 40.0)

                for lane_index, lane in enumerate(LANE_DISTRIBUTIONS):
                    lane_record = lanes[lane_index]
                    base_speed = speed_limit * lane["speed_ratio"]
                    avg_speed = max(18.0, round(base_speed - congestion_drop, 1))
                    weaving_idx = min(
                        0.95,
                        round(lane["weaving"] * (0.80 + 0.40 * load_ratio), 2),
                    )

                    records.append(
                        HourlyTelemetry(
                            corridor_id=corridor_id,
                            day_of_week=day,
                            hour=hour,
                            lane_number=lane_record["lane"],
                            count_cars=lane_record["count_cars"],
                            count_microbus=lane_record["count_microbus"],
                            count_buses=lane_record["count_buses"],
                            count_trucks=lane_record["count_trucks"],
                            count_motorcycles=lane_record["count_motorcycles"],
                            avg_speed_kmh=avg_speed,
                            lane_weaving_index=weaving_idx,
                            pce_flow=round(lane_record["pce"], 1),
                            passenger_flow=round(lane_record["passengers"], 1),
                        )
                    )

    session.add_all(records)
    session.commit()

    # 3. Record the seed version so a normal restart does not overwrite live CV
    #    updates or a user-modified baseline.
    state = session.get(SeedState, SEED_STATE_KEY)
    if state is None:
        state = SeedState(key=SEED_STATE_KEY, value=SEED_VERSION)
    else:
        state.value = SEED_VERSION
    session.add(state)
    session.commit()
