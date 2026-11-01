"""
Weather, Fog "Shaboura" & Convoy Advisor Engine (Module 5).
Implements AASHTO Green Book Stopping Sight Distance (SSD) for Cars & Heavy Trucks,
tire-pavement friction models, pileup risk indices, and 3-Tier protocol escalation.
"""

from typing import List
from backend.app.models.schemas import WeatherRequest, WeatherResponse

FRICTION_FACTORS = {
    "dry": 0.70,
    "wet": 0.38,
    "first_rain_slick": 0.22,
    "sandstorm": 0.45,
    "fog_slick": 0.22,
}


def calculate_car_ssd(speed_kmh: float, mu: float, gradient_pct: float = 0.0) -> float:
    """Car Stopping Sight Distance (m): AASHTO 2.5s perception-reaction time."""
    if speed_kmh <= 0:
        return 0.0
    denom = 254.0 * max(0.05, mu + gradient_pct / 100.0)
    return 0.278 * speed_kmh * 2.5 + (speed_kmh ** 2) / denom


def calculate_truck_ssd(speed_kmh: float, mu: float, gradient_pct: float = 0.0) -> float:
    """Heavy Truck SSD (m): 2.8s perception-reaction, 0.72 reduced braking efficiency."""
    if speed_kmh <= 0:
        return 0.0
    denom = 254.0 * max(0.05, (mu * 0.72) + gradient_pct / 100.0)
    return 0.278 * speed_kmh * 2.8 + (speed_kmh ** 2) / denom


def find_safe_speed_for_truck(visibility_m: float, mu: float, gradient_pct: float = 0.0) -> float:
    """
    Finds the maximum safe harmonized speed limit in [30..100] (step 5)
    where ssd_truck(V) <= 0.85 * visibility_m.
    """
    safe_v = 30.0
    for v in range(30, 105, 5):
        if calculate_truck_ssd(float(v), mu, gradient_pct) <= 0.85 * visibility_m:
            safe_v = float(v)
        else:
            break
    return safe_v


def evaluate_weather_protocol(req: WeatherRequest) -> WeatherResponse:
    cond_key = req.road_condition.lower()
    mu = FRICTION_FACTORS.get(cond_key, 0.38)

    ssd_car = calculate_car_ssd(req.current_speed_limit_kmh, mu, req.gradient_pct)
    ssd_truck = calculate_truck_ssd(req.current_speed_limit_kmh, mu, req.gradient_pct)

    # Safe speed limit harmonized for heavy vehicles
    safe_speed = find_safe_speed_for_truck(req.visibility_m, mu, req.gradient_pct)
    safe_speed = min(req.current_speed_limit_kmh, safe_speed)
    safe_ssd = calculate_truck_ssd(safe_speed, mu, req.gradient_pct)

    deficit = max(0.0, ssd_truck - req.visibility_m)

    # Pileup Risk Index (0 - 100%)
    if ssd_truck > req.visibility_m:
        pileup_risk = max(5.0, min(100.0, ((ssd_truck - req.visibility_m) / max(1.0, ssd_truck)) * 100.0))
    else:
        pileup_risk = 8.0

    # 3-Tier Automated Protocol Escalation
    if req.visibility_m < 40.0:
        protocol_tier = "TIER 3: MANDATORY CORRIDOR GATE CLOSURE"
        pacing_required = True
        risk_level = "CRITICAL"
        convoy_speed = 25.0
        lead_vehicles = 4
        vms_en = "CRITICAL FOG (<40M): CORRIDOR CLOSED - STAGE AT UPSTREAM REST PLAZAS"
        vms_ar = "شبورة منعدمة (<40م): إغلاق كامل للمحور - الانتظار الإجباري بساحات الاستراحة"
    elif ssd_truck > req.visibility_m:
        protocol_tier = "TIER 2: PATROL-LED CONVOY PACING (تفويج مروري)"
        pacing_required = True
        risk_level = "HIGH" if deficit > 35.0 else "MODERATE"
        convoy_speed = min(40.0, max(30.0, safe_speed))
        lead_vehicles = 2 if req.traffic_flow_pce > 3000 else 1
        vms_en = f"SEVERE FOG: SPEED {int(safe_speed)} KM/H - PATROL CONVOY PACING ACTIVE - ZERO OVERTAKING"
        vms_ar = f"شبورة كثيفة: السرعة القصوى {int(safe_speed)} كم/س - تفويج مروري بركب سيارات الشرطة - يمنع التجاوز"
    else:
        protocol_tier = "TIER 1: VMS VARIABLE SPEED LIMIT & FOG BEACONS"
        pacing_required = False
        risk_level = "LOW"
        convoy_speed = safe_speed
        lead_vehicles = 0
        vms_en = f"FOG ADVISORY: SPEED {int(safe_speed)} KM/H - MAINTAIN SAFE HEADWAY"
        vms_ar = f"تحذير ضباب: السرعة {int(safe_speed)} كم/س - اترك مسافة أمان مضاعفة"

    police_sop_en = [
        f"Activate {protocol_tier} across all corridor interchanges.",
        f"Deploy {max(1, lead_vehicles)} Highway Patrol cruiser(s) with amber/blue strobes leading platoons at {int(convoy_speed)} km/h.",
        f"Enforce safe advisory speed limit of {int(safe_speed)} km/h via overhead Variable Message Signs.",
        "Restrict commercial trucks (>5 tons) strictly to Lane 1 (right curb) with mandatory fog flashers on.",
        "Illuminate cat-eye road studs and solar fog warning flashers along highway shoulders."
    ]

    police_sop_ar = [
        f"تفعيل {protocol_tier} على جميع منافذ ومطالع المحور فوراً.",
        f"انطلاق عدد {max(1, lead_vehicles)} دورية مرور بفلاشرات ضوئية لقيادة قوافل المركبات بسرعة {int(convoy_speed)} كم/س.",
        f"إلزام السائقين بالسرعة الاسترشادية الآمنة {int(safe_speed)} كم/س عبر الشاشات الإلكترونية VMS.",
        "حظر سير سيارات النقل الثقيل خارج الحارة 1 (أقصى اليمين) مع تشغيل أنوار الانتظار الرباعية إجبارياً.",
        "تشغيل العيون الضوئية الأرضية وعواكس الضباب على جانبي الطريق لتحديد مسار الحارات."
    ]

    return WeatherResponse(
        visibility_m=req.visibility_m,
        road_condition=req.road_condition,
        friction_coefficient=mu,
        current_stopping_sight_distance_m=round(ssd_truck, 1),
        ssd_car_m=round(ssd_car, 1),
        ssd_truck_m=round(ssd_truck, 1),
        safe_advisory_speed_kmh=safe_speed,
        safe_stopping_sight_distance_m=round(safe_ssd, 1),
        stopping_distance_deficit_m=round(deficit, 1),
        pileup_risk_pct=round(pileup_risk, 1),
        protocol_tier=protocol_tier,
        pacing_convoy_required=pacing_required,
        convoy_speed_kmh=convoy_speed,
        convoy_lead_vehicles_count=lead_vehicles,
        vms_warning_text_en=vms_en,
        vms_warning_text_ar=vms_ar,
        police_sop_actions_en=police_sop_en,
        police_sop_actions_ar=police_sop_ar,
        risk_level=risk_level,
    )
