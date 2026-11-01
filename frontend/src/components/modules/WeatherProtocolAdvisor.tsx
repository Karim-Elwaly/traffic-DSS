import React, { useState, useEffect } from 'react';
import { CloudFog, ShieldAlert, AlertTriangle, Eye, Gauge, Compass, Copy, Check, Radio, Siren, Sparkles, Sliders } from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { WeatherBrakingCanvas } from '../simulation/WeatherBrakingCanvas';
import { WeatherResponse, evaluateWeatherProtocolAPI } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface WeatherProtocolAdvisorProps {
  corridorId: string;
  language: Language;
}

export const WeatherProtocolAdvisor: React.FC<WeatherProtocolAdvisorProps> = ({
  corridorId,
  language,
}) => {
  const t = translations[language];
  const isAr = language === 'ar';

  const [visibilityM, setVisibilityM] = useState<number>(60);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState<number>(90);
  const [roadCondition, setRoadCondition] = useState<string>('fog_slick');
  const [gradientPct, setGradientPct] = useState<number>(0);
  const [trafficFlowPce, setTrafficFlowPce] = useState<number>(3800);
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchProtocol = async () => {
    setLoading(true);
    try {
      const res = await evaluateWeatherProtocolAPI({
        corridor_id: corridorId,
        visibility_m: visibilityM,
        current_speed_limit_kmh: currentSpeedKmh,
        road_condition: roadCondition,
        gradient_pct: gradientPct,
        traffic_flow_pce: trafficFlowPce,
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
    fetchProtocol();
  }, [corridorId, visibilityM, currentSpeedKmh, roadCondition, gradientPct, trafficFlowPce]);

  const handleCopyDirective = () => {
    if (!data) return;
    const directive = isAr
      ? `[تعليمات العمليات المرورية - بروتوكول الشبورة والطقس]
المحور: ${corridorId}
مدى الرؤية الأفقية: ${data.visibility_m} متر
السرعة الآمنة الموصى بها: ${data.safe_advisory_speed_kmh} كم/س
مسافة التوقف الحالية: ${data.current_stopping_sight_distance_m} م | العجز الخطر: ${data.stopping_distance_deficit_m} م
التفويج الأمني: ${data.pacing_convoy_required ? `مطلوب بتفويج ${data.convoy_lead_vehicles_count} سيارات مرور بسرعة ${data.convoy_speed_kmh} كم/س` : 'غير مطلوب'}
رسالة اللوحات الإرشادية VMS: ${data.vms_warning_text_ar}
إجراءات السيطرة:
${data.police_sop_actions_ar.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : `[TRAFFIC OPERATIONS DIRECTIVE - FOG & WEATHER PROTOCOL]
Corridor: ${corridorId}
Visibility Range: ${data.visibility_m} m
Safe Advisory Speed: ${data.safe_advisory_speed_kmh} km/h
Stopping Distance: ${data.current_stopping_sight_distance_m} m | Hazard Deficit: ${data.stopping_distance_deficit_m} m
Police Convoy Pacing: ${data.pacing_convoy_required ? `REQUIRED (${data.convoy_lead_vehicles_count} lead units at ${data.convoy_speed_kmh} km/h)` : 'NOT REQUIRED'}
VMS Advisory: ${data.vms_warning_text_en}
Operational Procedures:
${data.police_sop_actions_en.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;

    navigator.clipboard.writeText(directive);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Module Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2">
            <CloudFog className="w-6 h-6 text-cyan-400" />
            {isAr ? 'مستشار بروتوكول الطقس والشبورة والتفويج المروري' : 'Weather & Fog Protocol Advisor (AASHTO SSD)'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'حساب مسافات الرؤية والتوقف الآمن (SSD) وتفعيل منظومة التفويج الأمني واللوحات الإرشادية الذكية'
              : 'Stopping Sight Distance (SSD) vs. Fog Visibility Modeling, Safe Speed Limit & Police Convoy Pacing SOP'}
          </p>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                data.risk_level === 'CRITICAL'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/40 animate-pulse'
                  : data.risk_level === 'HIGH'
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/40'
                  : data.risk_level === 'MODERATE'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/40'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {isAr ? `مستوى الخطر: ${data.risk_level}` : `Risk Level: ${data.risk_level}`}
            </span>
            <span className="px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
              {data.protocol_tier}
            </span>
            <span className="px-2.5 py-1.5 rounded-full text-xs font-mono font-bold bg-slate-900 text-rose-400 border border-rose-500/30">
              {isAr ? `احتمال التصادم التتابعي: ${Math.round(data.pileup_risk_pct)}%` : `Pileup Risk: ${Math.round(data.pileup_risk_pct)}%`}
            </span>
            <button
              onClick={handleCopyDirective}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? (isAr ? 'تم النسخ!' : 'Directive Copied!') : (isAr ? 'نسخ أمر العمليات' : 'Copy Directive')}
            </button>
          </div>
        )}
      </div>

      {/* Control Input Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        {/* Visibility S_fog */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium flex items-center gap-1">
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
              {isAr ? 'مدى الرؤية الأفقية للشبورة' : 'Fog Visibility Range (S_fog)'}
            </span>
            <span className="text-cyan-400 font-bold font-mono">{visibilityM} m</span>
          </div>
          <input
            type="range"
            min={10}
            max={2000}
            step={5}
            value={visibilityM}
            onChange={(e) => setVisibilityM(Number(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>10m ({isAr ? 'شبورة معتمة' : 'Dense'})</span>
            <span>2,000m ({isAr ? 'واضحة' : 'Clear'})</span>
          </div>
        </div>

        {/* Current Speed Limit */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-rose-400" />
              {isAr ? 'السرعة الحالية المقررة' : 'Current Speed Limit'}
            </span>
            <span className="text-rose-400 font-bold font-mono">{currentSpeedKmh} km/h</span>
          </div>
          <input
            type="range"
            min={30}
            max={120}
            step={5}
            value={currentSpeedKmh}
            onChange={(e) => setCurrentSpeedKmh(Number(e.target.value))}
            className="w-full accent-rose-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>30 km/h</span>
            <span>120 km/h</span>
          </div>
        </div>

        {/* Road Surface Condition */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium block">
            {isAr ? 'حالة السطح والرطوبة' : 'Pavement Surface Condition'}
          </label>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {[
              { id: 'dry', labelEn: 'Dry', labelAr: 'جاف' },
              { id: 'wet', labelEn: 'Wet', labelAr: 'ممطر' },
              { id: 'first_rain_slick', labelEn: 'First Rain', labelAr: 'مطر أول' },
              { id: 'sandstorm', labelEn: 'Sandstorm', labelAr: 'عاصفة رملية' },
              { id: 'fog_slick', labelEn: 'Fog Slick', labelAr: 'شبورة زلقة' },
            ].map((cond) => (
              <button
                key={cond.id}
                onClick={() => setRoadCondition(cond.id)}
                className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg border transition-all text-center ${
                  roadCondition === cond.id
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
                }`}
              >
                {isAr ? cond.labelAr : cond.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Road Gradient */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              {isAr ? 'الميل الطولي للمحور' : 'Longitudinal Gradient'}
            </span>
            <span className="text-amber-400 font-bold font-mono">
              {gradientPct > 0 ? `+${gradientPct}%` : `${gradientPct}%`}
            </span>
          </div>
          <input
            type="range"
            min={-6}
            max={6}
            step={1}
            value={gradientPct}
            onChange={(e) => setGradientPct(Number(e.target.value))}
            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>-6% ({isAr ? 'نزول' : 'Down'})</span>
            <span>0%</span>
            <span>+6% ({isAr ? 'صعود' : 'Up'})</span>
          </div>
        </div>

        {/* Traffic Flow Demand */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">
              {isAr ? 'كثافة التدفق الحالية' : 'Corridor Demand'}
            </span>
            <span className="text-emerald-400 font-bold font-mono">{trafficFlowPce} PCE/h</span>
          </div>
          <input
            type="range"
            min={500}
            max={9000}
            step={250}
            value={trafficFlowPce}
            onChange={(e) => setTrafficFlowPce(Number(e.target.value))}
            className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>500</span>
            <span>9,000 PCE/h</span>
          </div>
        </div>
      </div>

      {/* 60fps Visual Braking Simulation Canvas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" />
            {isAr ? 'المحاكي البصري اللحظي لمخروط التوقف والشبورة (60fps)' : 'Real-time Stopping Distance vs Sight Horizon Canvas (60fps)'}
          </span>
          <span className="text-[11px] text-slate-500">
            {isAr ? 'محاكاة تفاعلية لحركة المركبات ودوريات المرور' : 'Interactive vehicle physics & patrol convoy pacing'}
          </span>
        </div>
        <WeatherBrakingCanvas
          visibilityM={data ? data.visibility_m : visibilityM}
          currentSpeedKmh={currentSpeedKmh}
          safeSpeedKmh={data ? data.safe_advisory_speed_kmh : 50}
          currentSsdM={data ? data.current_stopping_sight_distance_m : 110}
          safeSsdM={data ? data.safe_stopping_sight_distance_m : 55}
          deficitM={data ? data.stopping_distance_deficit_m : 50}
          roadCondition={roadCondition}
          pacingActive={data ? data.pacing_convoy_required : false}
          convoySpeedKmh={data ? data.convoy_speed_kmh : 35}
          trafficFlowPce={trafficFlowPce}
          language={language}
        />
      </div>

      {/* KPI Physics Metrics */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={isAr ? 'مسافة التوقف الفعلية (SSD)' : 'Current Stopping Distance'}
            value={`${Math.round(data.current_stopping_sight_distance_m)} m`}
            subtitle={isAr ? `ملاكي: ${Math.round(data.ssd_car_m)}م | نقل ثقيل: ${Math.round(data.ssd_truck_m)}م` : `Cars: ${Math.round(data.ssd_car_m)}m | Trucks: ${Math.round(data.ssd_truck_m)}m`}
            variant={data.stopping_distance_deficit_m > 0 ? 'danger' : 'success'}
            accent="border-rose-500/40"
          />

          <KpiCard
            title={isAr ? 'السرعة الاسترشادية الآمنة' : 'Safe Advisory Speed'}
            value={`${Math.round(data.safe_advisory_speed_kmh)} km/h`}
            subtitle={isAr ? `تضمن التوقف قبل مسافة الرؤية` : `Guarantees stop within ${data.visibility_m}m`}
            variant="success"
            accent="border-emerald-500/40"
          />

          <KpiCard
            title={isAr ? 'عجز مسافة الرؤية الخطر' : 'Stopping Distance Deficit'}
            value={data.stopping_distance_deficit_m > 0 ? `+${Math.round(data.stopping_distance_deficit_m)} m` : '0 m'}
            subtitle={data.stopping_distance_deficit_m > 0 ? (isAr ? 'توقف خارج مجال الرؤية (خطر اصطدام)' : 'Blind braking hazard!') : (isAr ? 'ضمن الحدود الآمنة' : 'Safe operating margin')}
            variant={data.stopping_distance_deficit_m > 0 ? 'danger' : 'neutral'}
            accent="border-amber-500/40"
          />

          <KpiCard
            title={isAr ? 'حالة التفويج المروري' : 'Patrol Convoy Pacing'}
            value={data.pacing_convoy_required ? (isAr ? 'مفعل فوراً' : 'ACTIVE') : (isAr ? 'في وضع الاستعداد' : 'STANDBY')}
            subtitle={data.pacing_convoy_required ? (isAr ? `سرعة الركب: ${data.convoy_speed_kmh} كم/س (${data.convoy_lead_vehicles_count} سيارات)` : `Pacing at ${data.convoy_speed_kmh} km/h`) : (isAr ? 'لا يستلزم تدخل الركب' : 'Visibility adequate')}
            variant={data.pacing_convoy_required ? 'warning' : 'neutral'}
            accent="border-cyan-500/40"
          />
        </div>
      )}

      {/* Dynamic VMS Signboard & Police SOP Directives */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* VMS Overhead Signboard Simulator */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Radio className="w-4 h-4 text-amber-400" />
                  {isAr ? 'شاشات الرسائل المتغيرة الإلكترونية (VMS)' : 'Overhead Variable Message Sign (VMS)'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  LIVE BROADCAST
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                {isAr
                  ? 'الرسالة المبرمجة آلياً للبث الفوري على بوابات الكيلو 26 والمطالع الرئيسية'
                  : 'Automated live feed broadcasting to portal gantries at Corridor Entry Points'}
              </p>
            </div>

            {/* LED Matrix Sign Simulation */}
            <div className="bg-black border-4 border-slate-700 rounded-lg p-4 font-mono text-center shadow-inner my-2">
              <div className="text-amber-400 text-sm md:text-base font-extrabold tracking-wider leading-relaxed animate-pulse">
                {isAr ? data.vms_warning_text_ar : data.vms_warning_text_en}
              </div>
              <div className="text-slate-500 text-[10px] mt-2 border-t border-slate-800 pt-2 flex justify-between">
                <span>VMS GANTRY #04 - KM 22.5</span>
                <span>EMERGENCY OVERRIDE</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 mt-2">
              {isAr
                ? 'يتم تحديث الرسائل كل 60 ثانية استناداً لمجسات الرؤية ومحطات الرصد الجوي المتصلة.'
                : 'Advisory messages auto-cycle every 60s based on connected fog optical scatterometers.'}
            </div>
          </div>

          {/* Operational Police Convoy SOP Protocol (تفويج مروري) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Siren className="w-4 h-4 text-cyan-400" />
                  {isAr ? 'بروتوكول التفويج المروري الميداني (SOP)' : 'Standard Police Pacing Protocol (SOP)'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  TACTICAL DIRECTIVE
                </span>
              </div>

              <div className="space-y-2 mt-3">
                {(isAr ? data.police_sop_actions_ar : data.police_sop_actions_en).map((action, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-200"
                  >
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 font-bold flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed">{action}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span>{isAr ? 'مرجع الكود: الدليل الإرشادي لإدارة الطقس السيئ' : 'Egyptian Road Authority Emergency Code'}</span>
              <span>{isAr ? 'تحديث لحظي' : 'Real-time sync'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
