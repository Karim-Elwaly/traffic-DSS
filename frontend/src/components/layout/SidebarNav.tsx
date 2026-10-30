import React from 'react';
import { Construction, Split, Zap, ArrowLeftRight } from 'lucide-react';
import { Language, translations } from '../../i18n/translations';

export type ActiveModule = 'workzone' | 'intersection' | 'shockwave' | 'reversible';

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

  const navItems = [
    {
      id: 'workzone' as const,
      name: t.nav_workzone,
      desc: t.nav_workzone_desc,
      icon: <Construction className="w-5 h-5" />,
      accent: 'from-amber-500 to-orange-600',
      activeColor: 'text-amber-400',
    },
    {
      id: 'intersection' as const,
      name: t.nav_intersection,
      desc: t.nav_intersection_desc,
      icon: <Split className="w-5 h-5" />,
      accent: 'from-cyan-500 to-blue-600',
      activeColor: 'text-cyan-400',
    },
    {
      id: 'shockwave' as const,
      name: t.nav_shockwave,
      desc: t.nav_shockwave_desc,
      icon: <Zap className="w-5 h-5" />,
      accent: 'from-rose-500 to-red-600',
      activeColor: 'text-rose-400',
    },
    {
      id: 'reversible' as const,
      name: t.nav_reversible,
      desc: t.nav_reversible_desc,
      icon: <ArrowLeftRight className="w-5 h-5" />,
      accent: 'from-emerald-500 to-teal-600',
      activeColor: 'text-emerald-400',
    },
  ];

  return (
    <aside className="w-full lg:w-72 bg-slate-950 border-e border-slate-800 p-3 lg:p-4 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible flex-shrink-0">
      <div className="hidden lg:block px-2 py-1 mb-2">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          {language === 'ar' ? 'وحدات دعم القرار' : 'DSS Decision Modules'}
        </span>
      </div>

      {navItems.map((item) => {
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectModule(item.id)}
            className={`flex items-center gap-3 p-3 rounded-xl transition-all text-start min-w-[200px] lg:min-w-0 ${
              isActive
                ? 'bg-slate-900 border border-slate-700 shadow-lg text-slate-100'
                : 'hover:bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <div
              className={`p-2.5 rounded-lg transition-all ${
                isActive
                  ? `bg-gradient-to-br ${item.accent} text-slate-950 shadow-md`
                  : 'bg-slate-900 text-slate-400'
              }`}
            >
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`block text-xs font-bold truncate ${isActive ? item.activeColor : ''}`}>
                  {item.name}
                </span>
              </div>
              <span className="block text-[11px] text-slate-500 truncate hidden lg:block">
                {item.desc}
              </span>
            </div>
            {isActive && (
              <span className="hidden lg:block w-1.5 h-6 rounded-full bg-cyan-400" />
            )}
          </button>
        );
      })}
    </aside>
  );
};
