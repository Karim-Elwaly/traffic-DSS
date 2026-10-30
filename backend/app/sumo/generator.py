"""
Dynamic SUMO Vehicle Demand and Route Generator for Egyptian Corridor Scenarios.
Synthesizes heterogeneous multi-class traffic (Car, Microbus, Bus, Heavy Truck, Motorcycle)
and assigns realistic OD routes for the 4 geometric alternatives.
"""

import math
import random
from pathlib import Path
from typing import Dict, List, Optional


# Egyptian Vehicle Class Profiles in SUMO
EGYPTIAN_VTYPES_XML = """
    <!-- Egyptian Heterogeneous Vehicle Types (Krauss Car-Following + LC2013 Lane Changing) -->
    <vType id="veh_car" vClass="passenger" length="4.60" width="1.85" maxSpeed="30.00" accel="2.80" decel="4.50" sigma="0.40" minGap="2.00" color="0,210,255" emissionClass="HBEFA3/PC_G_EU4"/>
    <vType id="veh_microbus" vClass="passenger" length="5.50" width="2.05" maxSpeed="25.00" accel="2.40" decel="4.20" sigma="0.75" minGap="1.50" lcAssertive="1.8" lcPushy="0.7" lcImpatience="0.8" color="245,158,11" emissionClass="HBEFA3/LDV_D_EU3"/>
    <vType id="veh_bus" vClass="bus" length="12.00" width="2.55" maxSpeed="19.00" accel="1.50" decel="3.50" sigma="0.30" minGap="2.50" color="16,185,129" emissionClass="HBEFA3/Bus"/>
    <vType id="veh_truck" vClass="truck" length="14.00" width="2.55" maxSpeed="17.00" accel="1.20" decel="3.20" sigma="0.30" minGap="3.00" color="244,63,94" emissionClass="HBEFA3/HDV_D_EU3"/>
    <vType id="veh_motorcycle" vClass="motorcycle" length="2.20" width="0.85" maxSpeed="28.00" accel="3.50" decel="5.50" sigma="0.60" minGap="1.00" color="168,85,247" emissionClass="HBEFA3/PC_G_EU2"/>
"""


def get_vehicle_type_distribution(heavy_pct: float) -> List[tuple]:
    """
    Returns (vType_id, probability) reflecting Egyptian traffic composition.
    Adjusts truck and bus shares based on input heavy_pct.
    """
    hv_fraction = max(0.02, min(0.40, heavy_pct / 100.0))
    truck_prob = hv_fraction * 0.60
    bus_prob = hv_fraction * 0.40
    microbus_prob = 0.22  # High share in Cairo corridors
    motorcycle_prob = 0.08
    car_prob = max(0.10, 1.0 - (truck_prob + bus_prob + microbus_prob + motorcycle_prob))
    
    return [
        ("veh_car", car_prob),
        ("veh_microbus", microbus_prob),
        ("veh_bus", bus_prob),
        ("veh_truck", truck_prob),
        ("veh_motorcycle", motorcycle_prob),
    ]


def pick_vtype(distribution: List[tuple], rng: random.Random) -> str:
    r = rng.random()
    cum = 0.0
    for vtype, prob in distribution:
        cum += prob
        if r <= cum:
            return vtype
    return distribution[0][0]


def generate_demand_xml(
    alt_id: str,
    main_flow_vehh: float,
    cross_flow_vehh: float,
    turning_pct: float,
    heavy_pct: float,
    duration_sec: int = 300,
    seed: int = 42,
) -> str:
    """
    Generates a complete SUMO .rou.xml string matching the requested geometry
    and demand flows over duration_sec.
    """
    rng = random.Random(seed)
    dist = get_vehicle_type_distribution(heavy_pct)
    turn_ratio = max(0.05, min(0.45, turning_pct / 100.0))

    # Rates in vehicles per second
    rate_main_west = (main_flow_vehh / 2.0) / 3600.0
    rate_main_east = (main_flow_vehh / 2.0) / 3600.0
    rate_cross_south = (cross_flow_vehh / 2.0) / 3600.0
    rate_cross_north = (cross_flow_vehh / 2.0) / 3600.0

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">']
    lines.append(EGYPTIAN_VTYPES_XML)

    # Route definitions per alternative geometry
    if alt_id in ("OPEN", "SIGNAL"):
        lines.append('    <route id="r_w_e" edges="E_WEST_IN E_EAST_OUT"/>')
        lines.append('    <route id="r_e_w" edges="E_EAST_IN E_WEST_OUT"/>')
        lines.append('    <route id="r_w_s" edges="E_WEST_IN E_SOUTH_OUT"/>')
        lines.append('    <route id="r_w_n" edges="E_WEST_IN E_NORTH_OUT"/>')
        lines.append('    <route id="r_e_n" edges="E_EAST_IN E_NORTH_OUT"/>')
        lines.append('    <route id="r_e_s" edges="E_EAST_IN E_SOUTH_OUT"/>')
        lines.append('    <route id="r_s_n" edges="E_SOUTH_IN E_NORTH_OUT"/>')
        lines.append('    <route id="r_s_e" edges="E_SOUTH_IN E_EAST_OUT"/>')
        lines.append('    <route id="r_s_w" edges="E_SOUTH_IN E_WEST_OUT"/>')
        lines.append('    <route id="r_n_s" edges="E_NORTH_IN E_SOUTH_OUT"/>')
        lines.append('    <route id="r_n_w" edges="E_NORTH_IN E_WEST_OUT"/>')
        lines.append('    <route id="r_n_e" edges="E_NORTH_IN E_EAST_OUT"/>')
    elif alt_id == "UTURN":
        # Closed median: mainline is continuous through center + uturn link; cross/turns turn right and loop
        lines.append('    <route id="r_w_e" edges="E_WEST_IN E_CENTER_TO_UTURN E_EAST_OUT"/>')
        lines.append('    <route id="r_e_w" edges="E_EAST_IN E_UTURN_TO_CENTER E_WEST_OUT"/>')
        lines.append('    <route id="r_w_u" edges="E_WEST_IN E_CENTER_TO_UTURN E_UTURN_TO_CENTER E_WEST_OUT"/>')
        lines.append('    <route id="r_s_w" edges="E_SOUTH_IN E_CENTER_TO_UTURN E_UTURN_TO_CENTER E_WEST_OUT"/>')
        lines.append('    <route id="r_s_e" edges="E_SOUTH_IN E_CENTER_TO_UTURN E_EAST_OUT"/>')
        lines.append('    <route id="r_n_w" edges="E_NORTH_IN E_WEST_OUT"/>')
        lines.append('    <route id="r_n_e" edges="E_NORTH_IN E_WEST_OUT E_CENTER_TO_UTURN E_EAST_OUT"/>')
    elif alt_id == "ROUNDABOUT":
        lines.append('    <route id="r_w_e" edges="E_WEST_IN E_ROT_W_S E_ROT_S_E E_EAST_OUT"/>')
        lines.append('    <route id="r_e_w" edges="E_EAST_IN E_ROT_E_N E_ROT_N_W E_WEST_OUT"/>')
        lines.append('    <route id="r_w_s" edges="E_WEST_IN E_ROT_W_S E_SOUTH_OUT"/>')
        lines.append('    <route id="r_w_n" edges="E_WEST_IN E_ROT_W_S E_ROT_S_E E_ROT_E_N E_NORTH_OUT"/>')
        lines.append('    <route id="r_s_n" edges="E_SOUTH_IN E_ROT_S_E E_ROT_E_N E_NORTH_OUT"/>')
        lines.append('    <route id="r_s_e" edges="E_SOUTH_IN E_ROT_S_E E_EAST_OUT"/>')
        lines.append('    <route id="r_n_s" edges="E_NORTH_IN E_ROT_N_W E_ROT_W_S E_SOUTH_OUT"/>')
        lines.append('    <route id="r_n_w" edges="E_NORTH_IN E_ROT_N_W E_WEST_OUT"/>')

    # Generate individual vehicle departures (Poisson arrival process)
    veh_counter = 1
    for t in range(0, duration_sec):
        # 1. Westbound Main approach
        if rng.random() < rate_main_west:
            vtype = pick_vtype(dist, rng)
            is_turn = rng.random() < turn_ratio
            if alt_id in ("OPEN", "SIGNAL"):
                route = "r_w_s" if (is_turn and rng.random() < 0.5) else ("r_w_n" if is_turn else "r_w_e")
            elif alt_id == "UTURN":
                route = "r_w_u" if is_turn else "r_w_e"
            else:  # ROUNDABOUT
                route = "r_w_s" if is_turn else "r_w_e"
            lines.append(f'    <vehicle id="veh_{veh_counter}" type="{vtype}" route="{route}" depart="{t}.00" departLane="best" departSpeed="max"/>')
            veh_counter += 1

        # 2. Eastbound Main approach
        if rng.random() < rate_main_east:
            vtype = pick_vtype(dist, rng)
            is_turn = rng.random() < turn_ratio
            if alt_id in ("OPEN", "SIGNAL"):
                route = "r_e_n" if (is_turn and rng.random() < 0.5) else ("r_e_s" if is_turn else "r_e_w")
            elif alt_id == "UTURN":
                route = "r_e_w"
            else:  # ROUNDABOUT
                route = "r_e_w"
            lines.append(f'    <vehicle id="veh_{veh_counter}" type="{vtype}" route="{route}" depart="{t}.00" departLane="best" departSpeed="max"/>')
            veh_counter += 1

        # 3. South Cross approach
        if rng.random() < rate_cross_south:
            vtype = pick_vtype(dist, rng)
            if alt_id in ("OPEN", "SIGNAL"):
                route = "r_s_e" if rng.random() < 0.4 else "r_s_n"
            elif alt_id == "UTURN":
                route = "r_s_w" if rng.random() < 0.5 else "r_s_e"
            else:
                route = "r_s_e" if rng.random() < 0.4 else "r_s_n"
            lines.append(f'    <vehicle id="veh_{veh_counter}" type="{vtype}" route="{route}" depart="{t}.00" departLane="best" departSpeed="max"/>')
            veh_counter += 1

        # 4. North Cross approach
        if rng.random() < rate_cross_north:
            vtype = pick_vtype(dist, rng)
            if alt_id in ("OPEN", "SIGNAL"):
                route = "r_n_w" if rng.random() < 0.4 else "r_n_s"
            elif alt_id == "UTURN":
                route = "r_n_w"
            else:
                route = "r_n_w" if rng.random() < 0.4 else "r_n_s"
            lines.append(f'    <vehicle id="veh_{veh_counter}" type="{vtype}" route="{route}" depart="{t}.00" departLane="best" departSpeed="max"/>')
            veh_counter += 1

    lines.append('</routes>')
    return "\n".join(lines)


def generate_workzone_demand_xml(
    demand_pce: float,
    heavy_pct: float = 12.0,
    duration_sec: int = 120,
    seed: int = 42,
) -> str:
    """
    Generates dynamic vehicle demand for 4-lane highway workzone corridor.
    """
    rng = random.Random(seed)
    dist = get_vehicle_type_distribution(heavy_pct)
    rate_per_sec = (demand_pce / 3600.0)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">',
        EGYPTIAN_VTYPES_XML,
        '    <route id="r_hwy" edges="E_HWY_UPSTREAM E_HWY_DOWNSTREAM"/>'
    ]

    veh_counter = 1
    for t in range(0, duration_sec):
        rem = rate_per_sec
        while rem > 0:
            if rng.random() < min(1.0, rem):
                vtype = pick_vtype(dist, rng)
                lines.append(f'    <vehicle id="wz_{veh_counter}" type="{vtype}" route="r_hwy" depart="{t}.00" departLane="random" departSpeed="max"/>')
                veh_counter += 1
            rem -= 1.0

    lines.append('</routes>')
    return "\n".join(lines)

