#!/usr/bin/env python3
"""
Edge Computer Vision Stream Simulator (YOLOv8 + ByteTrack Telemetry Emitter)
Intelligent Traffic Decision Support System (IT-DSS)

Simulates continuous, real-time edge CCTV telemetry feeds from highway gantries
(e.g., 26th of July Axis, Ring Road, Salah Salem) into the IT-DSS backend API.

Features:
- Models realistic 4-lane Egyptian highway traffic behavior:
  * Lane 1 (Curb): High heavy trucks, frequent microbus stopping and lateral weaving.
  * Lane 2 (Mid-Right): Mixed passenger cars and microbuses.
  * Lane 3 (Mid-Left): High-speed passenger cars.
  * Lane 4 (Median): Fast passing lane with minimal heavy vehicles.
- Pushes JSON telemetry payloads to `POST /api/cv/ingest` every 3 seconds.
- Displays an executive real-time ANSI terminal dashboard for stakeholder demos.
"""

import sys
import time
import random
import argparse
import requests
from datetime import datetime

# Color terminal codes
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def generate_lane_feed(lane_num: int, corridor_speed_limit: float = 80.0):
    """
    Generates realistic 5-second window vehicle counts and kinematics for a specific highway lane.
    """
    if lane_num == 1:
        # Slow / curb lane: high microbus and truck density, lower speed, high lateral weaving
        cars = random.randint(3, 8)
        microbus = random.randint(4, 12)
        buses = random.randint(1, 4)
        trucks = random.randint(3, 9)
        motorcycles = random.randint(1, 5)
        base_speed = corridor_speed_limit * random.uniform(0.40, 0.65)
        weaving = random.uniform(0.45, 0.85)  # Microbus curb-friction weaving
    elif lane_num == 2:
        # Mid-Right lane: moderate mixing, occasional microbus pull-outs
        cars = random.randint(8, 16)
        microbus = random.randint(2, 6)
        buses = random.randint(0, 2)
        trucks = random.randint(1, 4)
        motorcycles = random.randint(1, 4)
        base_speed = corridor_speed_limit * random.uniform(0.60, 0.80)
        weaving = random.uniform(0.20, 0.45)
    elif lane_num == 3:
        # Mid-Left lane: high car throughput, few heavy vehicles
        cars = random.randint(14, 24)
        microbus = random.randint(0, 2)
        buses = random.randint(0, 1)
        trucks = random.randint(0, 1)
        motorcycles = random.randint(0, 2)
        base_speed = corridor_speed_limit * random.uniform(0.75, 0.95)
        weaving = random.uniform(0.08, 0.22)
    else:  # Lane 4
        # Fast overtaking lane: exclusively fast cars, zero trucks, low weaving
        cars = random.randint(16, 28)
        microbus = 0
        buses = 0
        trucks = 0
        motorcycles = random.randint(0, 2)
        base_speed = corridor_speed_limit * random.uniform(0.90, 1.15)
        weaving = random.uniform(0.02, 0.12)

    return {
        "lane_number": lane_num,
        "count_cars": cars,
        "count_microbus": microbus,
        "count_buses": buses,
        "count_trucks": trucks,
        "count_motorcycles": motorcycles,
        "avg_speed_kmh": round(base_speed, 1),
        "lane_weaving_index": round(weaving, 3)
    }


def run_stream(
    endpoint: str = "http://127.0.0.1:8000/api/cv/ingest",
    corridor_id: str = "corridor_26july",
    camera_id: str = "CCTV-26JULY-KM14-OCTCITY",
    interval_sec: float = 3.0,
    max_iterations: int = 0
):
    print(f"{CYAN}{BOLD}======================================================================{RESET}")
    print(f"{CYAN}{BOLD}   IT-DSS EDGE COMPUTER VISION (YOLOv8 + ByteTrack) TELEMETRY STREAM   {RESET}")
    print(f"{CYAN}{BOLD}======================================================================{RESET}")
    print(f"{BOLD}Target Endpoint:{RESET} {endpoint}")
    print(f"{BOLD}Corridor ID:{RESET}     {corridor_id}")
    print(f"{BOLD}Camera ID:{RESET}       {camera_id}")
    print(f"{BOLD}Stream Cadence:{RESET}  Every {interval_sec} seconds")
    print(f"{DIM}Press Ctrl+C at any time to pause or terminate the simulation.{RESET}\n")

    iteration = 0
    total_transmitted = 0
    total_failures = 0

    try:
        while True:
            iteration += 1
            if max_iterations > 0 and iteration > max_iterations:
                print(f"\n{GREEN}Completed {max_iterations} iterations. Stopping.{RESET}")
                break

            now = datetime.now()
            lanes = [generate_lane_feed(lane_num, corridor_speed_limit=80.0) for lane_num in range(1, 5)]

            payload = {
                "camera_id": camera_id,
                "corridor_id": corridor_id,
                "timestamp_epoch": time.time(),
                "lanes": lanes
            }

            # Calculate batch metrics
            total_vehicles = sum(
                l["count_cars"] + l["count_microbus"] + l["count_buses"] +
                l["count_trucks"] + l["count_motorcycles"]
                for l in lanes
            )
            mean_speed = sum(l["avg_speed_kmh"] for l in lanes) / len(lanes)

            status_text = ""
            try:
                t0 = time.time()
                resp = requests.post(endpoint, json=payload, timeout=4.0)
                elapsed_ms = (time.time() - t0) * 1000.0

                if resp.status_code == 200:
                    data = resp.json()
                    pce = data.get("total_instantaneous_pce", 0.0)
                    passengers = data.get("total_instantaneous_passengers", 0.0)
                    status_text = (
                        f"{GREEN}{BOLD}[OK 200]{RESET} {elapsed_ms:.1f}ms | "
                        f"PCE Flow: {YELLOW}{pce:.0f} PCE/h{RESET} | "
                        f"Passenger Rate: {CYAN}{passengers:.0f} pers/h{RESET}"
                    )
                    total_transmitted += 1
                else:
                    status_text = f"{RED}[ERR {resp.status_code}]{RESET} {resp.text[:60]}"
                    total_failures += 1
            except requests.exceptions.RequestException as e:
                status_text = f"{RED}[CONNECTION REFUSED]{RESET} Backend offline at {endpoint}"
                total_failures += 1

            # Render Live Status Row
            print(
                f"{DIM}{now.strftime('%H:%M:%S')}{RESET} | "
                f"{BOLD}Frame #{iteration:04d}{RESET} | "
                f"L1-4 Flow: {BOLD}{total_vehicles:2d} veh{RESET} | "
                f"Avg Spd: {mean_speed:4.1f} km/h | {status_text}"
            )

            # Per-lane breakdown mini table
            lane_str = "  "
            for l in lanes:
                l_num = l["lane_number"]
                l_cnt = l["count_cars"] + l["count_microbus"] + l["count_buses"] + l["count_trucks"] + l["count_motorcycles"]
                lane_str += f"Lane {l_num}: {l_cnt:2d} veh ({l['avg_speed_kmh']:4.1f}km/h, w={l['lane_weaving_index']:.2f})  "
            print(f"{DIM}{lane_str}{RESET}")

            time.sleep(interval_sec)

    except KeyboardInterrupt:
        print(f"\n\n{YELLOW}Stream paused by operator.{RESET}")
        print(f"Summary: {total_transmitted} batches transmitted, {total_failures} failures.")
        sys.exit(0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IT-DSS Edge Computer Vision Telemetry Simulator")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000/api/cv/ingest", help="Target DSS backend ingestion URL")
    parser.add_argument("--corridor", default="corridor_26july", help="Target Corridor ID")
    parser.add_argument("--camera", default="CCTV-26JULY-KM14-OCTCITY", help="CCTV Gantry ID")
    parser.add_argument("--interval", type=float, default=3.0, help="Cadence in seconds (default: 3.0)")
    parser.add_argument("--iterations", type=int, default=0, help="Max iterations to send (0 = infinite)")

    args = parser.parse_args()
    run_stream(
        endpoint=args.endpoint,
        corridor_id=args.corridor,
        camera_id=args.camera,
        interval_sec=args.interval,
        max_iterations=args.iterations
    )
