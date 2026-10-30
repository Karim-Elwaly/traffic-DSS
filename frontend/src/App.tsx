// Intelligent Traffic DSS Main Application
import React, { useState, useEffect } from 'react';
import { TopCommandBar } from './components/layout/TopCommandBar';
import { SidebarNav, ActiveModule } from './components/layout/SidebarNav';
import { WorkZoneAdvisor } from './components/modules/WorkZoneAdvisor';
import { IntersectionSimulator } from './components/modules/IntersectionSimulator';
import { ShockwavePredictor } from './components/modules/ShockwavePredictor';
import { ReversiblePlanner } from './components/modules/ReversiblePlanner';
import { CorridorSummary, fetchCorridors, FALLBACK_CORRIDORS } from './api/client';
import { Language } from './i18n/translations';

export const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('ar'); // Default to Arabic for Egyptian Authority Context
  const [activeModule, setActiveModule] = useState<ActiveModule>('workzone');
  const [corridors, setCorridors] = useState<CorridorSummary[]>(FALLBACK_CORRIDORS);
  const [selectedCorridorId, setSelectedCorridorId] = useState<string>('corridor_26july');

  // Handle language switch and RTL / LTR HTML direction
  const handleToggleLanguage = () => {
    const nextLang = language === 'ar' ? 'en' : 'ar';
    setLanguage(nextLang);
  };

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // Load corridors on startup
  useEffect(() => {
    const load = async () => {
      const list = await fetchCorridors();
      if (list && list.length > 0) {
        setCorridors(list);
        if (!selectedCorridorId) {
          setSelectedCorridorId(list[0].id);
        }
      }
    };
    load();
  }, []);

  const activeCorridor = corridors.find((c) => c.id === selectedCorridorId) || corridors[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Operations Command Bar */}
      <TopCommandBar
        corridors={corridors}
        selectedCorridorId={selectedCorridorId}
        onSelectCorridor={setSelectedCorridorId}
        language={language}
        onToggleLanguage={handleToggleLanguage}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Sidebar DSS Navigation */}
        <SidebarNav
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          language={language}
        />

        {/* Dynamic DSS Module Content View */}
        <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full overflow-y-auto">
          {activeModule === 'workzone' && (
            <WorkZoneAdvisor
              corridorId={selectedCorridorId}
              speedLimitKmh={activeCorridor?.speed_limit_kmh || 80}
              language={language}
            />
          )}

          {activeModule === 'intersection' && (
            <IntersectionSimulator language={language} />
          )}

          {activeModule === 'shockwave' && (
            <ShockwavePredictor
              corridorId={selectedCorridorId}
              language={language}
            />
          )}

          {activeModule === 'reversible' && (
            <ReversiblePlanner
              corridorId={selectedCorridorId}
              language={language}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
