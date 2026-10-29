import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, GitCompare } from 'lucide-react';

interface IntersectionCanvasProps {
  mainFlow: number;
  crossFlow: number;
  language?: 'en' | 'ar';
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  direction: 'main' | 'cross' | 'uturn';
  color: string;
  isStopped: boolean;
}

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = ({
  mainFlow,
  crossFlow,
  language = 'en',
}) => {
  const signalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uturnCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  const signalParticlesRef = useRef<Particle[]>([]);
  const uturnParticlesRef = useRef<Particle[]>([]);
  const signalPhaseRef = useRef<'MAIN_GREEN' | 'CROSS_GREEN'>('MAIN_GREEN');
  const phaseTimerRef = useRef(0);

  useEffect(() => {
    const sigCanvas = signalCanvasRef.current;
    const uturnCanvas = uturnCanvasRef.current;
    if (!sigCanvas || !uturnCanvas) return;

    const sigCtx = sigCanvas.getContext('2d');
    const uturnCtx = uturnCanvas.getContext('2d');
    if (!sigCtx || !uturnCtx) return;

    let animId: number;

    const render = () => {
      if (isPlaying) {
        // -------------------------------------------------------------------
        // 1. Update Traffic Signal Logic (Cycle: 120 frames Main Green, 80 Cross Green)
        // -------------------------------------------------------------------
        phaseTimerRef.current++;
        if (signalPhaseRef.current === 'MAIN_GREEN' && phaseTimerRef.current > 140) {
          signalPhaseRef.current = 'CROSS_GREEN';
          phaseTimerRef.current = 0;
        } else if (signalPhaseRef.current === 'CROSS_GREEN' && phaseTimerRef.current > 90) {
          signalPhaseRef.current = 'MAIN_GREEN';
          phaseTimerRef.current = 0;
        }

        // Spawn Signal Particles
        if (Math.random() < (mainFlow / 3600.0) * 0.45) {
          signalParticlesRef.current.push({
            x: 0,
            y: 95,
            speed: 1.8,
            direction: 'main',
            color: '#06b6d4',
            isStopped: false,
          });
        }
        if (Math.random() < (crossFlow / 3600.0) * 0.45) {
          signalParticlesRef.current.push({
            x: 195,
            y: 0,
            speed: 1.5,
            direction: 'cross',
            color: '#f59e0b',
            isStopped: false,
          });
        }

        // Spawn U-Turn Particles (Continuous Mainline, Loop for Cross/Detour)
        if (Math.random() < (mainFlow / 3600.0) * 0.45) {
          uturnParticlesRef.current.push({
            x: 0,
            y: 95,
            speed: 2.2, // Higher free-flow cruise speed
            direction: 'main',
            color: '#06b6d4',
            isStopped: false,
          });
        }
        if (Math.random() < (crossFlow / 3600.0) * 0.35) {
          uturnParticlesRef.current.push({
            x: 195,
            y: 0,
            speed: 1.6,
            direction: 'uturn',
            color: '#10b981',
            isStopped: false,
          });
        }

        // Update Signal Particles
        const isMainGreen = signalPhaseRef.current === 'MAIN_GREEN';
        signalParticlesRef.current.forEach((p, idx) => {
          if (p.direction === 'main') {
            const stopLine = 170;
            if (!isMainGreen && p.x < stopLine && p.x > stopLine - 60) {
              p.isStopped = true;
            } else {
              // Car following
              const ahead = signalParticlesRef.current.find(
                (o, j) => j !== idx && o.direction === 'main' && o.x > p.x && o.x - p.x < 18
              );
              p.isStopped = !!ahead;
            }
            if (!p.isStopped) p.x += p.speed;
          } else {
            // cross
            const stopLine = 75;
            if (isMainGreen && p.y < stopLine && p.y > stopLine - 60) {
              p.isStopped = true;
            } else {
              const ahead = signalParticlesRef.current.find(
                (o, j) => j !== idx && o.direction === 'cross' && o.y > p.y && o.y - p.y < 18
              );
              p.isStopped = !!ahead;
            }
            if (!p.isStopped) p.y += p.speed;
          }
        });
        signalParticlesRef.current = signalParticlesRef.current.filter(
          (p) => p.x < sigCanvas.width + 20 && p.y < sigCanvas.height + 20
        );

        // Update U-Turn Particles
        uturnParticlesRef.current.forEach((p) => {
          if (p.direction === 'main') {
            p.x += p.speed; // No stop line on mainline!
          } else {
            // U-Turn vehicle turns into right deceleration pocket and loops
            if (p.y < 95) {
              p.y += p.speed;
            } else if (p.x < 310) {
              p.x += p.speed * 0.9;
            } else if (p.y < 125) {
              p.y += p.speed * 0.8;
            } else {
              p.x -= p.speed * 0.9; // Loops back
            }
          }
        });
        uturnParticlesRef.current = uturnParticlesRef.current.filter(
          (p) => p.x < uturnCanvas.width + 40 && p.x > -50 && p.y < uturnCanvas.height + 30
        );
      }

      // ---------------------------------------------------------------------
      // Draw Left Canvas: Signal Intersection
      // ---------------------------------------------------------------------
      sigCtx.fillStyle = '#070b14';
      sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);

      // Roads
      sigCtx.fillStyle = '#1e293b';
      sigCtx.fillRect(0, 75, sigCanvas.width, 50); // East-West Main
      sigCtx.fillRect(175, 0, 50, sigCanvas.height); // North-South Cross

      // Center intersection box
      sigCtx.fillStyle = '#0f172a';
      sigCtx.fillRect(175, 75, 50, 50);

      // Signal Heads
      const isMG = signalPhaseRef.current === 'MAIN_GREEN';
      // Main Signal
      sigCtx.fillStyle = isMG ? '#10b981' : '#ef4444';
      sigCtx.beginPath();
      sigCtx.arc(165, 68, 5, 0, Math.PI * 2);
      sigCtx.fill();

      // Cross Signal
      sigCtx.fillStyle = !isMG ? '#10b981' : '#ef4444';
      sigCtx.beginPath();
      sigCtx.arc(232, 68, 5, 0, Math.PI * 2);
      sigCtx.fill();

      // Draw Signal Vehicles
      signalParticlesRef.current.forEach((p) => {
        sigCtx.fillStyle = p.isStopped ? '#ef4444' : p.color;
        sigCtx.fillRect(p.x - 5, p.y - 3, 10, 6);
      });

      // ---------------------------------------------------------------------
      // Draw Right Canvas: U-Turn Corridor
      // ---------------------------------------------------------------------
      uturnCtx.fillStyle = '#070b14';
      uturnCtx.fillRect(0, 0, uturnCanvas.width, uturnCanvas.height);

      // Continuous Main Highway
      uturnCtx.fillStyle = '#1e293b';
      uturnCtx.fillRect(0, 75, uturnCanvas.width, 50);

      // Closed Median barrier (Concrete jersey barrier)
      uturnCtx.fillStyle = '#38bdf8';
      uturnCtx.fillRect(60, 98, 220, 4); // Solid median blocking direct crossing

      // Protected U-Turn loop opening at 300px
      uturnCtx.fillStyle = '#0f172a';
      uturnCtx.fillRect(290, 85, 45, 30); // Median gap for U-turn

      // Incoming right-in right-out cross stub
      uturnCtx.fillStyle = '#1e293b';
      uturnCtx.fillRect(175, 0, 40, 75);

      // Draw U-Turn Vehicles
      uturnParticlesRef.current.forEach((p) => {
        uturnCtx.fillStyle = p.color;
        uturnCtx.fillRect(p.x - 5, p.y - 3, 10, 6);
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [mainFlow, crossFlow, isPlaying]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-emerald-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {language === 'ar'
              ? 'مقارنة مرئية: إشارة ضوئية (توقف وتكدس) مقابل دوران محمي (حركة حرة مستمرة)'
              : 'Visual Comparator: Traffic Signal (Stop-and-Go) vs Protected U-Turn (Free Flow)'}
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              signalParticlesRef.current = [];
              uturnParticlesRef.current = [];
            }}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Signal Panel */}
        <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-xs font-medium text-rose-400">
              {language === 'ar' ? '1. إشارة ضوئية رباعية (تكدس ونقاط تصادم)' : '1. 4-Phase Signal (Queuing & 8 Conflict Points)'}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">32 Conflict Pts</span>
          </div>
          <canvas ref={signalCanvasRef} width={400} height={200} className="w-full h-auto block rounded" />
        </div>

        {/* U-Turn Panel */}
        <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-xs font-medium text-emerald-400">
              {language === 'ar' ? '2. محور دوران محمي (تدفق مستمر وآمن)' : '2. Protected U-Turn Axis (Continuous Flow & 4 Conflict Points)'}
            </span>
            <span className="text-[11px] text-emerald-400 font-mono">4 Conflict Pts (Safe)</span>
          </div>
          <canvas ref={uturnCanvasRef} width={400} height={200} className="w-full h-auto block rounded" />
        </div>
      </div>
    </div>
  );
};
