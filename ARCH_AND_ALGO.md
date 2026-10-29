# Intelligent Traffic Decision Support System (IT-DSS)
## System Architecture & Algorithm Engineering Reference Manual

---

## 1. Executive Architecture Overview

The **Intelligent Traffic Decision Support System (IT-DSS)** is engineered as a deterministic, physics-based decision support platform for highway authorities and traffic management operations rooms. Unlike traditional dashboards that rely on static heuristics or placeholder data, IT-DSS dynamically executes hydrodynamic traffic physics, gap-acceptance queuing theory, and Webster signal timing equations in real time.

```mermaid
graph TD
    subgraph Data & Telemetry Tier
        Seeder[Synthetic Telemetry Generator\n3 Corridors x 4 Lanes x 7d x 24h\n2,016 Baseline Records]
        EdgeCV[YOLOv8/v11 + ByteTrack Edge Nodes\nPOST /api/cv/ingest]
        SQLiteDB[(SQLite Database\ntraffic_dss.db)]
        Seeder -->|Startup Lifespan| SQLiteDB
        EdgeCV -->|Instantaneous Ingestion| SQLiteDB
    end

    subgraph Mathematical Physics Engine Core (backend/app/core/)
        HCM[hcm_math.py\n• PCE Flow Equations\n• Human Occupancy Calculus\n• Work-Zone Capacity Drop\n• MUTCD Geometry & Tapers\n• LoS A-F Grading]
        WZ[workzone_engine.py\n• 168h Maintenance Window Optimizer\n• Residual Queue Recursion\n• Exit Spillback Detection\n• Person-Hours of Delay (PHD)\n• Bilingual SOP Directives]
        INT[intersection_engine.py\n• Uncontrolled Open (32 Conflict Pts)\n• Webster Adaptive Signal (8 Conflict Pts)\n• Protected U-Turn Model (4 Conflict Pts)\n• Modern 3-Lane Roundabout (8 Pts)\n• Multi-Criteria Winning Recommender]
        LWR[shockwave_engine.py\n• Lighthill-Whitham-Richards Hydrodynamics\n• Backward Propagation Wave Velocity\n• Exit Blockage Countdown Timer\n• 60-Min Queue Expansion Timeline\n• Micro-Friction Curb Remediation]
        REV[reversible_engine.py\n• Directional Surge Split Meter\n• Dynamic 4+4 vs 5+3 Reallocation\n• 5-Node Green Wave Signal Progression\n• VIP / Emergency Pre-Arrival Flush Time]

        HCM --> WZ
        HCM --> INT
        HCM --> LWR
        HCM --> REV
    end

    subgraph Application Service Tier (FastAPI :8765)
        Router[API Router: backend/app/api/routes.py]
        SQLiteDB --> Router
        WZ --> Router
        INT --> Router
        LWR --> Router
        REV --> Router
    end

    subgraph Operations Command Center (React 18 + Vite :5199)
        TopBar[TopCommandBar: Corridor Selector | AR/EN Toggle | Radar Clock]
        Sidebar[SidebarNav: 4 DSS Module Switcher]
        
        M1[WorkZoneAdvisor.tsx\n• Recharts 24h Demand vs Capacity Profile\n• Top 3 Optimal Windows vs Worst Window\n• Printable / Copyable Field SOP Drawer]
        M2[IntersectionSimulator.tsx\n• Flow / Turning / Heavy Vehicle Sliders\n• 4-Way Side-by-Side Comparison Matrix\n• Winning Engineering Rationale Banner]
        M3[ShockwavePredictor.tsx\n• Incident Type & Blocked Lanes Selector\n• Shockwave Speed & Red Alert Countdown\n• 60-Minute Queue Growth Graph]
        M4[ReversiblePlanner.tsx\n• Inbound/Outbound Surge Sliders\n• 4+4 vs 5+3 Travel Time Savings %\n• 5-Intersection Progression Offsets Table]

        Canvas1[HighwayCanvas.tsx\n60fps HTML5 4-Lane Canvas\nClass-Coded Particles, Taper Cones, Merging & Shockwave Queues]
        Canvas2[IntersectionCanvas.tsx\nSplit-Screen 60fps Comparator\nSignal Stop-and-Go vs Protected U-Turn Continuous Flow]

        TopBar --> Sidebar
        Sidebar --> M1 & M2 & M3 & M4
        M1 --> Canvas1
        M3 --> Canvas1
        M2 --> Canvas2
    end

    Router <-->|JSON REST APIs / Vite Proxy /api| M1 & M2 & M3 & M4
```

---

## 2. Mathematical Formulations & Algorithms

### 2.1 Passenger Car Equivalents (PCE) & Human Occupancy

Standard traffic counts underestimate transit buses and overloaded microbuses. IT-DSS homogenizes mixed traffic into equivalent passenger cars ($q_{\text{PCE}}$) and passenger throughput ($P_{\text{pax}}$).

#### Mathematical Formulations:
For any corridor lane $i \in \{1, 2, 3, 4\}$ at hour $h$:

$$q_{\text{PCE}, i} = N_{\text{car}}(1.0) + N_{\text{microbus}}(1.5) + N_{\text{bus}}(2.0) + N_{\text{truck}}(2.5) + N_{\text{moto}}(0.4)$$

$$P_{\text{pax}, i} = N_{\text{car}}(1.4) + N_{\text{microbus}}(14.0) + N_{\text{bus}}(45.0) + N_{\text{truck}}(1.2) + N_{\text{moto}}(1.2)$$

* **Heavy Vehicle Ratio ($P_{\text{HV}}$):**
  $$P_{\text{HV}} = \frac{N_{\text{bus}} + N_{\text{truck}}}{\max\left(1, \sum N_k\right)}$$
* **Heavy Vehicle Adjustment Factor ($f_{\text{HV}}$):**
  $$f_{\text{HV}} = \frac{1}{1.0 + P_{\text{HV}} \times (E_{\text{HV}} - 1.0)} \quad \text{where } E_{\text{HV}} = 2.5$$

---

### 2.2 Module 1: Work-Zone Optimization & Queue Dynamics

#### Step 1: Work-Zone Effective Capacity Reduction
When $n_{\text{closed}}$ lanes are blocked out of $N=4$ base lanes (base capacity $C_{\text{base}} = 2,000\text{ PCE/h/lane}$):

1. **Merge Turbulence Friction Factor ($f_{\text{merge}}$):**
   $$f_{\text{merge}} = \max\left(0.40, 1.0 - 0.12 \times n_{\text{closed}}\right)$$

2. **Specific Lane Closure Penalty ($f_{\text{lane}}$):**
   * **Lane 1 Closed** (Rightmost slow lane where heavy freight & microbuses load/unload): Forces heavy vehicles to cut across middle lanes:
     $$f_{\text{lane}} = 0.88$$
   * **Lane 2 or Lane 3 Closed** (Center lanes): Causes bilateral merging friction from both flanks:
     $$f_{\text{lane}} = 0.90$$
   * **Lane 4 Closed** (Leftmost high-speed lane): High collision risk requiring extended warning taper:
     $$f_{\text{lane}} = 0.93$$

3. **Effective Hourly Work-Zone Capacity ($C_{\text{wz}}$):**
   $$C_{\text{wz}} = C_{\text{base}} \times (4 - n_{\text{closed}}) \times f_{\text{merge}} \times f_{\text{lane}} \times f_{\text{HV}}$$

#### Step 2: Hourly Queue Accumulation & Delay Recursion
For a candidate maintenance window starting at $t_0$ spanning duration $D$ hours:
Initialize residual vehicular queue $Q_{\text{queue}}(t_0 - 1) = 0.0$.

For each hour $t \in [t_0, t_0 + D)$:
1. **Vehicular Queue Carryover:**
   $$Q_{\text{queue}}(t) = \max\left(0.0, Q_{\text{queue}}(t-1) + Q_{\text{PCE}}(t) - C_{\text{wz}}\right)$$

2. **Physical Queue Length ($L_{\text{queue}}$ in meters):**
   $$L_{\text{queue}}(t) = \frac{Q_{\text{queue}}(t) \times 6.5\text{ m}}{4 - n_{\text{closed}}}$$
   *(where $6.5\text{ m}$ is the average bumper-to-bumper queue spacing per vehicle)*

3. **Spillback Flag:**
   $$\text{Spillback}(t) = \begin{cases} 
   \text{True} & \text{if } L_{\text{queue}}(t) \ge D_{\text{upstream\_exit}} \\ 
   \text{False} & \text{otherwise} 
   \end{cases}$$

4. **Delay per Vehicle ($d_{\text{wz}}$ in seconds/vehicle):**
   $$d_{\text{wz}}(t) = 12.0 \times \left(\frac{Q_{\text{PCE}}(t)}{\max(1, C_{\text{wz}})}\right)^3 + \left(\frac{Q_{\text{queue}}(t)}{\max(1, C_{\text{wz}})}\right) \times 1800.0$$

5. **Person-Hours of Delay ($PHD$):**
   $$\text{PHD}(t) = \left(\frac{Q_{\text{PCE}}(t) \times d_{\text{wz}}(t)}{3600.0}\right) \times \left(\frac{P_{\text{pax}}(t)}{\max(1, Q_{\text{PCE}}(t))}\right)$$

#### Step 3: 168-Hour Window Optimization Algorithm
```python
def optimize_schedule(demands_168h, passengers_168h, D, C_wz, D_exit):
    window_scores = []
    for start_h in range(168):
        window_phd = 0.0
        max_q = 0.0
        has_spillback = False
        queue = 0.0
        
        for step in range(D):
            h = (start_h + step) % 168
            queue = max(0.0, queue + demands_168h[h] - C_wz)
            q_len = (queue * 6.5) / open_lanes
            max_q = max(max_q, q_len)
            if q_len >= D_exit:
                has_spillback = True
            
            d_veh = 12.0 * ((demands_168h[h] / C_wz) ** 3) + (queue / C_wz) * 1800.0
            window_phd += (demands_168h[h] * d_veh / 3600.0) * (passengers_168h[h] / demands_168h[h])
            
        penalty = 5000.0 if has_spillback else 0.0
        fitness = window_phd + penalty
        window_scores.append((fitness, start_h, window_phd, max_q, has_spillback))
        
    window_scores.sort(key=lambda x: x[0])
    return window_scores[:3], window_scores[-1]  # Top 3 Optimal vs Worst Window
```

#### Step 4: Automated MUTCD Geometric Design Calculus
* **Warning Taper Length ($L_{\text{taper}}$ in meters):**
  $$L_{\text{taper}} = \text{round}\left(0.62 \times W_{\text{lane}} \times S_{\text{limit}} \times n_{\text{closed}}\right) \quad \text{where } W_{\text{lane}} = 3.65\text{ m}$$
* **Longitudinal Buffer Space ($L_{\text{buffer}}$ in meters):**
  $$L_{\text{buffer}} = \text{round}\left(2.5 \times S_{\text{limit}}\right)$$
* **Reduced Speed Limit:** $S_{\text{wz}} = \max\left(40.0, S_{\text{limit}} - 20.0\right)\text{ km/h}$.
* **Tow Truck Staging Position:** Exactly $150\text{ m}$ upstream of taper start.

---

### 2.3 Module 2: Intersection Signal Warrant & "What-If" Geometry Engine

Evaluates 4 geometric alternatives under identical traffic demands: $Q_{\text{main}}$, $Q_{\text{cross}}$, turning fraction $P_{\text{turn}}$, and heavy vehicle fraction $P_{\text{HV}}$.

| Alternative | Conflict Points | Governing Physics Model | Key Characteristic |
| :--- | :---: | :--- | :--- |
| **1. Uncontrolled Open** | **32** | Gap Acceptance Capacity Formula | Baseline, severe right-angle crash risk |
| **2. Webster Traffic Signal** | **8** | Webster Optimal Cycle & Saturation Delay | Signalized stop-and-go waves |
| **3. Protected U-Turn Corridor** | **4** | Detour Geometry + Weaving Friction | Continuous mainline throughput (Egyptian Axis Model) |
| **4. 3-Lane Roundabout** | **8** | Exponential Circulating Flow Gap Model | Self-regulating entry capacity |

#### Alternative 1: Uncontrolled Open Intersection
* **Capacity:**
  $$C_{\text{open}} = \frac{3600}{1.0 + P_{\text{turn}} \times 1.2 + P_{\text{HV}} \times 0.8}$$
* **Average Delay ($d_{\text{open}}$ in seconds):**
  $$d_{\text{open}} = 9.5 + 28.0 \times \left(\frac{Q_{\text{main}} + Q_{\text{cross}}}{C_{\text{open}}}\right)^{2.6}$$
* **95th Percentile Queue ($Q95_{\text{open}}$ in meters):**
  $$Q95_{\text{open}} = \max\left(15.0, \frac{Q_{\text{main}} + Q_{\text{cross}}}{3600} \times d_{\text{open}} \times 6.5 \times 0.45\right)$$

#### Alternative 2: Adaptive 4-Phase Traffic Signal (Webster's Model)
* **Saturation Flows ($S_{\text{main}}, S_{\text{cross}}$ in veh/h):**
  $$S_{\text{main}} = 1900 \times 3 \times \left(1.0 - \frac{P_{\text{HV}}}{2.0}\right), \quad S_{\text{cross}} = 1800 \times 2 \times \left(1.0 - \frac{P_{\text{HV}}}{2.0}\right)$$
* **Critical Flow Ratio ($Y$):**
  $$Y = \min\left(0.94, \frac{0.55 \cdot Q_{\text{main}}}{S_{\text{main}}} + \frac{0.65 \cdot Q_{\text{cross}}}{S_{\text{cross}}} + \frac{P_{\text{turn}}}{2.50}\right)$$
* **Total Lost Time per Cycle:** $L = 16.0\text{ sec}$.
* **Optimal Cycle Length ($C_{\text{opt}}$):**
  $$C_{\text{opt}} = \text{clamp}\left(\frac{1.5 L + 5.0}{1.0 - Y}, 45.0, 160.0\right)$$
* **Effective Mainline Green Ratio ($g/C$):**
  $$g/C = \max\left(0.25, \left(1.0 - \frac{L}{C_{\text{opt}}}\right) \times \frac{Q_{\text{main}}}{Q_{\text{main}} + Q_{\text{cross}}}\right)$$
* **Saturation Degree ($X$):**
  $$X = \frac{Q_{\text{main}} + Q_{\text{cross}}}{\max\left(1.0, S_{\text{main}} \cdot (g/C) + S_{\text{cross}} \cdot (1 - g/C - L/C_{\text{opt}})\right)}$$
* **Uniform + Incremental Delay ($d_{\text{sig}}$ in seconds):**
  $$d_{\text{sig}} = \frac{0.5 \cdot C_{\text{opt}} \cdot (1 - g/C)^2}{1.0 - \min(0.98, X) \cdot (g/C)} + 45.0 \times \max(0.0, X - 0.85) \times 120.0$$
* **95th Percentile Queue ($Q95_{\text{sig}}$ in meters):**
  $$Q95_{\text{sig}} = \left(\frac{Q_{\text{main}}}{3600} \cdot C_{\text{opt}} \cdot (1 - g/C) \cdot \frac{6.5}{3.0}\right) \times \left(1.0 + \max(0.0, X - 0.75) \cdot 2.2\right)$$

#### Alternative 3: Closed Median + Protected U-Turn Corridor (Egyptian Axis Model)
Direct cross-movements are physically barred by a solid concrete median barrier, routing traffic through dedicated deceleration slip lanes into an upstream protected U-turn bay.
* **Diverted Volume Ratio ($P_{\text{div}}$):**
  $$P_{\text{div}} = \frac{Q_{\text{cross}} + Q_{\text{main}} \cdot P_{\text{turn}}}{Q_{\text{main}} + Q_{\text{cross}}}$$
* **Geometric Detour Time ($t_{\text{detour}}$ in seconds at cruise speed $50\text{ km/h} = 13.89\text{ m/s}$):**
  $$t_{\text{detour}} = \frac{2.0 \times D_{\text{uturn}}}{13.89}$$
* **Merging Weaving Friction ($d_{\text{weave}}$ in seconds):**
  $$d_{\text{weave}} = 6.0 + 14.0 \times \left(\frac{Q_{\text{main}} + Q_{\text{cross}}}{6800.0}\right)^{2.1}$$
* **Weighted Average Delay ($d_{\text{uturn}}$):**
  $$d_{\text{uturn}} = (P_{\text{div}} \times t_{\text{detour}} \times 0.55) + d_{\text{weave}}$$
* **Mainline Queue ($Q95_{\text{uturn}}$):**
  $$Q95_{\text{uturn}} = \max(12.0, d_{\text{uturn}} \times 1.4)$$

#### Alternative 4: Modern 3-Lane Roundabout
* **Circulating Volume ($Q_{\text{circ}}$ in veh/h):**
  $$Q_{\text{circ}} = 0.42 \cdot Q_{\text{main}} + 0.65 \cdot Q_{\text{cross}} \cdot (1.0 + P_{\text{turn}})$$
* **Entry Capacity ($C_{\text{round}}$ in veh/h):**
  $$C_{\text{round}} = 3.0 \times 1350.0 \times e^{-0.00075 \cdot Q_{\text{circ}}}$$
* **Delay ($d_{\text{round}}$ in seconds):**
  $$d_{\text{round}} = 11.0 + \frac{3600.0}{C_{\text{round}}} + 65.0 \times \left(\max(0.0, \frac{Q_{\text{total}}}{C_{\text{round}}} - 0.75)\right)^{2.2} \times 100.0$$

#### Level of Service (LoS) Grading Function:
```python
def calculate_los(delay_sec, vc_ratio):
    if vc_ratio > 1.0 or delay_sec > 80.0: return "F"
    elif delay_sec <= 10.0 and vc_ratio <= 0.60: return "A"
    elif delay_sec <= 20.0 and vc_ratio <= 0.70: return "B"
    elif delay_sec <= 35.0 and vc_ratio <= 0.80: return "C"
    elif delay_sec <= 55.0 and vc_ratio <= 0.90: return "D"
    elif delay_sec <= 80.0 and vc_ratio <= 1.00: return "E"
    return "F"
```

---

### 2.4 Module 3: Incident Hydrodynamics & Shockwave Propagation

When an accident, breakdown, or illegal microbus stop obstructs the roadway at position $x=0$, a boundary discontinuity occurs between upstream arrival traffic (State 1) and bottleneck discharge traffic (State 2).

```text
    State 1: Upstream Flow             State 2: Bottleneck Discharge
  ====================================|====================================
  q1 = Arrival Flow (PCE/h)           | q2 = Restricted Capacity (PCE/h)
  v1 = Upstream Speed (km/h)          | Blocked Lanes = 1..3
  k1 = q1 / v1 (veh/km)               | Micro-friction weaving penalty
  ====================================|====================================
               <--- Backward Shockwave Speed (w in km/h) <---
```

#### Step 1: Upstream State 1
$$q_1 = \text{Hourly Arrival PCE Flow}, \quad v_1 = \max(15.0, \text{Arrival Speed km/h})$$
$$\text{Upstream Density: } k_1 = \frac{q_1}{v_1} \text{ (veh/km across 4 lanes)}$$

#### Step 2: Bottleneck State 2
Bottleneck capacity is reduced by blocked lanes, incident severity, and microbus lateral weaving friction ($W_{\text{idx}} \in [0.0, 1.0]$):
$$\mu_{\text{micro}} = \max\left(0.68, 1.0 - 0.32 \times W_{\text{idx}}\right)$$

$$\gamma_{\text{incident}} = \begin{cases} 
0.95 & \text{Stall / Breakdown} \\ 
0.88 & \text{Multi-Vehicle Collision} \\ 
0.78 & \text{Informal Microbus Double-Parking} 
\end{cases}$$

$$q_2 = 2000.0 \times (4 - n_{\text{blocked}}) \times \mu_{\text{micro}} \times \gamma_{\text{incident}}$$

#### Step 3: Lighthill-Whitham-Richards (LWR) Shockwave Velocity
Jam density across 4 lanes ($145\text{ veh/km/lane}$):
$$k_{\text{jam}} = 145.0 \times 4 = 580.0\text{ veh/km}$$

If $q_1 > q_2$, excess demand accumulates into a backward shockwave propagating upstream against the flow of traffic:
$$w = \left|\frac{q_2 - q_1}{\max(10.0, k_{\text{jam}} - k_1)}\right| \quad (\text{km/h})$$

If $q_1 \le q_2$, demand is absorbed without backpressure ($w = 0.0\text{ km/h}$).

#### Step 4: Upstream Exit Blockage Countdown ($T_{\text{block}}$)
Given the distance to the upstream on-ramp/off-ramp interchange $D_{\text{exit}}$ (in meters):
$$T_{\text{block}} = \begin{cases} 
\left(\frac{D_{\text{exit}} / 1000.0}{w}\right) \times 60.0 & \text{if } w > 0 \\ 
999.0 & \text{if } w = 0 
\end{cases} \quad (\text{minutes})$$

An imminent spillback alert (`RED ALERT`) triggers whenever $T_{\text{block}} \le 20.0\text{ minutes}$.

#### Step 5: 60-Minute Queue Growth Trajectory
Evaluated at 5-minute increments for $t \in \{0, 5, 10, \dots, 60\}$:
$$L_{\text{queue}}(t) = \left(w \times \frac{t}{60.0}\right) \times 1000.0\text{ meters}$$
$$N_{\text{veh\_queued}}(t) = \max\left(0, \text{round}\left((q_1 - q_2) \times \frac{t}{60.0}\right)\right)$$
$$V_{\text{upstream}}(t) = \max\left(10.0, v_1 - \left(\frac{L_{\text{queue}}(t)}{D_{\text{exit}}}\right) \times (v_1 - 12.0)\right)\text{ km/h}$$

---

### 2.5 Module 4: Dynamic Reversible Lanes (5+3) & Green Wave Progression

#### Step 1: Directional Surge Evaluation
$$Q_{\text{total}} = Q_{\text{inbound}} + Q_{\text{outbound}}$$
$$\text{Directional Split: } \text{Split}_{\text{in}} = \left(\frac{Q_{\text{inbound}}}{\max(1, Q_{\text{total}})}\right) \times 100.0\%$$

* **Standard 4+4 Allocation:**
  $$C_{\text{in}} = 7200\text{ PCE/h}, \quad C_{\text{out}} = 7200\text{ PCE/h}$$
* **Dynamic Reversible 5+3 Allocation:**
  $$C_{\text{in, rev}} = 8850\text{ PCE/h}, \quad C_{\text{out, rev}} = 5250\text{ PCE/h}$$
* **Reversible Activation Warrant:**
  $$\text{Warrant} = \left(\text{Split}_{\text{in}} \ge 65.0\% \text{ and } \frac{Q_{\text{outbound}}}{5250} < 0.85\right) \text{ or } \text{EmergencyMode}$$

#### Step 2: Speed-Flow Degradation Calculus
For configuration $k \in \{\text{Standard}, \text{Reversible}\}$:
$$V_{\text{in}}(k) = \max\left(12.0, 75.0 \times \left(1.0 - 0.75 \times \max(0.0, \frac{Q_{\text{inbound}}}{C_{\text{in}}(k)} - 0.65)\right)\right)\text{ km/h}$$
$$t_{\text{travel}}(k) = \left(\frac{D_{\text{corridor\_km}}}{V_{\text{in}}(k)}\right) \times 60.0\text{ minutes}$$

$$\text{Travel Time Savings: } \Delta t_{\%} = \max\left(0.0, \frac{t_{\text{travel}}(\text{Standard}) - t_{\text{travel}}(\text{Reversible})}{t_{\text{travel}}(\text{Standard})} \times 100.0\right)$$

#### Step 3: Green Wave Signal Progression Offsets
Calculates dynamic signal progression offsets across 5 synchronized intersections at target arterial progression speed $V_{\text{prog}} = 60\text{ km/h} = 16.67\text{ m/s}$:
* **Cycle Length:** $C_{\text{cycle}} = 90.0\text{ sec}$.
* **Green Window:** $G_{\text{window}} = 52.0\text{ sec}$.
* **Intersection Offset for Node $k$ at distance $D_k$ meters:**
  $$\Delta t_{\text{offset}, k} = \left(\frac{D_k}{16.67}\right) \pmod{C_{\text{cycle}}}\text{ seconds}$$

#### Step 4: Emergency Pre-Arrival Queue Flush Time
Lead time needed by operations room to flush stationary queues before an incoming emergency/VIP convoy arrives:
$$T_{\text{flush}} = \left(\frac{L_{\text{queue}}}{8.5\text{ m/s}}\right) + 18.0\text{ seconds}$$

---

## 3. Microscopic Canvas Simulation Physics (60fps)

Both HTML5 Canvases ([HighwayCanvas.tsx](file:///d:/projects/traffic_dss/frontend/src/components/simulation/HighwayCanvas.tsx) and [IntersectionCanvas.tsx](file:///d:/projects/traffic_dss/frontend/src/components/simulation/IntersectionCanvas.tsx)) execute customized, lightweight microscopic particle physics on every animation frame:

1. **Intelligent Driver Car-Following Model:**
   $$a_{\text{follow}} = k_{\text{accel}} \cdot (v_{\text{target}} - v) - k_{\text{brake}} \cdot \max\left(0.0, d_{\text{safe}} - \Delta x_{\text{lead}}\right)$$
2. **Lane-Changing Merge Logic (Work-Zone Taper):**
   When vehicle coordinate $x \in [X_{\text{taper}} - 100\text{px}, X_{\text{taper}}]$, vehicles in closed lanes scan adjacent open lanes for gap clearance ($\Delta x > 25\text{px}$) and interpolate their lateral coordinate $y(t) \to y_{\text{target}}$ smoothly over 20 frames.
3. **Microbus Erratic Weaving Model:**
   Microbus particles execute stochastic lateral jumps based on $W_{\text{idx}}$:
   $$P_{\text{weave}} = W_{\text{idx}} \times 0.015 \text{ per frame}$$
4. **Deceleration & Brake Light Glow:**
   When lead gap $< 35\text{px}$, particle sets `isBraking = true`, drawing a dynamic red radial shadow glow (`#ef4444`) on the rear corners.

---

## 4. REST API Endpoint Specifications

All endpoints run on FastAPI backend port **`8765`** and are automatically documented at `http://localhost:8765/docs`.

### 1. `GET /api/health`
* **Purpose:** System heartbeat and verified active mathematical engine inventory.
* **Response:**
  ```json
  {
    "status": "ONLINE",
    "service": "Intelligent Traffic Decision Support System (IT-DSS)",
    "version": "1.0.0-production",
    "engines": ["HCM-WorkZone", "Webster-Intersection", "LWR-Shockwave", "Dynamic-Reversible"]
  }
  ```

### 2. `GET /api/corridors`
* **Purpose:** Retrieve all pre-seeded Egyptian arterial corridors with geometric attributes.
* **Response:** Array of `CorridorSummary` objects (`corridor_26july`, `corridor_ring`, `corridor_salah_salem`).

### 3. `GET /api/corridors/{id}/telemetry?day_of_week={0-6}`
* **Purpose:** Hourly 24h per-lane breakdown of traffic volumes, PCE, passenger counts, average speed, and weaving index.

### 4. `POST /api/dss/workzone-optimize`
* **Request:**
  ```json
  {
    "corridor_id": "corridor_26july",
    "closed_lanes": [1],
    "duration_hours": 4,
    "day_of_week": 0
  }
  ```
* **Output:** 24h demand vs capacity curves, Top 3 ranked optimal maintenance windows, worst window, and bilingual MUTCD field SOP.

### 5. `POST /api/dss/intersection-simulate`
* **Request:**
  ```json
  {
    "main_flow": 3400.0,
    "cross_flow": 850.0,
    "turning_pct": 18.0,
    "heavy_pct": 12.0,
    "uturn_distance_m": 450.0
  }
  ```
* **Output:** Side-by-side performance matrix for Open, Signal, U-Turn Corridor, and Roundabout, with delay, 95th queue, conflict points, LoS grade, and winning recommendation.

### 6. `POST /api/dss/shockwave-predict`
* **Request:**
  ```json
  {
    "corridor_id": "corridor_26july",
    "hour": 8,
    "blocked_lanes": 2,
    "incident_type": "COLLISION",
    "weaving_index": 0.45
  }
  ```
* **Output:** Backward shockwave speed ($w$), time until upstream exit blocked ($T_{\text{block}}$), 60-min queue expansion trajectory, and micro-friction curb remedies.

### 7. `POST /api/dss/reversible-evaluate`
* **Request:**
  ```json
  {
    "corridor_id": "corridor_26july",
    "inbound_flow": 6600.0,
    "outbound_flow": 2100.0,
    "corridor_length_km": 8.5,
    "emergency_mode": false
  }
  ```
* **Output:** 4+4 vs 5+3 comparison metrics, travel time savings %, and 5-intersection Green Wave signal progression schedule.

### 8. `POST /api/cv/ingest`
* **Purpose:** Live webhook ingestion for YOLOv8/v11 + ByteTrack edge camera nodes.
* **Request:**
  ```json
  {
    "camera_id": "CAM_OCT_04",
    "corridor_id": "corridor_26july",
    "lanes": [
      {
        "lane_number": 1,
        "count_cars": 25,
        "count_microbus": 15,
        "count_buses": 4,
        "count_trucks": 8,
        "count_motorcycles": 5,
        "avg_speed_kmh": 52.0,
        "lane_weaving_index": 0.45
      }
    ]
  }
  ```

---

## 5. Bilingual Dictionary Architecture

Localization is built natively without third-party i18n overhead in [translations.ts](file:///d:/projects/traffic_dss/frontend/src/i18n/translations.ts). Toggling the language from the top bar:
1. Dynamically toggles `document.documentElement.dir = 'rtl' | 'ltr'`.
2. Sets `document.documentElement.lang = 'ar' | 'en'`.
3. Flips layout grid directions, flex containers, and text alignments.
4. Updates all chart labels, KPI units, and printable SOP documentation.
