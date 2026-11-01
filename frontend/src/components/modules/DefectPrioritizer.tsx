import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Hammer, Wrench, AlertTriangle, Clock, TrendingUp, Copy, Check, CheckCircle2, ShieldAlert } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { DefectRoiResponse, evaluateDefectRoiAPI } from '../../api/client';
import { BridgeDefectCanvas } from '../simulation/BridgeDefectCanvas';
import { Language, translations } from '../../i18n/translations';

interface DefectPrioritizerProps {
  corridorId: string;
  language: Language;
}

export const DefectPrioritizer: React.FC<DefectPrioritizerProps> = ({ corridorId, language }) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [defectType, setDefectType] = useState<string>('DAMAGED_EXPANSION_JOINT');
  const [crawlSpeed, setCrawlSpeed] = useState<number>(15);
  const [affectedLanes, setAffectedLanes] = useState<number>(2);
  const [repairHours, setRepairHours] = useState<number>(4);

  const [data, setData] = useState<DefectRoiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchDefectData = async () => {
    setLoading(true);
    try {
      const res = await evaluateDefectRoiAPI({
        corridor_id: corridorId,
        defect_type: defectType,
        crawl_speed_kmh: crawlSpeed,
        affected_lanes: affectedLanes,
        repair_hours: repairHours,
        speed_limit_kmh: 80,
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
    fetchDefectData();
  }, [corridorId, defectType, crawlSpeed, affectedLanes, repairHours]);

  const handleCopyDirective = () => {
    if (!data) return;
    const topDefect = data.corridor_defect_inventory[0];
    const directive = isAr
      ? `[أمر عمليات هيئة الطرق - خطة الصيانة السريعة لفواصل وعيوب الرصف]
المحور: ${corridorId}
العيب ذو الأولوية القصوى (المرتبة 1): ${topDefect.defect_name_ar} (${topDefect.km_marker})
معدل العائد الاستثماري (ROI): ${Math.round(topDefect.roi_phd_per_repair_hour)} ساعة تأخير موفرة لكل ساعة صيانة
إجمالي التأخير المهدر يومياً: ${Math.round(topDefect.daily_wasted_phd)} ساعة ركاب/يوم (PHD)
النافذة الزمنية الموصى بها: ${topDefect.recommended_window}
إجراءات الصيانة والسلامة:
${data.sop_directives_ar.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : `[ROAD AUTHORITY DIRECTIVE - EXPANSION JOINT & DEFECT RESTORATION PLAN]
Corridor: ${corridorId}
Top Priority Defect (Rank #1): ${topDefect.defect_name_en} (${topDefect.km_marker})
ROI Score: ${Math.round(topDefect.roi_phd_per_repair_hour)} PHD saved per maintenance hour
Daily Wasted Delay: ${Math.round(topDefect.daily_wasted_phd)} Person-Hours of Delay (PHD/day)
Recommended Work Window: ${topDefect.recommended_window}
Field Directives:
${data.sop_directives_en.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

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
            <Hammer className="w-6 h-6 text-amber-400" />
            {isAr ? 'محدد أولويات إصلاح فواصل الكباري وعيوب الرصف (ROI)' : 'Bridge Joint & Surface Defect ROI Prioritizer'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'حساب السعة المهدرة وساعات التأخير اليومية وترتيب العيوب وفق أعلى عائد مجتمعي لساعات العمل'
              : 'Spot-crawl capacity reduction, 24h Person-Hours of Delay (PHD) integration, and repair ROI ranking'}
          </p>
        </div>

        {data && (
          <button
            onClick={handleCopyDirective}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'نسخ أمر الصيانة' : 'Copy Directive')}
          </button>
        )}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Defect Type */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'نوع العيب الإنشائي' : 'Structural Defect Type'}
          </label>
          <select
            value={defectType}
            onChange={(e) => setDefectType(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:border-amber-400"
          >
            <option value="DAMAGED_EXPANSION_JOINT">{isAr ? 'فاصل تمدد كوبري متضرر' : 'Damaged Bridge Joint'}</option>
            <option value="DEEP_POTHOLE_CLUSTER">{isAr ? 'تجمع حفر غائرة بالأسفلت' : 'Deep Pothole Cluster'}</option>
            <option value="ASPHALT_SUBSIDENCE">{isAr ? 'هبوط وتخدد أسفلتي' : 'Asphalt Subsidence & Rutting'}</option>
          </select>
        </div>

        {/* Crawl Speed */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'سرعة الزحف فوق العيب' : 'Spot Crawl Speed'}</span>
            <span className="text-amber-400 font-bold font-mono">{crawlSpeed} km/h</span>
          </div>
          <input
            type="range"
            min={10}
            max={45}
            step={5}
            value={crawlSpeed}
            onChange={(e) => setCrawlSpeed(Number(e.target.value))}
            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>10 km/h (زحف شديد)</span>
            <span>45 km/h</span>
          </div>
        </div>

        {/* Affected Lanes */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'عدد الحارات المتأثرة' : 'Affected Lanes'}
          </label>
          <div className="grid grid-cols-4 gap-1 mt-1">
            {[1, 2, 3, 4].map((l) => (
              <button
                key={l}
                onClick={() => setAffectedLanes(l)}
                className={`py-1.5 text-xs font-semibold rounded border transition-all text-center ${
                  affectedLanes === l
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
                }`}
              >
                {l} {isAr ? 'حارة' : 'Lane'}
              </button>
            ))}
          </div>
        </div>

        {/* Repair Duration */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'مدة الإصلاح التقديرية' : 'Estimated Repair Duration'}</span>
            <span className="text-cyan-400 font-bold font-mono">{repairHours} hrs</span>
          </div>
          <input
            type="range"
            min={2}
            max={8}
            step={0.5}
            value={repairHours}
            onChange={(e) => setRepairHours(Number(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>2 hrs</span>
            <span>8 hrs</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={isAr ? 'السعة الفعالة فوق موقع العيب' : 'Defect Bottleneck Capacity'}
            value={`${Math.round(data.active_defect_capacity_pce)} PCE/h`}
            subtitle={isAr ? `انخفاض سعة بمقدار -${data.capacity_reduction_pct}%` : `-${data.capacity_reduction_pct}% capacity drop`}
            variant="danger"
            accent="border-rose-500/40"
          />

          <KpiCard
            title={isAr ? 'ساعات التأخير المهدرة يومياً' : 'Daily Delay Wasted (PHD)'}
            value={`${Math.round(data.daily_wasted_phd).toLocaleString()} hrs`}
            subtitle={isAr ? 'ساعات ركاب تضيع يومياً بسبب العيب' : 'Person-Hours of Delay per day'}
            variant="warning"
            accent="border-amber-500/40"
          />

          <KpiCard
            title={isAr ? 'معامل العائد على الصيانة (ROI)' : 'ROI Priority Score'}
            value={`${Math.round(data.roi_phd_per_repair_hour).toLocaleString()}`}
            subtitle={isAr ? 'ساعة تأخير موفرة / ساعة عمل' : 'PHD saved per repair hour'}
            variant="success"
            accent="border-emerald-500/40"
          />

          <KpiCard
            title={isAr ? 'النافذة الليلية المثالية للإصلاح' : 'Optimal Night Window'}
            value={data.recommended_night_window}
            subtitle={isAr ? 'أدنى تأثير على انسياب المرور' : 'Lowest commuter traffic impact'}
            variant="neutral"
            accent="border-cyan-500/40"
          />
        </div>
      )}

      {/* 60FPS Bridge Defect & Spot-Crawl Micro-Simulation Canvas */}
      <BridgeDefectCanvas
        defectType={defectType}
        crawlSpeedKmh={crawlSpeed}
        affectedLanes={affectedLanes}
        speedLimitKmh={80}
        language={language}
      />

      {/* 24h Wasted Delay Chart */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                {isAr ? 'منحنى تراكم التأخير المهدر على مدار 24 ساعة (Wasted PHD Profile)' : '24-Hour Wasted Person-Hours of Delay (PHD) Profile'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isAr
                  ? 'مقارنة الطلب الحجمي بالسعة المخنوقة للعيب وبيان ساعات الذروة التي يتفجر فيها الطابور'
                  : 'Hourly traffic demand vs reduced bottleneck capacity demonstrating peak delay buildup'}
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.hourly_delay_curve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="phdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" stroke="#64748b" tickFormatter={(v) => `${v}:00`} textAnchor="middle" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem' }}
                  formatter={(val: number, name: string) => [
                    name === 'wasted_phd' ? `${Math.round(val)} hrs` : `${val} PCE/h`,
                    name === 'wasted_phd' ? 'Wasted PHD' : name === 'demand_pce' ? 'Demand' : 'Defect Capacity',
                  ]}
                />
                <Area type="monotone" dataKey="wasted_phd" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#phdGrad)" name="wasted_phd" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 5-Defect Ranked Priority Table */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              {isAr ? 'جدول أولويات إصلاح عيوب المحور وفق العائد الاستثماري (ROI Score Ranking)' : 'Corridor Defect Inventory Ranked by ROI Score'}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              5 DETECTED DEFECTS
            </span>
          </div>

          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs text-start">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3 text-start">#</th>
                  <th className="py-2.5 px-3 text-start">{isAr ? 'العيب الإنشائي والموقع' : 'Defect & Location'}</th>
                  <th className="py-2.5 px-3 text-center">{isAr ? 'الحارات' : 'Lanes'}</th>
                  <th className="py-2.5 px-3 text-center">{isAr ? 'سرعة الزحف' : 'Crawl Speed'}</th>
                  <th className="py-2.5 px-3 text-center">{isAr ? 'هبوط السعة' : 'Drop'}</th>
                  <th className="py-2.5 px-3 text-center text-amber-400">{isAr ? 'التأخير اليومي (PHD)' : 'Daily PHD'}</th>
                  <th className="py-2.5 px-3 text-center text-emerald-400 font-bold">{isAr ? 'معامل الأولوية (ROI)' : 'ROI Score'}</th>
                  <th className="py-2.5 px-3 text-end">{isAr ? 'النافذة الموصى بها' : 'Window'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {data.corridor_defect_inventory.map((d) => (
                  <tr key={d.defect_id} className={d.priority_rank === 1 ? 'bg-amber-500/5' : ''}>
                    <td className="py-3 px-3">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                        d.priority_rank === 1 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {d.priority_rank}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <span className="block font-bold text-slate-200">{isAr ? d.defect_name_ar : d.defect_name_en}</span>
                      <span className="text-[10px] text-slate-400">{d.km_marker}</span>
                    </td>
                    <td className="py-3 px-3 text-center text-slate-300">{d.affected_lanes}</td>
                    <td className="py-3 px-3 text-center text-amber-400 font-bold">{d.crawl_speed_kmh} km/h</td>
                    <td className="py-3 px-3 text-center text-rose-400">-{d.capacity_drop_pct}%</td>
                    <td className="py-3 px-3 text-center text-amber-300 font-bold">{Math.round(d.daily_wasted_phd).toLocaleString()} hrs</td>
                    <td className="py-3 px-3 text-center text-emerald-400 font-extrabold text-sm">{Math.round(d.roi_phd_per_repair_hour).toLocaleString()}</td>
                    <td className="py-3 px-3 text-end text-slate-300 font-sans text-[11px]">{d.recommended_window}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
