import React, { useState } from 'react';
import { FileText, Copy, Check, Printer, ShieldAlert } from 'lucide-react';

interface SopActionCardProps {
  directiveId: string;
  titleEn: string;
  titleAr: string;
  windowEn: string;
  windowAr: string;
  taperLengthM: number;
  bufferSpaceM: number;
  postedSpeedKmh: number;
  workzoneSpeedKmh: number;
  towTruckStagingM: number;
  heavyDiversion: boolean;
  instructionsEn: string[];
  instructionsAr: string[];
  language?: 'en' | 'ar';
}

export const SopActionCard: React.FC<SopActionCardProps> = ({
  directiveId,
  titleEn,
  titleAr,
  windowEn,
  windowAr,
  taperLengthM,
  bufferSpaceM,
  postedSpeedKmh,
  workzoneSpeedKmh,
  towTruckStagingM,
  heavyDiversion,
  instructionsEn,
  instructionsAr,
  language = 'en',
}) => {
  const [copied, setCopied] = useState(false);

  const isAr = language === 'ar';
  const instructions = isAr ? instructionsAr : instructionsEn;
  const title = isAr ? titleAr : titleEn;
  const executionWindow = isAr ? windowAr : windowEn;

  const handleCopy = () => {
    const text = `
=== ${directiveId} ===
${title}
${isAr ? 'فترة التنفيذ:' : 'Execution Window:'} ${executionWindow}
${isAr ? 'مسافة التدرج (Taper):' : 'Taper Length:'} ${taperLengthM}m
${isAr ? 'منطقة الأمان (Buffer):' : 'Buffer Space:'} ${bufferSpaceM}m
${isAr ? 'السرعة المؤقتة:' : 'Reduced Speed Limit:'} ${workzoneSpeedKmh} km/h
${isAr ? 'تمركز ونش الإنقاذ:' : 'Tow Truck Staging:'} ${towTruckStagingM}m upstream

${isAr ? 'التوجيهات الميدانية:' : 'Tactical Directives:'}
${instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-5 shadow-2xl relative overflow-hidden">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {directiveId}
              </span>
              <span className="text-xs text-slate-400 font-mono">AUTHORIZED SOP</span>
            </div>
            <h3 className="text-base font-bold text-slate-100 mt-1">{title}</h3>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? (isAr ? 'تم النسخ' : 'Copied') : isAr ? 'نسخ التوجيه' : 'Copy SOP'}
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-slate-950 transition"
          >
            <Printer className="w-3.5 h-3.5" />
            {isAr ? 'طباعة' : 'Print Directive'}
          </button>
        </div>
      </div>

      {/* Geometry & Operational Spec Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">{isAr ? 'مسافة التدرج (Taper)' : 'Taper Length'}</span>
          <strong className="text-base font-mono text-cyan-400">{taperLengthM} m</strong>
        </div>
        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">{isAr ? 'منطقة الأمان (Buffer)' : 'Buffer Space'}</span>
          <strong className="text-base font-mono text-emerald-400">{bufferSpaceM} m</strong>
        </div>
        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">{isAr ? 'السرعة المخفضة' : 'Work-Zone Speed'}</span>
          <strong className="text-base font-mono text-amber-400">{workzoneSpeedKmh} km/h</strong>
        </div>
        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">{isAr ? 'تمركز الونش' : 'Tow Staging'}</span>
          <strong className="text-base font-mono text-rose-400">{towTruckStagingM} m Upstream</strong>
        </div>
      </div>

      {/* Heavy Vehicle Diversion Alert */}
      {heavyDiversion && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-amber-300 text-xs">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400" />
          <span>
            {isAr
              ? 'تنبيه عملياتي: يجب تفعيل تحويلات النقل الثقيل والميكروباص عند المخرج السابق لتفادي الشلل التام.'
              : 'CRITICAL MANDATE: Divert heavy freight & microbuses at upstream interchange to prevent weaving gridlock.'}
          </span>
        </div>
      )}

      {/* Tactical Checklist */}
      <div className="space-y-2 mt-3">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {isAr ? 'خطوات التنفيذ الميدانية المعتمدة:' : 'Field Operational Directives:'}
        </h4>
        <ul className="space-y-1.5 text-xs text-slate-300">
          {instructions.map((inst, index) => (
            <li key={index} className="flex items-start gap-2 bg-slate-950/60 p-2 rounded border border-slate-800/80">
              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 font-mono flex items-center justify-center text-[10px]">
                {index + 1}
              </span>
              <span>{inst}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
