'use client';
import { useEffect, useRef } from 'react';
import { X, Loader2, AlertTriangle, CheckCircle2, Info, Minus, Plus } from 'lucide-react';
import { oeeTone, pct } from '@/lib/format';

export function Card({ title, sub, action, children, className = '', pad = true }: { title?: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-bold tracking-tight text-ink">{title}</h2>}
            {sub && <p className="text-[13px] text-muted mt-0.5">{sub}</p>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={pad ? 'p-4 sm:p-5' : title || action ? 'pt-3' : ''}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone = 'plain', icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'plain' | 'accent' | 'navy' | 'good' | 'bad' | 'warn'; icon?: React.ReactNode }) {
  const tones = {
    plain: 'bg-white border-line',
    accent: 'bg-brand-500 border-brand-500 text-white',
    navy: 'bg-navy-800 border-navy-800 text-white',
    good: 'bg-good-bg border-good-bg',
    bad: 'bg-bad-bg border-bad-bg',
    warn: 'bg-warn-bg border-warn-bg',
  } as const;
  const dark = tone === 'accent' || tone === 'navy';
  return (
    <div className={`rounded-2xl border px-4 py-3.5 min-w-0 ${tones[tone]}`}>
      <div className={`flex items-center gap-1.5 text-[12.5px] font-medium ${dark ? 'text-white/80' : 'text-muted'}`}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-[26px] leading-none font-bold tracking-tight tabular-nums">{value}</div>
      {sub && <div className={`mt-1.5 text-xs truncate ${dark ? 'text-white/80' : 'text-muted'}`}>{sub}</div>}
    </div>
  );
}

export function Badge({ tone = 'plain', children }: { tone?: 'plain' | 'good' | 'bad' | 'warn' | 'navy' | 'brand' | 'yellow'; children: React.ReactNode }) {
  const t = {
    plain: 'bg-canvas text-muted',
    good: 'bg-good-bg text-good',
    bad: 'bg-bad-bg text-bad',
    warn: 'bg-warn-bg text-warn',
    navy: 'bg-navy-100 text-navy-800',
    brand: 'bg-brand-100 text-brand-600',
    yellow: 'bg-alert text-ink',
  }[tone];
  return <span className={`chip ${t}`}>{children}</span>;
}

export function OeeBadge({ v, low = 0.6, high = 0.8 }: { v: number | null | undefined; low?: number; high?: number }) {
  const t = oeeTone(v, low, high);
  return <Badge tone={t === 'none' ? 'plain' : t}>{pct(v)}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  if (status === 'verified') return <Badge tone="good">Verified</Badge>;
  if (status === 'correction_requested') return <Badge tone="bad">Correction</Badge>;
  return <Badge tone="yellow">Submitted</Badge>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} />;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted text-sm">
      <Spinner /> {text}
    </div>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-bad-bg text-bad px-4 py-3 text-sm flex items-center gap-3">
      <AlertTriangle size={18} /> <span className="flex-1">{text}</span>
      {onRetry && <button className="btn btn-md btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: React.ReactNode }) {
  const map = { info: ['bg-navy-50 text-navy-800', Info], warn: ['bg-warn-bg text-warn', AlertTriangle], bad: ['bg-bad-bg text-bad', AlertTriangle], good: ['bg-good-bg text-good', CheckCircle2] } as const;
  const [cls, Icon] = map[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 text-sm flex gap-2.5 ${cls}`}>
      <Icon size={18} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-4">
      <div className="mx-auto w-14 h-14 rounded-2xl hatch border border-line mb-3" />
      <div className="font-semibold">{title}</div>
      {children && <div className="text-sm text-muted mt-1">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-navy-950/40 backdrop-blur-[2px] p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col outline-none`}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="w-10 h-10 rounded-full hover:bg-canvas grid place-items-center" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; size?: 'md' | 'lg' }) {
  return (
    <div className="inline-flex rounded-full bg-canvas p-1 gap-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full font-semibold transition ${size === 'lg' ? 'h-12 px-5 text-base' : 'h-8 px-3.5 text-[13px]'} ${o.value === value ? 'bg-ink text-white shadow' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Big touch-friendly number input with − / + buttons and numeric keyboard. */
export function NumberField({ value, onChange, step = 1, min = 0, label, unit, invalid, id, compact }: { value: number | ''; onChange: (v: number | '') => void; step?: number; min?: number; label?: string; unit?: string; invalid?: string | null; id?: string; compact?: boolean }) {
  const h = compact ? 'h-12' : 'h-14';
  const bump = (d: number) => {
    const cur = value === '' ? 0 : Number(value);
    onChange(Math.max(min, Math.round((cur + d) * 1000) / 1000));
  };
  return (
    <div>
      {label && <label className="label" htmlFor={id}>{label}{unit && <span className="font-normal"> ({unit})</span>}</label>}
      <div className={`flex items-stretch rounded-xl border bg-white ${invalid ? 'border-bad ring-4 ring-bad-bg' : 'border-line focus-within:border-navy-600 focus-within:ring-4 focus-within:ring-navy-100'}`}>
        <button type="button" tabIndex={-1} onClick={() => bump(-step)} className={`${h} w-12 grid place-items-center text-muted active:bg-canvas rounded-l-xl`} aria-label={`Decrease ${label ?? ''}`}><Minus size={18} /></button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          enterKeyHint="next"
          className={`${h} w-full min-w-0 bg-transparent text-center text-xl font-bold tabular-nums outline-none`}
          value={value}
          min={min}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <button type="button" tabIndex={-1} onClick={() => bump(step)} className={`${h} w-12 grid place-items-center text-muted active:bg-canvas rounded-r-xl`} aria-label={`Increase ${label ?? ''}`}><Plus size={18} /></button>
      </div>
      {invalid && <p className="text-bad text-xs font-semibold mt-1">{invalid}</p>}
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight leading-tight">{title}</h1>
        {sub && <p className="text-muted text-sm mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function MiniBar({ value, tone }: { value: number | null; tone?: 'good' | 'warn' | 'bad' | 'none' }) {
  const t = tone ?? oeeTone(value);
  const c = t === 'good' ? 'bg-good' : t === 'warn' ? 'bg-alert' : t === 'bad' ? 'bg-bad' : 'bg-line';
  return (
    <div className="h-1.5 w-full rounded-full bg-canvas overflow-hidden">
      <div className={`h-full ${c} rounded-full`} style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} />
    </div>
  );
}
