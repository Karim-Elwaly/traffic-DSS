"""
Bridge Expansion-Joint & Surface Defect ROI Prioritizer Engine (Module 9).
Models spot-crawl capacity drop, 24-hour wasted Person-Hours of Delay (PHD),
and ranks corridor road defects by return-on-investment (PHD saved per repair hour).
"""

from typing import List
from backend.app.core.demand_profile import BASE_HOURLY_PCE
from backend.app.models.schemas import (
    DefectRoiRequest,
    DefectRoiResponse,
    DefectHourlyDelay,
    DefectItem,
)

# Use the same authoritative diurnal profile as the telemetry seeder. The old
# local list contradicted the seeded data at 10:00 and 22:00-23:00.
HOURLY_DEMAND_PROFILE = [float(value) for value in BASE_HOURLY_PCE]

CORRIDOR_DEFECT_REGISTRY = {
    "corridor_26july": [
        {
            "id": "DEF-26J-01",
            "name_en": "Km 14.2 Damaged Bridge Expansion Joint",
            "name_ar": "فاصل تمدد كوبري متضرر كم 14.2",
            "km": "Km 14.2 Westbound",
            "type": "DAMAGED_EXPANSION_JOINT",
            "lanes": 2,
            "crawl_speed": 12.0,
            "repair_hours": 4.0,
            "window": "01:00 - 05:00 (Thu Night)",
        },
        {
            "id": "DEF-26J-02",
            "name_en": "Km 22.8 Deep Pothole Cluster (Lane 1)",
            "name_ar": "تجمع حفر غائرة بالحارة 1 كم 22.8",
            "km": "Km 22.8 Eastbound",
            "type": "DEEP_POTHOLE_CLUSTER",
            "lanes": 1,
            "crawl_speed": 25.0,
            "repair_hours": 2.5,
            "window": "02:00 - 04:30 (Daily)",
        },
        {
            "id": "DEF-26J-03",
            "name_en": "Km 8.5 Severe Asphalt Subsidence & Rutting",
            "name_ar": "هبوط أسفلتي وتخدد حاد كم 8.5",
            "km": "Km 8.5 Dual Lanes",
            "type": "ASPHALT_SUBSIDENCE",
            "lanes": 2,
            "crawl_speed": 18.0,
            "repair_hours": 6.0,
            "window": "00:30 - 06:30 (Fri Night)",
        },
        {
            "id": "DEF-26J-04",
            "name_en": "Km 18.1 Longitudinal Crack & Rebar Exposure",
            "name_ar": "شروخ طولية وظهور حديد التسليح كم 18.1",
            "km": "Km 18.1 Overpass",
            "type": "DAMAGED_EXPANSION_JOINT",
            "lanes": 1,
            "crawl_speed": 20.0,
            "repair_hours": 3.0,
            "window": "01:30 - 04:30 (Sun Night)",
        },
        {
            "id": "DEF-26J-05",
            "name_en": "Km 3.2 Bridge Approach Transition Bump",
            "name_ar": "هبوط في مطالع الكوبري كم 3.2",
            "km": "Km 3.2 Approach",
            "type": "ASPHALT_SUBSIDENCE",
            "lanes": 3,
            "crawl_speed": 22.0,
            "repair_hours": 5.0,
            "window": "01:00 - 06:00 (Fri Night)",
        },
    ]
}


def calculate_defect_capacity(base_cap: float, affected_lanes: int, crawl_speed: float, speed_limit: float) -> float:
    """
    Spot-Crawl Capacity Reduction:
    C_defect = C_base * [1 - (n_aff / 4) * (1 - 0.78 * (S_crawl / S_limit))]
    """
    speed_ratio = min(1.0, max(0.05, crawl_speed / max(20.0, speed_limit)))
    lane_factor = min(1.0, max(0.25, affected_lanes / 4.0))
    reduction_term = lane_factor * (1.0 - 0.78 * speed_ratio)
    return max(1500.0, base_cap * (1.0 - reduction_term))


def evaluate_defect_prioritization(req: DefectRoiRequest) -> DefectRoiResponse:
    base_corridor_capacity = 8000.0
    active_defect_capacity = calculate_defect_capacity(
        base_corridor_capacity,
        req.affected_lanes,
        req.crawl_speed_kmh,
        req.speed_limit_kmh,
    )

    cap_reduction_pct = ((base_corridor_capacity - active_defect_capacity) / base_corridor_capacity) * 100.0

    # 24-Hour integration of queuing delay
    hourly_curve: List[DefectHourlyDelay] = []
    total_daily_phd = 0.0
    accumulated_queue = 0.0

    for h, demand in enumerate(HOURLY_DEMAND_PROFILE):
        if demand > active_defect_capacity:
            excess = demand - active_defect_capacity
            accumulated_queue = min(1800.0, accumulated_queue + excess)
            delay_h = (accumulated_queue / active_defect_capacity) * demand
        else:
            accumulated_queue = max(0.0, accumulated_queue - (active_defect_capacity - demand))
            delay_h = (accumulated_queue / active_defect_capacity) * demand if accumulated_queue > 0 else 0.0

        # Egyptian commuter vehicle occupancy ~ 1.85 passengers/PCE
        hour_phd = delay_h * 1.85
        total_daily_phd += hour_phd

        hourly_curve.append(DefectHourlyDelay(
            hour=h,
            demand_pce=demand,
            defect_capacity_pce=round(active_defect_capacity, 0),
            delay_hours=round(delay_h, 1),
            wasted_phd=round(hour_phd, 0),
        ))

    # Priority ROI: Person-Hours of Delay saved per hour of maintenance
    roi_score = total_daily_phd / max(1.0, req.repair_hours)

    # Build 5-defect ranked inventory for selected corridor
    raw_inventory = CORRIDOR_DEFECT_REGISTRY.get(req.corridor_id, CORRIDOR_DEFECT_REGISTRY["corridor_26july"])
    ranked_inventory: List[DefectItem] = []

    for d in raw_inventory:
        d_cap = calculate_defect_capacity(base_corridor_capacity, d["lanes"], d["crawl_speed"], req.speed_limit_kmh)
        d_drop = ((base_corridor_capacity - d_cap) / base_corridor_capacity) * 100.0
        
        # Approximate daily PHD for each defect
        d_phd = 0.0
        q = 0.0
        for dem in HOURLY_DEMAND_PROFILE:
            if dem > d_cap:
                q = min(1800.0, q + (dem - d_cap))
                d_phd += (q / d_cap) * dem * 1.85
            else:
                q = max(0.0, q - (d_cap - dem))
                if q > 0:
                    d_phd += (q / d_cap) * dem * 1.85

        d_roi = d_phd / max(1.0, d["repair_hours"])
        ranked_inventory.append(DefectItem(
            defect_id=d["id"],
            defect_name_en=d["name_en"],
            defect_name_ar=d["name_ar"],
            km_marker=d["km"],
            defect_type=d["type"],
            affected_lanes=d["lanes"],
            crawl_speed_kmh=d["crawl_speed"],
            capacity_drop_pct=round(d_drop, 1),
            daily_wasted_phd=round(d_phd, 0),
            repair_hours=d["repair_hours"],
            roi_phd_per_repair_hour=round(d_roi, 1),
            recommended_window=d["window"],
            priority_rank=0,
        ))

    # Sort descending by ROI score
    ranked_inventory.sort(key=lambda x: x.roi_phd_per_repair_hour, reverse=True)
    for idx, item in enumerate(ranked_inventory):
        item.priority_rank = idx + 1

    sop_en = [
        f"Prioritize repair of defect with highest ROI ({ranked_inventory[0].defect_name_en}: {ranked_inventory[0].roi_phd_per_repair_hour:.0f} PHD/h).",
        "Enforce rapid-curing elastomeric concrete or steel modular expansion plates to limit work window to < 4 hours.",
        f"Schedule asphalt milling and joint restoration strictly within the nocturnal low-demand window ({ranked_inventory[0].recommended_window}).",
        "Deploy temporary cold-mix asphalt ramps over damaged transitions during daytime hours to elevate crawl speed from 15 to 45 km/h.",
        "Equip upstream warning trailer 400m in advance with dynamic radar speed sign to prevent rear-end deceleration shockwaves."
    ]

    sop_ar = [
        f"إعطاء الأولوية القصوى لإصلاح العيب ذي أعلى عائد استثماري ({ranked_inventory[0].defect_name_ar}: توفير {ranked_inventory[0].roi_phd_per_repair_hour:.0f} ساعة تأخير لكل ساعة صيانة).",
        "استخدام الخرسانة البوليمرية سريعة التصلب أو الشرائح الفولاذية مسبقة الصنع لتقليص مدة العمل لأقل من 4 ساعات.",
        f"حصر أعمال الكشط ورصف الفواصل حصرياً في نافذة الليل الهادئة الموصى بها ({ranked_inventory[0].recommended_window}).",
        "وضع منحدرات أسفلتية باردة مؤقتة فوق فواصل الكباري المتضررة نهاراً لرفع سرعة العبور من 15 إلى 45 كم/س ومنع التباطؤ.",
        "تمركز مقطورة تحذير مسبقة قبل موقع العيب بمسافة 400 متر مزودة برادار سرعة ديناميكي لتفادي موجات الاصطدام الخلفي."
    ]

    return DefectRoiResponse(
        corridor_id=req.corridor_id,
        defect_type=req.defect_type,
        active_defect_capacity_pce=round(active_defect_capacity, 0),
        capacity_reduction_pct=round(cap_reduction_pct, 1),
        daily_wasted_phd=round(total_daily_phd, 0),
        roi_phd_per_repair_hour=round(roi_score, 1),
        hourly_delay_curve=hourly_curve,
        corridor_defect_inventory=ranked_inventory,
        recommended_night_window="01:00 - 05:00 (Thu Night)",
        sop_directives_en=sop_en,
        sop_directives_ar=sop_ar,
    )
