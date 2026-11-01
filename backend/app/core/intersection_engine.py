"""
Module 2: Intersection Signal Warrant & What-If Simulator Engine.
Compares 4 geometric and operational intersection alternatives:
1. Uncontrolled Open Intersection (Baseline, high conflict points)
2. Webster's Adaptive 4-Phase Traffic Signal
3. Closed Median + Protected U-Turn Corridor (Egyptian Axis Model)
4. Modern 3-Lane Roundabout

All values are deterministic HCM/Webster calculations. Every queue is bounded
by the available upstream storage and every delay is finite, so an extreme
slider combination reports "oversaturated" instead of producing delay or queue
values in the millions.
"""

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

import math
from typing import List, Dict, Any
from backend.app.core.hcm_math import calculate_los
from backend.app.models.schemas import (
    IntersectionRequest,
    IntersectionResponse,
    IntersectionAlternative,
)


MAIN_LANES_PER_DIRECTION = 2
CROSS_LANES_PER_DIRECTION = 2
MAIN_SATURATION_PER_LANE = 1900.0
CROSS_SATURATION_PER_LANE = 1800.0
LOST_TIME_SEC = 16.0
ANALYSIS_PERIOD_H = 0.25  # 15-minute HCM analysis period
MAX_DELAY_SEC = 240.0
MIN_DELAY_SEC = 5.0
MAX_QUEUE_M = 500.0
MIN_QUEUE_M = 10.0
JAM_SPACING_M = 7.5
PEAK_DIRECTION_SHARE = 0.55
DEFAULT_UPSTREAM_STORAGE_M = 500.0


def clamp(val: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, val))


def _bounded_delay(value: float) -> float:
    if not math.isfinite(value):
        return MAX_DELAY_SEC
    return clamp(value, MIN_DELAY_SEC, MAX_DELAY_SEC)


def _bounded_queue(value: float) -> float:
    if not math.isfinite(value):
        return MAX_QUEUE_M
    return clamp(value, MIN_QUEUE_M, MAX_QUEUE_M)


def _uniform_delay(cycle_sec: float, green_sec: float, vc: float) -> float:
    """Webster/HCM uniform control delay for one approach."""
    green_ratio = green_sec / max(1.0, cycle_sec)
    denominator = 1.0 - min(0.98, max(0.0, vc)) * green_ratio
    denominator = max(0.05, denominator)
    return 0.5 * cycle_sec * (1.0 - green_ratio) ** 2 / denominator


def _incremental_delay(capacity: float, vc: float) -> float:
    """HCM incremental (overflow) delay term for a 15-minute analysis period."""
    if capacity <= 0.0 or vc <= 1e-6:
        return 0.0
    k = 0.5
    i = 1.0
    term = (vc - 1.0) ** 2 + (
        8.0 * k * i * vc / max(1.0, capacity * ANALYSIS_PERIOD_H)
    )
    inc = 900.0 * ANALYSIS_PERIOD_H * ((vc - 1.0) + math.sqrt(max(0.0, term)))
    return clamp(inc, 0.0, MAX_DELAY_SEC)


def simulate_intersections(inputs: IntersectionRequest) -> IntersectionResponse:
    """
    Evaluates all 4 intersection geometries simultaneously using deterministic
    traffic flow theory and Webster's delay equations.
    """
    total_flow = inputs.main_flow + inputs.cross_flow
    total_flow = max(1.0, total_flow)
    turn_ratio = clamp(inputs.turning_pct / 100.0, 0.01, 0.60)
    heavy_ratio = clamp(inputs.heavy_pct / 100.0, 0.0, 0.50)
    heavy_factor = max(0.70, 1.0 - 0.5 * heavy_ratio)
    turn_factor = max(0.80, 1.0 - 0.2 * turn_ratio)

    # -----------------------------------------------------------------------
    # Alternative 1: Uncontrolled Open Intersection
    # -----------------------------------------------------------------------
    # A 4-leg, 8-lane uncontrolled junction cannot discharge at full saturation
    # because every movement must accept a gap. Use 900 veh/h per approach lane
    # as the gap-acceptance capacity, adjusted for turning and heavy vehicles.
    open_lanes_total = 2 * (MAIN_LANES_PER_DIRECTION + CROSS_LANES_PER_DIRECTION)
    c_open = 900.0 * open_lanes_total * turn_factor * max(0.75, 1.0 - 0.25 * heavy_ratio)
    vc_open = total_flow / max(1.0, c_open)
    # An uncontrolled junction has no signal protection, so once total demand
    # approaches the gap-acceptance capacity the delay grows like an HCM
    # unsignalized approach. The old BPR-style power curve was too shallow
    # (98 s at v/c 1.56) and let a gridlocked open junction outscore a signal.
    d_open = 9.5 + _incremental_delay(c_open, vc_open)
    q_open_veh = (
        1.6 * (total_flow / 3600.0) * d_open
        + max(0.0, total_flow - c_open) * ANALYSIS_PERIOD_H
    )
    q95_open = min(
        MAX_QUEUE_M,
        max(15.0, q_open_veh / max(1, MAIN_LANES_PER_DIRECTION) * JAM_SPACING_M),
    )
    los_open = calculate_los(d_open, vc_open, signalized=False)

    alt_open = IntersectionAlternative(
        id="OPEN",
        name_en="Uncontrolled Open Intersection",
        name_ar="تقاطع سطحي مفتوح بدون تحكم",
        conflict_points=32,
        average_delay_sec=round(_bounded_delay(d_open), 1),
        queue_95th_m=round(q95_open, 1),
        capacity_vehh=round(c_open, 1),
        volume_to_capacity=round(vc_open, 2),
        level_of_service=los_open,
        spillback_risk=q95_open > 300.0 or vc_open > 0.95,
        safety_index_pct=25.0,  # Highest crash risk due to 32 conflict points
        estimated_throughput_pce=round(min(total_flow, c_open), 1),
    )

    # -----------------------------------------------------------------------
    # Alternative 2: Adaptive Traffic Signal (Webster's Method)
    # -----------------------------------------------------------------------
    saturation_main = (
        MAIN_SATURATION_PER_LANE
        * MAIN_LANES_PER_DIRECTION
        * heavy_factor
        * turn_factor
    )
    saturation_cross = (
        CROSS_SATURATION_PER_LANE
        * CROSS_LANES_PER_DIRECTION
        * heavy_factor
        * turn_factor
    )

    # The inputs are two-way corridor flows. A 55/45 directional split is the
    # standard planning assumption; the critical lane group sees 55% of the
    # two-way volume. The green split therefore uses the critical flow ratios,
    # not an arbitrary fraction of the total flow.
    y_main = PEAK_DIRECTION_SHARE * inputs.main_flow / max(1.0, saturation_main)
    y_cross = PEAK_DIRECTION_SHARE * inputs.cross_flow / max(1.0, saturation_cross)
    y_raw = y_main + y_cross
    y_for_cycle = min(0.95, max(0.02, y_raw))
    raw_cycle = (1.5 * LOST_TIME_SEC + 5.0) / (1.0 - y_for_cycle)
    cycle_sec = clamp(raw_cycle, 45.0, 160.0)

    effective_green = max(16.0, cycle_sec - LOST_TIME_SEC)
    if y_raw > 1e-9:
        green_main = max(8.0, effective_green * y_main / y_raw)
        green_cross = max(8.0, effective_green - green_main)
    else:
        green_main = effective_green / 2.0
        green_cross = effective_green / 2.0
    cycle_sec = green_main + green_cross + LOST_TIME_SEC

    capacity_main = (
        2.0 * saturation_main * green_main / max(1.0, cycle_sec)
    )  # both directions
    capacity_cross = 2.0 * saturation_cross * green_cross / max(1.0, cycle_sec)
    capacity_sig = capacity_main + capacity_cross
    x_main = inputs.main_flow / max(1.0, capacity_main)
    x_cross = inputs.cross_flow / max(1.0, capacity_cross)
    x_sig = max(x_main, x_cross)

    d1_main = _uniform_delay(cycle_sec, green_main, x_main)
    d1_cross = _uniform_delay(cycle_sec, green_cross, x_cross)
    d2_main = _incremental_delay(capacity_main, x_main)
    d2_cross = _incremental_delay(capacity_cross, x_cross)
    d_sig = (
        inputs.main_flow * (d1_main + d2_main)
        + inputs.cross_flow * (d1_cross + d2_cross)
    ) / total_flow

    red_main = max(0.0, cycle_sec - green_main)
    red_cross = max(0.0, cycle_sec - green_cross)
    q_main_veh = (
        1.5 * (PEAK_DIRECTION_SHARE * inputs.main_flow / 3600.0) * red_main
        + max(0.0, inputs.main_flow - capacity_main) * ANALYSIS_PERIOD_H
    )
    q_cross_veh = (
        1.5 * (PEAK_DIRECTION_SHARE * inputs.cross_flow / 3600.0) * red_cross
        + max(0.0, inputs.cross_flow - capacity_cross) * ANALYSIS_PERIOD_H
    )
    q95_sig = min(
        MAX_QUEUE_M,
        max(
            15.0,
            q_main_veh / MAIN_LANES_PER_DIRECTION * JAM_SPACING_M,
            q_cross_veh / CROSS_LANES_PER_DIRECTION * JAM_SPACING_M,
        ),
    )
    los_sig = calculate_los(d_sig, x_sig)

    alt_signal = IntersectionAlternative(
        id="SIGNAL",
        name_en="Adaptive 4-Phase Traffic Signal",
        name_ar="إشارة ضوئية ذكية رباعية الأطوار",
        conflict_points=8,
        average_delay_sec=round(_bounded_delay(d_sig), 1),
        queue_95th_m=round(q95_sig, 1),
        capacity_vehh=round(capacity_sig, 1),
        volume_to_capacity=round(x_sig, 2),
        level_of_service=los_sig,
        spillback_risk=q95_sig > 300.0 or x_sig > 1.0,
        safety_index_pct=75.0,
        estimated_throughput_pce=round(min(total_flow, capacity_sig), 1),
    )

    # -----------------------------------------------------------------------
    # Alternative 3: Closed Median + Protected U-Turn Corridor
    # -----------------------------------------------------------------------
    # The mainline keeps four lanes in total. Diverted cross/left traffic uses a
    # protected U-turn opening with an additional 1,200 veh/h capacity.
    c_mainline = 4.0 * MAIN_SATURATION_PER_LANE * heavy_factor
    c_uturn = c_mainline + 1200.0 * heavy_factor
    vc_uturn = total_flow / max(1.0, c_uturn)

    p_div = clamp(
        (inputs.cross_flow + inputs.main_flow * turn_ratio) / total_flow,
        0.0,
        1.0,
    )
    v_cruise_ms = 50.0 / 3.6
    t_detour = (2.0 * inputs.uturn_distance_m) / v_cruise_ms
    d_weave = 6.0 + 14.0 * ((total_flow / 6800.0) ** 2.1)
    d_uturn = (
        p_div * max(0.0, t_detour - 15.0)
        + d_weave
        + _incremental_delay(c_uturn, vc_uturn)
    )

    diverted_veh = p_div * total_flow
    q_uturn_veh = (
        1.5 * (diverted_veh / 3600.0) * d_uturn
        + max(0.0, total_flow - c_uturn) * ANALYSIS_PERIOD_H
    )
    q95_uturn = min(MAX_QUEUE_M, max(12.0, q_uturn_veh * JAM_SPACING_M))
    los_uturn = calculate_los(d_uturn, vc_uturn, signalized=False)

    alt_uturn = IntersectionAlternative(
        id="UTURN",
        name_en="Closed Median + Protected U-Turn Corridor",
        name_ar="إلغاء التقاطع + محور دوران للخلف (نموذج المحاور المصرية)",
        conflict_points=4,
        average_delay_sec=round(_bounded_delay(d_uturn), 1),
        queue_95th_m=round(q95_uturn, 1),
        capacity_vehh=round(c_uturn, 1),
        volume_to_capacity=round(vc_uturn, 2),
        level_of_service=los_uturn,
        spillback_risk=q95_uturn > 300.0 or vc_uturn > 1.0,
        safety_index_pct=92.0,  # Eliminates right-angle perpendicular collisions
        estimated_throughput_pce=round(min(total_flow, c_uturn), 1),
    )

    # -----------------------------------------------------------------------
    # Alternative 4: Modern 3-Lane Roundabout
    # -----------------------------------------------------------------------
    # HCM-style entry capacity. Four approaches with two entry lanes each give
    # eight entry lanes; capacity falls as the circulating flow increases.
    entry_lanes = 4 * 2
    q_circ = 0.45 * inputs.main_flow + 0.55 * inputs.cross_flow * (1.0 + turn_ratio)
    q_circ_per_entry = q_circ / 4.0
    c_entry = (
        1130.0
        * math.exp(-0.0007 * q_circ_per_entry)
        * max(0.70, 1.0 - 0.5 * heavy_ratio)
    )
    c_round = c_entry * entry_lanes
    vc_round = total_flow / max(1.0, c_round)

    d_round = (
        3600.0 / max(1.0, c_entry)
        + 5.0  # HCM driver impatience / control delay floor
        + _incremental_delay(c_round, vc_round)
    )
    q_round_veh = (
        1.6 * (total_flow / 3600.0) * d_round
        + max(0.0, total_flow - c_round) * ANALYSIS_PERIOD_H
    )
    q95_round = min(
        MAX_QUEUE_M,
        max(18.0, q_round_veh / 2.0 * JAM_SPACING_M),
    )
    los_round = calculate_los(d_round, vc_round, signalized=False)

    alt_round = IntersectionAlternative(
        id="ROUNDABOUT",
        name_en="Modern 3-Lane High-Capacity Roundabout",
        name_ar="ميدان دائري حديث ثلاثي الحارات",
        conflict_points=8,
        average_delay_sec=round(_bounded_delay(d_round), 1),
        queue_95th_m=round(q95_round, 1),
        capacity_vehh=round(c_round, 1),
        volume_to_capacity=round(vc_round, 2),
        level_of_service=los_round,
        spillback_risk=q95_round > 280.0 or vc_round > 0.90,
        safety_index_pct=82.0,
        estimated_throughput_pce=round(min(total_flow, c_round), 1),
    )

    alternatives = [alt_open, alt_signal, alt_uturn, alt_round]

    # -----------------------------------------------------------------------
    # Winning Recommendation Logic (data-driven)
    # -----------------------------------------------------------------------
    # For each alternative, rank by control delay with explicit penalties for
    # oversaturation, spillback and poor safety. This replaces the old rule
    # that always selected the U-turn whenever mainline flow exceeded 2,800
    # veh/h, even when the computed U-turn delay was worse than the signal.
    def _score(alt: IntersectionAlternative) -> float:
        penalty = 0.0
        # An uncontrolled 4-leg junction is not an acceptable design once the
        # major approach exceeds the HCM signal-warrant range. Without this,
        # the lowest-delay arithmetic could recommend a 32-conflict open
        # junction at 8,000+ veh/h simply because its delay is slightly lower.
        if alt.id == "OPEN" and total_flow > 4000.0:
            penalty += 80.0
        if alt.volume_to_capacity > 1.0:
            penalty += 60.0
        if alt.spillback_risk:
            penalty += 30.0
        penalty += max(0.0, 100.0 - alt.safety_index_pct) * 0.08
        return alt.average_delay_sec + penalty

    winner = min(alternatives, key=_score)
    recommended_id = winner.id

    condition_en = (
        "The least-delay option is still oversaturated at this demand, so the "
        "scheme must be paired with upstream metering or demand management."
        if winner.volume_to_capacity > 1.0
        else (
            "The 95th-percentile queue reaches the upstream storage limit, so "
            "spillback mitigation is required."
            if winner.spillback_risk
            else "The selected option stays within capacity with no spillback."
        )
    )
    condition_ar = (
        "الخيار الأقل تأخيراً لا يزال مشبعاً عند هذا الطلب، لذا يجب دمجه مع تنظيم "
        "التدفق من المنبع أو إدارة الطلب."
        if winner.volume_to_capacity > 1.0
        else (
            "الطابور المئوي 95 يصل إلى حد السعة الخلفية، لذا يلزم اتخاذ إجراءات لمنع الارتداد."
            if winner.spillback_risk
            else "الخيار المختار يعمل داخل حدود السعة دون ارتداد للطابور."
        )
    )

    rationale_en = (
        f"At {total_flow:.0f} veh/h total demand ({inputs.main_flow:.0f} main + "
        f"{inputs.cross_flow:.0f} cross), {winner.name_en} gives the lowest "
        f"weighted control delay ({winner.average_delay_sec:.1f}s, LoS "
        f"{winner.level_of_service}), a 95th-percentile queue of "
        f"{winner.queue_95th_m:.0f}m, v/c {winner.volume_to_capacity:.2f}, "
        f"{winner.conflict_points} conflict points and a "
        f"{winner.safety_index_pct:.0f}% safety index. {condition_en}"
    )
    rationale_ar = (
        f"عند طلب إجمالي {total_flow:.0f} مركبة/ساعة ({inputs.main_flow:.0f} على المحور "
        f"و{inputs.cross_flow:.0f} على الشارع العرضي)، يحقق {winner.name_ar} أقل تأخير "
        f"مرجح ({winner.average_delay_sec:.1f} ثانية، مستوى خدمة "
        f"{winner.level_of_service})، وطابور مئوي 95 بطول "
        f"{winner.queue_95th_m:.0f} متر، ونسبة استيعاب {winner.volume_to_capacity:.2f}، "
        f"مع {winner.conflict_points} نقاط تعارض ومؤشر أمان "
        f"{winner.safety_index_pct:.0f}%. {condition_ar}"
    )

    safety_gain = winner.safety_index_pct - alt_open.safety_index_pct
    takeaway_en = (
        f"DECISION SUMMARY: Recommended implementation is {winner.id} "
        f"({winner.name_en}). Estimated safety improvement: "
        f"+{safety_gain:.0f}% over the open baseline; delay "
        f"{winner.average_delay_sec:.1f}s vs {alt_open.average_delay_sec:.1f}s."
    )
    takeaway_ar = (
        f"ملخص القرار: الخيار الموصى به هو {winner.name_ar}. نسبة تحسين الأمان: "
        f"+{safety_gain:.0f}% مقارنة بالتقاطع المفتوح؛ التأخير "
        f"{winner.average_delay_sec:.1f} ثانية مقابل {alt_open.average_delay_sec:.1f} ثانية."
    )

    return IntersectionResponse(
        inputs=inputs,
        alternatives=alternatives,
        recommended_option_id=recommended_id,
        recommendation_rationale_en=rationale_en,
        recommendation_rationale_ar=rationale_ar,
        executive_takeaway_en=takeaway_en,
        executive_takeaway_ar=takeaway_ar,
    )
