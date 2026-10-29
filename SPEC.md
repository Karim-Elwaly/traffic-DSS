# PROJECT SPECIFICATION: Intelligent Traffic Decision Support System (IT-DSS)

## 1. Role & Engineering Standards
You are a Principal Full-Stack Systems Architect and Traffic Operations Engineer. Your task is to build a production-grade, full-stack **Intelligent Traffic Decision Support System (IT-DSS)** with 4 interactive executive demos for highway and urban traffic management authorities.

### Non-Negotiable Implementation Rules:
1. **Zero Placeholders:** Never write `// TODO`, `pass`, `NotImplementedError`, or mock static responses where mathematical calculation is required. Every formula specified below must be fully implemented.
2. **Deterministic Traffic Physics:** All outputs must be computed dynamically from the Highway Capacity Manual (HCM), LWR (Lighthill-Whitham-Richards) hydrodynamic shockwave equations, and Webster's intersection delay models.
3. **Self-Contained Execution:** The platform must run out-of-the-box using a realistic, pre-seeded Egyptian Corridor Telemetry Generator (simulating corridors like the 26th of July Corridor, Ring Road, and Salah Salem) while exposing clean ingestion endpoints for real Computer Vision (YOLO/ByteTrack) camera feeds.
4. **Bilingual Executive Readiness:** Support an instant UI toggle between **Arabic (RTL)** and **English (LTR)** so traffic commanders and technical engineers can both use the Command Center seamlessly.

---

## 2. Target Tech Stack & Monorepo Structure
- **Backend:** Python 3.11+, FastAPI, Pydantic v2, SQLModel, NumPy, SQLite, Uvicorn.
- **Frontend:** React 18+, Vite, TypeScript, Tailwind CSS, Recharts, Lucide React, HTML5 Canvas 60fps Micro-Simulators.

```text
traffic-dss-platform/
├── SPEC.md
├── docker-compose.yml
├── run_dss.bat
├── backend/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py                    # FastAPI entry, CORS, startup data seeding
│   │   ├── models/
│   │   │   ├── domain.py              # SQLModel/ORM tables for corridors & telemetry
│   │   │   └── schemas.py             # Pydantic v2 request/response schemas
│   │   ├── core/
│   │   │   ├── hcm_math.py            # PCE, Capacity Drop, Taper length, LoS equations
│   │   │   ├── workzone_engine.py     # Use Case 1: Optimal closure window & SOP generator
│   │   │   ├── intersection_engine.py # Use Case 2: Signal vs U-Turn vs Roundabout simulator
│   │   │   ├── shockwave_engine.py    # Use Case 3: LWR incident shockwave & lane weaving
│   │   │   └── reversible_engine.py   # Use Case 4: Reversible lane & Green Wave optimizer
│   │   ├── services/
│   │   │   ├── synthetic_seeder.py    # Generates 7-day x 24h per-lane realistic traffic data
│   │   │   └── cv_ingestion.py        # Webhook/endpoint for real YOLO/ByteTrack JSON feeds
│   │   └── api/
│   │       └── routes.py              # REST endpoints for all 4 DSS modules + Copilot summary
│   └── tests/
│       ├── test_engines.py            # Pytest suite verifying all 4 mathematical engines
│       └── test_api.py                # FastAPI TestClient integration tests
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx                    # Main Command Center Shell & Module Switcher
        ├── i18n/
        │   └── translations.ts        # Full Arabic (RTL) & English (LTR) dictionary
        ├── api/
        │   └── client.ts              # Typed Axios/Fetch wrapper for backend endpoints
        ├── components/
        │   ├── layout/
        │   │   ├── TopCommandBar.tsx  # Corridor selector, Language toggle, System status
        │   │   └── SidebarNav.tsx     # Switcher between the 4 Decision Support Modules
        │   ├── simulation/
        │   │   ├── HighwayCanvas.tsx  # Live 2D animated 4-lane traffic + work-zone canvas
        │   │   └── IntersectionCanvas.tsx # Split-screen Signal vs U-Turn canvas
        │   ├── common/
        │   │   ├── KpiCard.tsx        # High-contrast metric card with delta badge
        │   │   └── SopActionCard.tsx  # Printable/Exportable Standard Operating Procedure
        │   └── modules/
        │       ├── WorkZoneAdvisor.tsx     # Demo 1 UI
        │       ├── IntersectionSimulator.tsx # Demo 2 UI
        │       ├── ShockwavePredictor.tsx  # Demo 3 UI
        │       └── ReversiblePlanner.tsx   # Demo 4 UI
```

---

## 3. Core Mathematical & Engineering Specifications

### 3.1 Per-Lane Vehicle Equivalents (PCE) & Human Occupancy

Every corridor has $N=4$ lanes per direction (Lane 1 = Rightmost slow/heavy lane, Lane 4 = Leftmost fast lane).
For any hour $h$ and lane $i \in \{1, 2, 3, 4\}$:

* **Passenger Car Equivalent Flow ($q_{\text{PCE}, i}$ in pc/h):**
$$q_{\text{PCE}, i} = N_{\text{car}}(1.0) + N_{\text{microbus}}(1.5) + N_{\text{bus}}(2.0) + N_{\text{truck}}(2.5) + N_{\text{moto}}(0.4)$$

* **Human Passenger Flow ($P_{\text{pax}, i}$ in persons/h):**
$$P_{\text{pax}, i} = N_{\text{car}}(1.4) + N_{\text{microbus}}(14.0) + N_{\text{bus}}(45.0) + N_{\text{truck}}(1.2) + N_{\text{moto}}(1.2)$$

---

### 3.2 Module 1: Work-Zone & Lane Closure Advisor

When $n_{\text{closed}}$ lanes (where $1 \le n_{\text{closed}} \le 3$) are closed on a 4-lane corridor of base lane capacity $C_{\text{base}} = 2000\text{ pc/h/lane}$:

1. **Merge Friction Factor ($f_{\text{merge}}$):**
$$f_{\text{merge}} = 1.0 - (0.12 \times n_{\text{closed}})$$

2. **Specific Lane Closure Penalty ($f_{\text{lane}}$):**
- Closing Lane 1 (Rightmost lane where heavy trucks & microbuses concentrate): $f_{\text{lane}} = 0.88$.
- Closing Lane 4 (Leftmost high-speed lane): $f_{\text{lane}} = 0.93$.
- Closing Center Lanes (Lane 2 or 3): $f_{\text{lane}} = 0.90$.

3. **Heavy Vehicle Adjustment ($f_{\text{HV}}$):**
$$f_{\text{HV}} = \frac{1}{1 + P_{\text{HV}} \times (2.5 - 1.0)}$$

4. **Effective Work-Zone Capacity ($C_{\text{wz}}$):**
$$C_{\text{wz}} = C_{\text{base}} \times (4 - n_{\text{closed}}) \times f_{\text{merge}} \times f_{\text{lane}} \times f_{\text{HV}}$$

5. **Queue Accumulation & Person-Hours of Delay across Maintenance Window $[t_{\text{start}}, t_{\text{start}} + D)$:**
- Residual queue: $\text{Queue}_{\text{veh}}(t) = \max\left(0, \text{Queue}_{\text{veh}}(t-1) + Q_{\text{PCE}}(t) - C_{\text{wz}}\right)$
- Physical Queue Length in meters:
$$L_{\text{queue}}(t) = \frac{\text{Queue}_{\text{veh}}(t) \times 6.5\text{ m}}{4 - n_{\text{closed}}}$$
- Spillback Risk Flag: `True` if $L_{\text{queue}}(t) \ge D_{\text{upstream\_exit}}$ (default 600m).
- Delay: $d_{\text{wz}} = 12.0 \times ((\text{Demand}/C_{\text{wz}})^3) + (\text{Queue}/C_{\text{wz}}) \times 1800.0$
- Total Person-Hours of Delay ($PHD$): $\sum (\text{Demand} \times d_{\text{wz}} / 3600) \times (\text{Pax}/\text{Demand})$.

6. **Automated Engineering SOP Output:**
- Taper Length: $L_{\text{taper}} = \text{round}(0.62 \times 3.65 \times S_{\text{limit}} \times n_{\text{closed}})$
- Buffer Zone: $\text{round}(2.5 \times S_{\text{limit}})$ meters.
- Directives: Staging tow truck 150m upstream, heavy vehicle diversion if Lane 1/2 closed.

---

### 3.3 Module 2: Intersection Signal Warrant & "What-If" Simulator

Given $Q_{\text{main}}$, $Q_{\text{cross}}$, turning $\%$, heavy $\%$, and U-turn distance:
Compare 4 geometric/control alternatives simultaneously:
1. **Uncontrolled Open Intersection:** 32 conflict points, gap-acceptance delay $d_{\text{open}}$.
2. **Traffic Signal Installation (Webster's Method):** 8 conflict points, $C_{\text{opt}} \in [45, 160]$, green split $g/C$, Webster delay $d_{\text{sig}}$, and 95th percentile queue $Q95_{\text{sig}}$.
3. **Closed Median + Protected U-Turn Corridor:** 4 conflict points, detour travel time penalty $\Delta t_{\text{geo}} = \frac{2 \times D_{\text{uturn}}}{V_{\text{cruise}}}$, weaving delay, delivers continuous mainline flow.
4. **Modern 3-Lane Roundabout:** 8 conflict points, entry capacity $C_{\text{entry}} = 3 \times 1350 \times e^{-0.00075 \times Q_{\text{circ}}}$, circulating flow delay.

---

### 3.4 Module 3: Incident Shockwave & Micro-Friction Predictor

When an incident occurs:
- Upstream arrival flow $q_1$, speed $v_1$, density $k_1 = q_1 / \max(15, v_1)$.
- Bottleneck discharge capacity $q_2$ at jam density $k_{\text{jam}} = 580$ veh/km.
- Backward Shockwave Propagation Speed ($w$ in km/h):
$$w = \left|\frac{q_2 - q_1}{k_{\text{jam}} - k_1}\right|$$
- Countdown to Upstream Exit Blockage ($T_{\text{block}}$ in minutes):
$$T_{\text{block}} = \frac{D_{\text{upstream\_km}}}{w} \times 60$$
- Micro-friction lane-weaving analysis and curb barrier / bay relocation recommendations.

---

### 3.5 Module 4: Dynamic Reversible Lanes & Green Wave Corridor

- Directional split analysis.
- Standard 4+4 vs Dynamic Reversible 5+3 (8,850 PCE/h Inbound capacity).
- Travel time savings % and safety margin for outbound lanes.
- Green Wave Signal Progression Offsets across 5 intersections at 60 km/h: $\Delta t_{\text{offset}, k} = \frac{D_{\text{link}, k}}{V_{\text{target}}}$.
- Pre-arrival emergency queue flush lead time: $T_{\text{flush}} = \frac{L_{\text{queue}}}{8.5} + 18.0\text{ sec}$.

---

## 4. API Endpoints Contract (`backend/app/api/routes.py`)

1. `GET /api/health` -> Service health and active physics engines
2. `GET /api/corridors` -> List pre-seeded corridors
3. `GET /api/corridors/{corridor_id}/telemetry` -> Per-lane hourly breakdown
4. `POST /api/dss/workzone-optimize` -> 24h curve, Top 3 optimal windows, SOP
5. `POST /api/dss/intersection-simulate` -> 4-way decision matrix and winning option
6. `POST /api/dss/shockwave-predict` -> Backward wave speed, exit countdown, 60-min progression
7. `POST /api/dss/reversible-evaluate` -> 4+4 vs 5+3 comparison and Green Wave schedule
8. `POST /api/cv/ingest` -> Real-time YOLO/ByteTrack edge telemetry ingestion