import React, { useState, useEffect } from 'react';
import { Split, Award, Shield, AlertCircle, ArrowUpRight, Cpu, Zap, Activity, Flame, Gauge, Loader2, Play } from 'lucide-react';
import { IntersectionCanvas } from '../simulation/IntersectionCanvas';
import { KpiCard } from '../common/KpiCard';
import { IntersectionResponse, simulateIntersectionsAPI, launchSumoGuiAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';
import { SumoStatusModal } from '../common/SumoStatusModal';

interface IntersectionSimulatorProps {
  language: Language;
}

export const IntersectionSimulator: React.FC<IntersectionSimulatorProps> = ({
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [engineMode, setEngineMode] = useState<'analytical' | 'sumo'>('analytical');
  const [isSumoModalOpen, setIsSumoModalOpen] = useState<boolean>(false);
  const [mainFlow, setMainFlow] = useState<number>(3400);
  const [crossFlow, setCrossFlow] = useState<number>(850);
  const [turningPct, setTurningPct] = useState<number>(18);
  const [heavyPct, setHeavyPct] = useState<number>(12);
  const [uturnDist, setUturnDist] = useState<number>(450);
  const [data, setData] = useState<IntersectionResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const runSimulation = async () => {
    setIsLoading(true);
    try {
      const res = await simulateIntersectionsAPI({
        main_flow: mainFlow,
        cross_flow: crossFlow,
        turning_pct: turningPct,
        heavy_pct: heavyPct,
        uturn_distance_m: uturnDist,
        engine_mode: engineMode,
        simulation_duration_sec: 300,
      });
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runSimulation();
  }, [mainFlow, crossFlow, turningPct, heavyPct, uturnDist, engineMode]);

  const getLosBadgeColor = (grade: string) => {
    switch (grade) {
      case 'A':
      case 'B':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      case 'C':
        return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40';
      case 'D':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'E':
      case 'F':
      default:
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
    }
  };

  const winnerAlt = data?.alternatives.find(
    (a) => a.id === data.recommended_option_id
  );
  const signalAlt = data?.alternatives.find((a) => a.id === 'SIGNAL');
  const sumoVehicles = data?.alternatives[0]?.sumo_metrics?.simulated_vehicles_count;
  const winnerCo2 = winnerAlt?.sumo_metrics?.co2_emissions_kg_h;
  const signalFuel = signalAlt?.sumo_metrics?.fuel_consumption_liters_h;
  const winnerFuel = winnerAlt?.sumo_metrics?.fuel_consumption_liters_h;
  const signalTimeLoss = signalAlt?.sumo_metrics?.total_time_loss_sec;
  const winnerTimeLoss = winnerAlt?.sumo_metrics?.total_time_loss_sec;
  const fuelSaved =
    signalFuel != null && winnerFuel != null
      ? Math.max(0, Math.round(signalFuel - winnerFuel))
      : null;
  const timeLossSaved =
    signalTimeLoss != null && winnerTimeLoss != null
      ? Math.max(0, Math.round((signalTimeLoss - winnerTimeLoss) / 3600))
      : null;

  return (
    <div className="space-y-6">
      {/* Header with Engine Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
            <Split className="w-6 h-6 text-cyan-400" />
            {t.int_title}
          </h2>
          <p className="text-xs text-slate-400 mt-1">{t.int_subtitle}</p>
        </div>

        {/* Engine Core Toggle */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 rounded-xl shadow-lg">
          <button
            onClick={() => setEngineMode('analytical')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              engineMode === 'analytical'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {t.int_engine_analytical}
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
            {t.int_engine_sumo}
          </button>
        </div>
      </div>

      {/* Engine Status Banner */}
      {engineMode === 'sumo' && (
        <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-cyan-950/40 border border-emerald-500/30 rounded-xl p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Cpu className="w-4 h-4 animate-pulse" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-emerald-400">
                  Eclipse SUMO TraCI Microscopic Engine Active
                </span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono border border-emerald-500/30">
                  {data?.engine_used || 'TraCI Digital Twin'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {isAr
                  ? 'محاكاة حركة كل مركبة بدقة مجهرية (Krauss Model) واستخراج أزمنة التأخير والانبعاثات بدقة HBEFA3'
                  : 'Simulating individual vehicle car-following (Krauss) & lane-changing physics with HBEFA3 emission calculus'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isLoading && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t.int_sumo_simulating}</span>
              </div>
            )}
            <button
              onClick={() => setIsSumoModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold border border-emerald-500/30 transition shadow-sm"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{isAr ? 'لوحة تشخيص سيمو' : 'SUMO Diagnostics'}</span>
            </button>
            <button
              onClick={async () => {
                try {
                  await launchSumoGuiAPI('intersection', data?.recommended_option_id || 'SIGNAL');
                } catch (e) {
                  console.error(e);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition shadow-md shadow-emerald-500/20"
              title={isAr ? 'تشغيل واجهة SUMO المرئية على سطح المكتب' : 'Launch native desktop SUMO-GUI window'}
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>{isAr ? 'تشغيل SUMO-GUI ↗' : 'Launch SUMO-GUI ↗'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Control Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Main Flow */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{isAr ? 'حجم المحور الرئيسي' : 'Mainline Flow'}</span>
            <span className="font-mono font-bold text-cyan-400">{mainFlow} veh/h</span>
          </div>
          <input
            type="range"
            min={1000}
            max={5000}
            step={100}
            value={mainFlow}
            onChange={(e) => setMainFlow(parseInt(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none"
          />
        </div>

        {/* Cross Flow */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{isAr ? 'حجم الشارع العرضي' : 'Cross Flow'}</span>
            <span className="font-mono font-bold text-amber-400">{crossFlow} veh/h</span>
          </div>
          <input
            type="range"
            min={300}
            max={2500}
            step={50}
            value={crossFlow}
            onChange={(e) => setCrossFlow(parseInt(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none"
          />
        </div>

        {/* Turning % */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{isAr ? 'نسبة الدوران لليسار' : 'Turning Share'}</span>
            <span className="font-mono font-bold text-slate-200">{turningPct}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={40}
            step={1}
            value={turningPct}
            onChange={(e) => setTurningPct(parseInt(e.target.value))}
            className="w-full accent-slate-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none"
          />
        </div>

        {/* Heavy Vehicle % */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{isAr ? 'نسبة النقل والميكروباص' : 'Heavy Share'}</span>
            <span className="font-mono font-bold text-rose-400">{heavyPct}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={35}
            step={1}
            value={heavyPct}
            onChange={(e) => setHeavyPct(parseInt(e.target.value))}
            className="w-full accent-rose-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none"
          />
        </div>

        {/* U-Turn Distance */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">{isAr ? 'مسافة الدوران للخلف' : 'U-Turn Distance'}</span>
            <span className="font-mono font-bold text-emerald-400">{uturnDist} m</span>
          </div>
          <input
            type="range"
            min={200}
            max={800}
            step={50}
            value={uturnDist}
            onChange={(e) => setUturnDist(parseInt(e.target.value))}
            className="w-full accent-emerald-400 cursor-pointer h-2 bg-slate-950 rounded-lg appearance-none"
          />
        </div>
      </div>

      {/* Winning Recommendation Banner */}
      {data && (
        <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900 to-emerald-950/40 border border-cyan-500/30 rounded-xl p-5 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Award className="w-5 h-5" />
              </span>
              <div>
                <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider">
                  {t.int_recommended_solution}
                </span>
                <h3 className="text-base font-extrabold text-slate-100">
                  {isAr
                    ? data.alternatives.find((a) => a.id === data.recommended_option_id)?.name_ar
                    : data.alternatives.find((a) => a.id === data.recommended_option_id)?.name_en}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-end">
                <span className="text-[11px] text-slate-400 block">{isAr ? 'مستوى الخدمة' : 'Level of Service'}</span>
                <span
                  className={`text-sm font-bold font-mono px-2.5 py-0.5 rounded border ${getLosBadgeColor(
                    data.alternatives.find((a) => a.id === data.recommended_option_id)?.level_of_service || 'B'
                  )}`}
                >
                  LoS {data.alternatives.find((a) => a.id === data.recommended_option_id)?.level_of_service}
                </span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mt-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
            {isAr ? data.recommendation_rationale_ar : data.recommendation_rationale_en}
          </p>
        </div>
      )}

      {/* 4-Way Decision Performance Matrix */}
      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">{t.int_comparison_matrix}</h3>
            <span className="text-xs text-slate-400 font-mono">
              Total Flow: {mainFlow + crossFlow} veh/h
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 text-start">{isAr ? 'البديل الهندسي' : 'Alternative'}</th>
                  <th className="py-3 px-3 text-center">{t.level_of_service}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'متوسط التأخير (ثانية)' : 'Delay (s)'}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'طول الطابور (م)' : '95th Queue (m)'}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'نقاط الحوادث' : 'Conflict Points'}</th>
                  <th className="py-3 px-3 text-center">{isAr ? 'نسبة الاستيعاب v/c' : 'v/c Ratio'}</th>
                  <th className="py-3 px-4 text-center">{isAr ? 'مؤشر الأمان والسلامة' : 'Safety Index'}</th>
                  {engineMode === 'sumo' && (
                    <>
                      <th className="py-3 px-3 text-center text-emerald-400">{t.int_sumo_speed}</th>
                      <th className="py-3 px-3 text-center text-emerald-400">{t.int_sumo_co2}</th>
                      <th className="py-3 px-3 text-center text-emerald-400">{t.int_sumo_fuel}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.alternatives.map((alt) => {
                  const isWinning = alt.id === data.recommended_option_id;
                  return (
                    <tr
                      key={alt.id}
                      className={`transition ${
                        isWinning ? 'bg-cyan-950/20 font-semibold' : 'hover:bg-slate-950/40'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          {isWinning && (
                            <span className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0 animate-ping" />
                          )}
                          <span className={isWinning ? 'text-cyan-300 font-bold' : 'text-slate-200'}>
                            {isAr ? alt.name_ar : alt.name_en}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono border ${getLosBadgeColor(alt.level_of_service)}`}>
                          {alt.level_of_service}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono">
                        <span className={alt.average_delay_sec > 55 ? 'text-rose-400' : 'text-slate-200'}>
                          {alt.average_delay_sec}s
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono">
                        <span className={alt.queue_95th_m > 300 ? 'text-rose-400' : 'text-slate-200'}>
                          {alt.queue_95th_m} m
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            alt.conflict_points <= 4
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : alt.conflict_points <= 8
                              ? 'bg-cyan-500/20 text-cyan-400'
                              : 'bg-rose-500/20 text-rose-400'
                          }`}
                        >
                          {alt.conflict_points} pts
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono text-slate-300">
                        {alt.volume_to_capacity}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-2 rounded-full bg-slate-950 overflow-hidden">
                            <div
                              className={`h-full ${
                                alt.safety_index_pct > 80
                                  ? 'bg-emerald-400'
                                  : alt.safety_index_pct > 60
                                  ? 'bg-cyan-400'
                                  : 'bg-rose-500'
                              }`}
                              style={{ width: `${alt.safety_index_pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-400">
                            {alt.safety_index_pct}%
                          </span>
                        </div>
                      </td>
                      {engineMode === 'sumo' && (
                        <>
                          <td className="py-3.5 px-3 text-center font-mono text-emerald-400">
                            {alt.sumo_metrics?.mean_speed_kmh ?? '—'} km/h
                          </td>
                          <td className="py-3.5 px-3 text-center font-mono text-slate-300">
                            {alt.sumo_metrics?.co2_emissions_kg_h ?? '—'} kg/h
                          </td>
                          <td className="py-3.5 px-3 text-center font-mono text-slate-300">
                            {alt.sumo_metrics?.fuel_consumption_liters_h ?? '—'} L/h
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUMO Environmental & Microscopic KPI Cards */}
      {engineMode === 'sumo' && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={isAr ? 'المركبات المجهرية المحاكاة' : 'Simulated Micro-Vehicles'}
            value={sumoVehicles != null ? sumoVehicles.toLocaleString() : '—'}
            unit={isAr ? 'مركبة' : 'veh'}
            status="info"
            subtitle={isAr ? 'معدل تدفق الحساب المجهري' : '300s TraCI Step Horizon'}
          />
          <KpiCard
            title={isAr ? 'انبعاثات الكربون للبديل الفائز' : 'Winning Solution CO2'}
            value={winnerCo2 ?? '—'}
            unit="kg/h"
            status="optimal"
            subtitle={isAr ? 'نموذج انبعاثات HBEFA3' : 'HBEFA3 Micro-Emission Model'}
          />
          <KpiCard
            title={isAr ? 'وفر الوقود مقارنة بالإشارة' : 'Fuel Saved vs Signal'}
            value={fuelSaved ?? '—'}
            unit="L/h"
            status="optimal"
            subtitle={isAr ? 'تقليل التوقف والتشغيل المستمر' : 'Reduced Stop-and-Go Idling'}
          />
          <KpiCard
            title={isAr ? 'وفر زمن التأخير الإجمالي' : 'Total Time Loss Saved'}
            value={timeLossSaved ?? '—'}
            unit={isAr ? 'ساعة ركاب/س' : 'hrs/h'}
            status="optimal"
            subtitle={isAr ? 'حسابات TraCI TimeLoss' : 'TraCI Trajectory Calculus'}
          />
        </div>
      )}

      {/* Live Split-Screen Canvas */}
      <IntersectionCanvas
        mainFlow={mainFlow}
        crossFlow={crossFlow}
        language={language}
      />

      {/* SUMO Digital Twin Diagnostics & Control Center Modal */}
      <SumoStatusModal
        isOpen={isSumoModalOpen}
        onClose={() => setIsSumoModalOpen(false)}
        language={language}
      />
    </div>
  );
};
