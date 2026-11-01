import React from 'react';
import { 
  Construction, 
  Split, 
  Zap, 
  ArrowLeftRight, 
  BarChart3, 
  CloudFog, 
  ShieldCheck, 
  GitFork, 
  GitMerge, 
  Hammer, 
  Users 
} from 'lucide-react';
import { Language, translations } from '../../i18n/translations';

export type ActiveModule =
  | 'workzone'
  | 'intersection'
  | 'shockwave'
  | 'reversible'
  | 'telemetry_cv'
  | 'weather'
  | 'checkpoint'
  | 'diversion'
  | 'ramp'
  | 'defect'
  | 'surge';

interface SidebarNavProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  language: Language;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeModule,
  onSelectModule,
  language,
}) => {
  const t = translations[language];

  const pillars = [
    {
      title: t.pillar_1,
      badge: 'Cap & Asset',
      items: [
        {
          id: 'workzone' as const,
          modNum: '01',
          name: t.nav_workzone,
          desc: t.nav_workzone_desc,
          icon: <Construction className="w-4 h-4" />,
          accent: 'from-amber-500 to-orange-600',
          activeColor: 'text-amber-400',
        },
        {
          id: 'reversible' as const,
          modNum: '04',
          name: t.nav_reversible,
          desc: t.nav_reversible_desc,
          icon: <ArrowLeftRight className="w-4 h-4" />,
          accent: 'from-emerald-500 to-teal-600',
          activeColor: 'text-emerald-400',
        },
        {
          id: 'ramp' as const,
          modNum: '06',
          name: t.nav_ramp,
          desc: t.nav_ramp_desc,
          icon: <GitMerge className="w-4 h-4" />,
          accent: 'from-orange-500 to-amber-600',
          activeColor: 'text-orange-400',
        },
        {
          id: 'defect' as const,
          modNum: '09',
          name: t.nav_defect,
          desc: t.nav_defect_desc,
          icon: <Hammer className="w-4 h-4" />,
          accent: 'from-rose-500 to-pink-600',
          activeColor: 'text-rose-400',
        },
      ],
    },
    {
      title: t.pillar_2,
      badge: 'Real-Time',
      items: [
        {
          id: 'shockwave' as const,
          modNum: '03',
          name: t.nav_shockwave,
          desc: t.nav_shockwave_desc,
          icon: <Zap className="w-4 h-4" />,
          accent: 'from-rose-500 to-red-600',
          activeColor: 'text-rose-400',
        },
        {
          id: 'weather' as const,
          modNum: '05',
          name: t.nav_weather,
          desc: t.nav_weather_desc,
          icon: <CloudFog className="w-4 h-4" />,
          accent: 'from-sky-500 to-blue-600',
          activeColor: 'text-sky-400',
        },
        {
          id: 'diversion' as const,
          modNum: '07',
          name: t.nav_diversion,
          desc: t.nav_diversion_desc,
          icon: <GitFork className="w-4 h-4" />,
          accent: 'from-indigo-500 to-cyan-600',
          activeColor: 'text-cyan-400',
        },
        {
          id: 'checkpoint' as const,
          modNum: '08',
          name: t.nav_checkpoint,
          desc: t.nav_checkpoint_desc,
          icon: <ShieldCheck className="w-4 h-4" />,
          accent: 'from-emerald-500 to-green-600',
          activeColor: 'text-emerald-400',
        },
      ],
    },
    {
      title: t.pillar_3,
      badge: 'Strategic',
      items: [
        {
          id: 'intersection' as const,
          modNum: '02',
          name: t.nav_intersection,
          desc: t.nav_intersection_desc,
          icon: <Split className="w-4 h-4" />,
          accent: 'from-cyan-500 to-blue-600',
          activeColor: 'text-cyan-400',
        },
        {
          id: 'surge' as const,
          modNum: '10',
          name: t.nav_surge,
          desc: t.nav_surge_desc,
          icon: <Users className="w-4 h-4" />,
          accent: 'from-purple-500 to-indigo-600',
          activeColor: 'text-purple-400',
        },
      ],
    },
    {
      title: t.pillar_cv,
      badge: 'CCTV / AI',
      items: [
        {
          id: 'telemetry_cv' as const,
          modNum: 'AI',
          name: t.nav_telemetry_cv,
          desc: t.nav_telemetry_cv_desc,
          icon: <BarChart3 className="w-4 h-4" />,
          accent: 'from-violet-500 to-purple-600',
          activeColor: 'text-violet-400',
        },
      ],
    },
  ];

  return (
    <aside className="w-full lg:w-80 bg-slate-950 border-e border-slate-800 p-3 lg:p-4 flex flex-row lg:flex-col gap-4 overflow-x-auto lg:overflow-y-auto flex-shrink-0 max-h-screen">
      {pillars.map((pillar, pIdx) => (
        <div key={pIdx} className="flex flex-row lg:flex-col gap-1.5 min-w-max lg:min-w-0">
          <div className="hidden lg:flex items-center justify-between px-2 pt-2 pb-1 border-b border-slate-900">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
              {pillar.title}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono">
              {pillar.badge}
            </span>
          </div>

          {pillar.items.map((item) => {
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectModule(item.id)}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl transition-all text-start min-w-[200px] lg:min-w-0 ${
                  isActive
                    ? 'bg-slate-900 border border-slate-700 shadow-lg text-slate-100'
                    : 'hover:bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <div
                  className={`p-2 rounded-lg transition-all flex items-center justify-center flex-shrink-0 ${
                    isActive
                      ? `bg-gradient-to-br ${item.accent} text-slate-950 shadow-md`
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-950 px-1 rounded border border-slate-900">
                      #{item.modNum}
                    </span>
                    <span className={`block text-xs font-bold truncate ${isActive ? item.activeColor : ''}`}>
                      {item.name}
                    </span>
                  </div>
                  <span className="block text-[10px] text-slate-500 truncate hidden lg:block mt-0.5">
                    {item.desc}
                  </span>
                </div>
                {isActive && (
                  <span className="hidden lg:block w-1.5 h-5 rounded-full bg-cyan-400 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
};
