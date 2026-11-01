"""
Security Checkpoint & Toll Plaza Dynamic Optimizer Engine.
Implements an M(t)/M(t)/c multi-server queueing model, booth capacity
allocation, queue spillback prevention, and the 180-Second Green Bypass
(التفويج الأخضر) SOP.

The queueing model now distinguishes steady-state Erlang-C (rho < 1) from a
deterministic fluid queue (rho >= 1). Previously any rho >= 0.98 invented at
least 10 veh/h of excess demand, which produced a queue even when the booths
were not saturated. Waits and queues are bounded by the physical storage
upstream of the plaza, and the bypass lanes contribute to throughput.
"""

import math
from typing import List, Tuple

from backend.app.models.schemas import CheckpointRequest, CheckpointResponse

# Stopped-vehicle spacing in the queue, including the bumper gap.
JAM_SPACING_M = 7.5

# Physical storage between the plaza and the upstream highway diverge. Beyond
# this point the queue blocks the mainline, so the reported queue is capped.
UPSTREAM_STORAGE_M = 450.0
MAX_QUEUE_VEH = UPSTREAM_STORAGE_M / JAM_SPACING_M  # 60 vehicles

# The green bypass is the 180-second SOP, but a stricter user target triggers
# it earlier.
GREEN_BYPASS_WAIT_SEC = 180.0
MAX_WAIT_SEC = 3600.0

# One extra free-flow bypass lane can clear roughly 1.5 times a staffed booth.
BYPASS_LANE_EFFICIENCY = 1.5
MAX_BYPASS_LANES = 3


def compute_erlang_c_wait_time(
    arrival_rate_vph: float,
    service_rate_per_booth_vph: float,
    c: int,
) -> Tuple[float, float, float]:
    """
    Computes M/M/c queuing metrics.
    Returns (traffic_intensity_rho, wait_time_sec, queue_length_veh).
    """
    if c <= 0 or service_rate_per_booth_vph <= 0.0:
        return 2.0, MAX_WAIT_SEC, MAX_QUEUE_VEH

    total_capacity = c * service_rate_per_booth_vph
    rho = arrival_rate_vph / max(1.0, total_capacity)
    service_time_sec = 3600.0 / service_rate_per_booth_vph

    # ------------------------------------------------------------------
    # Oversaturated: deterministic fluid queue over a 15-minute period.
    # ------------------------------------------------------------------
    if rho >= 1.0:
        t_period_hours = 0.25
        excess_rate = arrival_rate_vph - total_capacity
        queue_veh = min(MAX_QUEUE_VEH, excess_rate * t_period_hours)
        # Uniform arrivals and capacity-rate departures: the average vehicle
        # waits half the final queue's clearing time, plus its own service.
        avg_wait_sec = (
            (queue_veh / max(1.0, total_capacity)) * 3600.0 / 2.0
            + service_time_sec
        )
        return rho, min(MAX_WAIT_SEC, max(service_time_sec, avg_wait_sec)), queue_veh

    # ------------------------------------------------------------------
    # Undersaturated: steady-state Erlang-C (M/M/c).
    # ------------------------------------------------------------------
    a = arrival_rate_vph / service_rate_per_booth_vph
    sum_terms = sum((a ** n) / math.factorial(n) for n in range(c))
    last_term = (a ** c) / (math.factorial(c) * max(0.01, 1.0 - rho))
    p0 = 1.0 / max(1e-6, sum_terms + last_term)

    p_queue = last_term * p0
    wait_time_hours = p_queue / max(
        1.0, total_capacity - arrival_rate_vph
    )
    wait_time_sec = min(MAX_WAIT_SEC, wait_time_hours * 3600.0)
    l_queue = min(MAX_QUEUE_VEH, arrival_rate_vph * wait_time_hours)

    return rho, max(2.0, wait_time_sec), max(1.0, l_queue)


def evaluate_checkpoint_optimizer(req: CheckpointRequest) -> CheckpointResponse:
    # Adjust service rate for the booth technology.
    service_rate = req.service_rate_per_booth_vph
    if req.booth_type == "rfid":
        service_rate = max(service_rate, 750.0)
    elif req.booth_type == "security":
        service_rate = min(service_rate, 160.0)
    elif req.booth_type == "manual":
        service_rate = min(service_rate, 320.0)
    else:  # mixed
        service_rate = max(300.0, min(650.0, service_rate))

    # Heavy vehicles lengthen the service time at every booth type.
    heavy_factor = 1.0 - (req.heavy_vehicle_share_pct / 100.0) * 0.4
    effective_service_rate = service_rate * heavy_factor

    # ------------------------------------------------------------------
    # Current configuration
    # ------------------------------------------------------------------
    rho_cur, wait_cur, queue_cur = compute_erlang_c_wait_time(
        req.inbound_flow_veh_per_hour,
        effective_service_rate,
        req.open_booths,
    )

    # ------------------------------------------------------------------
    # Optimal booth count: smallest c that meets the wait target.
    # ------------------------------------------------------------------
    optimal_c = req.total_booths
    for candidate_c in range(1, req.total_booths + 1):
        _, cand_wait, _ = compute_erlang_c_wait_time(
            req.inbound_flow_veh_per_hour,
            effective_service_rate,
            candidate_c,
        )
        if cand_wait <= req.target_max_wait_sec:
            optimal_c = candidate_c
            break

    queue_length_m = min(
        UPSTREAM_STORAGE_M, queue_cur * JAM_SPACING_M
    )

    # ------------------------------------------------------------------
    # Green bypass trigger
    # ------------------------------------------------------------------
    wait_threshold = min(GREEN_BYPASS_WAIT_SEC, req.target_max_wait_sec)
    green_bypass_triggered = (
        wait_cur >= wait_threshold or queue_length_m >= UPSTREAM_STORAGE_M
    )
    bypass_lanes = 0
    if green_bypass_triggered:
        open_capacity = req.open_booths * effective_service_rate
        deficit_flow = max(
            0.0, req.inbound_flow_veh_per_hour - open_capacity
        )
        bypass_lanes = min(
            MAX_BYPASS_LANES,
            max(
                1,
                math.ceil(
                    deficit_flow
                    / max(1.0, effective_service_rate * BYPASS_LANE_EFFICIENCY)
                ),
            ),
        )

    # ------------------------------------------------------------------
    # Level of service (HCM-style control delay bands)
    # ------------------------------------------------------------------
    if wait_cur < 20.0:
        los = "A"
    elif wait_cur < 45.0:
        los = "B"
    elif wait_cur < 80.0:
        los = "C"
    elif wait_cur < 120.0:
        los = "D"
    elif wait_cur < 180.0:
        los = "E"
    else:
        los = "F"

    # Bypass lanes are free-flow and add capacity beyond the staffed booths.
    booth_throughput = req.open_booths * effective_service_rate
    bypass_throughput = (
        bypass_lanes
        * effective_service_rate
        * BYPASS_LANE_EFFICIENCY
    )
    throughput = min(
        req.inbound_flow_veh_per_hour,
        booth_throughput + bypass_throughput,
    )

    if green_bypass_triggered:
        strat_en = (
            f"CRITICAL BACKPRESSURE: Wait time is {int(wait_cur)}s "
            f"(threshold {int(wait_threshold)}s) and queue is "
            f"{int(queue_length_m)}m. Mandatory Green Wave Bypass activated: "
            f"opening {bypass_lanes} express bypass lane(s) to flush traffic."
        )
        strat_ar = (
            f"ارتداد مروري حرج: زمن الانتظار {int(wait_cur)} ثانية "
            f"(الحد {int(wait_threshold)} ث) والطابور {int(queue_length_m)} متر. "
            f"تم تفعيل بروتوكول التفويج الأخضر التلقائي: فتح عدد {bypass_lanes} "
            f"حارات طوارئ سريعة لمنع شلل المحور الرئيسي."
        )
    elif req.open_booths < optimal_c:
        strat_en = (
            f"Open {optimal_c - req.open_booths} additional booth(s) to lower "
            f"intensity rho from {rho_cur:.2f} to <0.80."
        )
        strat_ar = (
            f"يوصى بفتح عدد {optimal_c - req.open_booths} بوابات إضافية لخفض "
            f"معدل التشبع من {rho_cur:.2f} إلى أقل من 0.80."
        )
    else:
        strat_en = (
            f"Optimal configuration: {req.open_booths} booths operating smoothly "
            f"at LoS {los}."
        )
        strat_ar = (
            f"تشغيل متزن: {req.open_booths} بوابات تعمل بسلاسة عند مستوى خدمة {los}."
        )

    alloc_en: List[str] = []
    alloc_ar: List[str] = []
    rfid_booths_count = max(1, optimal_c // 2)
    manual_booths_count = max(1, optimal_c - rfid_booths_count)

    for b_idx in range(1, req.total_booths + 1):
        if green_bypass_triggered and b_idx <= bypass_lanes:
            alloc_en.append(
                f"Booth {b_idx}: Emergency Green Bypass Gate (Open Free Flow)"
            )
            alloc_ar.append(
                f"بوابة {b_idx}: تفويج أخضر للطوارئ (مرور حر بدون توقف)"
            )
        elif b_idx <= rfid_booths_count:
            alloc_en.append(
                f"Booth {b_idx}: Dedicated RFID / Electronic Smart Tag"
            )
            alloc_ar.append(
                f"بوابة {b_idx}: حارة مخصصة للدفع الإلكتروني والملصق الذكي (RFID)"
            )
        elif b_idx <= (rfid_booths_count + manual_booths_count):
            alloc_en.append(
                f"Booth {b_idx}: Active Manual Toll Collection & Verification"
            )
            alloc_ar.append(
                f"بوابة {b_idx}: تحصيل يدوي وفحص مروري نشط"
            )
        else:
            alloc_en.append(
                f"Booth {b_idx}: Standby Reserve Gate (Peak Auxiliary)"
            )
            alloc_ar.append(
                f"بوابة {b_idx}: بوابة احتياطية في وضع الاستعداد"
            )

    return CheckpointResponse(
        checkpoint_id=req.checkpoint_id,
        inbound_flow_veh_per_hour=req.inbound_flow_veh_per_hour,
        total_booths=req.total_booths,
        open_booths=req.open_booths,
        optimal_open_booths=optimal_c,
        traffic_intensity_rho=round(rho_cur, 3),
        avg_wait_time_sec=round(wait_cur, 1),
        avg_queue_veh=round(queue_cur, 1),
        queue_length_m=round(queue_length_m, 1),
        green_bypass_triggered=green_bypass_triggered,
        bypass_lanes_to_open=bypass_lanes,
        throughput_veh_per_hour=round(throughput, 0),
        level_of_service=los,
        mitigation_strategy_en=strat_en,
        mitigation_strategy_ar=strat_ar,
        booth_allocation_en=alloc_en,
        booth_allocation_ar=alloc_ar,
    )
