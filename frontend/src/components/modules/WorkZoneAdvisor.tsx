import React, { useState, useEffect, useRef } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import {
  Construction,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  Layers,
  Loader2,
  ShieldAlert,
  TrendingDown,
  Info,
} from 'lucide-react';
import { HighwayCanvas } from '../simulation/HighwayCanvas';
import { KpiCard } from '../common/KpiCard';
import { SopActionCard } from '../common/SopActionCard';
import {
  WorkZoneResponse,
  WindowOption,
  HourlyWorkZoneDetail,
  optimizeWorkZoneAPI,
} from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface WorkZoneTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: number;
  isAr: boolean;
  workzoneCapacity: number;
  upstreamExitDistanceM?: number;
}

const WorkZoneCustomTooltip: React.FC<WorkZoneTooltipProps> = ({
  active,
  payload,
  label,
  isAr,
  workzoneCapacity,
  upstreamExitDistanceM = 600,
}) => {
  if (!active || !payload || !payload.length) return null;

  const point: HourlyWorkZoneDetail = payload[0]?.payload;
  if (!point) return null;

  const hour = typeof label === 'number' ? label : point.hour;
  const nextHour = (hour + 1) % 24;
  const padH = (h: number) => h.toString().padStart(2, '0');
  const hourText = `${padH(hour)}:00 - ${padH(nextHour)}:00`;

  const demand = Math.round(point.demand_pce);
  const cap = Math.round(point.effective_capacity || workzoneCapacity);
  const vcRatio = cap > 0 ? demand / cap : 0;
  const queueM = Math.round(point.queue_length_m || 0);
  const delaySec = Number((point.delay_sec_per_veh || 0).toFixed(1));
  const personHours = Math.round(point.person_hours_delay || 0);
  const los =
    point.level_of_service ||
    (vcRatio < 0.6
      ? 'A'
      : vcRatio < 0.7
      ? 'B'
      : vcRatio < 0.8
      ? 'C'
      : vcRatio < 0.9
      ? 'D'
      : vcRatio <= 1.0
      ? 'E'
      : 'F');
  const isSpillback = point.spillback_risk || queueM >= upstreamExitDistanceM;

  let statusBadge = {
    text: isAr ? 'نافذة آمنة للصيانة (سعة فائضة)' : 'Safe Maintenance Window (Capacity Surplus)',
    bg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
    icon: '✅',
  };

  if (demand > cap) {
    statusBadge = {
      text: isAr ? 'فترة حرجة - يمنع الإغلاق (عجز سعة وتكدس)' : 'Critical - Closure Prohibited (Capacity Deficit)',
      bg: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
      icon: '⛔',
    };
  } else if (vcRatio >= 0.85) {
    statusBadge = {
      text: isAr ? 'تدفق مروري كثيف (اقتراب من التشبع)' : 'Heavy Traffic Flow (Near Capacity)',
      bg: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
      icon: '⚡',
    };
  }

  const losColors: Record<string, string> = {
    A: 'bg-emerald-600 text-white',
    B: 'bg-teal-600 text-white',
    C: 'bg-cyan-600 text-white',
    D: 'bg-amber-600 text-white',
    E: 'bg-orange-600 text-white',
    F: 'bg-rose-600 text-white animate-pulse',
  };

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="bg-slate-950/95 backdrop-blur-md border border-slate-700/80 p-3.5 rounded-xl shadow-2xl min-w-[290px] max-w-[340px] text-xs font-sans text-slate-200 pointer-events-none select-none z-50"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-1.5 font-bold text-slate-100 text-sm">
          <Clock className="w-4 h-4 text-cyan-400" />
          <span dir="ltr">{hourText}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400 uppercase font-mono">
            {isAr ? 'مستوى الخدمة' : 'LoS'}
          </span>
          <span className={`px-2 py-0.5 rounded font-black text-xs shadow-sm ${losColors[los] || 'bg-slate-700'}`}>
            {los}
          </span>
        </div>
      </div>

      {/* Operational Badge */}
      <div className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-2 mb-2.5 ${statusBadge.bg}`}>
        <span className="text-sm">{statusBadge.icon}</span>
        <span className="leading-tight font-semibold">{statusBadge.text}</span>
      </div>

      {/* Metrics List */}
      <div className="space-y-2">
        {/* Demand */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400" />
            <span>{isAr ? 'حجم الطلب المروري' : 'Traffic Demand'}:</span>
          </span>
          <div className="text-right flex items-center gap-1">
            <span className="font-bold text-cyan-300 font-mono text-[13px]">{demand.toLocaleString()}</span>
            <span className="text-[10px] text-slate-400">{isAr ? 'م.ر/س' : 'PCE/h'}</span>
            <span
              className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                vcRatio > 1.0 ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-slate-300'
              }`}
            >
              (v/c: {(vcRatio * 100).toFixed(0)}%)
            </span>
          </div>
        </div>

        {/* Workzone Capacity */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-0.5 bg-rose-400" />
            <span>{isAr ? 'سعة التحويلة المخفضة' : 'Work Zone Capacity'}:</span>
          </span>
          <div className="text-right flex items-center gap-1">
            <span className="font-bold text-rose-400 font-mono text-[13px]">{cap.toLocaleString()}</span>
            <span className="text-[10px] text-slate-400">{isAr ? 'م.ر/س' : 'PCE/h'}</span>
            <span
              className={`text-[10px] font-mono font-semibold ${
                demand > cap ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {demand > cap
                ? `(-${(demand - cap).toLocaleString()})`
                : `(+${(cap - demand).toLocaleString()})`}
            </span>
          </div>
        </div>

        {/* Queue Length */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
            <span>{isAr ? 'امتداد الطابور التراكمي' : 'Queue Length'}:</span>
          </span>
          <div className="text-right flex items-center gap-1">
            <span
              className={`font-bold font-mono text-[13px] ${
                queueM > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {queueM.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400">{isAr ? 'متر' : 'm'}</span>
            {isSpillback && (
              <span className="text-[9px] bg-rose-900/90 text-rose-200 border border-rose-500/50 px-1.5 py-0.5 rounded font-bold animate-pulse">
                {isAr ? '🚨 ارتداد للمخرج' : '🚨 Spillback'}
              </span>
            )}
          </div>
        </div>

        {/* Delay */}
        <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80 text-[11px]">
          <span className="text-slate-400">
            {isAr ? 'متوسط تأخير المركبة' : 'Avg Vehicle Delay'}:
          </span>
          <span className="font-semibold text-slate-300 font-mono">
            {delaySec} {isAr ? 'ثانية/مركبة' : 's/veh'}
            {personHours > 0 && (
              <span className="text-slate-400 text-[10px] mr-1 ml-1 font-normal">
                ({personHours.toLocaleString()} {isAr ? 'ساعة.شخص' : 'p-hrs'})
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export const WorkZoneAdvisor: React.FC<WorkZoneAdvisorProps> = ({
  corridorId,
  speedLimitKmh,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const engineMode = 'analytical' as const;
  const [closedLanes, setClosedLanes] = useState<number[]>([1]);
  const [durationHours, setDurationHours] = useState<number>(4);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [targetStartHour, setTargetStartHour] = useState<number | null>(null);
  const [scope, setScope] = useState<'daily' | 'weekly'>('weekly');
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<WorkZoneResponse | null>(null);
  // Rapid lane/day/duration changes can overlap. Publish only the newest
  // optimization so a stale response cannot replace the current scenario.
  const requestSeq = useRef(0);

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
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
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
      if (seq === requestSeq.current) setData(res);
    } catch (err) {
      console.error(err);
      if (seq === requestSeq.current) setData(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    runOptimization();
  }, [corridorId, closedLanes, durationHours, dayOfWeek, targetStartHour]);

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
  const dayOptimalWindow = data?.optimal_windows?.[0];
  const requestedEnd = targetStartHour !== null ? (targetStartHour + durationHours) % 24 : null;

  const canvasWindow: WindowOption | null | undefined =
    data?.requested_window ?? data?.worst_window ?? activeWindows[0];

  // The canvas simulates one representative hour, not a fictitious average.
  // When the requested window exists it follows that demand period; otherwise
  // it stress-tests the selected day's worst window. Within the window the
  // canvas uses the highest-demand hour so it never hides the peak.
  const canvasOnSelectedDay =
    !canvasWindow ||
    canvasWindow.day_of_week == null ||
    canvasWindow.day_of_week === dayOfWeek;
  const canvasHour = (() => {
    if (!data || !canvasWindow || !canvasOnSelectedDay) return null;
    let best: (typeof data.hourly_curves)[number] | null = null;
    for (let i = 0; i < Math.max(1, data.duration_hours); i += 1) {
      const hour = (canvasWindow.start_hour + i) % 24;
      const detail = data.hourly_curves.find((c) => c.hour === hour);
      if (detail && (!best || detail.demand_pce > best.demand_pce)) {
        best = detail;
      }
    }
    return best;
  })();

  const closureDemandPce = Math.round(
    canvasHour?.demand_pce ?? canvasWindow?.avg_demand_pce ?? 0
  );
  const canvasCapacityPce = Math.round(
    canvasHour?.effective_capacity ??
      canvasWindow?.avg_capacity_pce ??
      (data?.workzone_capacity ?? 0)
  );
  const canvasHeavyPct =
    canvasWindow && canvasWindow.heavy_vehicle_percentage > 0
      ? canvasWindow.heavy_vehicle_percentage
      : 12;
  const canvasHourLabel = canvasHour
    ? `${padHour(canvasHour.hour)}:00`
    : null;
  const canvasWindowLabel = canvasWindow
    ? formatWindowRange(canvasWindow)
    : null;
  const canvasScenarioLabel = canvasWindow
    ? data?.requested_window
      ? isAr
        ? `${canvasHourLabel ?? 'متوسط النافذة'} · الساعة المطلوبة · ${formatWindowDay(canvasWindow)} · ${canvasWindowLabel}`
        : `${canvasHourLabel ?? 'window average'} · requested window · ${formatWindowDay(canvasWindow)} · ${canvasWindowLabel}`
      : isAr
      ? `${canvasHourLabel ?? 'متوسط النافذة'} · ساعة اختبار الضغط · ${formatWindowDay(canvasWindow)} · ${canvasWindowLabel}`
      : `${canvasHourLabel ?? 'window average'} · stress-test hour · ${formatWindowDay(canvasWindow)} · ${canvasWindowLabel}`
    : undefined;

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
            <span className="text-xs font-bold font-mono text-amber-400">{durationHours} {isAr ? 'ساعات' : 'Hours'}</span>
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
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{t.wz_demand_vs_cap}</span>
                <span className="text-xs font-normal text-amber-400/90 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded">
                  {daysLabels[dayOfWeek]}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isAr
                  ? 'تحليل ديناميكي لساعات اليوم يوضح نافذة التنفيذ الآمنة مقارنة بفترات الذروة والتكدس'
                  : 'Dynamic hourly profile highlighting safe maintenance windows vs peak congestion'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-cyan-500 shadow-sm" />
                {t.wz_demand_label}
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-0.5 bg-rose-500" />
                {t.wz_capacity_label} ({data.workzone_capacity.toLocaleString()})
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-amber-500/80 shadow-sm" />
                {t.wz_queue_label}
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-3 h-3 rounded-sm bg-emerald-500/25 border border-emerald-500" />
                {isAr ? 'نافذة الصيانة المثلى' : 'Optimal Window'}
              </span>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.hourly_curves} margin={{ top: 15, right: 15, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="demandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.55} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="queueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.08} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="hour"
                  stroke="#64748b"
                  tickFormatter={(h) => `${h.toString().padStart(2, '0')}:00`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="demand"
                  stroke="#64748b"
                  tick={{ fontSize: 11 }}
                  domain={[0, 'auto']}
                  label={{
                    value: isAr ? 'م.ر/س' : 'PCE/h',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#64748b',
                    fontSize: 10,
                  }}
                />
                <YAxis
                  yAxisId="queue"
                  orientation="right"
                  stroke="#f59e0b"
                  tick={{ fontSize: 11 }}
                  domain={[0, (dataMax: number) => Math.max(800, Math.ceil((dataMax || 600) * 1.3))]}
                  tickFormatter={(v) => `${v}`}
                  label={{
                    value: isAr ? 'طول الطابور (م)' : 'Queue (m)',
                    angle: 90,
                    position: 'insideRight',
                    fill: '#f59e0b',
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  content={(props: any) => (
                    <WorkZoneCustomTooltip
                      {...props}
                      isAr={isAr}
                      workzoneCapacity={data.workzone_capacity}
                      upstreamExitDistanceM={600}
                    />
                  )}
                />

                {/* Optimal Window Highlight Band */}
                {dayOptimalWindow && (
                  dayOptimalWindow.start_hour < dayOptimalWindow.end_hour ? (
                    <ReferenceArea
                      yAxisId="demand"
                      x1={dayOptimalWindow.start_hour}
                      x2={dayOptimalWindow.end_hour}
                      fill="#10b981"
                      fillOpacity={0.16}
                      stroke="#10b981"
                      strokeOpacity={0.7}
                      strokeDasharray="4 4"
                      label={{
                        value: isAr
                          ? `نافذة الصيانة المثلى (${padHour(dayOptimalWindow.start_hour)}:00 - ${padHour(dayOptimalWindow.end_hour)}:00)`
                          : `Optimal Window (${padHour(dayOptimalWindow.start_hour)}:00 - ${padHour(dayOptimalWindow.end_hour)}:00)`,
                        position: 'insideTop',
                        fill: '#34d399',
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    />
                  ) : (
                    <>
                      <ReferenceArea
                        yAxisId="demand"
                        x1={dayOptimalWindow.start_hour}
                        x2={23}
                        fill="#10b981"
                        fillOpacity={0.16}
                        stroke="#10b981"
                        strokeOpacity={0.7}
                        strokeDasharray="4 4"
                      />
                      <ReferenceArea
                        yAxisId="demand"
                        x1={0}
                        x2={dayOptimalWindow.end_hour}
                        fill="#10b981"
                        fillOpacity={0.16}
                        stroke="#10b981"
                        strokeOpacity={0.7}
                        strokeDasharray="4 4"
                        label={{
                          value: isAr
                            ? `نافذة الصيانة المثلى (${padHour(dayOptimalWindow.start_hour)}:00 - ${padHour(dayOptimalWindow.end_hour)}:00)`
                            : `Optimal Window (${padHour(dayOptimalWindow.start_hour)}:00 - ${padHour(dayOptimalWindow.end_hour)}:00)`,
                          position: 'insideTop',
                          fill: '#34d399',
                          fontSize: 11,
                          fontWeight: 'bold',
                        }}
                      />
                    </>
                  )
                )}

                {/* Requested Window Highlight Band (if different from optimal) */}
                {targetStartHour !== null && requestedEnd !== null && targetStartHour !== dayOptimalWindow?.start_hour && (
                  targetStartHour < requestedEnd ? (
                    <ReferenceArea
                      yAxisId="demand"
                      x1={targetStartHour}
                      x2={requestedEnd}
                      fill="#38bdf8"
                      fillOpacity={0.12}
                      stroke="#38bdf8"
                      strokeOpacity={0.7}
                      strokeDasharray="4 4"
                      label={{
                        value: isAr
                          ? `النافذة المطلوبة (${padHour(targetStartHour)}:00 - ${padHour(requestedEnd)}:00)`
                          : `Requested Window (${padHour(targetStartHour)}:00 - ${padHour(requestedEnd)}:00)`,
                        position: 'insideTop',
                        fill: '#7dd3fc',
                        fontSize: 10,
                      }}
                    />
                  ) : (
                    <>
                      <ReferenceArea
                        yAxisId="demand"
                        x1={targetStartHour}
                        x2={23}
                        fill="#38bdf8"
                        fillOpacity={0.12}
                        stroke="#38bdf8"
                        strokeOpacity={0.7}
                        strokeDasharray="4 4"
                      />
                      <ReferenceArea
                        yAxisId="demand"
                        x1={0}
                        x2={requestedEnd}
                        fill="#38bdf8"
                        fillOpacity={0.12}
                        stroke="#38bdf8"
                        strokeOpacity={0.7}
                        strokeDasharray="4 4"
                        label={{
                          value: isAr
                            ? `النافذة المطلوبة (${padHour(targetStartHour)}:00 - ${padHour(requestedEnd)}:00)`
                            : `Requested Window (${padHour(targetStartHour)}:00 - ${padHour(requestedEnd)}:00)`,
                          position: 'insideTop',
                          fill: '#7dd3fc',
                          fontSize: 10,
                        }}
                      />
                    </>
                  )
                )}

                {/* Reduced Work Zone Capacity Line */}
                <ReferenceLine
                  y={data.workzone_capacity}
                  yAxisId="demand"
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: isAr ? `السعة المخفضة: ${data.workzone_capacity}` : `Reduced Cap: ${data.workzone_capacity}`,
                    fill: '#f87171',
                    fontSize: 11,
                    position: 'insideBottomRight',
                  }}
                />

                {/* Upstream Exit Distance Threshold (600m) */}
                <ReferenceLine
                  y={600}
                  yAxisId="queue"
                  stroke="#fb7185"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{
                    value: isAr ? 'عتبة ارتداد المخرج السابق (600م)' : 'Upstream Exit Limit (600m)',
                    fill: '#fb7185',
                    fontSize: 10,
                    position: 'insideTopRight',
                  }}
                />

                {/* Demand Area */}
                <Area
                  type="monotone"
                  dataKey="demand_pce"
                  yAxisId="demand"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#demandGrad)"
                  name={isAr ? 'الطلب (م.ر/س)' : 'Demand (PCE/h)'}
                />

                {/* Queue Length Area */}
                <Area
                  type="monotone"
                  dataKey="queue_length_m"
                  yAxisId="queue"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#queueGrad)"
                  name={isAr ? 'طول الطابور (م)' : 'Queue length (m)'}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Corridor Operational Profile Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mt-3 pt-3 border-t border-slate-800 text-xs">
            <div className="flex items-start gap-2.5 bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <span>{isAr ? 'نافذة الصيانة الآمنة (00:00 - 05:00)' : 'Safe Window (00:00 - 05:00)'}</span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  {isAr
                    ? 'طلب متدنٍ (< 2,500 م.ر/س)، سعة فائضة تفوق +3,100 م.ر/س، انعدام تام للطوابير (0م).'
                    : 'Low demand (< 2,500 PCE/h), surplus capacity > +3,100 PCE/h, zero queue (0m).'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 bg-amber-950/20 border border-amber-500/30 rounded-xl p-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <span>{isAr ? 'ذروة الصباح (07:00 - 11:00)' : 'Morning Peak (07:00 - 11:00)'}</span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  {isAr
                    ? 'طلب يفوق السعة (~7,200 م.ر/س)، تشكل طابور 600م يرتد للمخرج السابق. يمنع الإغلاق.'
                    : 'Demand exceeds capacity (~7,200 PCE/h), 600m queue blocks upstream exit. Closure prohibited.'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 bg-rose-950/20 border border-rose-500/30 rounded-xl p-2.5">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-300 flex items-center gap-1.5">
                  <span>{isAr ? 'ذروة المساء (16:00 - 19:00)' : 'Evening Peak (16:00 - 19:00)'}</span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  {isAr
                    ? 'أعلى حمل مروري (~7,500 م.ر/س)، عجز حرج في السعة (-1,860 م.ر/س) وشلل مروري تام.'
                    : 'Highest traffic load (~7,500 PCE/h), severe capacity deficit (-1,860 PCE/h) and gridlock.'}
                </div>
              </div>
            </div>
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

      {/* Live 60fps Micro-Simulator Canvas */}
      {canvasWindow ? (
        <HighwayCanvas
          closedLanes={closedLanes}
          speedLimitKmh={speedLimitKmh}
          demandPce={closureDemandPce}
          capacityPce={canvasCapacityPce}
          heavyPct={canvasHeavyPct}
          workzoneSpeedKmh={data?.sop.workzone_speed_limit_kmh}
          storageM={data?.upstream_exit_distance_m}
          scenarioLabel={canvasScenarioLabel}
          planningDelaySec={canvasHour?.delay_sec_per_veh}
          planningQueueM={
            canvasHour?.queue_length_m ?? canvasWindow?.max_queue_length_m
          }
          language={language}
        />
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-sm text-slate-400">
          {loading
            ? isAr
              ? 'جاري تحميل بيانات المحاكاة…'
              : 'Loading measured simulation data…'
            : isAr
            ? 'لا تتوفر بيانات قياس للمحاكاة.'
            : 'No measured telemetry is available for the simulation.'}
        </div>
      )}

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
