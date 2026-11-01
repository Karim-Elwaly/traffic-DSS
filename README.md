# Intelligent Traffic Decision Support System (IT-DSS)
### نظام دعم اتخاذ القرار المروري الذكي

A full-stack, production-grade **Intelligent Traffic Decision Support System (IT-DSS)** designed for traffic authorities and operations commanders. Powered by deterministic traffic physics from the **Highway Capacity Manual (HCM 6th/7th Edition)**, **Lighthill-Whitham-Richards (LWR) hydrodynamic shockwave equations**, and **Webster's intersection delay models**.

> 📖 **Comprehensive Documentation:**  
> - [System Architecture Manual (ARCHITECTURE.md)](file:///d:/projects/traffic_dss/ARCHITECTURE.md): Complete system topology, component interactions, database schemas, CV pipelines, network ports, and API contracts.
> - [Mathematical Physics & Algorithms Manual (ALGORITHMS.md)](file:///d:/projects/traffic_dss/ALGORITHMS.md): Detailed equations, derivations, queue recursions, Webster models, LWR shockwave physics, and 60fps particle mechanics.

---

## 🌟 Key Features

1. **Deterministic Traffic Flow Physics (Zero Placeholders):**
   - **PCE Flow & Human Occupancy:** Dynamically calculates Passenger Car Equivalents and human passenger flows across 5 vehicle classes (Cars, 14-Seat Microbuses, Transit Buses, Heavy Trucks, Motorcycles).
   - **Level of Service (LoS A-F):** Automated grading based on delay ($d$) and volume-to-capacity ($v/c$).
2. **10 Executive Decision Support Modules:**
   - **Module 1 (Work-Zone & Lane Closure Advisor):** 168-hour maintenance optimizer ranking optimal closure windows minimizing Person-Hours of Delay (PHD), calculating storage-bounded queues, Little's-law delay, merge/lane/taper geometry, and bilingual Standard Operating Procedures (SOP).
   - **Module 2 (Corridor Signal & U-Turn Coordinator):** Side-by-side evaluation of 4 geometric alternatives: Uncontrolled Open, Webster Adaptive 4-Phase Signal, Closed Median + Protected U-Turn Corridor (Egyptian Axis Model), and Modern 3-Lane Roundabout.
   - **Module 3 (Incident Shockwave Predictor):** LWR backward shockwave propagation speed ($w$ km/h), urgent countdown to upstream exit blockage ($T_{\text{block}}$ minutes), 60-minute queue progression curve, and micro-friction remedies.
   - **Module 4 (Dynamic Reversible Lanes & Green Wave):** Directional split analysis comparing standard 4+4 vs 5+3 movable-barrier allocation, travel-time delay savings, and Green Wave progression offset coordination.
   - **Module 5 (Severe Weather & Fog Protocol Advisor):** AASHTO Stopping Sight Distance (SSD) for cars vs trucks under wet/foggy conditions, tire-pavement friction modeling, pileup risk indices, and 3-Tier Police Convoy Pacing (تفويج مروري).
   - **Module 6 (Smart On-Ramp Metering & Merge Controller):** ALINEA feedback regulation law, merge turbulence capacity drop alleviation, and 180m channelized barrier curb optimization.
   - **Module 7 (Parallel Corridor Diversion Balancer):** Bureau of Public Roads (BPR) link performance functions, 36-point sweep curves, Wardrop User Equilibrium split %, and dynamic VMS rerouting advisories.
   - **Module 8 (Security Checkpoint & Toll Plaza Optimizer):** Funnel queuing physics $M(t)/M(t)/c$, dynamic booth allocation, and the 180-Second Anti-Gridlock Green Bypass trigger.
   - **Module 9 (Bridge Joint & Surface Defect ROI Prioritizer):** Spot-crawl capacity reduction model, 24-hour diurnal delay integration (PHD), and ROI ranking (delay saved per maintenance hour).
   - **Module 10 (Mega-Event & School Peak Surge Orchestrator):** Gaussian surge modeling, peak-shaving staggered release waves, coned express chute allocation, and minute-by-minute gate playbook.
3. **Live 60fps Microscopic Canvases:**
   - Interactive HTML5 Canvas engines for Work-Zone Merging, 4-Way Intersection Alternatives, Reversible Barrier Flow, Fog Braking Cone & Patrol Convoy, Ramp ALINEA Metering, Diversion Fork BPR, and Toll Plaza Funneling.
4. **Bilingual Executive Readiness (RTL / LTR):** Instant toggle between English (LTR) and Egyptian / Standard Arabic (RTL) with dynamic `dir="rtl"` layout switching.
5. **Real-time Edge CV Ingestion Webhook:** `POST /api/cv/ingest` ready for YOLOv8/v11 + ByteTrack camera feeds.

---

## 📐 Complete 10-Module Functional Matrix

| # | Module Name | Operational Focus | Core Physics & Algorithm | Primary Field Output |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Work-Zone & Lane Closure Advisor** | Capacity & Maintenance | HCM Work-Zone Drop, Merge Friction ($f_{\text{merge}}$), 168-Hour PHD Minimizer | Top 3 optimal windows, cone taper geometry, SOP |
| **2** | **Corridor Signal & Green Wave** | Intersections & U-Turns | Webster delay, HCM incremental overflow, U-turn weaving penalty | 4-way comparison matrix, conflict point audit |
| **3** | **Incident Shockwave Predictor** | Incident Management | LWR Hydrodynamic Shockwave $w = \Delta q / \Delta k$, exit blockage countdown | Exit blockage timer, queue trajectory, warning trailer placement |
| **4** | **Reversible Lane Operator** | Tidal Flow Management | Directional split $>68\%$, 5+3 barrier reallocation, Green Wave offsets | Barrier reallocation order, signal flush offsets |
| **5** | **Severe Weather & Fog Advisor** | Crisis & Wet Weather | AASHTO SSD $d = 0.278Vt + V^2 / (254(\mu \pm G))$, Pileup Risk Index | Safe advisory speed, VMS alert, police convoy pacing (تفويج) |
| **6** | **Ramp Metering & Merge Assistant**| On-Ramp Bottlenecks | ALINEA feedback law, merge turbulence recovery, 180m barrier curb | Cycle time, metering rate, barrier length recommendation |
| **7** | **Parallel Corridor Balancer** | Network Rerouting | BPR curves $T = t_0[1 + 0.15(v/c)^4]$, Wardrop User Equilibrium | Optimal split %, travel time parity, VMS advisory broadcast |
| **8** | **Security & Toll Optimizer** | Plaza Bottlenecks | $M/M/c$ queuing theory, queue backpressure, 180s Green Bypass | Optimal booth count, RFID allocation, bypass gate trigger |
| **9** | **Bridge Joint & Defect ROI** | Infrastructure Maintenance | Spot-crawl speed drop, 24h diurnal PHD integration, ROI ranking | Defect priority rank, nocturnal repair window, delay savings |
| **10**| **Mega-Event Surge Orchestrator** | Stadium & School Peaks | Gaussian dispersion, staggered wave release, coned express chute | Stagger schedule, clearance time saved, gate playbook |

---

## 📂 Architecture & Directory Structure

```text
traffic-dss-platform/
├── ARCHITECTURE.md                  # Comprehensive System Architecture Manual
├── ALGORITHMS.md                    # Detailed Mathematical Physics & Algorithm Manual
├── SPEC.md                           # Master Project Specification
├── README.md                         # Project Guide & Quickstart
├── docker-compose.yml                # Multi-container orchestration (Ports 8765 & 5199)
├── run_dss.bat                       # One-click Windows launcher
├── backend/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py                    # FastAPI entry, CORS, DB initialization (Port 8765)
│   │   ├── models/
│   │   │   ├── domain.py              # SQLModel/SQLite tables (Corridors & Telemetry)
│   │   │   └── schemas.py             # Pydantic v2 API contracts
│   │   ├── core/
│   │   │   ├── hcm_math.py            # PCE, Occupancy, Capacity Drop, Taper, LoS
│   │   │   ├── workzone_engine.py     # Module 1: Window Optimizer & SOP
│   │   │   ├── intersection_engine.py # Module 2: 4-Way Geometric Simulator
│   │   │   ├── shockwave_engine.py    # Module 3: LWR Shockwave & Micro-Friction
│   │   │   ├── reversible_engine.py   # Module 4: 5+3 Reversible & Green Wave
│   │   │   ├── weather_engine.py      # Module 5: AASHTO Fog SSD & Convoy Pacing
│   │   │   ├── ramp_engine.py         # Module 6: ALINEA Ramp Metering & Merge Barrier
│   │   │   ├── diversion_engine.py    # Module 7: BPR Parallel Corridor Balancer
│   │   │   ├── checkpoint_engine.py   # Module 8: Toll & Checkpoint Funnel Optimizer
│   │   │   ├── defect_roi_engine.py   # Module 9: Bridge Joint & Defect ROI Prioritizer
│   │   │   └── surge_engine.py        # Module 10: Mega-Event & School Surge Orchestrator
│   │   ├── services/
│   │   │   ├── synthetic_seeder.py    # Pre-seeds 3 Egyptian Corridors x 7d x 24h
│   │   │   └── cv_ingestion.py        # Live YOLO/ByteTrack webhook
│   │   ├── sumo/
│   │   │   ├── networks/              # 5 SUMO networks XML & base.sumocfg
│   │   │   ├── generator.py           # Multi-class heterogeneous vehicle generator
│   │   │   ├── runner.py              # TraCI runtime execution & metric extractor
│   │   │   └── service.py             # Hybrid Digital Twin orchestrator & fallback
│   │   └── api/
│   │       └── routes.py              # REST API endpoints (HCM + SUMO Digital Twin)
│   └── tests/
│       ├── test_engines.py            # Pytest suite for mathematical engines
│       ├── test_api.py                # FastAPI TestClient integration tests
│       └── test_sumo.py               # SUMO TraCI & microscopic simulation test suite
└── frontend/
    ├── package.json
    ├── vite.config.ts                 # Vite server config (Port 5199, proxy to :8765)
    ├── tailwind.config.js
    ├── Dockerfile
    └── src/
        ├── App.tsx                    # Master Command Center Shell
        ├── i18n/
        │   └── translations.ts        # Full Arabic (RTL) & English (LTR) dictionary
        ├── api/
        │   └── client.ts              # Typed API client with 10-module endpoints
        ├── components/
        │   ├── layout/
        │   │   ├── TopCommandBar.tsx  # Corridor selector, AR/EN toggle, Status
        │   │   └── SidebarNav.tsx     # 10 DSS Module Navigation across 3 Pillars
        │   ├── simulation/
        │   │   ├── HighwayCanvas.tsx          # 60fps Work-Zone micro-simulator
        │   │   ├── IntersectionCanvas.tsx     # Split-screen Signal vs U-Turn simulator
        │   │   ├── ReversibleCanvas.tsx       # 5+3 Tidal flow reversible lane canvas
        │   │   ├── WeatherBrakingCanvas.tsx   # Fog SSD braking cone & police convoy
        │   │   ├── RampMergeCanvas.tsx        # ALINEA ramp metering & merge barrier
        │   │   ├── DiversionForkCanvas.tsx    # Parallel corridor BPR bifurcation
        │   │   └── CheckpointFunnelCanvas.tsx # Toll plaza queue & green bypass funnel
        │   ├── common/
        │   │   ├── KpiCard.tsx                # Operations-grade KPI badge card
        │   │   └── SopActionCard.tsx          # Printable/Copyable SOP card
        │   └── modules/
        │       ├── WorkZoneAdvisor.tsx        # Module 1 Dashboard
        │       ├── IntersectionSimulator.tsx  # Module 2 Dashboard
        │       ├── ShockwavePredictor.tsx     # Module 3 Dashboard
        │       ├── ReversiblePlanner.tsx      # Module 4 Dashboard
        │       ├── WeatherProtocolAdvisor.tsx # Module 5 Dashboard
        │       ├── RampMergeController.tsx    # Module 6 Dashboard
        │       ├── DiversionBalancer.tsx      # Module 7 Dashboard
        │       ├── CheckpointOptimizer.tsx    # Module 8 Dashboard
        │       ├── DefectPrioritizer.tsx      # Module 9 Dashboard
        │       ├── SurgeOrchestrator.tsx      # Module 10 Dashboard
        │       └── TelemetryCvInspector.tsx   # Live CCTV CV Telemetry Inspector
```

---

## 🚀 Quick Start Instructions

### Ports Configuration
- **Backend API**: `http://localhost:8765` (Docs at `http://localhost:8765/docs`)
- **Frontend Command Center**: `http://localhost:5199`

### Option 1: Quick Launch Script (Windows)
Double-click [run_dss.bat](file:///d:/projects/traffic_dss/run_dss.bat) in the project root.

### Option 2: Docker Compose
```bash
docker-compose up --build
```
- Backend API Docs: `http://localhost:8765/docs`
- Frontend Command Center: `http://localhost:5199`

### Option 3: Manual Execution

#### 1. Backend (from the project root)
```bash
python -m venv .venv
# Windows:
.venv\Scripts\python -m pip install -r backend/requirements.txt
.venv\Scripts\python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8765 --reload
# macOS / Linux:
# source .venv/bin/activate && pip install -r backend/requirements.txt
# python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8765 --reload
```

#### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

#### 3. Run Automated Tests (from the project root)
```bash
# Mathematical physics, weekly optimizer, reversible thresholds, Green Wave spacing
.venv\Scripts\python -m pytest backend/tests/test_engines.py -v

# FastAPI REST endpoints, CV live-state ingestion, requested-window API
.venv\Scripts\python -m pytest backend/tests/test_api.py -v

# Native SUMO / TraCI networks and microscopic simulations
.venv\Scripts\python -m pytest backend/tests/test_sumo.py -v

# Complete suite
.venv\Scripts\python -m pytest backend/tests -q
```

---

## Optional SUMO / TraCI Digital Twin (Backend & API)

The analytical HCM/Webster/LWR engines are always available. If Eclipse SUMO
and the `traci`/`sumolib` Python packages are installed, the platform also runs
vehicle-by-vehicle microscopic simulations through the native C++ SUMO core.
The browser UI does not expose a SUMO engine switch; native SUMO remains
available through the API and is used by automated validation and the test
suite.

```bash
winget install Eclipse.SUMO
.venv\Scripts\python -m pip install -r backend/requirements.txt
```

- `GET /api/dss/sumo/status` reports the discovered `sumo.exe`, `sumo-gui.exe`,
  `SUMO_HOME`, TraCI availability, and the five generated networks.
- Add `"engine_mode": "sumo"` to `/api/dss/workzone-optimize`,
  `/api/dss/intersection-simulate`, or `/api/dss/shockwave-predict` to attach
  microscopic telemetry to the analytical decision output.
- Dedicated endpoints: `POST /api/dss/sumo/workzone-simulate` (uses the seeded
  demand for `target_start_hour`, or the selected day's peak hour when omitted)
  and `POST /api/dss/sumo/intersection-simulate`.
- `POST /api/dss/sumo/launch-gui?scenario=intersection&alt_id=SIGNAL` opens the
  native desktop SUMO-GUI for live visual inspection.
- When SUMO is not installed, the APIs return an explicitly labelled calibrated
  micro-emulation fallback (`is_native_sumo: false`) instead of silently failing.
