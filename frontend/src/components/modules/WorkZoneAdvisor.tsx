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
import { Construction, AlertTriangle, CheckCircle2, Clock, Calendar, Layers, Cpu, Zap, Activity, Flame, Gauge, Loader2, Play } from 'lucide-react';
import { HighwayCanvas } from '../simulation/HighwayCanvas';
import { KpiCard } from '../common/KpiCard';
import { SopActionCard } from '../common/SopActionCard';
import { WorkZoneResponse, optimizeWorkZoneAPI, launchSumoGuiAPI } from '../../api/client';
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

  const [engineMode, setEngineMode] = useState<'analytical' | 'sumo'>('sumo');
  const [closedLanes, setClosedLanes] = useState<number[]>([1]);
  const [durationHours, setDurationHours] = useState<number>(4);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [targetStartHour, setTargetStartHour] = useState<number | null>(null);
  const [scope, setScope] = useState<'daily' | 'weekly'>('weekly');
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
        target_start_hour: targetStartHour ?? undefined,
        engine_mode: engineMode,
        simulation_duration_sec: 60,
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
  }, [corridorId, closedLanes, durationHours, dayOfWeek, targetStartHour, engineMode]);

  const daysLabels = isAr
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const padHour = (h: number) => h.toString().padStart(2, '0');

  const formatWindowRange = (win: { start_hour: number; end_hour: number; day_of_week?: number | null; end_day_of_week?: number | null }) => {
    const startDay = win.day_of_week ?? dayOfWeek;
    const endDay = win.end_day_of_week ?? startDay;
    if (startDay === endDay) {
      return `${padHour(win.start_hour)}:00 - ${padHour(win.end_hour)}:00`;
    }
    return `${padHour(win.start_hour)}:00 ${daysLabels[startDay]} - ${padHour(win.end_hour)}:00 ${daysLabels[endDay]}`;
  };

  const formatWindowDay = (win: { day_of_week?: number | null }) =>
    daysLabels[win.day_of_week ?? dayOfWeek];

  const weeklyWindows = data?.weekly_optimal_windows ?? [];
  const hasWeekly = weeklyWindows.length > 0;
  const activeWindows =
    scope === 'weekly' && hasWeekly ? weeklyWindows : data?.optimal_windows ?? [];
  const activeWorst =
    scope === 'weekly' && data?.weekly_worst_window
      ? data.weekly_worst_window
      : data?.worst_window;
  const recommendedWindow = hasWeekly ? weeklyWindows[0] : data?.optimal_windows[0];

  const closureDemandPce = (() => {
    if (!data || !recommendedWindow) return 5800;
    let sum = 0;
    for (let step = 0; step < durationHours; step++) {
      const h = (recommendedWindow.start_hour + step) % 24;
      sum += data.hourly_curves[h]?.demand_pce ?? 0;
    }
    return Math.round(sum / Math.max(1, durationHours));
  })();

  return (
    <div className="space-y-6">
      {/* Header with Engine Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
            <Construction className="w-6 h-6 text-amber-400" />
            {t.wz_title}
            {loading && <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />}
          </h2>
          <p className="text-xs text-slate-400 mt-1">{t.wz_subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {engineMode === 'sumo' && (
            <button
              onClick={async () => {
                try {
                  await launchSumoGuiAPI('workzone');
                } catch (e) {
                  console.error(e);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition shadow-md shadow-emerald-500/20"
              title={isAr ? 'تشغيل واجهة SUMO المرئية على سطح المكتب' : 'Launch native desktop SUMO-GUI window'}
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>{isAr ? 'تشغيل SUMO-GUI ↗' : 'Launch SUMO-GUI ↗'}</span>
            </button>
          )}

          {/* Engine Switcher */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 rounded-xl shadow-lg">
            <button
              onClick={() => setEngineMode('analytical')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                engineMode === 'analytical'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              {t.int_engine_analytical || (isAr ? 'التحليل الحسابي السريع (HCM)' : 'Deterministic HCM')}
            </button>
            <button
              onClick={() => setEngineMode('sumo')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                engineMode === 'sumo'
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              {t.int_engine_sumo || (isAr ? 'محاكاة SUMO TraCI المجهرية' : 'SUMO TraCI Digital Twin')}
            </button>
          </div>
        </div>
      </div>

      {/* Control Panel: Lane Selection & Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
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

        {/* Requested Start Hour (optional) */}
        <div>
          <label className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-cyan-400" />
            {isAr ? 'وقت بدء مطلوب (اختياري)' : 'Requested Start Hour (optional)'}
          </label>
          <select
            value={targetStartHour ?? ''}
            onChange={(e) =>
              setTargetStartHour(e.target.value === '' ? null : parseInt(e.target.value))
            }
            className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">{isAr ? 'بدون تقييد' : 'No constraint'}</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {padHour(h)}:00
              </option>
            ))}
          </select>
          <span className="text-[10px] text-slate-500 block mt-2">
            {isAr
              ? 'تقييم فوري لأي نافذة مطلوبة من الإدارة'
              : 'Evaluates any management-requested window instantly'}
          </span>
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
            value={recommendedWindow ? formatWindowRange(recommendedWindow) : '--'}
            unit={recommendedWindow ? formatWindowDay(recommendedWindow) : ''}
            status="success"
            description={
              hasWeekly
                ? isAr
                  ? 'أفضل نافذة خلال الأسبوع (168 ساعة)'
                  : 'Best of 168 weekly hours'
                : isAr
                ? 'أقل تأخير بشري خلال اليوم'
                : 'Min person-hours of delay'
            }
          />
          <KpiCard
            title={isAr ? 'أقصى طول طابور' : 'Max Queue Length'}
            value={recommendedWindow?.max_queue_length_m ?? 0}
            unit="m"
            status={recommendedWindow?.has_spillback ? 'critical' : 'success'}
            description={
              recommendedWindow?.has_spillback
                ? isAr
                  ? 'خطر امتداد للمخرج'
                  : 'Spillback Risk!'
                : isAr
                ? 'لا يوجد ارتداد'
                : 'Zero Exit Spillback'
            }
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

      {/* Top Optimal Windows vs Worst Window */}
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-100">
              {scope === 'weekly'
                ? isAr
                  ? 'أفضل نوافذ التنفيذ خلال الأسبوع (168 ساعة)'
                  : 'Best Execution Windows Across the Week (168 Hours)'
                : isAr
                ? 'أفضل نوافذ التنفيذ خلال اليوم المحدد'
                : 'Best Execution Windows on the Selected Day'}
            </h3>
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
              <button
                onClick={() => setScope('daily')}
                className={`px-3 py-1 rounded text-xs font-semibold transition ${
                  scope === 'daily'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {isAr ? 'يومي (24 ساعة)' : 'Daily (24h)'}
              </button>
              <button
                onClick={() => setScope('weekly')}
                disabled={!hasWeekly}
                className={`px-3 py-1 rounded text-xs font-semibold transition disabled:opacity-40 ${
                  scope === 'weekly' && hasWeekly
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {isAr ? 'أسبوعي (168 ساعة)' : 'Weekly (168h)'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {activeWindows.map((win) => (
              <div
                key={`${win.rank}-${win.day_of_week ?? dayOfWeek}-${win.start_hour}`}
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
                <div className="text-base font-mono font-bold text-slate-100">
                  {formatWindowRange(win)}
                </div>
                <div className="text-[11px] text-emerald-400/80 font-semibold mt-0.5">
                  {formatWindowDay(win)}
                </div>
                <div className="mt-2 text-xs text-slate-400 space-y-1">
                  <div>
                    {isAr ? 'التأخير البشري:' : 'Delay:'}{' '}
                    <strong className="text-emerald-400">{win.total_person_hours_delay}</strong>{' '}
                    {isAr ? 'ساعة.شخص' : 'PHD'}
                  </div>
                  <div>
                    {isAr ? 'أقصى طابور:' : 'Max Queue:'}{' '}
                    <strong className="text-slate-200">{win.max_queue_length_m} m</strong>
                  </div>
                  <div>
                    {isAr ? 'خفض السرعة:' : 'Speed Drop:'}{' '}
                    <strong className="text-amber-400">{win.avg_speed_drop_pct}%</strong>
                  </div>
                </div>
              </div>
            ))}

            {/* Worst Window */}
            {activeWorst && (
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
                <div className="text-base font-mono font-bold text-rose-300">
                  {formatWindowRange(activeWorst)}
                </div>
                <div className="text-[11px] text-rose-400/80 font-semibold mt-0.5">
                  {formatWindowDay(activeWorst)}
                </div>
                <div className="mt-2 text-xs text-slate-400 space-y-1">
                  <div>
                    {isAr ? 'التأخير البشري:' : 'Delay:'}{' '}
                    <strong className="text-rose-400">
                      {activeWorst.total_person_hours_delay}
                    </strong>{' '}
                    {isAr ? 'ساعة.شخص' : 'PHD'}
                  </div>
                  <div>
                    {isAr ? 'أقصى طابور:' : 'Max Queue:'}{' '}
                    <strong className="text-rose-400">
                      {activeWorst.max_queue_length_m} m
                    </strong>
                  </div>
                  <div>
                    {isAr ? 'خفض السرعة:' : 'Speed Drop:'}{' '}
                    <strong className="text-rose-300">{activeWorst.avg_speed_drop_pct}%</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Requested Window Evaluation */}
          {data.requested_window && (
            <div className="p-3.5 rounded-xl border bg-cyan-950/20 border-cyan-500/40 shadow-lg">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-cyan-300">
                  {isAr ? 'تقييم النافذة المطلوبة' : 'Requested Window Evaluation'}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  {isAr ? 'مقارنة مرجعية' : 'What-If'}
                </span>
              </div>
              <div className="text-base font-mono font-bold text-slate-100">
                {formatWindowRange(data.requested_window)}
              </div>
              <div className="mt-1 text-xs text-slate-400 flex flex-wrap gap-4">
                <span>
                  {isAr ? 'التأخير البشري:' : 'Delay:'}{' '}
                  <strong className="text-cyan-300">
                    {data.requested_window.total_person_hours_delay}
                  </strong>{' '}
                  {isAr ? 'ساعة.شخص' : 'PHD'}
                </span>
                <span>
                  {isAr ? 'أقصى طابور:' : 'Max Queue:'}{' '}
                  <strong className="text-cyan-300">
                    {data.requested_window.max_queue_length_m} m
                  </strong>
                </span>
                <span>
                  {isAr ? 'خفض السرعة:' : 'Speed Drop:'}{' '}
                  <strong className="text-cyan-300">
                    {data.requested_window.avg_speed_drop_pct}%
                  </strong>
                </span>
                {data.requested_window.has_spillback && (
                  <span className="text-rose-400 font-bold">
                    {isAr ? 'خطر ارتداد للمخرج!' : 'Spillback Risk!'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUMO TraCI Microscopic Bottleneck Telemetry Card */}
      {data?.sumo_metrics && engineMode === 'sumo' && (
        <div className="bg-gradient-to-r from-slate-900 via-emerald-950/20 to-slate-900 border border-emerald-500/30 rounded-xl p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                {isAr ? 'بيانات محاكاة SUMO TraCI المجهرية لاختناق التحويلات' : 'SUMO TraCI Microscopic Bottleneck Telemetry'}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                {data.sumo_metrics.engine}
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                {isAr ? `${data.sumo_metrics.simulated_vehicles_count} مركبة بمحاكاة TraCI` : `${data.sumo_metrics.simulated_vehicles_count} TraCI Vehs`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                {isAr ? 'معدل التصريف الفعلي' : 'Discharge Rate'}
              </div>
              <div className="text-base font-mono font-bold text-cyan-400 mt-1">
                {data.sumo_metrics.bottleneck_throughput_pce}
                <span className="text-[10px] text-slate-500 ml-1">PCE/h</span>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                {isAr ? 'أقصى طابور مجهري (Q95)' : 'TraCI Q95 Queue'}
              </div>
              <div className="text-base font-mono font-bold text-amber-400 mt-1">
                {data.sumo_metrics.max_queue_m}
                <span className="text-[10px] text-slate-500 ml-1">m</span>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-rose-400" />
                {isAr ? 'متوسط التأخير الفعلي' : 'Avg Time Loss'}
              </div>
              <div className="text-base font-mono font-bold text-rose-400 mt-1">
                {data.sumo_metrics.average_delay_sec}
                <span className="text-[10px] text-slate-500 ml-1">s/veh</span>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                {isAr ? 'متوسط سرعة المرور' : 'Mean Speed'}
              </div>
              <div className="text-base font-mono font-bold text-emerald-400 mt-1">
                {data.sumo_metrics.average_speed_kmh}
                <span className="text-[10px] text-slate-500 ml-1">km/h</span>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                {isAr ? 'مؤشر اضطراب الحارات' : 'Weaving Turbulence'}
              </div>
              <div className="text-base font-mono font-bold text-amber-300 mt-1">
                {data.sumo_metrics.weaving_turbulence_index}
                <span className="text-[10px] text-slate-500 ml-1">LC2013</span>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-rose-400" />
                {isAr ? 'انبعاثات CO2 المحاكاة' : 'CO2 Emissions'}
              </div>
              <div className="text-base font-mono font-bold text-slate-200 mt-1">
                {data.sumo_metrics.co2_emissions_kg_h}
                <span className="text-[10px] text-slate-500 ml-1">kg/h</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live 60fps Micro-Simulator Canvas */}
      <HighwayCanvas
        closedLanes={closedLanes}
        speedLimitKmh={speedLimitKmh}
        demandPce={closureDemandPce}
        capacityPce={data?.sumo_metrics ? Math.round(data.sumo_metrics.bottleneck_throughput_pce) : Math.round(data?.workzone_capacity ?? 0)}
        language={language}
        engineMode={engineMode}
        isSumoNative={Boolean(data?.sumo_metrics?.is_native_sumo)}
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
