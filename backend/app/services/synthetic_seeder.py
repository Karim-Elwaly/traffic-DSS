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


# Authoritative 24-hour 4-lane directional hourly flow rate targets (PCE/h):
# Night (00:00 - 05:00): 900 to 1,800 PCE/h total across 4 lanes.
# Morning Peak (07:00 - 10:00): 6,200 to 7,400 PCE/h total.
# Midday (11:00 - 13:00): 4,500 to 5,400 PCE/h total.
# Afternoon Peak (14:00 - 18:00): 6,500 to 7,600 PCE/h total.
# Evening (19:00 - 23:00): 3,200 to 5,200 PCE/h total (higher on Thursday night).
BASE_HOURLY_PCE = [
    1450.0, 1200.0, 980.0, 920.0, 1150.0, 1650.0,   # 00 - 05: Night (920 - 1,650 PCE/h)
    3500.0, 6300.0, 7300.0, 6800.0, 6250.0, 4850.0,  # 06 - 11: Morning Peak (6,250 - 7,300 PCE/h)
    4650.0, 5200.0, 6600.0, 7500.0, 7200.0, 6600.0,  # 12 - 17: Midday (4,650 - 5,200) & Afternoon Peak (6,600 - 7,500)
    6400.0, 4600.0, 4200.0, 3700.0, 3300.0, 3000.0,  # 18 - 23: Afternoon Peak (18) & Evening (19 - 23)
]


def _get_hourly_demand_factor(hour: int, day_of_week: int) -> float:
    """
    Returns normalized hourly demand factor (0.10 to 1.0).
    """
    base_factor = BASE_HOURLY_PCE[hour] / 9000.0

    # Thursday (day 4): weekend-eve evening surge extending into the night
    if day_of_week == 4 and 19 <= hour <= 23:
        base_factor = min(1.0, base_factor * 1.15)

    # Friday (day 5): lower morning rush, moderate afternoon/evening
    if day_of_week == 5:
        if 6 <= hour <= 11:
            base_factor *= 0.55
        elif 14 <= hour <= 22:
            base_factor = min(1.0, base_factor * 1.05)

    return base_factor


def get_corridor_hourly_target_pce(hour: int, day_of_week: int, multiplier: float = 1.0) -> float:
    """
    Computes strict 4-lane directional hourly flow rate (PCE/h) calibrated to:
    - Night (00:00 - 05:00): 900 to 1,800 PCE/h total
    - Morning Peak (07:00 - 10:00): 6,200 to 7,400 PCE/h total
    - Midday (11:00 - 13:00): 4,500 to 5,400 PCE/h total
    - Afternoon Peak (14:00 - 18:00): 6,500 to 7,600 PCE/h total
    - Evening (19:00 - 23:00): 3,200 to 5,200 PCE/h total (higher on Thursday night)
    """
    val = BASE_HOURLY_PCE[hour]
    if day_of_week == 4 and 19 <= hour <= 23:
        val = min(5200.0, val * 1.15)
    elif day_of_week == 5:
        if 6 <= hour <= 11:
            val *= 0.58
        elif 14 <= hour <= 22:
            val = min(6800.0, val * 1.04)

    target = val * multiplier
    if 0 <= hour <= 5:
        target = max(900.0, min(1800.0, target))
    elif 7 <= hour <= 10:
        target = max(6200.0, min(7400.0, target))
    elif 11 <= hour <= 13:
        target = max(4500.0, min(5400.0, target))
    elif 14 <= hour <= 18:
        target = max(6500.0, min(7600.0, target))
    elif 19 <= hour <= 23:
        target = max(3200.0, min(5200.0, target))

    return round(target, 1)


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


def seed_corridors_and_telemetry(session: Session) -> None:
    """
    Seeds all 3 corridors and their 7-day x 24-hour per-lane telemetry.
    Verifies that existing data matches the calibrated 4-lane flow rates;
    if stale or corrupted (e.g. cumulative sums > 10,000 PCE/h), cleans and reseeds.
    """
    existing_corridors = session.exec(select(Corridor)).all()
    existing_records = session.exec(select(HourlyTelemetry)).all()

    # Verify existing database health: must have 3 corridors, exactly 2016 rows,
    # and realistic non-monotonically climbing demand.
    if len(existing_corridors) == len(CORRIDOR_METADATA) and len(existing_records) == 2016:
        # Check hour 23 demand on corridor 26 July: should be ~3,300 PCE/h, NOT 60,000!
        h23_records = [
            r for r in existing_records
            if r.corridor_id == "corridor_26july" and r.day_of_week == 0 and r.hour == 23
        ]
        h23_sum = sum(r.pce_flow for r in h23_records)
        if 2000.0 <= h23_sum <= 4500.0:
            return  # Already clean and authoritative!

    # Clean stale / duplicated tables
    for r in existing_records:
        session.delete(r)
    for c in existing_corridors:
        session.delete(c)
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
        c_id = meta["id"]
        speed_lim = meta["speed_limit_kmh"]
        peak_mult = meta["peak_flow_multiplier"]
        mb_ratio = meta["microbus_ratio"]
        tk_ratio = meta["truck_ratio"]

        for day in range(7):  # 0 to 6
            for hour in range(24):
                demand_factor = _get_hourly_demand_factor(hour, day)
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
