import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Users, Zap, Clock, ShieldCheck, Flag, Copy, Check, CheckCircle2, Sliders } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { EventSurgeCanvas } from '../simulation/EventSurgeCanvas';
import { SurgeOrchestratorResponse, evaluateSurgeOrchestratorAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface SurgeOrchestratorProps {
  corridorId: string;
  language: Language;
}

export const SurgeOrchestrator: React.FC<SurgeOrchestratorProps> = ({ corridorId, language }) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [eventType, setEventType] = useState<string>('STADIUM_EGRESS');
  const [surgeVehicles, setSurgeVehicles] = useState<number>(5500);
  const [baseFlow, setBaseFlow] = useState<number>(3600);
  const [staggerMinutes, setStaggerMinutes] = useState<number>(30);
  const [expressChute, setExpressChute] = useState<boolean>(true);

  const [data, setData] = useState<SurgeOrchestratorResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchSurgeData = async () => {
    setLoading(true);
    try {
      const res = await evaluateSurgeOrchestratorAPI({
        corridor_id: corridorId,
        event_type: eventType,
        surge_vehicles: surgeVehicles,
        base_corridor_flow_pce: baseFlow,
        stagger_minutes: staggerMinutes,
        enable_express_chute: expressChute,
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
    fetchSurgeData();
  }, [corridorId, eventType, surgeVehicles, baseFlow, staggerMinutes, expressChute]);

  const handleCopyDirective = () => {
    if (!data) return;
    const directive = isAr
      ? `[خطة عمليات تفويج الفعاليات الكبرى والذروة المدرسية]
المحور: ${corridorId} | نوع الفعالية: ${data.event_type}
حجم المركبات المفوجة: ${data.surge_vehicles.toLocaleString()} مركبة
زمن تفريغ الفعالية بعد التدخل: ${data.staggered_clearance_min} دقيقة (وفر ${data.clearance_time_saved_min} دقيقة مقارنة بالخروج العشوائي)
نسبة خفض ساعات التأخير: -${data.aggregate_delay_reduction_pct}%
أقصى طول طابور: ${Math.round(data.max_staggered_queue_m)} م (مقارنة بـ ${Math.round(data.max_uncontrolled_queue_m)} م)
جدول تشغيل البوابات الميداني (Playbook):
${data.gate_playbook_ar.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : `[MEGA-EVENT & SCHOOL SURGE OPERATIONS PLAYBOOK]
Corridor: ${corridorId} | Event Type: ${data.event_type}
Surge Volume: ${data.surge_vehicles.toLocaleString()} vehicles
Staggered Clearance Time: ${data.staggered_clearance_min} min (Saved ${data.clearance_time_saved_min} min vs uncontrolled spike)
Total Delay Reduction: -${data.aggregate_delay_reduction_pct}%
Max Queue: ${Math.round(data.max_staggered_queue_m)}m (vs ${Math.round(data.max_uncontrolled_queue_m)}m uncontrolled)
Minute-by-Minute Gate Playbook:
${data.gate_playbook_en.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;

    navigator.clipboard.writeText(directive);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-400" />
            {isAr ? 'منسق تفويج الفعاليات الكبرى والذروة المدرسية' : 'Mega-Event & School Peak Surge Orchestrator'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'تسطيح موجات الخروج المتزامن عبر التفويج المرحلي للبوابات وتخصيص مسار التدفق السريع بالأقماع'
              : 'Peak-shaving staggered discharge, coned express chute allocation, and minute-by-minute gate playbook'}
          </p>
        </div>

        {data && (
          <button
            onClick={handleCopyDirective}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'نسخ خطة التفويج' : 'Copy Playbook')}
          </button>
        )}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Event Type */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'تصنيف الفعالية / الذروة' : 'Event / Surge Category'}
          </label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:border-purple-400"
          >
            <option value="STADIUM_EGRESS">{isAr ? 'انصراف استاد رياضي (50K+ مشجع)' : 'Stadium Egress (50k+ Match)'}</option>
            <option value="SCHOOL_CLUSTER_PEAK">{isAr ? 'ذروة مجمع مدارس (انصراف موحد)' : 'School Cluster Drop-off/Pickup'}</option>
            <option value="EXHIBITION_DISPERSAL">{isAr ? 'انصراف مركز المعارض والمؤتمرات' : 'Convention / Exhibition Peak'}</option>
          </select>
        </div>

        {/* Surge Vehicles */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'حجم مركبات الفعالية' : 'Surge Vehicles Volume'}</span>
            <span className="text-purple-400 font-bold font-mono">{surgeVehicles.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={1500}
            max={9000}
            step={250}
            value={surgeVehicles}
            onChange={(e) => setSurgeVehicles(Number(e.target.value))}
            className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>1,500</span>
            <span>9,000 veh</span>
          </div>
        </div>

        {/* Base Flow */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'حركة المحور الأساسية' : 'Background Flow'}</span>
            <span className="text-cyan-400 font-bold font-mono">{baseFlow} PCE/h</span>
          </div>
          <input
            type="range"
            min={2000}
            max={5500}
            step={250}
            value={baseFlow}
            onChange={(e) => setBaseFlow(Number(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>2,000</span>
            <span>5,500 PCE/h</span>
          </div>
        </div>

        {/* Stagger Minutes */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'فارق توقيت التفويج' : 'Zoned Stagger Interval'}
          </label>
          <div className="grid grid-cols-4 gap-1 mt-1">
            {[0, 15, 30, 45].map((m) => (
              <button
                key={m}
                onClick={() => setStaggerMinutes(m)}
                className={`py-1.5 text-xs font-semibold rounded border transition-all text-center ${
                  staggerMinutes === m
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
                }`}
              >
                {m === 0 ? (isAr ? 'عشوائي' : '0m') : `${m}m`}
              </button>
            ))}
          </div>
        </div>

        {/* Express Chute Toggle */}
        <div className="flex flex-col justify-center">
          <span className="text-xs font-semibold text-slate-300 mb-2">
            {isAr ? 'مسار الأقماع السريع (Express Chute)' : 'Coned Express Chute'}
          </span>
          <button
            onClick={() => setExpressChute(!expressChute)}
            className={`flex items-center justify-between p-2 rounded-lg border text-xs font-bold transition ${
              expressChute
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-md'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <span>{isAr ? 'حارة خروج مخصصة' : 'Lane 1 Dedicated'}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${expressChute ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
              {expressChute ? 'ACTIVE' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {/* 60fps Microscopic Event Surge & Express Chute Simulation Canvas */}
      <EventSurgeCanvas
        eventType={eventType}
        surgeVehicles={surgeVehicles}
        baseFlowPce={baseFlow}
        staggerMinutes={staggerMinutes}
        expressChute={expressChute}
        language={language}
      />

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={isAr ? 'زمن إخلاء الفعالية التام' : 'Venue Clearance Time'}
            value={`${data.staggered_clearance_min} min`}
            subtitle={isAr ? `توفير ${data.clearance_time_saved_min} دقيقة عن الخروج العشوائي` : `Saved ${data.clearance_time_saved_min} min vs uncontrolled`}
            variant="success"
            accent="border-purple-500/40"
          />

          <KpiCard
            title={isAr ? 'ذروة كثافة المحور (Peak v/c)' : 'Peak Volume-to-Capacity'}
            value={`${data.staggered_peak_vc}`}
            subtitle={isAr ? `انخفضت من ${data.uncontrolled_peak_vc} (منع شلل المحور)` : `Reduced from ${data.uncontrolled_peak_vc} (gridlock prevented)`}
            variant={data.staggered_peak_vc > 1.0 ? 'warning' : 'success'}
            accent="border-emerald-500/40"
          />

          <KpiCard
            title={isAr ? 'نسبة خفض ساعات التأخير' : 'Total Delay Reduction'}
            value={`-${data.aggregate_delay_reduction_pct}%`}
            subtitle={isAr ? 'توفير آلاف ساعات التكدس' : 'Substantial commuter PHD saved'}
            variant="success"
            accent="border-cyan-500/40"
          />

          <KpiCard
            title={isAr ? 'أقصى امتداد للطابور' : 'Max Queue Storage'}
            value={`${Math.round(data.max_staggered_queue_m)} m`}
            subtitle={isAr ? `مقارنة بـ ${Math.round(data.max_uncontrolled_queue_m)} م بدون تنظيم` : `vs ${Math.round(data.max_uncontrolled_queue_m)}m uncontrolled`}
            variant="neutral"
            accent="border-amber-500/40"
          />
        </div>
      )}

      {/* 180-Minute Timeline Dual Area Chart */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-400" />
                {isAr ? 'محاكاة التدفق الزمني على مدار 180 دقيقة: الخروج المتزامن مقابل التفويج المرحلي' : '180-Minute Discharge Timeline: Uncontrolled Spike vs Staggered Release'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isAr
                  ? 'الخط الأحمر يوضح الانفجار الحجمي العشوائي، بينما المساحة البنفسجية تبين استيعاب المحور للتدفق بعد التفويج'
                  : 'Red curve illustrates violent uncontrolled spike; purple shows smooth flattened demand below capacity'}
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.timeline} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="staggerGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="minute" stroke="#64748b" tickFormatter={(v) => `${v}m`} textAnchor="middle" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem' }}
                  formatter={(val: number, name: string) => [
                    `${val} PCE/h`,
                    name === 'staggered_flow_vph' ? 'Staggered Flow' : 'Uncontrolled Surge',
                  ]}
                />
                <ReferenceLine y={8000} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Corridor Capacity (8000)', fill: '#ef4444', fontSize: 10 }} />
                <Area type="monotone" dataKey="uncontrolled_flow_vph" stroke="#ef4444" strokeWidth={2} fill="transparent" name="uncontrolled_flow_vph" />
                <Area type="monotone" dataKey="staggered_flow_vph" stroke="#a855f7" strokeWidth={2.5} fillOpacity={1} fill="url(#staggerGrad)" name="staggered_flow_vph" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Minute-by-Minute Gate Playbook Card */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Flag className="w-4 h-4 text-purple-400" />
              {isAr ? 'خطة إدارة وتشغيل البوابات الميدانية دقيقة بدقيقة (Playbook SOP)' : 'Minute-by-Minute Tactical Gate Playbook SOP'}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
              TACTICAL DEPLOYMENT
            </span>
          </div>

          <div className="space-y-2 mt-3">
            {(isAr ? data.gate_playbook_ar : data.gate_playbook_en).map((step, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-200"
              >
                <span className="flex-shrink-0 px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold font-mono text-[10px]">
                  STEP {idx + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
