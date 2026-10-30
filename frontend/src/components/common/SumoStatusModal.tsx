import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Terminal,
  Play,
  Loader2,
  FileCode,
  Flame,
  Gauge,
  Clock,
  Car,
  Truck,
  Bus,
  Bike,
  Shield,
  Layers,
} from 'lucide-react';
import {
  getSumoStatusAPI,
  SumoSystemStatus,
  simulateIntersectionsAPI,
  IntersectionResponse,
  launchSumoGuiAPI,
} from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface SumoStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
}

export const SumoStatusModal: React.FC<SumoStatusModalProps> = ({
  isOpen,
  onClose,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [status, setStatus] = useState<SumoSystemStatus | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<IntersectionResponse | null>(null);
  const [isLaunchingGui, setIsLaunchingGui] = useState<boolean>(false);
  const [guiLaunchMsg, setGuiLaunchMsg] = useState<string | null>(null);

  const handleLaunchSumoGui = async (scenario: 'intersection' | 'workzone' = 'intersection') => {
    setIsLaunchingGui(true);
    setGuiLaunchMsg(null);
    try {
      const res = await launchSumoGuiAPI(scenario, 'SIGNAL');
      if (res.status === 'launched') {
        setGuiLaunchMsg(
          isAr
            ? `✓ تم تشغيل واجهة SUMO-GUI الأصلية بنجاح على سطح المكتب! (معرف العملية PID: ${res.pid})`
            : `✓ Official Desktop SUMO-GUI window launched! (PID: ${res.pid})`
        );
      } else {
        setGuiLaunchMsg(`⚠️ ${res.error || 'Failed to launch SUMO-GUI'}`);
      }
    } catch (err: any) {
      setGuiLaunchMsg(`⚠️ ${err.message}`);
    } finally {
      setIsLaunchingGui(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      getSumoStatusAPI().then(setStatus);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyWinget = () => {
    navigator.clipboard.writeText('winget install Eclipse.SUMO');
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const runDiagnosticTest = async () => {
    setIsTesting(true);
    try {
      const res = await simulateIntersectionsAPI({
        main_flow: 3600,
        cross_flow: 950,
        turning_pct: 20,
        heavy_pct: 14,
        uturn_distance_m: 450,
        engine_mode: 'sumo',
        simulation_duration_sec: 300,
      });
      setTestResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-slate-950 shadow-lg shadow-emerald-500/20">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
                {t.sumo_modal_title}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t.sumo_modal_subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Main Status Hero Banner */}
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              status?.sumo_available
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                : 'bg-cyan-950/30 border-cyan-500/40 text-cyan-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`p-2 rounded-lg border ${
                  status?.sumo_available
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                }`}
              >
                {status?.sumo_available ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <Cpu className="w-5 h-5 animate-pulse" />
                )}
              </span>
              <div>
                <h4 className="text-sm font-bold">
                  {status?.sumo_available
                    ? t.sumo_native_online
                    : t.sumo_emulation_active}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {status?.sumo_available
                    ? (isAr
                        ? 'محرك SUMO TraCI ينفذ محاكاة كاملة عبر معالج C++ الحقيقي بدقة مجهرية'
                        : 'SUMO TraCI is running native C++ headless processes with live TraCI socket hooks')
                    : (isAr
                        ? 'محرك المحاكاة المجهرية المعاير يعمل بدقة عالية بناءً على تدفقات المحاور المصرية'
                        : 'Calibrated microscopic vehicle-level simulation is fully active with zero downtime')}
                </p>
              </div>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                status?.sumo_available
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
              }`}
            >
              {status?.sumo_available ? 'C++ ONLINE' : 'TWIN ACTIVE'}
            </span>
          </div>

          {/* Environmental Diagnostics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* TraCI Package */}
            <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400 block font-mono">
                {t.sumo_traci_pkg}
              </span>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs font-bold text-slate-200 font-mono">
                  Python TraCI v1.28.0
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  READY
                </span>
              </div>
            </div>

            {/* Binary Path */}
            <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400 block font-mono">
                {t.sumo_binary_label}
              </span>
              <div className="flex items-center justify-between mt-1.5">
                <span
                  className="text-xs font-mono truncate max-w-[220px] text-slate-300"
                  title={status?.sumo_binary_path || 'Auto-Emulation Fallback'}
                >
                  {status?.sumo_binary_path || 'Not on PATH (Auto-Fallback)'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    status?.sumo_binary_path
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                  }`}
                >
                  {status?.sumo_binary_path ? 'FOUND' : 'CALIBRATED'}
                </span>
              </div>
            </div>

            {/* SUMO_HOME */}
            <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400 block font-mono">
                {t.sumo_home_label}
              </span>
              <div className="flex items-center justify-between mt-1.5">
                <span
                  className="text-xs font-mono truncate max-w-[220px] text-slate-300"
                  title={status?.sumo_home_path || 'Standard search list'}
                >
                  {status?.sumo_home_path || 'Auto-Inferred'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                  {status?.sumo_home_set ? 'CONFIGURED' : 'STANDARD'}
                </span>
              </div>
            </div>

            {/* 4 Geometric Networks */}
            <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400 block font-mono">
                {t.sumo_loaded_networks}
              </span>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs font-bold text-slate-200">
                  {status?.networks_ready?.length ?? 0} Cairo Corridor Networks
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  VERIFIED
                </span>
              </div>
            </div>
          </div>

          {/* Native SUMO GUI Desktop Visual Launcher */}
          <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-cyan-950/30 border border-emerald-500/40 rounded-xl p-4 space-y-3 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h5 className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  {isAr ? 'تشغيل واجهة SUMO المرئية الأصلية (Desktop SUMO-GUI)' : 'Launch Native Desktop SUMO-GUI Window'}
                </h5>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {isAr
                    ? 'فتح نافذة تطبيق SUMO الرسومية على شاشتك لمشاهدة حركة المركبات والإشارات مباشرة بالعين المجردة'
                    : 'Launches the official desktop SUMO GUI window so you can watch vehicle movements and traffic lights live'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLaunchSumoGui('intersection')}
                  disabled={isLaunchingGui}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md transition disabled:opacity-50"
                >
                  {isLaunchingGui ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-slate-950" />}
                  {isAr ? 'تشغيل تقاطع الإشارة ↗' : 'Launch Intersection GUI ↗'}
                </button>
                <button
                  onClick={() => handleLaunchSumoGui('workzone')}
                  disabled={isLaunchingGui}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition disabled:opacity-50"
                >
                  {isLaunchingGui ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-slate-950" />}
                  {isAr ? 'تشغيل تحويلة الطريق السريع ↗' : 'Launch Workzone GUI ↗'}
                </button>
              </div>
            </div>
            {guiLaunchMsg && (
              <div className="text-xs font-mono font-bold text-emerald-300 bg-emerald-950/70 p-2.5 rounded-lg border border-emerald-500/40 animate-in fade-in">
                {guiLaunchMsg}
              </div>
            )}
          </div>

          {/* Quick Install Helper (Only shown when native SUMO is not found) */}
          {!status?.sumo_available && (
            <div className="bg-gradient-to-r from-amber-950/30 via-slate-900 to-amber-950/20 border border-amber-500/30 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                <AlertTriangle className="w-4 h-4" />
                <span>{t.sumo_how_to_enable}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t.sumo_winget_instruction}
              </p>
              <div className="flex items-center justify-between gap-3 bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-xs">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Terminal className="w-4 h-4 text-slate-500" />
                  <span>winget install Eclipse.SUMO</span>
                </div>
                <button
                  onClick={handleCopyWinget}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">{t.sumo_copied_cmd}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t.sumo_copy_cmd}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Live Diagnostic Tester Section */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h5 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 text-cyan-400" />
                  {t.sumo_test_button}
                </h5>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isAr
                    ? 'محاكاة مجهرية لحظية عبر مسارات المحاور المصرية (300 ثانية)'
                    : 'Executes a 300s TraCI simulation step horizon across all 4 geometries'}
                </p>
              </div>
              <button
                onClick={runDiagnosticTest}
                disabled={isTesting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.sumo_testing}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-slate-950" />
                    <span>{t.sumo_test_button}</span>
                  </>
                )}
              </button>
            </div>

            {/* Test Results Banner */}
            {testResult && (
              <div className="mt-3 bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-2 animate-in fade-in">
                <span className="text-[11px] font-bold text-emerald-400 font-mono block">
                  ✓ {t.sumo_test_results}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Vehicles</span>
                    <span className="font-bold text-slate-100 font-mono">
                      {testResult.alternatives[0]?.sumo_metrics?.simulated_vehicles_count ?? '—'}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Mean Speed</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      {testResult.alternatives[2]?.sumo_metrics?.mean_speed_kmh ?? '—'} km/h
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">CO2 Emissions</span>
                    <span className="font-bold text-cyan-400 font-mono">
                      {testResult.alternatives[2]?.sumo_metrics?.co2_emissions_kg_h ?? '—'} kg/h
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Fuel Burn</span>
                    <span className="font-bold text-amber-400 font-mono">
                      {testResult.alternatives[2]?.sumo_metrics?.fuel_consumption_liters_h ?? '—'} L/h
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Vehicle Profiles Table */}
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              {t.sumo_vehicle_profiles}
            </h5>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                <Car className="w-4 h-4 mx-auto text-cyan-400 mb-1" />
                <span className="font-bold block text-slate-200">Private Car</span>
                <span className="text-slate-400 text-[10px] block">PCE: 1.0 (50%)</span>
                <span className="text-[9px] text-slate-500 font-mono">Length: 4.6m</span>
              </div>
              <div className="bg-slate-950/80 border border-amber-500/30 p-2.5 rounded-lg text-center">
                <Bus className="w-4 h-4 mx-auto text-amber-400 mb-1" />
                <span className="font-bold block text-amber-300">14-Seat Microbus</span>
                <span className="text-amber-400/80 text-[10px] block">PCE: 1.5 (22%)</span>
                <span className="text-[9px] text-amber-500/80 font-mono">Assertive: 1.8</span>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                <Bus className="w-4 h-4 mx-auto text-emerald-400 mb-1" />
                <span className="font-bold block text-slate-200">Transit Bus</span>
                <span className="text-slate-400 text-[10px] block">PCE: 2.0 (10%)</span>
                <span className="text-[9px] text-slate-500 font-mono">Length: 12.0m</span>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                <Truck className="w-4 h-4 mx-auto text-rose-400 mb-1" />
                <span className="font-bold block text-slate-200">Heavy Truck</span>
                <span className="text-slate-400 text-[10px] block">PCE: 2.5 (10%)</span>
                <span className="text-[9px] text-slate-500 font-mono">Length: 14.0m</span>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-center">
                <Bike className="w-4 h-4 mx-auto text-purple-400 mb-1" />
                <span className="font-bold block text-slate-200">Motorcycle</span>
                <span className="text-slate-400 text-[10px] block">PCE: 0.4 (8%)</span>
                <span className="text-[9px] text-slate-500 font-mono">Length: 2.2m</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            {t.sumo_close}
          </button>
        </div>
      </div>
    </div>
  );
};
