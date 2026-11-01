import React, { useState, useEffect } from 'react';
import { GitMerge, Shield, Zap, AlertTriangle, Clock, Layers, Sliders, Copy, Check, CheckCircle2 } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { RampMergeCanvas } from '../simulation/RampMergeCanvas';
import { RampMeteringResponse, evaluateRampMeteringAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface RampMergeControllerProps {
  corridorId: string;
  language: Language;
}

export const RampMergeController: React.FC<RampMergeControllerProps> = ({ corridorId, language }) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [mainlineFlow, setMainlineFlow] = useState<number>(5800);
  const [rampDemand, setRampDemand] = useState<number>(1100);
  const [heavyPct, setHeavyPct] = useState<number>(16);
  const [controlMode, setControlMode] = useState<string>('ALINEA_METERED');

  const [data, setData] = useState<RampMeteringResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchRampData = async () => {
    setLoading(true);
    try {
      const res = await evaluateRampMeteringAPI({
        corridor_id: corridorId,
        mainline_flow_pce: mainlineFlow,
        ramp_demand_pce: rampDemand,
        heavy_pct: heavyPct,
        control_mode: controlMode,
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
    fetchRampData();
  }, [corridorId, mainlineFlow, rampDemand, heavyPct, controlMode]);

  const handleCopyDirective = () => {
    if (!data) return;
    const directive = isAr
      ? `[تعليمات العمليات المرورية - التحكم الذكي في مطالع الكباري والاندماج]
المحور: ${corridorId}
التدفق على المحور الرئيسي: ${data.mainline_flow_pce} م.ر/ساعة | طلب المطلع: ${data.ramp_demand_pce} م.ر/ساعة
الحل الموصى به: ${data.recommended_mode}
زمن دورة إشارة المطلع ALINEA: ${data.signal_cycle_sec} ثانية/مركبة (معدل الإطلاق: ${data.metering_rate_pce_h} م.ر/س)
حاجز التوجيه الخرساني: ${data.barrier_length_m} متراً
توجيهات العمليات الميدانية:
${data.sop_directives_ar.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : `[TRAFFIC OPERATIONS DIRECTIVE - ON-RAMP METERING & MERGE CONTROL]
Corridor: ${corridorId}
Mainline Flow: ${data.mainline_flow_pce} PCE/h | Ramp Demand: ${data.ramp_demand_pce} PCE/h
Recommended Strategy: ${data.recommended_mode}
ALINEA Metering Cycle: ${data.signal_cycle_sec}s per vehicle (Release Rate: ${data.metering_rate_pce_h} PCE/h)
Channelized Barrier Length: ${data.barrier_length_m}m
Field Operations Directives:
${data.sop_directives_en.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

    navigator.clipboard.writeText(directive);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const selectedModeData = data?.modes.find((m) => m.mode_id === controlMode) || data?.modes[1];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
            <GitMerge className="w-6 h-6 text-sky-400" />
            {isAr ? 'التحكم الذكي في إشارات ومطالع الكباري (ALINEA)' : 'Smart On-Ramp Metering & Merge Controller (ALINEA)'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'معالجة انهيار السعة الناتج عن اضطراب الاندماج العشوائي بحواجز التوجيه وإشارات التفويج النبضي'
              : 'Mitigating merge turbulence capacity drops via ALINEA feedback regulation & 180m channelized barrier curbs'}
          </p>
        </div>

        {data && (
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-full text-xs font-bold border border-sky-500/40 bg-sky-500/10 text-sky-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-sky-400" />
              {isAr ? `الحل الأفضل: ${data.recommended_mode}` : `Optimal: ${data.recommended_mode}`}
            </span>

            <button
              onClick={handleCopyDirective}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'نسخ أمر العمليات' : 'Copy Directive')}
            </button>
          </div>
        )}
      </div>

      {/* Control Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Mainline Flow */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'تدفق المحور الرئيسي' : 'Mainline Arterial Flow'}</span>
            <span className="text-sky-400 font-bold font-mono">{mainlineFlow} PCE/h</span>
          </div>
          <input
            type="range"
            min={2000}
            max={7500}
            step={100}
            value={mainlineFlow}
            onChange={(e) => setMainlineFlow(Number(e.target.value))}
            className="w-full accent-sky-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>2,000</span>
            <span>7,500 PCE/h</span>
          </div>
        </div>

        {/* Ramp Demand */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'حجم حركة المطلع' : 'On-Ramp Demand'}</span>
            <span className="text-emerald-400 font-bold font-mono">{rampDemand} PCE/h</span>
          </div>
          <input
            type="range"
            min={200}
            max={2200}
            step={50}
            value={rampDemand}
            onChange={(e) => setRampDemand(Number(e.target.value))}
            className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>200</span>
            <span>2,200 PCE/h</span>
          </div>
        </div>

        {/* Heavy Vehicle Share */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">{isAr ? 'نسبة الشاحنات والنقل' : 'Heavy Trucks Share'}</span>
            <span className="text-rose-400 font-bold font-mono">{heavyPct}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={35}
            step={1}
            value={heavyPct}
            onChange={(e) => setHeavyPct(Number(e.target.value))}
            className="w-full accent-rose-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>5%</span>
            <span>35%</span>
          </div>
        </div>

        {/* Control Mode Toggle */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'نمط التحكم التكتيكي' : 'Operational Strategy'}
          </label>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {[
              { id: 'UNCONTROLLED', labelEn: 'Uncontrolled', labelAr: 'حر' },
              { id: 'ALINEA_METERED', labelEn: 'ALINEA', labelAr: 'إشارة' },
              { id: 'CHANNELIZED_BARRIER', labelEn: 'Barrier', labelAr: 'حاجز' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setControlMode(m.id)}
                className={`py-1.5 text-[11px] font-semibold rounded border transition-all text-center ${
                  controlMode === m.id
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
                }`}
              >
                {isAr ? m.labelAr : m.labelEn}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 60fps Ramp Merge Canvas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-sky-400" />
            {isAr ? 'المحاكي البصري اللحظي لاندماج المطلع وإشارة ALINEA (60fps)' : 'Real-time Mainline + On-Ramp Simulation (60fps)'}
          </span>
          <span className="text-[11px] text-slate-500">
            {isAr ? 'محاكاة ديناميكية لنبضات الإشارة وحاجز التوجيه الخرساني' : 'Simulating pulse green releases and channelized merge barrier'}
          </span>
        </div>
        <RampMergeCanvas
          mainlineFlowPce={mainlineFlow}
          rampDemandPce={rampDemand}
          controlMode={controlMode}
          signalCycleSec={data ? data.signal_cycle_sec : 4.5}
          mainlineSpeedKmh={selectedModeData ? selectedModeData.mainline_speed_kmh : 65}
          heavyPct={heavyPct}
          language={language}
        />
      </div>

      {/* 3-Mode Comparison Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.modes.map((m) => {
            const isSelected = m.mode_id === controlMode;
            const isWinning = m.mode_id === data.recommended_mode;

            return (
              <div
                key={m.mode_id}
                onClick={() => setControlMode(m.mode_id)}
                className={`cursor-pointer rounded-xl p-4 border transition-all ${
                  isSelected
                    ? 'bg-slate-900 border-sky-500 shadow-lg shadow-sky-500/10'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    {isAr ? m.mode_name_ar : m.mode_name_en}
                  </h4>
                  {isWinning && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                      {isAr ? 'الأمثل' : 'RECOMMENDED'}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-xs font-mono mt-3">
                  <div className="flex justify-between text-slate-400">
                    <span>{isAr ? 'السعة الفعالة' : 'Effective Capacity'}:</span>
                    <span className="text-slate-100 font-bold">{m.effective_capacity_pce} PCE/h</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{isAr ? 'سرعة المحور' : 'Mainline Speed'}:</span>
                    <span className={m.mainline_speed_kmh < 40 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {m.mainline_speed_kmh} km/h
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{isAr ? 'فقد السعة' : 'Capacity Drop'}:</span>
                    <span className={m.capacity_loss_pct > 15 ? 'text-rose-400' : 'text-slate-300'}>
                      -{m.capacity_loss_pct}%
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{isAr ? 'مستوى الخدمة' : 'LoS'}:</span>
                    <span className="text-sky-400 font-bold">LoS {m.level_of_service}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Field SOP Card */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-sky-400" />
              {isAr ? 'التوجيه الميداني لضباط العمليات والمرور' : 'Operational Field SOP Directive'}
            </span>
            <span className="text-xs text-slate-500 font-mono">
              ALINEA Feedback Law v2.4
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div className="space-y-2">
              {(isAr ? data.sop_directives_ar : data.sop_directives_en).slice(0, 3).map((s, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center text-[10px]">
                    {idx + 1}
                  </span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(isAr ? data.sop_directives_ar : data.sop_directives_en).slice(3).map((s, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center text-[10px]">
                    {idx + 4}
                  </span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
