import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, Activity, Zap, Clock, ShieldCheck, CheckCircle2, ChevronRight } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import {
  ReversibleResponse,
  evaluateReversibleAPI,
} from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface ReversiblePlannerProps {
  corridorId: string;
  language: Language;
}

export const ReversiblePlanner: React.FC<ReversiblePlannerProps> = ({
  corridorId,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [inboundFlow, setInboundFlow] = useState<number>(6600);
  const [outboundFlow, setOutboundFlow] = useState<number>(2100);
  const [corridorLength, setCorridorLength] = useState<number>(8.5);
  const [emergencyMode, setEmergencyMode] = useState<boolean>(false);
  const [data, setData] = useState<ReversibleResponse | null>(null);

  const runEvaluation = async () => {
    try {
      const res = await evaluateReversibleAPI({
        corridor_id: corridorId,
        inbound_flow: inboundFlow,
        outbound_flow: outboundFlow,
        corridor_length_km: corridorLength,
        emergency_mode: emergencyMode,
      });
      setData(res);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    runEvaluation();
  }, [corridorId, inboundFlow, outboundFlow, corridorLength, emergencyMode]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
          <ArrowLeftRight className="w-6 h-6 text-emerald-400" />
          {t.rev_title}
        </h2>
        <p className="text-xs text-slate-400 mt-1">{t.rev_subtitle}</p>
      </div>

      {/* Sliders & Emergency Flush Toggle */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Inbound Flow */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{t.rev_inbound_flow}</span>
            <span className="font-mono font-bold text-emerald-400">{inboundFlow} PCE/h</span>
          </div>
          <input
            type="range"
            min={1000}
            max={8500}
            step={100}
            value={inboundFlow}
            onChange={(e) => setInboundFlow(parseInt(e.target.value))}
            className="w-full accent-emerald-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none mt-2"
          />
        </div>

        {/* Outbound Flow */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{t.rev_outbound_flow}</span>
            <span className="font-mono font-bold text-cyan-400">{outboundFlow} PCE/h</span>
          </div>
          <input
            type="range"
            min={800}
            max={6500}
            step={100}
            value={outboundFlow}
            onChange={(e) => setOutboundFlow(parseInt(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none mt-2"
          />
        </div>

        {/* Emergency VIP Flush Toggle */}
        <div className="flex flex-col justify-center">
          <span className="text-xs font-semibold text-slate-300 mb-2">
            {isAr ? 'نمط الطوارئ وتفريغ الموكب' : 'Emergency Green Wave Mode'}
          </span>
          <button
            onClick={() => setEmergencyMode(!emergencyMode)}
            className={`flex items-center justify-between p-2.5 rounded-lg border text-xs font-bold transition ${
              emergencyMode
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-lg'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <Zap className={`w-4 h-4 ${emergencyMode ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`} />
              {isAr ? 'تفعيل الإخلاء والموجة الخضراء' : 'VIP Corridor Pre-Flush'}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                emergencyMode ? 'bg-rose-500 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {emergencyMode ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {/* Directional Split Progress Meter */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-slate-300">{t.rev_directional_split}</span>
            <div className="flex items-center gap-3 font-mono font-bold">
              <span className="text-emerald-400">Inbound: {data.directional_split_pct}%</span>
              <span className="text-slate-500">|</span>
              <span className="text-cyan-400">Outbound: {(100 - data.directional_split_pct).toFixed(1)}%</span>
            </div>
          </div>
          <div className="w-full h-3 rounded-full bg-slate-950 overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${data.directional_split_pct}%` }}
            />
            <div
              className="bg-cyan-500 h-full transition-all duration-300"
              style={{ width: `${100 - data.directional_split_pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
            <span>50% Balanced</span>
            <span className="text-amber-400 font-bold">65% Reversible Threshold</span>
            <span>85% Extreme Surge</span>
          </div>
        </div>
      )}

      {/* Side-by-Side Configuration Comparison (4+4 vs 5+3) */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Standard 4+4 */}
          <div className="p-5 rounded-xl border bg-slate-900 border-slate-800 shadow-xl">
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-200">{t.rev_std_config}</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                4 In / 4 Out
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'سعة الداخل' : 'Inbound Capacity'}</span>
                <strong className="text-sm font-mono text-slate-100">{data.standard_4_4.inbound_capacity} PCE/h</strong>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'سرعة الداخل' : 'Inbound Speed'}</span>
                <strong className="text-sm font-mono text-amber-400">{data.standard_4_4.inbound_speed_kmh} km/h</strong>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'زمن الرحلة' : 'Travel Time'}</span>
                <strong className="text-sm font-mono text-slate-100">{data.standard_4_4.inbound_travel_time_min} min</strong>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'تأخير المركبة' : 'Delay per Veh'}</span>
                <strong className="text-sm font-mono text-rose-400">{data.standard_4_4.inbound_delay_sec} s</strong>
              </div>
            </div>
          </div>

          {/* Dynamic Reversible 5+3 */}
          <div
            className={`p-5 rounded-xl border shadow-xl relative ${
              data.recommended_mode === 'REVERSIBLE_5_3'
                ? 'bg-emerald-950/20 border-emerald-500/40'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-emerald-400">{t.rev_dynamic_config}</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                5 In / 3 Out
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'سعة الداخل' : 'Inbound Capacity'}</span>
                <strong className="text-sm font-mono text-emerald-400">{data.reversible_5_3.inbound_capacity} PCE/h</strong>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'سرعة الداخل' : 'Inbound Speed'}</span>
                <strong className="text-sm font-mono text-emerald-400">{data.reversible_5_3.inbound_speed_kmh} km/h</strong>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'زمن الرحلة' : 'Travel Time'}</span>
                <strong className="text-sm font-mono text-emerald-400">{data.reversible_5_3.inbound_travel_time_min} min</strong>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-400 block">{isAr ? 'هامش أمان الخارج' : 'Outbound Safety'}</span>
                <strong className="text-sm font-mono text-cyan-400">{data.reversible_5_3.outbound_safety_margin_pct}%</strong>
              </div>
            </div>
            {data.travel_time_saved_pct > 0 && (
              <div className="mt-3 p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-center text-xs text-emerald-300 font-semibold">
                {isAr
                  ? `توفير ${data.travel_time_saved_pct}% من زمن الرحلة للمدخل!`
                  : `+${data.travel_time_saved_pct}% Travel Time Savings on Inbound Corridors!`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Green Wave Progression Schedule Table */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-100">{t.rev_green_wave_title}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isAr
                  ? 'مزامنة 5 تقاطعات متتالية بسرعة تصميمية 60 كم/س'
                  : '5 Consecutive Intersections synchronized at 60 km/h design progression speed'}
              </p>
            </div>
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
              <Clock className="w-4 h-4 text-rose-400" />
              <span className="text-slate-300">
                {t.rev_pre_flush_label}: <strong className="font-mono text-rose-400">{data.pre_arrival_flush_time_sec}s</strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 text-start">{isAr ? 'التقاطع / العقدة المرورية' : 'Intersection Node'}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'المسافة التراكمية (م)' : 'Distance (m)'}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'فارق توقيت الإشارة (ثانية)' : 'Offset (sec)'}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'زمن الدورة' : 'Cycle Length'}</th>
                  <th className="py-3 px-4 text-center">{isAr ? 'النافذة الخضراء' : 'Green Window'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.green_wave_schedule.map((gw) => (
                  <tr key={gw.intersection_index} className="hover:bg-slate-950/40">
                    <td className="py-3 px-4 font-medium text-slate-200">
                      {isAr ? gw.name_ar : gw.name_en}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {gw.distance_from_start_m} m
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-emerald-400">
                      +{gw.offset_seconds}s
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-300">
                      {gw.cycle_length_sec}s
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-emerald-400">
                      {gw.green_window_sec}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Executive Decision Takeaway */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-xs text-slate-300 leading-relaxed shadow-lg">
          <strong className="text-cyan-400 block mb-1 uppercase font-mono text-[11px]">
            {isAr ? 'ملخص التوجيه التنفيذي:' : 'Executive Operations Summary:'}
          </strong>
          {isAr ? data.executive_summary_ar : data.executive_summary_en}
        </div>
      )}
    </div>
  );
};
