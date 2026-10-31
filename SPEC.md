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

1. **Merge Friction Factor ($f_{\text{merge}}$):** each closed lane adds 6% merge/weaving loss, floored at 0.40:
$$f_{\text{merge}} = \max\left(0.40, 1.0 - 0.06 \times n_{\text{closed}}\right)$$

2. **Lane-Position Factor ($f_{\text{lane}}$):** a 2% penalty only when a median lane (Lane 2 or 3) is closed; otherwise 1.00. Closing Lane 1 gives $2000 \times 3 \times 0.94 = 5{,}640$ PCE/h.

3. **Heavy Vehicle Adjustment ($f_{\text{HV}}$):**
$$f_{\text{HV}} = \frac{1}{1 + P_{\text{HV}} \times (2.5 - 1.0)}$$
It is reported but not applied again, because demand is already in PCE/h.

4. **Effective Work-Zone Capacity ($C_{\text{wz}}$):**
$$C_{\text{wz}} = 2000 \times (4 - n_{\text{closed}}) \times f_{\text{merge}} \times f_{\text{lane}}$$

5. **Storage-Bounded Queue and Person-Hours of Delay across $[t_{\text{start}}, t_{\text{start}} + D)$:**
- Fleet-average PCE: $\overline{\text{PCE}} = 1.125 + 1.3 P_{\text{HV}}$.
- Storage capacity: $N_{\text{store}} = D_{\text{upstream\_exit}} \times n_{\text{open}} / 6.5$ vehicles.
- Queue: $Q(t) = \min(N_{\text{store}}, \max(0, Q(t-1) + Q_{\text{veh}}(t) - C_{\text{veh}}))$. Once storage is full, excess demand is metered/diverted at the upstream exit.
- Physical queue length: $L(t) = \min(D_{\text{exit}}, Q(t) \times 6.5 / n_{\text{open}})$.
- Delay: Little's law on vehicle-hours in queue divided by joining vehicles, plus the work-zone geometric/merge delay, capped at 600 s.
- Spillback: `True` at 95% of storage or queue length.
- Total Person-Hours of Delay ($PHD$): vehicle-hours (including base delay) times passengers per vehicle.

6. **Automated Engineering SOP Output:**
- Taper Length: $L_{\text{taper}} = \text{round}(0.62 \times 3.65 \times S_{\text{limit}} \times n_{\text{closed}})$
- Buffer Zone: $\text{round}(2.5 \times S_{\text{limit}})$ meters.
- Directives: Staging tow truck 150m upstream, heavy vehicle diversion if Lane 1/2 closed.

---

### 3.3 Module 2: Intersection Signal Warrant & "What-If" Simulator

Given $Q_{\text{main}}$, $Q_{\text{cross}}$, turning $\%$, heavy $\%$, and U-turn distance:
Compare 4 geometric/control alternatives simultaneously:
1. **Uncontrolled Open Intersection:** 32 conflict points, 8 approach lanes at 900 veh/h/lane gap acceptance, HCM incremental delay.
2. **Traffic Signal Installation (Webster's Method):** 8 conflict points, $C_{\text{opt}} \in [45, 160]$ s, critical-flow-ratio green splits, 16 s lost time, HCM uniform + incremental delay, 95th percentile queue capped at 500 m.
3. **Closed Median + Protected U-Turn Corridor:** 4 conflict points, detour time $t_{\text{detour}} = 2D_{\text{uturn}}/13.89$, weaving delay, weighted by the diverted share, plus HCM incremental delay.
4. **Modern 3-Lane Roundabout:** 8 conflict points, 8 entry lanes with $C_{\text{entry}} = 1130e^{-0.0007Q_{\text{circ}}/4}\max(0.70,1-0.5P_{\text{HV}})$, HCM incremental delay.

---

### 3.4 Module 3: Incident Shockwave & Micro-Friction Predictor

When an incident occurs:
- Upstream arrival flow $q_1$, speed $v_1$, PCE-consistent density $k_1 = q_1 / \max(15, v_1)$.
- Bottleneck discharge $q_2 = 2000(4-n_{\text{blocked}})\mu_{\text{micro}}\gamma_{\text{type}}$, with incident factors STALL 0.95, COLLISION 0.88, MICROBUS_STOP 0.78.
- Jam density at 6.5 m spacing: $k_{\text{jam}} = (1000/6.5) \times 4$ veh/km.
- Backward shockwave speed, capped at 25 km/h:
$$w = \min\left(25, \frac{q_1 - q_2}{k_{\text{jam,PCE}} - k_{1,\text{PCE}}}\right)$$
- Countdown to upstream exit blockage, capped at 240 min:
$$T_{\text{block}} = \min\left(240, \frac{D_{\text{upstream\_km}}}{w} \times 60\right)$$
- The 60-min trajectory caps queue length at $D_{\text{exit}}$ and vehicles at both excess demand and physical storage.
- Micro-friction lane-weaving analysis and curb barrier / bay relocation recommendations.

---

### 3.5 Module 4: Dynamic Reversible Lanes & Green Wave Corridor

- Directional split analysis.
- Standard 4+4 vs Dynamic Reversible 5+3 (8,850 PCE/h inbound, 5,250 PCE/h outbound).
- Delay is the extra travel time relative to a 75 km/h free-flow trip, capped at 600 s; both travel-time and delay savings come from the same speeds.
- Warrant: split > 68%, standard outbound v/c < 0.45, and reversible outbound v/c < 0.85 (or emergency override).
- Green Wave Signal Progression Offsets across the actual corridor at 60 km/h, with $D_{\text{link}} = D_{\text{corridor}} \times 1000 / N$ (1,700 m for 8.5 km / 5 nodes): $\Delta t_{\text{offset}, k} = (D_k / 16.67) \bmod 90$ s.
- Pre-arrival emergency queue flush uses Little's law and 7.5 m/veh over four lanes, capped by 90% of corridor length: $T_{\text{flush}} = \min(240, L_{\text{queue}}/8.5 + 18)$ s.

### 3.6 Live Canvas Measurement Contract

The browser canvases run independent deterministic IDM/Poisson microsimulations.
They are not SUMO renders and never publish fallback numbers:

- Work-zone flow is counted at the taper over 60 s; delay uses completed-trip
  journey time over 120 s; queue is capped by the corridor storage. The
  analytical planning delay/queue is displayed alongside as a reference.
- Intersection signal KPIs are withheld for one full cycle and 20 trips, then
  averaged over two cycles; U-turn KPIs are withheld for 30 s and 20 trips.
  Each panel shows its HCM/Webster planning delay and queue as a reference.
- During warm-up all measured values show `—`.

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