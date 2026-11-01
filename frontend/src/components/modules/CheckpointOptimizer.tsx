import React, { useState, useEffect } from 'react';
import { ShieldCheck, Zap, AlertTriangle, Clock, Layers, Users, Sliders, Copy, Check, CheckCircle2 } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { CheckpointFunnelCanvas } from '../simulation/CheckpointFunnelCanvas';
import { CheckpointResponse, optimizeCheckpointAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface CheckpointOptimizerProps {
  language: Language;
}

export const CheckpointOptimizer: React.FC<CheckpointOptimizerProps> = ({ language }) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [inboundFlow, setInboundFlow] = useState<number>(2400);
  const [totalBooths, setTotalBooths] = useState<number>(8);
  const [openBooths, setOpenBooths] = useState<number>(5);
  const [boothType, setBoothType] = useState<string>('mixed');
  const [heavyPct, setHeavyPct] = useState<number>(18);
  const [targetMaxWait, setTargetMaxWait] = useState<number>(60);
  const [data, setData] = useState<CheckpointResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Keep openBooths within totalBooths
  useEffect(() => {
    if (openBooths > totalBooths) {
      setOpenBooths(totalBooths);
    }
  }, [totalBooths, openBooths]);

  const runOptimizer = async () => {
    setLoading(true);
    try {
      const res = await optimizeCheckpointAPI({
        checkpoint_id: 'toll_cairo_alex_km26',
        inbound_flow_veh_per_hour: inboundFlow,
        total_booths: totalBooths,
        open_booths: openBooths,
        booth_type: boothType,
        service_rate_per_booth_vph: boothType === 'rfid' ? 550 : boothType === 'manual' ? 220 : boothType === 'security' ? 95 : 280,
        heavy_vehicle_share_pct: heavyPct,
        target_max_wait_sec: targetMaxWait,
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
    runOptimizer();
  }, [inboundFlow, totalBooths, openBooths, boothType, heavyPct, targetMaxWait]);

  const handleCopyDirective = () => {
    if (!data) return;
    const directive = isAr
      ? `[تعليمات تشغيل محطة الرسوم ونقطة التفتيش الأمني]
الموقع: محطة بوابات القاهرة / الكيلو 26
التدفق الوارد: ${data.inbound_flow_veh_per_hour} مركبة/ساعة
الحارات العاملة حالياً: ${data.open_booths} من إجمالي ${data.total_booths} حارة
كثافة الاستيعاب (Rho): ${(data.traffic_intensity_rho * 100).toFixed(1)}% | متوسط الانتظار: ${Math.round(data.avg_wait_time_sec)} ثانية
طول الطابور التراكمي: ${Math.round(data.queue_length_m)} متر (${data.avg_queue_veh} مركبة)
بروتوكول التجاوز الأخضر 180s: ${data.green_bypass_triggered ? `مفعل إجبارياً! فتح ${data.bypass_lanes_to_open} حارات عبور مجاني بدون توقف` : 'غير مفعل (وضع التشغيل الاعتيادي)'}
الحل الأمثل الموصى به: تشغيل ${data.optimal_open_booths} حارات لتحقيق زمن انتظار أقل من ${targetMaxWait} ثانية
توزيع الحارات:
${data.booth_allocation_ar.map((b, i) => `${i + 1}. ${b}`).join('\n')}`
      : `[TOLL PLAZA & SECURITY CHECKPOINT OPERATIONS DIRECTIVE]
Location: Cairo / Km 26 Toll Gantry
Inbound Flow: ${data.inbound_flow_veh_per_hour} veh/h
Open Booths: ${data.open_booths} / ${data.total_booths}
Traffic Intensity (Rho): ${(data.traffic_intensity_rho * 100).toFixed(1)}% | Average Wait: ${Math.round(data.avg_wait_time_sec)}s
Queue Length: ${Math.round(data.queue_length_m)}m (${data.avg_queue_veh} veh)
180-Second Green Bypass: ${data.green_bypass_triggered ? `TRIGGERED! Open ${data.bypass_lanes_to_open} free-flow bypass lanes immediately` : 'STANDBY (Normal service)'}
Recommended Configuration: Open ${data.optimal_open_booths} booths to keep wait < ${targetMaxWait}s
Lane Allocation:
${data.booth_allocation_en.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;

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
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            {isAr ? 'محسن بوابات الرسوم ونقاط التفتيش الأمني' : 'Security Checkpoint & Toll-Plaza Optimizer (M/M/c)'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'نمذجة طوابير الانتظار M(t)/M(t)/c وتخصيص الحارات وتفعيل الفتح التلقائي لتجاوز طابور 180 ثانية'
              : 'Funnel Queuing Physics, Dynamic Booth Reallocation & 180-Second Anti-Gridlock Green Bypass Trigger'}
          </p>
        </div>

        {data && (
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                data.green_bypass_triggered
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/40 animate-pulse'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              {data.green_bypass_triggered
                ? (isAr ? 'تجاوز 180 ثانية مفعل!' : '180s GREEN BYPASS ACTIVE')
                : (isAr ? 'الانسياب طبيعي' : 'FLOW CONTROL STABLE')}
            </span>

            <button
              onClick={handleCopyDirective}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'نسخ أمر التشغيل' : 'Copy Directive')}
            </button>
          </div>
        )}
      </div>

      {/* Control Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Inbound Flow */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'التدفق الوارد' : 'Inbound Flow'}</span>
            <span className="text-emerald-400 font-bold font-mono">{inboundFlow} veh/h</span>
          </div>
          <input
            type="range"
            min={600}
            max={5000}
            step={100}
            value={inboundFlow}
            onChange={(e) => setInboundFlow(Number(e.target.value))}
            className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>600</span>
            <span>5,000 veh/h</span>
          </div>
        </div>

        {/* Total Booths */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'إجمالي البوابات' : 'Total Booths (N)'}</span>
            <span className="text-cyan-400 font-bold font-mono">{totalBooths}</span>
          </div>
          <input
            type="range"
            min={4}
            max={14}
            step={1}
            value={totalBooths}
            onChange={(e) => setTotalBooths(Number(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>4</span>
            <span>14 booths</span>
          </div>
        </div>

        {/* Currently Open Booths */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'البوابات المفتوحة' : 'Open Booths (c)'}</span>
            <span className="text-amber-400 font-bold font-mono">{openBooths} / {totalBooths}</span>
          </div>
          <input
            type="range"
            min={1}
            max={totalBooths}
            step={1}
            value={openBooths}
            onChange={(e) => setOpenBooths(Number(e.target.value))}
            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>1</span>
            <span>{totalBooths} booths</span>
          </div>
        </div>

        {/* Booth Type */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'طبيعة الخدمة' : 'Service Type'}
          </label>
          <div className="grid grid-cols-2 gap-1 mt-1">
            {[
              { id: 'rfid', labelEn: 'RFID Tag', labelAr: 'إلكتروني' },
              { id: 'mixed', labelEn: 'Mixed', labelAr: 'مختلط' },
              { id: 'manual', labelEn: 'Cash', labelAr: 'نقدي' },
              { id: 'security', labelEn: 'Security', labelAr: 'تفتيش' },
            ].map((type) => (
              <button
                key={type.id}
                onClick={() => setBoothType(type.id)}
                className={`py-1 text-[11px] font-semibold rounded border transition-all text-center ${
                  boothType === type.id
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
                }`}
              >
                {isAr ? type.labelAr : type.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Heavy Vehicle Share */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'نسبة النقل الثقيل' : 'Heavy Share %'}</span>
            <span className="text-rose-400 font-bold font-mono">{heavyPct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            step={2}
            value={heavyPct}
            onChange={(e) => setHeavyPct(Number(e.target.value))}
            className="w-full accent-rose-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>0%</span>
            <span>40%</span>
          </div>
        </div>

        {/* Target Wait Threshold */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'سقف الانتظار المستهدف' : 'Target Max Wait'}</span>
            <span className="text-blue-400 font-bold font-mono">{targetMaxWait}s</span>
          </div>
          <input
            type="range"
            min={30}
            max={180}
            step={10}
            value={targetMaxWait}
            onChange={(e) => setTargetMaxWait(Number(e.target.value))}
            className="w-full accent-blue-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>30s</span>
            <span>180s (Bypass)</span>
          </div>
        </div>
      </div>

      {/* 60fps Funnel Canvas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            {isAr ? 'المحاكي البصري لقمع البوابات والتدفق الحركي (60fps)' : '4-into-N Toll Plaza Funnel Canvas (60fps)'}
          </span>
          <span className="text-[11px] text-slate-500">
            {isAr ? 'محاكاة حركة المركبات وتفريغ الطوابير وبوابات العبور السريع' : 'Real-time vehicle movement & dynamic gate allocation'}
          </span>
        </div>
        <CheckpointFunnelCanvas
          totalBooths={totalBooths}
          openBooths={openBooths}
          inboundFlowVph={inboundFlow}
          avgWaitSec={data ? data.avg_wait_time_sec : 45}
          queueMeters={data ? data.queue_length_m : 80}
          greenBypassActive={data ? data.green_bypass_triggered : false}
          boothType={boothType}
          language={language}
        />
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={isAr ? 'كثافة استيعاب المحطة (Rho)' : 'Traffic Intensity (ρ)'}
            value={`${(data.traffic_intensity_rho * 100).toFixed(1)}%`}
            subtitle={data.traffic_intensity_rho >= 1.0 ? (isAr ? 'تجاوز السعة القصوى (تكدس)' : 'Oversaturated (Queue Expanding)') : (isAr ? 'ضمن السعة المتاحة' : 'Sub-critical demand')}
            variant={data.traffic_intensity_rho >= 1.0 ? 'danger' : data.traffic_intensity_rho > 0.85 ? 'warning' : 'success'}
            accent="border-emerald-500/40"
          />

          <KpiCard
            title={isAr ? 'متوسط زمن الانتظار' : 'Average Delay (Wq)'}
            value={`${Math.round(data.avg_wait_time_sec)} sec`}
            subtitle={isAr ? `مستوى الخدمة: LoS ${data.level_of_service}` : `Level of Service: LoS ${data.level_of_service}`}
            variant={data.avg_wait_time_sec > 180 ? 'danger' : data.avg_wait_time_sec > targetMaxWait ? 'warning' : 'success'}
            accent="border-cyan-500/40"
          />

          <KpiCard
            title={isAr ? 'طول الطابور التراكمي' : 'Queue Length (Tail)'}
            value={`${Math.round(data.queue_length_m)} m`}
            subtitle={isAr ? `${data.avg_queue_veh} مركبة منتظرة بالقمع` : `${data.avg_queue_veh} vehicles queuing in funnel`}
            variant={data.queue_length_m > 600 ? 'danger' : data.queue_length_m > 300 ? 'warning' : 'neutral'}
            accent="border-amber-500/40"
          />

          <KpiCard
            title={isAr ? 'البوابات الموصى بتشغيلها' : 'Optimal Open Booths'}
            value={`${data.optimal_open_booths} / ${data.total_booths}`}
            subtitle={data.optimal_open_booths > openBooths ? (isAr ? `افتح +${data.optimal_open_booths - openBooths} حارات إضافية` : `Open +${data.optimal_open_booths - openBooths} additional booths`) : (isAr ? 'العدد الحالي كافٍ ومثالي' : 'Current staffing adequate')}
            variant={data.optimal_open_booths > openBooths ? 'warning' : 'success'}
            accent="border-blue-500/40"
          />
        </div>
      )}

      {/* Operational Allocation & Green Bypass Directive */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Lane Configuration and Dynamic Allocation */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {isAr ? 'مخطط التوزيع التكتيكي للحارات (Gate Allocation)' : 'Tactical Booth Lane Allocation'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  OPTIMIZED
                </span>
              </div>

              <div className="space-y-2 mt-3">
                {(isAr ? data.booth_allocation_ar : data.booth_allocation_en).map((booth, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-200"
                  >
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed">{booth}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
              <span>{isAr ? data.mitigation_strategy_ar : data.mitigation_strategy_en}</span>
            </div>
          </div>

          {/* 180s Green Bypass Override Action Panel */}
          <div className={`rounded-xl p-5 shadow-lg flex flex-col justify-between border ${
            data.green_bypass_triggered
              ? 'bg-rose-950/20 border-rose-500/40'
              : 'bg-slate-900 border-slate-800'
          }`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-slate-200">
                  <Zap className={`w-4 h-4 ${data.green_bypass_triggered ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`} />
                  {isAr ? 'بروتوكول تفريغ التكدس (180s Green Bypass)' : 'Anti-Gridlock 180s Green Bypass Protocol'}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  data.green_bypass_triggered
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {data.green_bypass_triggered ? 'TRIGGERED' : 'STANDBY'}
                </span>
              </div>

              <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-2 mt-3">
                <p className="font-semibold text-slate-100 flex items-center gap-2">
                  <AlertTriangle className={`w-4 h-4 ${data.green_bypass_triggered ? 'text-rose-400' : 'text-amber-400'}`} />
                  {isAr ? 'شرط التدخل القانوني لمنع شلل المحاور:' : 'Statutory Anti-Gridlock Trigger Condition:'}
                </p>
                <p className="leading-relaxed text-slate-400">
                  {isAr
                    ? 'إذا تجاوز متوسط انتظار المركبات 180 ثانية أو امتد الطابور لأكثر من 650 متراً نحو مطالع المحور الرئيسي، يُلزم ضابط العمليات بفتح البوابات كحارات مرور حر مجانية فوراً لمنع شلل شريان المحور.'
                    : 'If average queue delay exceeds 180 seconds or queue reaches 650m near arterial mainline exits, toll gates MUST automatically open into free-flow bypass lanes to prevent mainline arterial gridlock.'}
                </p>

                {data.green_bypass_triggered && (
                  <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 font-bold mt-2">
                    {isAr
                      ? `⚠️ تم تفعيل الشرط: افتح فوراً عدد (${data.bypass_lanes_to_open}) حارات للعبور الحر بدون توقف حتى انخفاض الطابور إلى أقل من 250 متراً.`
                      : `⚠️ CONDITION MET: Immediately lock open ${data.bypass_lanes_to_open} bypass gates until queue drops below 250m.`}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 flex justify-between">
              <span>{isAr ? 'نظام تحكم بوابات الرسوم الذكية' : 'Intelligent Toll Gantry Control'}</span>
              <span>{isAr ? 'تأكيد الحماية من الشلل' : 'Anti-Spillback Safe'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
