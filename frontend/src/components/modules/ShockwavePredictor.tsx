import React, { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Zap, AlertOctagon, Timer, ShieldAlert, Sparkles, Sliders, Loader2 } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { HighwayCanvas } from '../simulation/HighwayCanvas';
import {
  ShockwaveResponse,
  predictShockwaveAPI,
} from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface ShockwavePredictorProps {
  corridorId: string;
  language: Language;
}

export const ShockwavePredictor: React.FC<ShockwavePredictorProps> = ({
  corridorId,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const engineMode = 'analytical' as const;
  const [incidentType, setIncidentType] = useState<string>('COLLISION');
  const [blockedLanes, setBlockedLanes] = useState<number>(2);
  const [weavingIndex, setWeavingIndex] = useState<number>(0.45);
  const [incidentHour, setIncidentHour] = useState<number>(8);
  const [incidentDay, setIncidentDay] = useState<number>(0);
  const [data, setData] = useState<ShockwaveResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const runPrediction = async () => {
    setLoading(true);
    try {
      const res = await predictShockwaveAPI({
        corridor_id: corridorId,
        hour: incidentHour,
        day_of_week: incidentDay,
        blocked_lanes: blockedLanes,
        incident_type: incidentType,
        weaving_index: weavingIndex,
        engine_mode: engineMode,
        simulation_duration_sec: 60,
      });
      setData(res);
    } catch (err) {
      console.error(err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runPrediction();
  }, [corridorId, incidentHour, incidentDay, incidentType, blockedLanes, weavingIndex]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
            <Zap className="w-6 h-6 text-rose-500" />
            {t.sw_title}
            {loading && <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />}
          </h2>
          <p className="text-xs text-slate-400 mt-1">{t.sw_subtitle}</p>
        </div>
      </div>

      {/* Incident Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Incident Type */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-2 block">
            {t.sw_incident_type}
          </label>
          <div className="space-y-1.5 mt-2">
            {[
              { id: 'COLLISION', labelEn: 'Multi-Vehicle Collision', labelAr: 'حادث تصادم متعدد', color: 'rose' },
              { id: 'STALL', labelEn: 'Vehicle Breakdown / Stall', labelAr: 'تعطل مركبة مفاجئ', color: 'amber' },
              { id: 'MICROBUS_STOP', labelEn: 'Informal Microbus Stop', labelAr: 'توقف عشوائي للميكروباص', color: 'cyan' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setIncidentType(item.id)}
                className={`w-full text-start px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                  incidentType === item.id
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {isAr ? item.labelAr : item.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Blocked Lanes */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-2 block">
            {t.sw_blocked_lanes}
          </label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {[1, 2, 3].map((num) => (
              <button
                key={num}
                onClick={() => setBlockedLanes(num)}
                className={`py-3 rounded-lg text-xs font-mono font-bold border transition ${
                  blockedLanes === num
                    ? 'bg-rose-500 text-slate-950 border-rose-400 font-extrabold shadow-lg shadow-rose-500/20'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {num} {isAr ? 'حارة' : 'Lanes'}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-500 block mt-2">
            {isAr
              ? `يتبقى ${4 - blockedLanes} حارات مفتوحة من أصل 4`
              : `${4 - blockedLanes} open lanes remaining out of 4`}
          </span>
        </div>

        {/* Microbus Weaving Slider */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300 flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              {t.sw_weaving_slider}
            </span>
            <span className="font-mono font-bold text-cyan-400">{weavingIndex}</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={1.0}
            step={0.05}
            value={weavingIndex}
            onChange={(e) => setWeavingIndex(parseFloat(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none mt-2"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
            <span>0.0 (Smooth)</span>
            <span>0.5 (Normal)</span>
            <span>1.0 (Chaotic Weaving)</span>
          </div>
        </div>

        {/* Incident Time-of-Day */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300 flex items-center gap-1">
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              {isAr ? 'توقيت وقوع الحادث' : 'Incident Hour of Day'}
            </span>
            <span className="font-mono font-bold text-amber-400">
              {incidentHour.toString().padStart(2, '0')}:00
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={23}
            step={1}
            value={incidentHour}
            onChange={(e) => setIncidentHour(parseInt(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none mt-2"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
            <span>00:00</span>
            <span>08:00</span>
            <span>16:00</span>
            <span>23:00</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            {isAr
              ? 'يُحسب الطلب وسرعة الوصول من بيانات الساعة المحددة'
              : 'Arrival flow and speed are drawn from the selected hour'}
          </span>
        </div>

        {/* Incident Day of Week */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-2 block">
            {isAr ? 'يوم وقوع الحادث' : 'Incident Day of Week'}
          </label>
          <select
            value={incidentDay}
            onChange={(e) => setIncidentDay(parseInt(e.target.value))}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          >
            {(isAr
              ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
              : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            ).map((dayName, idx) => (
              <option key={idx} value={idx}>
                {dayName}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-slate-500 block mt-2">
            {isAr
              ? 'يُستخدم ملف المرور الأسبوعي للتحقق من الذروة'
              : 'Uses the 7-day telemetry profile for peak validation'}
          </span>
        </div>
      </div>



      {/* Critical Tactical Gauge Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Urgent Countdown Timer */}
          <div
            className={`p-5 rounded-xl border relative overflow-hidden shadow-2xl ${
              data.is_spillback_imminent
                ? 'bg-rose-950/40 border-rose-500/60 text-rose-300'
                : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-rose-500 animate-pulse" />
                {t.sw_countdown_label}
              </span>
              {data.is_spillback_imminent && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500 text-slate-950 uppercase animate-ping">
                  CRITICAL
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-4xl font-extrabold font-mono text-rose-400">
                {data.time_to_block_minutes < 999 ? `${data.time_to_block_minutes}` : '∞'}
              </span>
              <span className="text-sm font-semibold text-slate-400">
                {t.sw_countdown_unit}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {isAr
                ? `المسافة حتى المخرج السابق: ${data.upstream_exit_distance_m} متر`
                : `Distance to Upstream Exit: ${data.upstream_exit_distance_m}m`}
            </p>
          </div>

          {/* Shockwave Speed Gauge */}
          <KpiCard
            title={t.sw_shockwave_speed}
            value={data.backward_shockwave_speed_kmh}
            unit="km/h"
            status={data.backward_shockwave_speed_kmh > 15 ? 'critical' : 'warning'}
            description={isAr ? 'سرعة ارتداد الطابور للخلف' : 'Backward wave velocity'}
          />

          {/* Bottleneck Capacity vs Arrival */}
          <KpiCard
            title={isAr ? 'سعة عنق الزجاجة' : 'Bottleneck Capacity'}
            value={data.bottleneck_capacity_pce}
            unit="PCE/h"
            status="normal"
            description={isAr ? `التدفق الواصل: ${data.arrival_flow_pce}` : `Arrival flow: ${data.arrival_flow_pce} PCE/h`}
          />
        </div>
      )}

      {/* Live Microscopic Highway Simulation of Incident Shockwave */}
      {data && (
        <HighwayCanvas
          closedLanes={
            blockedLanes === 1
              ? [1]
              : blockedLanes === 2
              ? [1, 2]
              : [1, 2, 3]
          }
          speedLimitKmh={80}
          demandPce={Math.round(data.arrival_flow_pce)}
          capacityPce={Math.round(data.bottleneck_capacity_pce)}
          weavingIndex={weavingIndex}
          heavyPct={14}
          workzoneSpeedKmh={40}
          storageM={data.upstream_exit_distance_m}
          scenarioLabel={
            isAr
              ? `محاكاة ميكروسكوبية حية للحظر: ${data.incident_type} (${blockedLanes} حارات مغلقة — سرعة موجة الصدمة ${data.backward_shockwave_speed_kmh} كم/س)`
              : `Live Incident Micro-Simulation: ${data.incident_type} (${blockedLanes} Blocked Lanes — Shockwave ${data.backward_shockwave_speed_kmh} km/h)`
          }
          planningQueueM={
            data.queue_progression[data.queue_progression.length - 1]?.queue_length_m
          }
          language={language}
        />
      )}

      {/* 60-Minute Queue Progression Growth Chart */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-bold text-slate-100">{t.sw_queue_growth}</h3>
            <span className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
              <AlertOctagon className="w-3.5 h-3.5" />
              {isAr
                ? `حد الامتداد الحرج (المخرج السابق): ${data.upstream_exit_distance_m} متر`
                : `Critical Spillback Threshold: ${data.upstream_exit_distance_m}m`}
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.queue_progression} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="shockwaveGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="elapsed_minutes"
                  stroke="#64748b"
                  tickFormatter={(m) => `T+${m}m`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#090d16',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <ReferenceLine
                  y={data.upstream_exit_distance_m}
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{
                    value: isAr ? 'المخرج السابق مغلق' : 'Upstream Exit Blocked',
                    fill: '#f87171',
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="queue_length_m"
                  stroke="#f43f5e"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#shockwaveGrad)"
                  name={isAr ? 'طول طابور التكدس (م)' : 'Physical Queue Length (m)'}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Engineering Micro-Friction Remedy */}
      {data && (
        <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-cyan-300">
              {t.sw_micro_friction_box}
            </h3>
          </div>
          <p className="text-xs text-slate-200 bg-slate-950 p-3 rounded-lg border border-slate-800 leading-relaxed">
            {isAr ? data.sop.micro_friction_remedy_ar : data.sop.micro_friction_remedy_en}
          </p>

          <div className="mt-4 space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {isAr ? 'إجراءات السيطرة الفورية الميدانية:' : 'Immediate Incident Containment Directives:'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {(isAr ? data.sop.containment_actions_ar : data.sop.containment_actions_en).map((action, i) => (
                <div key={i} className="flex items-start gap-2 bg-slate-950 p-2.5 rounded border border-slate-800">
                  <ShieldAlert className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
