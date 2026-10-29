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
import { Construction, AlertTriangle, CheckCircle2, Clock, Calendar, Layers } from 'lucide-react';
import { HighwayCanvas } from '../simulation/HighwayCanvas';
import { KpiCard } from '../common/KpiCard';
import { SopActionCard } from '../common/SopActionCard';
import { WorkZoneResponse, optimizeWorkZoneAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface WorkZoneAdvisorProps {
  corridorId: string;
  speedLimitKmh: number;
  language: Language;
}

export const WorkZoneAdvisor: React.FC<WorkZoneAdvisorProps> = ({
  corridorId,
  speedLimitKmh,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [closedLanes, setClosedLanes] = useState<number[]>([1]);
  const [durationHours, setDurationHours] = useState<number>(4);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<WorkZoneResponse | null>(null);

  const toggleLane = (laneNum: number) => {
    if (closedLanes.includes(laneNum)) {
      if (closedLanes.length > 1) {
        setClosedLanes(closedLanes.filter((l) => l !== laneNum));
      }
    } else {
      if (closedLanes.length < 3) {
        setClosedLanes([...closedLanes, laneNum].sort());
      }
    }
  };

  const runOptimization = async () => {
    setLoading(true);
    try {
      const res = await optimizeWorkZoneAPI({
        corridor_id: corridorId,
        closed_lanes: closedLanes,
        duration_hours: durationHours,
        day_of_week: dayOfWeek,
      });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runOptimization();
  }, [corridorId, closedLanes, durationHours, dayOfWeek]);

  const daysLabels = isAr
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
          <Construction className="w-6 h-6 text-amber-400" />
          {t.wz_title}
        </h2>
        <p className="text-xs text-slate-400 mt-1">{t.wz_subtitle}</p>
      </div>

      {/* Control Panel: Lane Selection & Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Lane Selector */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-cyan-400" />
            {t.wz_select_lanes}
          </label>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {[1, 2, 3, 4].map((lane) => {
              const isClosed = closedLanes.includes(lane);
              return (
                <button
                  key={lane}
                  onClick={() => toggleLane(lane)}
                  className={`py-2 px-1 rounded-lg text-xs font-mono font-bold border transition ${
                    isClosed
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-md shadow-rose-500/10'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {isAr ? `حارة ${lane}` : `Lane ${lane}`}
                  <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                    {lane === 1
                      ? isAr
                        ? 'يمين/نقل'
                        : 'Slow/Heavy'
                      : lane === 4
                      ? isAr
                        ? 'يسار/سريع'
                        : 'Fast'
                      : isAr
                      ? 'وسط'
                      : 'Center'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Duration Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" />
              {t.wz_duration}
            </label>
            <span className="text-xs font-bold font-mono text-amber-400">{durationHours} Hours</span>
          </div>
          <input
            type="range"
            min={1}
            max={12}
            value={durationHours}
            onChange={(e) => setDurationHours(parseInt(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none mt-3"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
            <span>1h</span>
            <span>4h</span>
            <span>8h</span>
            <span>12h</span>
          </div>
        </div>

        {/* Day of Week */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-emerald-400" />
            {t.wz_day}
          </label>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {daysLabels.map((dayName, idx) => (
              <button
                key={idx}
                onClick={() => setDayOfWeek(idx)}
                className={`px-2.5 py-1 rounded text-xs transition ${
                  dayOfWeek === idx
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold'
                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700'
                }`}
              >
                {dayName}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            title={isAr ? 'السعة الفعالة' : 'Effective Capacity'}
            value={data.workzone_capacity}
            unit="PCE/h"
            status={data.workzone_capacity < 3500 ? 'warning' : 'normal'}
            description={isAr ? `انخفاض ${data.capacity_drop_pct}%` : `-${data.capacity_drop_pct}% capacity drop`}
          />
          <KpiCard
            title={isAr ? 'أفضل فترة تنفيذ' : 'Recommended Window'}
            value={`${data.optimal_windows[0]?.start_hour.toString().padStart(2, '0')}:00`}
            unit={isAr ? `إلى ${data.optimal_windows[0]?.end_hour.toString().padStart(2, '0')}:00` : `to ${data.optimal_windows[0]?.end_hour.toString().padStart(2, '0')}:00`}
            status="success"
            description={isAr ? 'أقل تأخير بشري' : 'Min Person-Hours Delay'}
          />
          <KpiCard
            title={isAr ? 'أقصى طول طابور' : 'Max Queue Length'}
            value={data.optimal_windows[0]?.max_queue_length_m}
            unit="m"
            status={data.optimal_windows[0]?.has_spillback ? 'critical' : 'success'}
            description={data.optimal_windows[0]?.has_spillback ? (isAr ? 'خطر امتداد للمخرج' : 'Spillback Risk!') : (isAr ? 'لا يوجد ارتداد' : 'Zero Exit Spillback')}
          />
          <KpiCard
            title={isAr ? 'مسافة التدرج الهندسي' : 'Taper Length'}
            value={data.sop.taper_length_m}
            unit="m"
            status="normal"
            description={isAr ? `منطقة أمان ${data.sop.buffer_space_m}م` : `Buffer: ${data.sop.buffer_space_m}m`}
          />
        </div>
      )}

      {/* 24-Hour Demand vs Capacity Chart */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-bold text-slate-100">{t.wz_demand_vs_cap}</h3>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-cyan-500" />
                {t.wz_demand_label}
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-0.5 bg-rose-500" />
                {t.wz_capacity_label}
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.hourly_curves} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="demandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="queueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="hour"
                  stroke="#64748b"
                  tickFormatter={(h) => `${h.toString().padStart(2, '0')}:00`}
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
                  y={data.workzone_capacity}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{
                    value: isAr ? `السعة: ${data.workzone_capacity}` : `Capacity: ${data.workzone_capacity}`,
                    fill: '#f87171',
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="demand_pce"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#demandGrad)"
                  name={isAr ? 'الطلب (م.ر/س)' : 'Demand (PCE/h)'}
                />
                <Area
                  type="monotone"
                  dataKey="queue_veh"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#queueGrad)"
                  name={isAr ? 'طابور التكدس (مركبة)' : 'Queue (veh)'}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top 3 Optimal Windows vs Worst Window */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          {data.optimal_windows.map((win) => (
            <div
              key={win.rank}
              className={`p-3.5 rounded-xl border transition ${
                win.is_recommended
                  ? 'bg-emerald-950/20 border-emerald-500/40 shadow-lg'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300">
                  {isAr ? `الخيار #${win.rank}` : `Option #${win.rank}`}
                </span>
                {win.is_recommended && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {isAr ? 'الأمثل ميدانياً' : 'Recommended'}
                  </span>
                )}
              </div>
              <div className="text-lg font-mono font-bold text-slate-100">
                {win.start_hour.toString().padStart(2, '0')}:00 - {win.end_hour.toString().padStart(2, '0')}:00
              </div>
              <div className="mt-2 text-xs text-slate-400 space-y-1">
                <div>
                  {isAr ? 'التأخير البشري:' : 'Delay:'}{' '}
                  <strong className="text-emerald-400">{win.total_person_hours_delay}</strong> {isAr ? 'ساعة.شخص' : 'PHD'}
                </div>
                <div>
                  {isAr ? 'أقصى طابور:' : 'Max Queue:'}{' '}
                  <strong className="text-slate-200">{win.max_queue_length_m} m</strong>
                </div>
              </div>
            </div>
          ))}

          {/* Worst Window */}
          <div className="p-3.5 rounded-xl border bg-rose-950/20 border-rose-500/40 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {isAr ? 'أسوأ فترة (تجنبها)' : 'Worst Window'}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                {isAr ? 'شلل مروري' : 'Severe Congestion'}
              </span>
            </div>
            <div className="text-lg font-mono font-bold text-rose-300">
              {data.worst_window.start_hour.toString().padStart(2, '0')}:00 -{' '}
              {data.worst_window.end_hour.toString().padStart(2, '0')}:00
            </div>
            <div className="mt-2 text-xs text-slate-400 space-y-1">
              <div>
                {isAr ? 'التأخير البشري:' : 'Delay:'}{' '}
                <strong className="text-rose-400">{data.worst_window.total_person_hours_delay}</strong> {isAr ? 'ساعة.شخص' : 'PHD'}
              </div>
              <div>
                {isAr ? 'أقصى طابور:' : 'Max Queue:'}{' '}
                <strong className="text-rose-400">{data.worst_window.max_queue_length_m} m</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live 60fps Micro-Simulator Canvas */}
      <HighwayCanvas
        closedLanes={closedLanes}
        speedLimitKmh={speedLimitKmh}
        demandPce={data?.hourly_curves[15]?.demand_pce || 5800}
        capacityPce={data?.workzone_capacity || 4200}
        language={language}
      />

      {/* Field SOP Action Card */}
      {data && (
        <SopActionCard
          directiveId={data.sop.directive_id}
          titleEn={`Official Work-Zone Closure Directive (${data.duration_hours}h Window)`}
          titleAr={`توجيه إغلاق حارة الصيانة المعتمد (فترة ${data.duration_hours} ساعات)`}
          windowEn={data.sop.optimal_window_en}
          windowAr={data.sop.optimal_window_ar}
          taperLengthM={data.sop.taper_length_m}
          bufferSpaceM={data.sop.buffer_space_m}
          postedSpeedKmh={data.sop.posted_speed_limit_kmh}
          workzoneSpeedKmh={data.sop.workzone_speed_limit_kmh}
          towTruckStagingM={data.sop.tow_truck_staging_m}
          heavyDiversion={data.sop.heavy_vehicle_diversion}
          instructionsEn={data.sop.tactical_instructions_en}
          instructionsAr={data.sop.tactical_instructions_ar}
          language={language}
        />
      )}
    </div>
  );
};
