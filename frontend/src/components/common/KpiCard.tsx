import React from 'react';

type KpiStatus = 'normal' | 'warning' | 'critical' | 'success' | 'info' | 'optimal';
type KpiVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'critical' | 'optimal';

interface KpiCardProps {
  title: string;
  value: string | number;
  unit?: string;
  delta?: {
    value: number;
    isGood: boolean;
  };
  status?: KpiStatus;
  /** Shorthand for the module KPI palette. Ignored when `status` is supplied. */
  variant?: KpiVariant;
  /** Optional Tailwind border class that overrides the status border colour. */
  accent?: string;
  los?: string;
  icon?: React.ReactNode;
  description?: string;
  subtitle?: string;
}

const VARIANT_STATUS: Record<KpiVariant, KpiStatus> = {
  success: 'success',
  warning: 'warning',
  danger: 'critical',
  critical: 'critical',
  neutral: 'normal',
  info: 'info',
  optimal: 'optimal',
};

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  unit,
  delta,
  status,
  variant,
  accent,
  los,
  icon,
  description,
  subtitle,
}) => {
  const resolvedStatus: KpiStatus =
    status ?? (variant ? VARIANT_STATUS[variant] : 'normal');

  const getStatusTone = () => {
    switch (resolvedStatus) {
      case 'success':
      case 'optimal':
        return 'bg-emerald-950/20 text-emerald-400';
      case 'warning':
        return 'bg-amber-950/20 text-amber-400';
      case 'critical':
        return 'bg-rose-950/20 text-rose-400';
      case 'info':
        return 'bg-cyan-950/20 text-cyan-400';
      default:
        return 'bg-slate-900/90 text-cyan-400';
    }
  };

  const getStatusBorder = () => {
    switch (resolvedStatus) {
      case 'success':
      case 'optimal':
        return 'border-emerald-500/30';
      case 'warning':
        return 'border-amber-500/30';
      case 'critical':
        return 'border-rose-500/30';
      case 'info':
        return 'border-cyan-500/30';
      default:
        return 'border-slate-800';
    }
  };

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

  return (
    <div className={`p-4 rounded-xl border shadow-lg backdrop-blur-sm transition-all hover:border-slate-700 ${accent ?? getStatusBorder()} ${getStatusTone()}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tracking-tight text-slate-100">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-medium">{unit}</span>}
        {los && (
          <span className={`ms-auto text-xs font-bold px-2 py-0.5 rounded border ${getLosBadgeColor(los)}`}>
            LoS {los}
          </span>
        )}
      </div>

      {(delta || description) && (
        <div className="mt-2 flex items-center justify-between text-xs">
          {description && <span className="text-slate-400 truncate max-w-[180px]">{description}</span>}
          {delta && (
            <span className={`font-medium ${delta.isGood ? 'text-emerald-400' : 'text-rose-400'}`}>
              {delta.value > 0 ? `+${delta.value}%` : `${delta.value}%`}
            </span>
          )}
        </div>
      )}
      {subtitle && (
        <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">{subtitle}</div>
      )}
    </div>
  );
};
