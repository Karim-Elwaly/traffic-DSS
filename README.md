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
2. **4 Executive Decision Support Modules:**
   - **Module 1 (Work-Zone Advisor):** 168-hour maintenance optimizer ranking the Top 3 optimal closure windows minimizing Person-Hours of Delay (PHD), calculating merge friction ($f_{\text{merge}}$), lane-specific penalties ($f_{\text{lane}}$), taper length, buffer space, and bilingual Standard Operating Procedures (SOP).
   - **Module 2 (Intersection Simulator):** Side-by-side evaluation of 4 geometric alternatives:
     1. Uncontrolled Open Intersection (32 conflict points)
     2. Webster's Adaptive 4-Phase Traffic Signal (8 conflict points)
     3. Closed Median + Protected U-Turn Corridor (4 conflict points - Egyptian Axis Model)
     4. Modern 3-Lane Roundabout (8 conflict points)
   - **Module 3 (Incident Shockwave Predictor):** LWR backward shockwave propagation speed ($w$ km/h), urgent countdown to upstream exit blockage ($T_{\text{block}}$ minutes), 60-minute queue progression curve, and micro-friction remedies.
   - **Module 4 (Dynamic Reversible Lanes & Green Wave):** Directional split analysis comparing standard 4+4 vs 5+3 movable-barrier allocation, travel time savings %, and configurable Green Wave signal progression offsets (450 m node spacing).
3. **Live 60fps Microscopic Canvases:**
   - `HighwayCanvas.tsx`: Animated 4-lane highway with class-colored vehicles, work-zone cones, lane merging, and shockwave queues.
   - `IntersectionCanvas.tsx`: Split-screen animated comparison between Traffic Signal stop-and-go waves and Protected U-Turn continuous flow.
4. **Bilingual Executive Readiness (RTL / LTR):** Instant toggle between English (LTR) and Egyptian / Standard Arabic (RTL) with dynamic `dir="rtl"` layout switching.
5. **Real-time Edge CV Ingestion Webhook:** `POST /api/cv/ingest` ready for YOLOv8/v11 + ByteTrack camera feeds.

---

## 📐 System Architecture & Algorithm Blueprint

For deep technical derivations and pseudocode, consult [ARCHITECTURE.md](file:///d:/projects/traffic_dss/ARCHITECTURE.md) and [ALGORITHMS.md](file:///d:/projects/traffic_dss/ALGORITHMS.md). Below is a summary of the core modules:

| Module | Core Physics & Algorithm | Primary Output |
| :--- | :--- | :--- |
| **PCE & Occupancy** | $q_{\text{PCE}} = \sum N_k \cdot w_k$, $P_{\text{pax}} = \sum N_k \cdot O_k$ | Homogenized flow & human throughput |
| **Module 1: Work-Zone** | $C_{\text{wz}} = 2000 \cdot (4-n) \cdot f_{\text{merge}} \cdot f_{\text{lane}} \cdot f_{\text{HV}}$, 168h window optimizer | Top 3 optimal windows, buffer/taper, field SOP |
| **Module 2: Intersection** | Webster optimal cycle $C_{\text{opt}}$, detour time $\Delta t_{\text{geo}}$, roundabout gap acceptance | 4-way comparison matrix & winning recommendation |
| **Module 3: Shockwave** | LWR wave velocity $w = \|\Delta q / \Delta k\|$, exit blockage countdown $T_{\text{block}}$ | Speed gauge, red countdown, 60-min queue trajectory |
| **Module 4: Reversible** | Split ratio $>68\%$ with outbound 4+4 v/c $<0.45$, configurable-node Green Wave offsets $\Delta t = D / V_{\text{prog}}$ (450 m spacing) | 4+4 vs 5+3 comparison, Green Wave schedule |

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
│   │   │   └── reversible_engine.py   # Module 4: 5+3 Reversible & Green Wave
│   │   ├── services/
│   │   │   ├── synthetic_seeder.py    # Pre-seeds 3 Egyptian Corridors x 7d x 24h
│   │   │   └── cv_ingestion.py        # Live YOLO/ByteTrack webhook
│   │   ├── sumo/
│   │   │   ├── networks/              # 4 Cairo geometric networks XML & base.sumocfg
│   │   │   ├── generator.py           # Multi-class heterogeneous vehicle & route generator
│   │   │   ├── runner.py              # TraCI runtime execution & microscopic metric extractor
│   │   │   └── service.py             # Hybrid Digital Twin orchestrator & fallback
│   │   └── api/
│   │       └── routes.py              # REST API endpoints (HCM + SUMO Digital Twin)
│   └── tests/
│       ├── test_engines.py            # Pytest suite for math engines
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
        │   └── client.ts              # Typed API client + deterministic local fallback
        ├── components/
        │   ├── layout/
        │   │   ├── TopCommandBar.tsx  # Corridor selector, AR/EN toggle, Status
        │   │   └── SidebarNav.tsx     # 4 DSS Module Navigation
        │   ├── simulation/
        │   │   ├── HighwayCanvas.tsx      # 60fps 4-lane Highway micro-simulator
        │   │   └── IntersectionCanvas.tsx # Split-screen Signal vs U-Turn simulator
        │   ├── common/
        │   │   ├── KpiCard.tsx            # Operations-grade KPI badge card
        │   │   └── SopActionCard.tsx      # Printable/Copyable Standard Operating Procedure
        │   └── modules/
        │       ├── WorkZoneAdvisor.tsx       # Module 1 Dashboard
        │       ├── IntersectionSimulator.tsx # Module 2 Dashboard
        │       ├── ShockwavePredictor.tsx    # Module 3 Dashboard
        │       └── ReversiblePlanner.tsx     # Module 4 Dashboard
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
```
