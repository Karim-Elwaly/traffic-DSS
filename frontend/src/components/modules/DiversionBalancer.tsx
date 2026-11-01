import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { GitFork, Split, Zap, AlertTriangle, Clock, TrendingUp, Radio, Copy, Check, Sliders, CheckCircle2 } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { DiversionForkCanvas } from '../simulation/DiversionForkCanvas';
import { DiversionResponse, balanceDiversionAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface DiversionBalancerProps {
  language: Language;
}

export const DiversionBalancer: React.FC<DiversionBalancerProps> = ({ language }) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [totalDemand, setTotalDemand] = useState<number>(7500);
  const [primaryName, setPrimaryName] = useState<string>(isAr ? 'محور 26 يوليو' : '26th of July Corridor');
  const [primaryCap, setPrimaryCap] = useState<number>(4800);
  const [primaryT0, setPrimaryT0] = useState<number>(16.0);

  const [alternateName, setAlternateName] = useState<string>(isAr ? 'محور روض الفرج' : 'Rod El-Farag Axis');
  const [alternateCap, setAlternateCap] = useState<number>(6200);
  const [alternateT0, setAlternateT0] = useState<number>(19.5);

  const [incidentFactor, setIncidentFactor] = useState<number>(1.8);
  const [data, setData] = useState<DiversionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Sync names if language changes
  useEffect(() => {
    setPrimaryName(isAr ? 'محور 26 يوليو' : '26th of July Corridor');
    setAlternateName(isAr ? 'محور روض الفرج' : 'Rod El-Farag Axis');
  }, [isAr]);

  const runDiversionBalance = async () => {
    setLoading(true);
    try {
      const res = await balanceDiversionAPI({
        total_corridor_demand_vph: totalDemand,
        primary_corridor_name: primaryName,
        primary_free_flow_time_min: primaryT0,
        primary_capacity_vph: primaryCap,
        alternate_corridor_name: alternateName,
        alternate_free_flow_time_min: alternateT0,
        incident_delay_factor: incidentFactor,
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
    runDiversionBalance();
  }, [totalDemand, primaryName, primaryCap, primaryT0, alternateName, alternateCap, alternateT0, incidentFactor]);

  const handleCopyDirective = () => {
    if (!data) return;
    const directive = isAr
      ? `[تعليمات العمليات - موازنة التدفق وتحويل المسار بين المحاور الموازية]
المحور الرئيسي: ${primaryName} | المحور البديل: ${alternateName}
إجمالي التدفق الوارد: ${data.total_demand_vph} مركبة/ساعة
مؤشر الاختناق بالمحور الرئيسي: x${incidentFactor.toFixed(1)}
الوضع الحالي (بدون تدخل):
- زمن رحلة المحور الرئيسي: ${data.do_nothing_primary_time_min.toFixed(1)} دقيقة (تدفق ${Math.round(data.do_nothing_primary_flow_vph)} م/س)
- زمن رحلة المحور البديل: ${data.do_nothing_alternate_time_min.toFixed(1)} دقيقة
التوازن الأمثل الموصى به (واردروب):
- نسبة التحويل المقترحة: ${data.recommended_diversion_pct.toFixed(1)}% عبر اللوحات الإرشادية
- زمن الرحلة بعد الموازنة: ${data.optimal_equilibrium_time_min.toFixed(1)} دقيقة
- التوفير لكل مركبة: ${data.time_saved_per_vehicle_min.toFixed(1)} دقيقة
- إجمالي ساعات التأخير الموفرة يومياً: ${Math.round(data.system_hours_saved_daily)} ساعة/يوم
رسالة اللوحات الإرشادية (VMS): ${data.vms_advisory_ar}`
      : `[OPERATIONS DIRECTIVE - PARALLEL CORRIDOR LOAD BALANCING & DIVERSION]
Primary Axis: ${primaryName} | Alternate Axis: ${alternateName}
Total Demand: ${data.total_demand_vph} veh/h
Bottleneck Incident Factor: x${incidentFactor.toFixed(1)}
Status Quo (Do-Nothing):
- Primary Route Travel Time: ${data.do_nothing_primary_time_min.toFixed(1)} min (${Math.round(data.do_nothing_primary_flow_vph)} veh/h)
- Alternate Route Travel Time: ${data.do_nothing_alternate_time_min.toFixed(1)} min
Wardrop Optimal Equilibrium:
- Recommended Diversion Split: ${data.recommended_diversion_pct.toFixed(1)}% via VMS Gantries
- Equilibrium Travel Time: ${data.optimal_equilibrium_time_min.toFixed(1)} min
- Time Saved Per Vehicle: ${data.time_saved_per_vehicle_min.toFixed(1)} min
- System Vehicle-Hours Saved Daily: ${Math.round(data.system_hours_saved_daily)} veh-hrs/day
VMS Broadcast Message: ${data.vms_advisory_en}`;

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
            <GitFork className="w-6 h-6 text-cyan-400" />
            {isAr ? 'موازن المحاور المتوازية وتحويل التدفق الذكي (BPR)' : 'Parallel Corridor Diversion Balancer (BPR & Wardrop)'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'نمذجة منحنى BPR لحساب التوازن الحركي لـ Wardrop وتحديد نسبة التحويل المثلى للوحات الإرشادية VMS'
              : 'Bureau of Public Roads (BPR) Link-Performance Functions & Dynamic VMS Overhead Diversion Split %'}
          </p>
        </div>

        {data && (
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                data.vms_switch_active
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              {data.vms_switch_active
                ? (isAr ? `تفعيل تحويل المسار (${Math.round(data.recommended_diversion_pct)}%)` : `VMS DIVERSION ACTIVE (${Math.round(data.recommended_diversion_pct)}%)`)
                : (isAr ? 'المسار الطبيعي كافٍ' : 'NO DIVERSION REQUIRED')}
            </span>

            <button
              onClick={handleCopyDirective}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'نسخ أمر العمليات' : 'Copy Directive')}
            </button>
          </div>
        )}
      </div>

      {/* Control Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Total Demand */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'إجمالي التدفق المتزامن' : 'Total Corridor Demand'}</span>
            <span className="text-emerald-400 font-bold font-mono">{totalDemand} veh/h</span>
          </div>
          <input
            type="range"
            min={3000}
            max={11000}
            step={250}
            value={totalDemand}
            onChange={(e) => setTotalDemand(Number(e.target.value))}
            className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>3,000</span>
            <span>11,000 veh/h</span>
          </div>
        </div>

        {/* Incident Factor on Primary */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              {isAr ? 'معامل تعطل المحور الرئيسي' : 'Primary Bottleneck Factor'}
            </span>
            <span className="text-rose-400 font-bold font-mono">x{incidentFactor.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={1.0}
            max={2.5}
            step={0.1}
            value={incidentFactor}
            onChange={(e) => setIncidentFactor(Number(e.target.value))}
            className="w-full accent-rose-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>x1.0 ({isAr ? 'طبيعي' : 'Normal'})</span>
            <span>x2.5 ({isAr ? 'حادث جسيم' : 'Major Crash'})</span>
          </div>
        </div>

        {/* Primary Corridor Capacity */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'سعة المحور الرئيسي' : 'Primary Capacity'}</span>
            <span className="text-cyan-400 font-bold font-mono">{primaryCap} veh/h</span>
          </div>
          <input
            type="range"
            min={3000}
            max={7000}
            step={200}
            value={primaryCap}
            onChange={(e) => setPrimaryCap(Number(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>3,000</span>
            <span>7,000 veh/h</span>
          </div>
        </div>

        {/* Alternate Corridor Capacity */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'سعة المحور البديل' : 'Alternate Capacity'}</span>
            <span className="text-amber-400 font-bold font-mono">{alternateCap} veh/h</span>
          </div>
          <input
            type="range"
            min={3000}
            max={8000}
            step={200}
            value={alternateCap}
            onChange={(e) => setAlternateCap(Number(e.target.value))}
            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>3,000</span>
            <span>8,000 veh/h</span>
          </div>
        </div>

        {/* Primary Free Flow Time */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'زمن الانسياب الأساسي' : 'Primary Base Time'}</span>
            <span className="text-slate-200 font-bold font-mono">{primaryT0} min</span>
          </div>
          <input
            type="range"
            min={10}
            max={30}
            step={1}
            value={primaryT0}
            onChange={(e) => setPrimaryT0(Number(e.target.value))}
            className="w-full accent-slate-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>10 min</span>
            <span>30 min</span>
          </div>
        </div>
      </div>

      {/* 60fps Parallel Corridor Fork Canvas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Split className="w-4 h-4 text-cyan-400" />
            {isAr ? 'المحاكي البصري لتفريع المركبات وموازنة المسارات (60fps)' : 'Dual Parallel Corridor Diverge Fork Canvas (60fps)'}
          </span>
          <span className="text-[11px] text-slate-500">
            {isAr ? 'محاكاة ديناميكية لتوجيه المركبات عبر اللوحات الإرشادية VMS' : 'Interactive vehicle routing & real-time travel times'}
          </span>
        </div>
        <DiversionForkCanvas
          primaryName={primaryName}
          alternateName={alternateName}
          primaryFlowVph={data ? data.optimal_primary_flow_vph : 4200}
          alternateFlowVph={data ? data.optimal_alternate_flow_vph : 3300}
          primaryTimeMin={data ? data.optimal_equilibrium_time_min : 24.5}
          alternateTimeMin={data ? data.optimal_equilibrium_time_min : 24.5}
          diversionPct={data ? data.recommended_diversion_pct : 42}
          vmsActive={data ? data.vms_switch_active : true}
          incidentFactor={incidentFactor}
          language={language}
        />
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={isAr ? 'نسبة التحويل الموصى بها' : 'Recommended Diversion'}
            value={`${data.recommended_diversion_pct.toFixed(1)}%`}
            subtitle={isAr ? `توجيه نحو ${alternateName}` : `Divert via ${alternateName}`}
            variant={data.recommended_diversion_pct > 30 ? 'warning' : 'neutral'}
            accent="border-emerald-500/40"
          />

          <KpiCard
            title={isAr ? 'التوفير في زمن الرحلة' : 'Trip Time Saved'}
            value={`${data.time_saved_per_vehicle_min.toFixed(1)} min`}
            subtitle={isAr ? 'لكل مركبة تعبر المحور' : 'Per traversing vehicle'}
            variant="success"
            accent="border-cyan-500/40"
          />

          <KpiCard
            title={isAr ? 'ساعات التأخير الموفرة للمجتمع' : 'System Hours Saved'}
            value={`${Math.round(data.system_hours_saved_daily)} hrs/day`}
            subtitle={isAr ? 'إجمالي الساعات الموفرة للشبكة يومياً' : 'Total vehicle-hours saved daily'}
            variant="success"
            accent="border-amber-500/40"
          />

          <KpiCard
            title={isAr ? 'تحسن كفاءة الشبكة' : 'Network Efficiency Gain'}
            value={`+${data.network_efficiency_gain_pct.toFixed(1)}%`}
            subtitle={isAr ? 'انخفاض في مجموع أزمنة التنقل' : 'Reduction in aggregate network delay'}
            variant="success"
            accent="border-blue-500/40"
          />
        </div>
      )}

      {/* BPR Dual-Corridor Equilibrium Crossover Curve (36-Point Sweep) */}
      {data && data.diversion_curve && data.diversion_curve.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                {isAr
                  ? 'منحنى تقاطع توازن واردروب لزمن الرحلة (BPR Equilibrium Crossover)'
                  : 'BPR Equilibrium Crossover Curve: Primary vs Alternate Travel Time'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isAr
                  ? `نقطة تقاطع الخطين تحدد نسبة التحويل المثلى (${data.recommended_diversion_pct}%) التي تساوي زمن الرحلة بين المحورين`
                  : `Intersection point identifies the exact optimal diversion split (${data.recommended_diversion_pct}%) that equalizes travel times`}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                {isAr ? `التقاطع الأمثل: ${data.recommended_diversion_pct}%` : `Equilibrium: ${data.recommended_diversion_pct}%`}
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.diversion_curve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="diversion_pct" stroke="#64748b" tickFormatter={(v) => `${v}%`} textAnchor="middle" />
                <YAxis stroke="#64748b" unit="m" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem' }}
                  formatter={(val: number, name: string) => [
                    `${val} min`,
                    name === 'primary_time_min' ? primaryName : alternateName,
                  ]}
                />
                <Legend />
                <ReferenceLine x={data.recommended_diversion_pct} stroke="#4ade80" strokeDasharray="3 3" label={{ value: 'Equilibrium Split', fill: '#4ade80', fontSize: 10 }} />
                <Line type="monotone" dataKey="primary_time_min" stroke="#38bdf8" strokeWidth={2.5} dot={false} name={primaryName} />
                <Line type="monotone" dataKey="alt_time_min" stroke="#f59e0b" strokeWidth={2.5} dot={false} name={alternateName} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Comparison Matrix & VMS Broadcast Sign */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Quo vs Wardrop Equilibrium Matrix */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  {isAr ? 'مصفوفة المقارنة: الوضع الراهن مقابل التوازن الذكي' : 'Status Quo vs. Wardrop Equilibrium'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  BPR VERIFIED
                </span>
              </div>

              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs text-start">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                      <th className="py-2 text-start">{isAr ? 'المعيار' : 'Metric'}</th>
                      <th className="py-2 text-center text-rose-400">{isAr ? 'الوضع الراهن' : 'Do Nothing'}</th>
                      <th className="py-2 text-center text-emerald-400">{isAr ? 'التوازن الذكي' : 'With DSS VMS'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    <tr>
                      <td className="py-2.5 text-slate-300 font-sans">{isAr ? 'زمن المحور الرئيسي' : 'Primary Route Time'}</td>
                      <td className="py-2.5 text-center text-rose-400 font-bold">{data.do_nothing_primary_time_min.toFixed(1)} min</td>
                      <td className="py-2.5 text-center text-emerald-400 font-bold">{data.optimal_equilibrium_time_min.toFixed(1)} min</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-300 font-sans">{isAr ? 'زمن المحور البديل' : 'Alternate Route Time'}</td>
                      <td className="py-2.5 text-center text-slate-400">{data.do_nothing_alternate_time_min.toFixed(1)} min</td>
                      <td className="py-2.5 text-center text-emerald-400 font-bold">{data.optimal_equilibrium_time_min.toFixed(1)} min</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-300 font-sans">{isAr ? 'تدفق المحور الرئيسي' : 'Primary Flow'}</td>
                      <td className="py-2.5 text-center text-slate-400">{Math.round(data.do_nothing_primary_flow_vph)} vph</td>
                      <td className="py-2.5 text-center text-slate-200">{Math.round(data.optimal_primary_flow_vph)} vph</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-300 font-sans">{isAr ? 'تدفق المحور البديل' : 'Alternate Flow'}</td>
                      <td className="py-2.5 text-center text-slate-400">{Math.round(data.do_nothing_alternate_flow_vph)} vph</td>
                      <td className="py-2.5 text-center text-emerald-400">{Math.round(data.optimal_alternate_flow_vph)} vph</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
              {isAr
                ? 'يحقق حل واردروب (Wardrop) تساوياً في أزمنة الرحلة عبر كافة المحاور البديلة بحيث لا يستطيع أي سائق تقليص زمن رحلته بمفرده.'
                : 'Wardrop 1st Principle guarantees equalized travel times across paths so no driver can unilaterally improve travel time.'}
            </div>
          </div>

          {/* Overhead VMS Display Simulator */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Radio className="w-4 h-4 text-amber-400" />
                  {isAr ? 'شاشات الرسائل المتغيرة قبل مفترق الطرق (VMS Gantry)' : 'Pre-Diverge VMS Gantry Broadcast'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  REAL-TIME OVERHEAD
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                {isAr
                  ? 'الرسالة التوجيهية الحية لبوابة تحويل المسار قبل التفرع بمسافة 1,500 متر'
                  : 'Dynamic advisory gantry message displayed 1,500m before the corridor diverge'}
              </p>
            </div>

            {/* LED Screen */}
            <div className="bg-black border-4 border-slate-700 rounded-lg p-4 font-mono text-center shadow-inner my-2">
              <div className="text-amber-400 text-sm md:text-base font-extrabold tracking-wider leading-relaxed animate-pulse">
                {isAr ? data.vms_advisory_ar : data.vms_advisory_en}
              </div>
              <div className="text-slate-500 text-[10px] mt-2 border-t border-slate-800 pt-2 flex justify-between">
                <span>VMS GANTRY #01 - DIVERGE FORK</span>
                <span>WARDROP AUTO-BALANCED</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 mt-2">
              {isAr
                ? 'يؤدي بث زمن الرحلة المقارن إلى التزام ما بين 35% إلى 55% من السائقين بالتحويل الطوعي للمحور الأسرع.'
                : 'Displaying comparative travel times elicits voluntary diversion compliance of 35% - 55% of drivers.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
