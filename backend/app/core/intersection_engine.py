"""
Module 2: Intersection Signal Warrant & What-If Simulator Engine.
Compares 4 geometric and operational intersection alternatives:
1. Uncontrolled Open Intersection (Baseline, high conflict points)
2. Webster's Adaptive 4-Phase Traffic Signal
3. Closed Median + Protected U-Turn Corridor (Egyptian Axis Model)
4. Modern 3-Lane Roundabout
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


def clamp(val: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, val))


def simulate_intersections(inputs: IntersectionRequest) -> IntersectionResponse:
    """
    Evaluates all 4 intersection geometries simultaneously using deterministic
    traffic flow theory and Webster's delay equations.
    """
    total_flow = inputs.main_flow + inputs.cross_flow
    turn_ratio = inputs.turning_pct / 100.0
    heavy_ratio = inputs.heavy_pct / 100.0

    # -----------------------------------------------------------------------
    # Alternative 1: Uncontrolled Open Intersection
    # -----------------------------------------------------------------------
    c_open = 3600.0 / (1.0 + turn_ratio * 1.2 + heavy_ratio * 0.8)
    vc_open = total_flow / max(1.0, c_open)
    d_open = 9.5 + 28.0 * ((total_flow / max(1.0, c_open)) ** 2.6)
    q95_open = max(15.0, (total_flow / 3600.0) * d_open * 6.5 * 0.45)
    los_open = calculate_los(d_open, vc_open)

    alt_open = IntersectionAlternative(
        id="OPEN",
        name_en="Uncontrolled Open Intersection",
        name_ar="تقاطع سطحي مفتوح بدون تحكم",
        conflict_points=32,
        average_delay_sec=round(d_open, 1),
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
    s_main = 1900.0 * 3.0 * (1.0 - heavy_ratio / 2.0)
    s_cross = 1800.0 * 2.0 * (1.0 - heavy_ratio / 2.0)

    y_critical = min(
        0.94,
        (inputs.main_flow * 0.55 / s_main)
        + (inputs.cross_flow * 0.65 / s_cross)
        + (inputs.turning_pct / 250.0),
    )
    lost_time_l = 16.0  # seconds lost per cycle
    c_opt = clamp((1.5 * lost_time_l + 5.0) / (1.0 - y_critical), 45.0, 160.0)

    # Effective green ratio for main movement
    g_c = max(
        0.25,
        (1.0 - lost_time_l / c_opt) * (inputs.main_flow / max(1.0, total_flow)),
    )
    capacity_sig = s_main * g_c + s_cross * max(0.15, (1.0 - g_c - lost_time_l / c_opt))
    x_sig = total_flow / max(1.0, capacity_sig)

    # Webster uniform delay + overflow delay
    d_sig_uniform = (0.5 * c_opt * ((1.0 - g_c) ** 2)) / (1.0 - min(0.98, x_sig) * g_c)
    d_sig_overflow = 45.0 * max(0.0, x_sig - 0.85) * 120.0
    d_sig = d_sig_uniform + d_sig_overflow

    # 95th Percentile Queue
    q95_sig = (
        (inputs.main_flow / 3600.0)
        * (c_opt * (1.0 - g_c))
        * (6.5 / 3.0)
        * (1.0 + max(0.0, x_sig - 0.75) * 2.2)
    )
    los_sig = calculate_los(d_sig, x_sig)

    alt_signal = IntersectionAlternative(
        id="SIGNAL",
        name_en="Adaptive 4-Phase Traffic Signal",
        name_ar="إشارة ضوئية ذكية رباعية الأطوار",
        conflict_points=8,
        average_delay_sec=round(d_sig, 1),
        queue_95th_m=round(q95_sig, 1),
        capacity_vehh=round(capacity_sig, 1),
        volume_to_capacity=round(x_sig, 2),
        level_of_service=los_sig,
        spillback_risk=q95_sig > 350.0 or x_sig > 0.95,
        safety_index_pct=75.0,
        estimated_throughput_pce=round(min(total_flow, capacity_sig), 1),
    )

    # -----------------------------------------------------------------------
    # Alternative 3: Closed Median + Protected U-Turn Corridor
    # -----------------------------------------------------------------------
    # Diverted cross and left traffic
    p_div = (inputs.cross_flow + inputs.main_flow * turn_ratio) / max(1.0, total_flow)
    # Cruise speed along detour is 50 km/h (13.89 m/s)
    v_cruise_ms = 50.0 / 3.6
    t_detour = (2.0 * inputs.uturn_distance_m) / v_cruise_ms
    d_weave = 6.0 + 14.0 * ((total_flow / 6800.0) ** 2.1)
    d_uturn = (p_div * t_detour * 0.55) + d_weave

    c_uturn = 7200.0  # High continuous mainline capacity (merging only)
    vc_uturn = total_flow / c_uturn
    q95_uturn = max(12.0, d_uturn * 1.4)
    los_uturn = calculate_los(d_uturn, vc_uturn)

    alt_uturn = IntersectionAlternative(
        id="UTURN",
        name_en="Closed Median + Protected U-Turn Corridor",
        name_ar="إلغاء التقاطع + محور دوران للخلف (نموذج المحاور المصرية)",
        conflict_points=4,
        average_delay_sec=round(d_uturn, 1),
        queue_95th_m=round(q95_uturn, 1),
        capacity_vehh=round(c_uturn, 1),
        volume_to_capacity=round(vc_uturn, 2),
        level_of_service=los_uturn,
        spillback_risk=False,
        safety_index_pct=92.0,  # Eliminates all right-angle perpendicular collisions
        estimated_throughput_pce=round(min(total_flow, c_uturn), 1),
    )

    # -----------------------------------------------------------------------
    # Alternative 4: Modern 3-Lane Roundabout
    # -----------------------------------------------------------------------
    q_circ = 0.42 * inputs.main_flow + 0.65 * inputs.cross_flow * (1.0 + turn_ratio)
    c_round = 3.0 * 1350.0 * math.exp(-0.00075 * q_circ)
    vc_round = total_flow / max(1.0, c_round)

    d_round = (
        11.0
        + (3600.0 / max(1.0, c_round))
        + 65.0 * ((max(0.0, vc_round - 0.75)) ** 2.2) * 100.0
    )
    q95_round = max(
        18.0,
        vc_round * 65.0 * (1.0 + max(0.0, vc_round - 0.85) * 4.5),
    )
    los_round = calculate_los(d_round, vc_round)

    alt_round = IntersectionAlternative(
        id="ROUNDABOUT",
        name_en="Modern 3-Lane High-Capacity Roundabout",
        name_ar="ميدان دائري حديث ثلاثي الحارات",
        conflict_points=8,
        average_delay_sec=round(d_round, 1),
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
    # Winning Recommendation Logic
    # -----------------------------------------------------------------------
    # On high arterial volumes (>3000 main flow), Closed Median U-turn dominates because
    # it completely eliminates mainline red light queues and right-angle collision points.
    if inputs.main_flow >= 2800.0:
        recommended_id = "UTURN"
        rationale_en = (
            f"At high mainline arterial demand ({inputs.main_flow:.0f} veh/h), installing a traffic light "
            f"creates severe shockwave queues ({q95_sig:.0f}m) and high delay ({d_sig:.1f}s, LoS {los_sig}). "
            f"The Protected U-Turn Corridor model completely eliminates mainline red-phase stopping, reduces "
            f"conflict points from 32 down to 4 (merging only), and delivers continuous flow with average delay "
            f"of just {d_uturn:.1f}s (LoS {los_uturn})."
        )
        rationale_ar = (
            f"نظراً للكثافة العالية على المحور الرئيسي ({inputs.main_flow:.0f} مركبة/س)، فإن تركيب إشارة ضوئية "
            f"يسبب طوابير تكدس حادة تصل إلى {q95_sig:.0f} متر وتأخير قدره {d_sig:.1f} ثانية (مستوى خدمة {los_sig}). "
            f"يعد نموذج إلغاء التقاطع وتطبيق دوران محمي للخلف (U-Turn) هو الحل الهندسي الأمثل، حيث يقضي تماماً على "
            f"توقف الحركة الرئيسية، ويخفض نقاط التعارض من 32 إلى 4 نقاط فقط، مع زمن تأخير {d_uturn:.1f} ثانية (مستوى خدمة {los_uturn})."
        )
    elif total_flow < 2200.0 and inputs.cross_flow > 600.0:
        recommended_id = "ROUNDABOUT"
        rationale_en = (
            f"Under moderate, balanced traffic conditions ({total_flow:.0f} total veh/h), the Modern 3-Lane "
            f"Roundabout provides self-regulating continuous circulation with low delay ({d_round:.1f}s) "
            f"and avoids signal operating/maintenance electricity costs."
        )
        rationale_ar = (
            f"في ظل الكثافات المتوسطة والمتوازنة ({total_flow:.0f} مركبة/س)، يحقق الميدان الدائري الثلاثي تدفقاً ذاتياً "
            f"مستمراً بتأخير منخفض ({d_round:.1f} ثانية) مع توفير تكاليف تشغيل وصيانة الإشارات الضوئية."
        )
    else:
        # Check lowest delay between Signal and U-Turn
        if d_uturn <= d_sig:
            recommended_id = "UTURN"
            rationale_en = (
                f"The Protected U-Turn Corridor minimizes average vehicular delay ({d_uturn:.1f}s vs {d_sig:.1f}s for signal) "
                f"while maintaining high corridor progression speed and cutting conflict points to 4."
            )
            rationale_ar = (
                f"يحقق نموذج الدوران للخلف أقل زمن تأخير للمركبات ({d_uturn:.1f} ثانية مقابل {d_sig:.1f} ثانية للإشارة) "
                f"مع الحفاظ على سرعة المحور وخفض نقاط الحوادث إلى 4 نقاط."
            )
        else:
            recommended_id = "SIGNAL"
            rationale_en = (
                f"The Adaptive 4-Phase Traffic Signal provides optimal balance ({d_sig:.1f}s delay, LoS {los_sig}) "
                f"by allocating dynamic green splits to cross-street demands with optimal cycle length of {c_opt:.0f}s."
            )
            rationale_ar = (
                f"تحقق الإشارة الضوئية الذكية أفضل توازن ({d_sig:.1f} ثانية تأخير، مستوى خدمة {los_sig}) عبر تخصيص فترات "
                f"خضراء متكيفة مع دورة زمنية مثالية قدرها {c_opt:.0f} ثانية."
            )

    takeaway_en = (
        f"DECISION SUMMARY: Recommended implementation is {recommended_id}. "
        f"Estimated safety improvement: +{next(a.safety_index_pct for a in alternatives if a.id == recommended_id) - 25.0:.0f}% over baseline."
    )
    takeaway_ar = (
        f"ملخص القرار: الخيار الموصى به هو {next(a.name_ar for a in alternatives if a.id == recommended_id)}. "
        f"نسبة تحسين الأمان والسلامة: +{next(a.safety_index_pct for a in alternatives if a.id == recommended_id) - 25.0:.0f}% مقارنة بالتقاطع المفتوح."
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
