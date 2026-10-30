"""
Synthetic Corridor Telemetry Seeder for IT-DSS.
Generates realistic 7-day x 24-hour per-lane baseline telemetry for 3 major Egyptian corridors:
1. 26th of July Corridor (محور ٢٦ يوليو)
2. Ring Road - Giza Sector (الطريق الدائري - قطاع الجيزة)
3. Salah Salem Axis (محور صلاح سالم)
Total: 3 corridors x 7 days x 24 hours x 4 lanes = 2,016 hourly records.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import math
from typing import List
from sqlmodel import Session, select
from backend.app.models.domain import Corridor, HourlyTelemetry
from backend.app.core.hcm_math import compute_pce_flow, compute_passenger_flow


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
        "peak_flow_multiplier": 1.15,
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
        "peak_flow_multiplier": 1.30,
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
        "peak_flow_multiplier": 1.05,
        "microbus_ratio": 0.22,
        "truck_ratio": 0.05,
    },
]


def _get_hourly_demand_factor(hour: int, day_of_week: int) -> float:
    """
    Returns normalized hourly demand factor (0.15 to 1.0).
    Captures:
    - Morning rush (07:00 - 10:00)
    - Afternoon peak (14:00 - 18:00)
    - Thursday night weekend surge (20:00 - 01:00) (day 4)
    - Friday prayer & evening leisure pattern (day 5)
    """
    # Base diurnal profile
    base_curve = [
        0.22, 0.16, 0.12, 0.11, 0.15, 0.28,  # 00 - 05
        0.58, 0.90, 0.98, 0.88, 0.72, 0.68,  # 06 - 11
        0.65, 0.70, 0.85, 0.95, 0.92, 0.84,  # 12 - 17
        0.80, 0.82, 0.86, 0.78, 0.60, 0.38,  # 18 - 23
    ]
    factor = base_curve[hour]

    # Thursday (day 4): weekend-eve evening surge extending into the night
    if day_of_week == 4 and 19 <= hour <= 23:
        factor = min(1.0, factor * 1.35)

    # Friday (day 5): lower morning rush, heavy afternoon and late-night surge
    if day_of_week == 5:
        if 6 <= hour <= 11:
            factor *= 0.45
        elif 14 <= hour <= 22:
            factor = min(1.0, factor * 1.15)
        elif 0 <= hour <= 1:
            factor = min(1.0, factor * 1.50)

    return factor


def _allocate_largest_remainder(total: int, weights: List[float]) -> List[int]:
    """
    Splits ``total`` into integer counts proportional to ``weights`` using the
    largest-remainder method. The returned counts always sum exactly to
    ``total``, so a lane can never contain more vehicles than its intended
    hourly volume.
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


def seed_corridors_and_telemetry(session: Session) -> None:
    """
    Checks if database already has corridors; if not, seeds all 3 corridors
    and their 7-day x 24-hour per-lane telemetry.
    """
    existing = session.exec(select(Corridor)).first()
    if existing:
        return  # Already seeded

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
        c_id = meta["id"]
        speed_lim = meta["speed_limit_kmh"]
        peak_mult = meta["peak_flow_multiplier"]
        mb_ratio = meta["microbus_ratio"]
        tk_ratio = meta["truck_ratio"]

        for day in range(7):  # 0 to 6
            for hour in range(24):
                demand_factor = _get_hourly_demand_factor(hour, day)
                # Total hourly vehicular demand across corridor (ranges between 1200 and 7200 veh/h)
                total_corridor_veh = int(6200.0 * demand_factor * peak_mult)

                # Distribution across lanes:
                # Lane 1 (right): 22% of total, heavy microbuses & trucks
                # Lane 2: 26% of total
                # Lane 3: 28% of total, mostly cars
                # Lane 4 (left): 24% of total, fast cars
                lane_distributions = [
                    {"lane": 1, "share": 0.22, "mb_p": 0.45, "bus_p": 0.12, "truck_p": 0.25, "moto_p": 0.08, "speed_ratio": 0.68, "weaving": 0.58},
                    {"lane": 2, "share": 0.26, "mb_p": 0.30, "bus_p": 0.06, "truck_p": 0.10, "moto_p": 0.05, "speed_ratio": 0.82, "weaving": 0.35},
                    {"lane": 3, "share": 0.28, "mb_p": 0.12, "bus_p": 0.02, "truck_p": 0.02, "moto_p": 0.03, "speed_ratio": 0.94, "weaving": 0.18},
                    {"lane": 4, "share": 0.24, "mb_p": 0.04, "bus_p": 0.01, "truck_p": 0.00, "moto_p": 0.02, "speed_ratio": 1.05, "weaving": 0.12},
                ]

                # Allocate the corridor total across lanes with largest-
                # remainder rounding so the four lane volumes sum exactly to
                # total_corridor_veh.
                lane_totals = _allocate_largest_remainder(
                    total_corridor_veh,
                    [ld["share"] for ld in lane_distributions],
                )

                for lane_index, ld in enumerate(lane_distributions):
                    lane_veh = lane_totals[lane_index]

                    # Heavy truck freight shift: higher at night (00:00 - 05:00)
                    night_freight_boost = 1.8 if 0 <= hour <= 5 and ld["lane"] <= 2 else 1.0

                    mb_weight = ld["mb_p"] * (mb_ratio / 0.25)
                    truck_weight = ld["truck_p"] * (tk_ratio / 0.10) * night_freight_boost
                    bus_weight = ld["bus_p"]
                    moto_weight = ld["moto_p"]
                    car_weight = max(
                        0.02,
                        1.0 - (mb_weight + truck_weight + bus_weight + moto_weight),
                    )

                    # Normalise the five class weights so their integer counts
                    # sum exactly to lane_veh. This prevents the old overshoot
                    # that forced n_cars to zero and produced more class records
                    # than vehicles (especially on Ring Road lane 1 at night).
                    n_microbus, n_buses, n_trucks, n_moto, n_cars = _allocate_largest_remainder(
                        lane_veh,
                        [mb_weight, bus_weight, truck_weight, moto_weight, car_weight],
                    )

                    # Average speed (km/h) drops during peak periods
                    base_speed = speed_lim * ld["speed_ratio"]
                    congestion_drop = max(0.0, (demand_factor - 0.70) * 35.0)
                    avg_speed = max(18.0, round(base_speed - congestion_drop, 1))

                    # Weaving increases during peak and near informal stops
                    weaving_idx = min(0.95, round(ld["weaving"] * (0.8 + 0.4 * demand_factor), 2))

                    # Calculate PCE and passenger flow
                    pce = compute_pce_flow(n_cars, n_microbus, n_buses, n_trucks, n_moto)
                    passengers = compute_passenger_flow(n_cars, n_microbus, n_buses, n_trucks, n_moto)

                    item = HourlyTelemetry(
                        corridor_id=c_id,
                        day_of_week=day,
                        hour=hour,
                        lane_number=ld["lane"],
                        count_cars=n_cars,
                        count_microbus=n_microbus,
                        count_buses=n_buses,
                        count_trucks=n_trucks,
                        count_motorcycles=n_moto,
                        avg_speed_kmh=avg_speed,
                        lane_weaving_index=weaving_idx,
                        pce_flow=round(pce, 1),
                        passenger_flow=round(passengers, 1),
                    )
                    records.append(item)

    session.add_all(records)
    session.commit()
