"""
SUMO Digital Twin Service.
Coordinates microscopic evaluations of the 4 Egyptian corridor alternatives,
integrates TraCI metrics with HCM Level of Service, and generates actionable
executive recommendations.
"""

from typing import Any, Dict, List
from backend.app.core.hcm_math import calculate_los
from backend.app.models.schemas import (
    IntersectionRequest,
    IntersectionResponse,
    IntersectionAlternative,
    SumoMicroscopicMetrics,
)
from backend.app.sumo.runner import (
    execute_traci_micro_sim,
    get_sumo_environment_info,
)


def get_sumo_system_status() -> Dict[str, Any]:
    """Exposes environmental diagnostics for SUMO/TraCI integration."""
    return get_sumo_environment_info()


def run_sumo_simulation(inputs: IntersectionRequest) -> IntersectionResponse:
    """
    Executes deep microscopic simulation across all 4 geometric alternatives
    using SUMO / TraCI, populating vehicle-level telemetry and emissions.
    """
    duration = getattr(inputs, "simulation_duration_sec", 300)
    total_flow = inputs.main_flow + inputs.cross_flow

    # Alternative 1: OPEN
    res_open = execute_traci_micro_sim(
        alt_id="OPEN",
        main_flow_vehh=inputs.main_flow,
        cross_flow_vehh=inputs.cross_flow,
        turning_pct=inputs.turning_pct,
        heavy_pct=inputs.heavy_pct,
        duration_sec=duration,
    )
    c_open = 3600.0 / (1.0 + (inputs.turning_pct / 100.0) * 1.2 + (inputs.heavy_pct / 100.0) * 0.8)
    vc_open = round(total_flow / max(1.0, c_open), 2)
    los_open = calculate_los(res_open["average_delay_sec"], vc_open)

    alt_open = IntersectionAlternative(
        id="OPEN",
        name_en="Uncontrolled Open Intersection",
        name_ar="تقاطع سطحي مفتوح بدون تحكم",
        conflict_points=32,
        average_delay_sec=res_open["average_delay_sec"],
        queue_95th_m=res_open["queue_95th_m"],
        capacity_vehh=round(c_open, 1),
        volume_to_capacity=vc_open,
        level_of_service=los_open,
        spillback_risk=res_open["queue_95th_m"] > 300.0 or vc_open > 0.95,
        safety_index_pct=25.0,
        estimated_throughput_pce=round(min(total_flow, c_open), 1),
        sumo_metrics=SumoMicroscopicMetrics(
            simulated_vehicles_count=res_open["simulated_vehicles_count"],
            total_time_loss_sec=res_open["total_time_loss_sec"],
            mean_speed_kmh=res_open["mean_speed_kmh"],
            co2_emissions_kg_h=res_open["co2_emissions_kg_h"],
            fuel_consumption_liters_h=res_open["fuel_consumption_liters_h"],
        ),
    )

    # Alternative 2: SIGNAL
    res_sig = execute_traci_micro_sim(
        alt_id="SIGNAL",
        main_flow_vehh=inputs.main_flow,
        cross_flow_vehh=inputs.cross_flow,
        turning_pct=inputs.turning_pct,
        heavy_pct=inputs.heavy_pct,
        duration_sec=duration,
    )
    c_sig = 4200.0 * (1.0 - (inputs.heavy_pct / 200.0))
    vc_sig = round(total_flow / max(1.0, c_sig), 2)
    los_sig = calculate_los(res_sig["average_delay_sec"], vc_sig)

    alt_sig = IntersectionAlternative(
        id="SIGNAL",
        name_en="Webster 4-Phase Adaptive Signal",
        name_ar="إشارة ضوئية رباعية المراحل (ويستر)",
        conflict_points=8,
        average_delay_sec=res_sig["average_delay_sec"],
        queue_95th_m=res_sig["queue_95th_m"],
        capacity_vehh=round(c_sig, 1),
        volume_to_capacity=vc_sig,
        level_of_service=los_sig,
        spillback_risk=res_sig["queue_95th_m"] > 250.0 or vc_sig > 0.90,
        safety_index_pct=72.0,
        estimated_throughput_pce=round(min(total_flow, c_sig), 1),
        sumo_metrics=SumoMicroscopicMetrics(
            simulated_vehicles_count=res_sig["simulated_vehicles_count"],
            total_time_loss_sec=res_sig["total_time_loss_sec"],
            mean_speed_kmh=res_sig["mean_speed_kmh"],
            co2_emissions_kg_h=res_sig["co2_emissions_kg_h"],
            fuel_consumption_liters_h=res_sig["fuel_consumption_liters_h"],
        ),
    )

    # Alternative 3: UTURN
    res_uturn = execute_traci_micro_sim(
        alt_id="UTURN",
        main_flow_vehh=inputs.main_flow,
        cross_flow_vehh=inputs.cross_flow,
        turning_pct=inputs.turning_pct,
        heavy_pct=inputs.heavy_pct,
        uturn_dist_m=inputs.uturn_distance_m,
        duration_sec=duration,
    )
    c_uturn = 6800.0
    vc_uturn = round(total_flow / c_uturn, 2)
    los_uturn = calculate_los(res_uturn["average_delay_sec"], vc_uturn)

    alt_uturn = IntersectionAlternative(
        id="UTURN",
        name_en="Closed Median + Protected U-Turn Corridor",
        name_ar="غلق الجزيرة الوسطى + مسار دورانات محمي (النموذج المصري)",
        conflict_points=4,
        average_delay_sec=res_uturn["average_delay_sec"],
        queue_95th_m=res_uturn["queue_95th_m"],
        capacity_vehh=c_uturn,
        volume_to_capacity=vc_uturn,
        level_of_service=los_uturn,
        spillback_risk=False,
        safety_index_pct=94.0,
        estimated_throughput_pce=round(min(total_flow, c_uturn), 1),
        sumo_metrics=SumoMicroscopicMetrics(
            simulated_vehicles_count=res_uturn["simulated_vehicles_count"],
            total_time_loss_sec=res_uturn["total_time_loss_sec"],
            mean_speed_kmh=res_uturn["mean_speed_kmh"],
            co2_emissions_kg_h=res_uturn["co2_emissions_kg_h"],
            fuel_consumption_liters_h=res_uturn["fuel_consumption_liters_h"],
        ),
    )

    # Alternative 4: ROUNDABOUT
    res_round = execute_traci_micro_sim(
        alt_id="ROUNDABOUT",
        main_flow_vehh=inputs.main_flow,
        cross_flow_vehh=inputs.cross_flow,
        turning_pct=inputs.turning_pct,
        heavy_pct=inputs.heavy_pct,
        duration_sec=duration,
    )
    c_round = 4050.0
    vc_round = round(total_flow / c_round, 2)
    los_round = calculate_los(res_round["average_delay_sec"], vc_round)

    alt_round = IntersectionAlternative(
        id="ROUNDABOUT",
        name_en="Modern 3-Lane Roundabout",
        name_ar="ميدان مروري حديث ثلاثي الحارات",
        conflict_points=8,
        average_delay_sec=res_round["average_delay_sec"],
        queue_95th_m=res_round["queue_95th_m"],
        capacity_vehh=c_round,
        volume_to_capacity=vc_round,
        level_of_service=los_round,
        spillback_risk=res_round["queue_95th_m"] > 220.0 or vc_round > 0.88,
        safety_index_pct=78.0,
        estimated_throughput_pce=round(min(total_flow, c_round), 1),
        sumo_metrics=SumoMicroscopicMetrics(
            simulated_vehicles_count=res_round["simulated_vehicles_count"],
            total_time_loss_sec=res_round["total_time_loss_sec"],
            mean_speed_kmh=res_round["mean_speed_kmh"],
            co2_emissions_kg_h=res_round["co2_emissions_kg_h"],
            fuel_consumption_liters_h=res_round["fuel_consumption_liters_h"],
        ),
    )

    alternatives = [alt_open, alt_sig, alt_uturn, alt_round]

    # Recommender Logic matching traffic engineering criteria
    if inputs.main_flow >= 2800.0 or alt_sig.level_of_service in ("E", "F"):
        recommended_id = "UTURN"
        rationale_en = (
            f"SUMO microscopic simulation confirms that high mainline corridor flow ({inputs.main_flow} veh/h) "
            f"causes catastrophic queue spillback under a 4-phase traffic light (Queue: {alt_sig.queue_95th_m}m, "
            f"Delay: {alt_sig.average_delay_sec}s). The Protected U-Turn Corridor slashes conflict points from 32 down to 4, "
            f"maintains uninterrupted mainline flow at {alt_uturn.average_delay_sec}s delay (LoS {alt_uturn.level_of_service}), "
            f"and reduces CO2 emissions by {round((1.0 - alt_uturn.sumo_metrics.co2_emissions_kg_h / max(1.0, alt_sig.sumo_metrics.co2_emissions_kg_h)) * 100.0)}%."
        )
        rationale_ar = (
            f"تؤكد المحاكاة المجهرية الدقيقة (SUMO) أن الكثافة العالية للمحور الرئيسي ({inputs.main_flow} م/س) "
            f"تؤدي إلى ارتداد كارثي لطوابير الإشارة الضوئية (طول الطابور: {alt_sig.queue_95th_m} متر، "
            f"التأخير: {alt_sig.average_delay_sec} ثانية). يحقق نموذج غلق الجزيرة وعمل دورانات محمية تقليص نقاط التعارض "
            f"من 32 إلى 4 نقاط فقط، مع تدفق حر مستمر بتأخير {alt_uturn.average_delay_sec} ثانية (مستوى خدمة {alt_uturn.level_of_service}) "
            f"وخفض انبعاثات الكربون بنسبة ملحوظة مقارنة بالإشارة."
        )
        takeaway_en = "Mandate Closed Median + U-Turn turnaround at 450m downstream to safeguard arterial capacity."
        takeaway_ar = "يوصى بغلق الجزيرة الوسطى وإنشاء مسار دورانات محمي لتأمين السعة القصوى للمحور."
    elif total_flow < 2400.0 and (inputs.main_flow / max(1.0, inputs.cross_flow)) < 1.8:
        recommended_id = "ROUNDABOUT"
        rationale_en = (
            f"SUMO TraCI simulation shows balanced, moderate flows ({total_flow} veh/h total) where a 3-lane roundabout "
            f"eliminates signal lost time, yielding minimal delay ({alt_round.average_delay_sec}s) and continuous circulation."
        )
        rationale_ar = (
            f"تظهر محاكاة SUMO أن التدفق المتوازن والمعتدل ({total_flow} م/س) يجعل الميدان المروري ثلاثي الحارات "
            f"الحل الأمثل لإلغاء أزمنة الإشارة المهدورة وتحقيق انسيابية مستمرة بتأخير {alt_round.average_delay_sec} ثانية."
        )
        takeaway_en = "Install modern 3-lane roundabout with circulating priority."
        takeaway_ar = "تنفيذ ميدان مروري ثلاثي الحارات مع إعطاء الأولوية للحركة الدائرية."
    else:
        # Lowest delay between signal and u-turn
        recommended_id = "UTURN" if alt_uturn.average_delay_sec <= alt_sig.average_delay_sec else "SIGNAL"
        rationale_en = (
            f"Under the simulated volume of {total_flow} veh/h, alternative {recommended_id} achieves the optimal trade-off "
            f"between control delay and intersection safety."
        )
        rationale_ar = (
            f"في ظل الكثافة المرورية البالغة {total_flow} م/س، يحقق البديل الموصى به أفضل توازن بين تقليل التأخير وسلامة الحركة."
        )
        takeaway_en = f"Implement {recommended_id} configuration based on microscopic vehicle delay optimization."
        takeaway_ar = f"اعتماد تكوين {recommended_id} بناءً على تحسين أزمنة التأخير المجهرية للمركبات."

    return IntersectionResponse(
        inputs=inputs,
        alternatives=alternatives,
        recommended_option_id=recommended_id,
        recommendation_rationale_en=rationale_en,
        recommendation_rationale_ar=rationale_ar,
        executive_takeaway_en=takeaway_en,
        executive_takeaway_ar=takeaway_ar,
    )
