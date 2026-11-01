"""
Security Checkpoint & Toll Plaza Dynamic Optimizer Engine.
Implements M(t)/M(t)/c multi-server queueing model, booth capacity allocation,
queue spillback prevention, and the 180-Second Green Bypass (التفويج الأخضر) SOP.
"""

import math
from typing import List, Tuple
from backend.app.models.schemas import CheckpointRequest, CheckpointResponse


def compute_erlang_c_wait_time(arrival_rate_vph: float, service_rate_per_booth_vph: float, c: int) -> Tuple[float, float, float]:
    """
    Computes M/M/c queuing metrics:
    Returns (traffic_intensity_rho, wait_time_sec, queue_length_veh)
    """
    if c <= 0:
        return 2.0, 999.0, 500.0

    total_capacity = c * service_rate_per_booth_vph
    rho = arrival_rate_vph / max(1.0, total_capacity)

    # Oversaturated deterministic queue growth (assuming 0.25h evaluation interval)
    if rho >= 0.98:
        t_period_hours = 0.25
        excess_rate = max(10.0, arrival_rate_vph - total_capacity)
        queue_veh = excess_rate * t_period_hours
        wait_time_sec = (queue_veh / total_capacity) * 3600.0 + (3600.0 / service_rate_per_booth_vph)
        # Clamp wait time to realistic bounds
        wait_time_sec = min(900.0, max(60.0, wait_time_sec))
        return rho, wait_time_sec, min(800.0, max(15.0, queue_veh))

    # Steady-state Erlang-C formula for M/M/c
    a = arrival_rate_vph / service_rate_per_booth_vph
    sum_terms = sum((a ** n) / math.factorial(n) for n in range(c))
    last_term = ((a ** c) / (math.factorial(c) * max(0.01, 1.0 - rho)))
    p0 = 1.0 / max(1e-6, (sum_terms + last_term))

    p_queue = last_term * p0
    wait_time_hours = p_queue / max(1.0, (c * service_rate_per_booth_vph - arrival_rate_vph))
    wait_time_sec = wait_time_hours * 3600.0
    l_queue = arrival_rate_vph * wait_time_hours

    return rho, max(2.0, wait_time_sec), max(1.0, l_queue)


def evaluate_checkpoint_optimizer(req: CheckpointRequest) -> CheckpointResponse:
    # Adjust service rate for heavy vehicles and booth type
    service_rate = req.service_rate_per_booth_vph
    if req.booth_type == "rfid":
        service_rate = max(service_rate, 750.0)
    elif req.booth_type == "security":
        service_rate = min(service_rate, 160.0)
    elif req.booth_type == "manual":
        service_rate = min(service_rate, 320.0)
    else:  # mixed
        service_rate = max(300.0, min(650.0, service_rate))

    # Heavy vehicle friction
    heavy_factor = 1.0 - (req.heavy_vehicle_share_pct / 100.0) * 0.4
    effective_service_rate = service_rate * heavy_factor

    # Evaluate current configuration
    rho_cur, wait_cur, queue_cur = compute_erlang_c_wait_time(
        req.inbound_flow_veh_per_hour,
        effective_service_rate,
        req.open_booths
    )

    # Find optimal number of open booths to keep wait <= target_max_wait_sec
    optimal_c = req.open_booths
    for candidate_c in range(1, req.total_booths + 1):
        _, cand_wait, _ = compute_erlang_c_wait_time(
            req.inbound_flow_veh_per_hour,
            effective_service_rate,
            candidate_c
        )
        if cand_wait <= req.target_max_wait_sec:
            optimal_c = candidate_c
            break
    else:
        optimal_c = req.total_booths

    # Average vehicle storage space = 7.5m (including bumper gap)
    queue_length_m = queue_cur * 7.5

    # 180-Second Green Bypass Trigger
    # Triggered when wait > 180s or queue > 450m (reaches upstream highway diverge)
    green_bypass_triggered = (wait_cur >= req.target_max_wait_sec) or (queue_length_m >= 450.0)
    bypass_lanes = 0
    if green_bypass_triggered:
        deficit_flow = max(0.0, req.inbound_flow_veh_per_hour - (req.open_booths * effective_service_rate))
        bypass_lanes = min(3, max(1, math.ceil(deficit_flow / (effective_service_rate * 1.5))))

    # Level of Service
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

    throughput = min(req.inbound_flow_veh_per_hour, req.open_booths * effective_service_rate)

    if green_bypass_triggered:
        strat_en = (
            f"CRITICAL BACKPRESSURE: Wait time is {int(wait_cur)}s (>180s threshold) and queue is {int(queue_length_m)}m. "
            f"Mandatory Green Wave Bypass activated: opening {bypass_lanes} express bypass lane(s) to flush traffic."
        )
        strat_ar = (
            f"ارتداد مروري حرج: زمن الانتظار {int(wait_cur)} ثانية (تجاوز حد 180 ث) والطابور {int(queue_length_m)} متر. "
            f"تم تفعيل بروتوكول التفويج الأخضر التلقائي: فتح عدد {bypass_lanes} حارات طوارئ سريعة لمنع شلل المحور الرئيسي."
        )
    elif req.open_booths < optimal_c:
        strat_en = f"Open {optimal_c - req.open_booths} additional booth(s) to lower intensity rho from {rho_cur:.2f} to <0.80."
        strat_ar = f"يوصى بفتح عدد {optimal_c - req.open_booths} بوابات إضافية لخفض معدل التشبع من {rho_cur:.2f} إلى أقل من 0.80."
    else:
        strat_en = f"Optimal configuration: {req.open_booths} booths operating smoothly at LoS {los}."
        strat_ar = f"تشغيل متزن: {req.open_booths} بوابات تعمل بسلاسة عند مستوى خدمة {los}."

    alloc_en = []
    alloc_ar = []
    rfid_booths_count = max(1, optimal_c // 2)
    manual_booths_count = max(1, optimal_c - rfid_booths_count)

    for b_idx in range(1, req.total_booths + 1):
        if green_bypass_triggered and b_idx <= bypass_lanes:
            alloc_en.append(f"Booth {b_idx}: Emergency Green Bypass Gate (Open Free Flow)")
            alloc_ar.append(f"بوابة {b_idx}: تفويج أخضر للطوارئ (مرور حر بدون توقف)")
        elif b_idx <= rfid_booths_count:
            alloc_en.append(f"Booth {b_idx}: Dedicated RFID / Electronic Smart Tag")
            alloc_ar.append(f"بوابة {b_idx}: حارة مخصصة للدفع الإلكتروني والملصق الذكي (RFID)")
        elif b_idx <= (rfid_booths_count + manual_booths_count):
            alloc_en.append(f"Booth {b_idx}: Active Manual Toll Collection & Verification")
            alloc_ar.append(f"بوابة {b_idx}: تحصيل يدوي وفحص مروري نشط")
        else:
            alloc_en.append(f"Booth {b_idx}: Standby Reserve Gate (Peak Auxiliary)")
            alloc_ar.append(f"بوابة {b_idx}: بوابة احتياطية في وضع الاستعداد")

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
