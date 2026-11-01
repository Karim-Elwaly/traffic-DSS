"""
Smart On-Ramp Metering & Merge Controller Engine (Module 6).
Implements ALINEA feedback control law, merge turbulence capacity drop modeling,
and physical channelized acceleration barrier optimization.

All three modes are evaluated with the same deterministic queueing physics so
the comparison is like-for-like: the merge capacity determines how much ramp
demand can actually enter the mainline, any unserved demand accumulates in the
ramp storage, and delay follows Little's law from the accumulated queue. The
previous implementation compared a ramp queue (vehicles) with a hardcoded
throughput gain and used a 0.4 delay factor that had no physical meaning.
"""

from typing import List

from backend.app.models.schemas import (
    RampMeteringRequest,
    RampMeteringResponse,
    RampModeComparison,
)

# ---------------------------------------------------------------------------
# Physical constants
# ---------------------------------------------------------------------------
MAINLINE_LANES = 4
LANE_CAPACITY_PCE = 2000.0                     # ideal saturation per lane
BASE_MAINLINE_CAPACITY = MAINLINE_LANES * LANE_CAPACITY_PCE  # 8,000 PCE/h
ANALYSIS_PERIOD_H = 0.25                       # 15-minute HCM analysis period
RAMP_STORAGE_M = 300.0                         # usable ramp storage length
JAM_SPACING_M = 6.5                            # stopped bumper-to-bumper spacing
RAMP_MAX_QUEUE_VEH = RAMP_STORAGE_M / JAM_SPACING_M

# ALINEA targets 88% of the critical mainline occupancy, which is close to the
# capacity-maximising point on the fundamental diagram.
ALINEA_TARGET_VC = 0.88
MIN_METERING_RATE = 300.0
MAX_METERING_RATE = 1800.0


def _speed_from_vc(free_flow_kmh: float, vc: float) -> float:
    """
    Average speed from the BPR travel-time relation.

    BPR gives t = t0 * (1 + 0.15 * (q/C)^4). The equivalent average speed over
    the same segment is v = vf / (1 + 0.15 * (q/C)^4). The result is bounded on
    the low side so an oversaturated link cannot report a negative or absurdly
    small speed.
    """
    penalty = 1.0 + 0.15 * max(0.0, vc) ** 4
    return max(20.0, free_flow_kmh / penalty)


def _mode_queue_veh(ramp_demand_pce: float, served_pce: float) -> float:
    """
    Vehicles left in the ramp storage after one 15-minute analysis period.

    ``ramp_demand_pce`` and ``served_pce`` are hourly rates, so the excess rate
    multiplied by the analysis period is the number of vehicles still waiting.
    The value is capped by the physical ramp storage.
    """
    excess_rate = max(0.0, ramp_demand_pce - served_pce)
    return min(RAMP_MAX_QUEUE_VEH, excess_rate * ANALYSIS_PERIOD_H)


def _ramp_delay_sec(queue_veh: float, ramp_demand_pce: float) -> float:
    """Average ramp delay from Little's law: W = L / lambda."""
    if queue_veh <= 0.0 or ramp_demand_pce <= 0.0:
        return 0.0
    return (queue_veh / ramp_demand_pce) * 3600.0


def _capacity_gain_pct(mode_capacity: float, uncontrolled_capacity: float) -> float:
    if uncontrolled_capacity <= 0.0:
        return 0.0
    return max(
        0.0,
        (mode_capacity - uncontrolled_capacity) / uncontrolled_capacity * 100.0,
    )


def evaluate_ramp_metering(req: RampMeteringRequest) -> RampMeteringResponse:
    # ------------------------------------------------------------------
    # Merge turbulence model
    # ------------------------------------------------------------------
    # An uncontrolled free merge loses capacity to weaving and forced lane
    # changes. The drop grows with the ramp's share of the combined flow and
    # with the heavy-vehicle share, both of which lengthen the merge manoeuvre.
    total_demand = req.mainline_flow_pce + req.ramp_demand_pce
    ramp_share = req.ramp_demand_pce / max(1.0, total_demand)
    heavy_ratio = req.heavy_pct / 100.0
    uncontrolled_drop = min(
        0.28,
        0.10 + 0.35 * ramp_share + 0.15 * heavy_ratio,
    )
    uncontrolled_cap = BASE_MAINLINE_CAPACITY * (1.0 - uncontrolled_drop)
    uncontrolled_vc = total_demand / max(1.0, uncontrolled_cap)
    uncontrolled_speed = _speed_from_vc(80.0, uncontrolled_vc)
    uncontrolled_served = min(
        req.ramp_demand_pce,
        max(0.0, uncontrolled_cap - req.mainline_flow_pce),
    )
    uncontrolled_queue = _mode_queue_veh(
        req.ramp_demand_pce, uncontrolled_served
    )
    uncontrolled_delay = _ramp_delay_sec(
        uncontrolled_queue, req.ramp_demand_pce
    )

    uncontrolled_mode = RampModeComparison(
        mode_id="UNCONTROLLED",
        mode_name_en="Uncontrolled Free Merge",
        mode_name_ar="اندماج حر بدون تحكم",
        effective_capacity_pce=round(uncontrolled_cap, 0),
        capacity_loss_pct=round(uncontrolled_drop * 100.0, 1),
        mainline_speed_kmh=round(uncontrolled_speed, 1),
        ramp_queue_veh=round(uncontrolled_queue, 0),
        ramp_delay_sec=round(uncontrolled_delay, 1),
        throughput_gain_pct=0.0,
        level_of_service=(
            "F" if uncontrolled_vc >= 1.0
            else "E" if uncontrolled_vc > 0.85
            else "D"
        ),
    )

    # ------------------------------------------------------------------
    # ALINEA metered merge
    # ------------------------------------------------------------------
    # ALINEA releases the ramp at the rate that holds the mainline just below
    # its critical occupancy. It cannot release more than the ramp receives.
    alinea_headroom = ALINEA_TARGET_VC * BASE_MAINLINE_CAPACITY - req.mainline_flow_pce
    r_meter = max(
        MIN_METERING_RATE,
        min(
            MAX_METERING_RATE,
            req.ramp_demand_pce,
            alinea_headroom if alinea_headroom > 0 else MIN_METERING_RATE,
        ),
    )
    cycle_sec = round(3600.0 / r_meter, 1)

    # Metering removes most merge turbulence but a small residual loss remains
    # because platoons still interact with the mainline at the nose.
    metered_drop = min(
        0.15,
        0.02 + 0.10 * heavy_ratio + 0.05 * ramp_share,
    )
    metered_cap = BASE_MAINLINE_CAPACITY * (1.0 - metered_drop)
    metered_flow = req.mainline_flow_pce + r_meter
    metered_vc = metered_flow / max(1.0, metered_cap)
    metered_speed = _speed_from_vc(80.0, metered_vc)
    metered_queue = _mode_queue_veh(req.ramp_demand_pce, r_meter)
    metered_delay = _ramp_delay_sec(metered_queue, req.ramp_demand_pce)

    metered_mode = RampModeComparison(
        mode_id="ALINEA_METERED",
        mode_name_en="ALINEA Intelligent Ramp Metering",
        mode_name_ar="التحكم الذكي في إشارة المطلع (ALINEA)",
        effective_capacity_pce=round(metered_cap, 0),
        capacity_loss_pct=round(metered_drop * 100.0, 1),
        mainline_speed_kmh=round(metered_speed, 1),
        ramp_queue_veh=round(metered_queue, 0),
        ramp_delay_sec=round(metered_delay, 1),
        throughput_gain_pct=round(
            _capacity_gain_pct(metered_cap, uncontrolled_cap), 1
        ),
        level_of_service=(
            "B" if metered_vc < 0.70
            else "C" if metered_vc < 0.85
            else "D"
        ),
    )

    # ------------------------------------------------------------------
    # Channelized barrier merge
    # ------------------------------------------------------------------
    # A 180 m barrier physically separates the acceleration lane from Lane 2.
    # It removes the forced lane-change component but does not meter demand,
    # so it recovers less of the lost capacity than ALINEA.
    barrier_drop = min(
        0.20,
        0.04 + 0.10 * heavy_ratio + 0.08 * ramp_share,
    )
    barrier_cap = BASE_MAINLINE_CAPACITY * (1.0 - barrier_drop)
    barrier_vc = total_demand / max(1.0, barrier_cap)
    barrier_speed = _speed_from_vc(80.0, barrier_vc)
    barrier_served = min(
        req.ramp_demand_pce,
        max(0.0, barrier_cap - req.mainline_flow_pce),
    )
    barrier_queue = _mode_queue_veh(req.ramp_demand_pce, barrier_served)
    barrier_delay = _ramp_delay_sec(barrier_queue, req.ramp_demand_pce)

    barrier_mode = RampModeComparison(
        mode_id="CHANNELIZED_BARRIER",
        mode_name_en="180m Channelized Barrier Curb",
        mode_name_ar="حاجز توجيه خرساني بطول 180م",
        effective_capacity_pce=round(barrier_cap, 0),
        capacity_loss_pct=round(barrier_drop * 100.0, 1),
        mainline_speed_kmh=round(barrier_speed, 1),
        ramp_queue_veh=round(barrier_queue, 0),
        ramp_delay_sec=round(barrier_delay, 1),
        throughput_gain_pct=round(
            _capacity_gain_pct(barrier_cap, uncontrolled_cap), 1
        ),
        level_of_service="C" if barrier_vc < 0.85 else "D",
    )

    # ------------------------------------------------------------------
    # Recommendation: minimise total vehicle-hours (mainline + ramp)
    # ------------------------------------------------------------------
    # Mainline delay per vehicle is the BPR excess over free-flow on a 1 km
    # merge segment at 80 km/h (45 s free-flow travel time).
    free_flow_segment_sec = 45.0

    def total_vehicle_hours(
        vc: float, mainline_flow: float, ramp_queue: float, ramp_delay: float
    ) -> float:
        mainline_delay_sec = free_flow_segment_sec * 0.15 * max(0.0, vc) ** 4
        return (
            mainline_flow * mainline_delay_sec
            + ramp_queue * ramp_delay
        ) / 3600.0

    mode_costs = {
        "UNCONTROLLED": total_vehicle_hours(
            uncontrolled_vc,
            req.mainline_flow_pce,
            uncontrolled_queue,
            uncontrolled_delay,
        ),
        "ALINEA_METERED": total_vehicle_hours(
            metered_vc,
            req.mainline_flow_pce,
            metered_queue,
            metered_delay,
        ),
        "CHANNELIZED_BARRIER": total_vehicle_hours(
            barrier_vc,
            req.mainline_flow_pce,
            barrier_queue,
            barrier_delay,
        ),
    }
    recommended = min(mode_costs, key=mode_costs.get)

    sop_en = [
        f"Program ALINEA controller cycle to {cycle_sec}s (release rate: {int(r_meter)} PCE/h) during peak mainline demand.",
        "Install 180-meter Type-F New Jersey concrete barrier between on-ramp acceleration lane and mainline Lane 2.",
        f"Equip ramp approach with dual amber warning flashers active when queue storage exceeds {int(RAMP_STORAGE_M * 0.7)} meters.",
        "Synchronize ramp signal green window with mainline gap-detection radar to eliminate stop-and-go merge shockwaves.",
        "Divert heavy freight trucks (>12 tons) to alternative downstream collector-distributor interchange during peak hours.",
    ]

    sop_ar = [
        f"ضبط زمن دورة إشارة المطلع ALINEA عند {cycle_sec} ثانية (معدل إطلاق: {int(r_meter)} م.ر/س) خلال ذروة المحور.",
        "تركيب حاجز خرساني نيوجيرسي بطول 180 متراً يفصل حارة التسارع عن الحارة 2 لمنع الاندماج العشوائي المفاجئ.",
        f"تفعيل فلاشرات التحذير الصفراء المسبقة على مطلع الكوبري عند وصول طابور الانتظار إلى {int(RAMP_STORAGE_M * 0.7)} متراً.",
        "ربط إشارة المطلع برادار رصد الفجوات المرورية على المحور الرئيسي لضمان الاندماج الانسيابي دون فرملة حادة.",
        "توجيه الشاحنات الثقيلة (أكبر من 12 طن) للمنزلق التجميعي البديل لتخفيف اضطراب الاندماج في أوقات الذروة.",
    ]

    summary_en = (
        f"{recommended.replace('_', ' ').title()} minimises total vehicle-hours "
        f"({mode_costs[recommended]:.0f} veh-h/h) by holding mainline speed near "
        f"{metered_speed} km/h with a {cycle_sec}s release cycle and a "
        f"{round(_capacity_gain_pct(metered_cap, uncontrolled_cap), 1)}% capacity recovery."
    )
    summary_ar = (
        f"يُحقق {recommended.replace('_', ' ')} أقل إجمالي ساعات مركبات "
        f"({mode_costs[recommended]:.0f} مركبة-ساعة/ساعة) عبر الحفاظ على سرعة المحور "
        f"قرب {metered_speed} كم/س بدورة إطلاق {cycle_sec} ثانية واستعادة "
        f"{round(_capacity_gain_pct(metered_cap, uncontrolled_cap), 1)}% من السعة المفقودة."
    )

    return RampMeteringResponse(
        corridor_id=req.corridor_id,
        mainline_flow_pce=req.mainline_flow_pce,
        ramp_demand_pce=req.ramp_demand_pce,
        heavy_pct=req.heavy_pct,
        recommended_mode=recommended,
        metering_rate_pce_h=round(r_meter, 0),
        signal_cycle_sec=cycle_sec,
        barrier_length_m=180.0,
        modes=[uncontrolled_mode, metered_mode, barrier_mode],
        sop_directives_en=sop_en,
        sop_directives_ar=sop_ar,
        executive_summary_en=summary_en,
        executive_summary_ar=summary_ar,
    )
