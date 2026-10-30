// Operations Top Command Bar (SUMO hidden)
import React, { useState, useEffect } from 'react';
import { ShieldCheck, Globe, Activity, Clock, Gauge, Compass } from 'lucide-react';
import { CorridorSummary } from '../../api/client';
import { Language, translations } from '../../i18n/translations';

interface TopCommandBarProps {
  corridors: CorridorSummary[];
  selectedCorridorId: string;
  onSelectCorridor: (id: string) => void;
  language: Language;
  onToggleLanguage: () => void;
}

export const TopCommandBar: React.FC<TopCommandBarProps> = ({
  corridors,
  selectedCorridorId,
  onSelectCorridor,
  language,
  onToggleLanguage,
}) => {
  const t = translations[language];
  const [timeStr, setTimeStr] = useState('');

  const activeCorridor = corridors.find((c) => c.id === selectedCorridorId) || corridors[0];

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [language]);

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Brand & System Status */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 shadow-lg shadow-cyan-500/20">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-extrabold tracking-wider text-slate-100 uppercase">
                {t.system_title}
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t.operational_status}
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden md:block">
              {t.system_subtitle}
            </p>
          </div>
        </div>

        {/* Center / Controls: Corridor Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg shadow-inner">
            <Activity className="w-4 h-4 text-cyan-400" />
            <select
              value={selectedCorridorId}
              onChange={(e) => onSelectCorridor(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer pr-4"
            >
              {corridors.map((c) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-slate-200">
                  {language === 'ar' ? c.name_ar : c.name_en}
                </option>
              ))}
            </select>
          </div>

          {/* Active Speed Limit Badge */}
          {activeCorridor && (
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-lg text-xs font-mono text-slate-300">
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
              <span>{activeCorridor.speed_limit_kmh} km/h</span>
            </div>
          )}
        </div>

        {/* Right Controls: Clock & Bilingual Toggle */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-slate-300 bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{timeStr}</span>
          </div>

          {/* Language Toggle Button */}
          <button
            onClick={onToggleLanguage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-400 border border-cyan-500/30 transition shadow-sm hover:border-cyan-400"
            title="Switch Language"
          >
            <Globe className="w-4 h-4" />
            <span>{t.language_toggle}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
