'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { localToday } from '@/lib/format';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useMeta } from '@/lib/client';
import { Combobox } from './Combobox';
import { monthName } from '@/lib/format';

export interface FilterValue {
  month: string;
  line: string;
  machineId: string;
  shift: string;
}

export function filterQuery(f: Partial<FilterValue>, extra: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams();
  if (f.month) p.set('month', f.month);
  if (f.line) p.set('line', f.line);
  if (f.machineId) p.set('machineIds', f.machineId);
  if (f.shift) p.set('shift', f.shift);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export function shiftMonth(m: string, d: number) {
  const [y, mo] = m.split('-').map(Number);
  const dt = new Date(y, mo - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex items-center rounded-full bg-white border border-line h-10">
      <button className="w-10 h-10 grid place-items-center rounded-full hover:bg-canvas" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
      <label className="relative px-1 text-sm font-semibold min-w-[118px] text-center cursor-pointer">
        {monthName(value)}
        <input type="month" className="absolute inset-0 opacity-0 cursor-pointer" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Month" />
      </label>
      <button className="w-10 h-10 grid place-items-center rounded-full hover:bg-canvas" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
    </div>
  );
}

/** Slicers like the Excel dashboard (Line, Machine) + shift. */
export function FilterBar({ value, onChange, showShift = true, showMachine = true, children }: { value: FilterValue; onChange: (v: FilterValue) => void; showShift?: boolean; showMachine?: boolean; children?: React.ReactNode }) {
  const { meta } = useMeta();
  const lines = useMemo(() => [...new Set((meta?.machines ?? []).map((m) => m.line.trim()).filter(Boolean))].sort(), [meta]);
  const machines = (meta?.machines ?? []).filter((m) => !value.line || m.line.trim() === value.line);
  return (
    <div className="card p-3 flex flex-wrap items-center gap-2 mb-4">
      <SlidersHorizontal size={16} className="text-muted ml-1" />
      <MonthPicker value={value.month} onChange={(month) => onChange({ ...value, month })} />
      <div className="inline-flex flex-wrap gap-1 rounded-full bg-canvas p-1">
        {['', ...lines].map((l) => (
          <button key={l || 'all'} onClick={() => onChange({ ...value, line: l, machineId: '' })} className={`h-8 px-3.5 rounded-full text-[13px] font-semibold ${value.line === l ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>{l || 'All lines'}</button>
        ))}
      </div>
      {showMachine && (
        <div className="w-[230px]">
          <Combobox size="md" value={value.machineId} onChange={(id) => onChange({ ...value, machineId: id })} placeholder="All machines" options={machines.map((m) => ({ value: String(m.id), label: m.name, hint: `${m.code} · ${m.line.trim()}` }))} />
        </div>
      )}
      {showShift && (
        <select className="input input-md w-auto rounded-full" value={value.shift} onChange={(e) => onChange({ ...value, shift: e.target.value })} aria-label="Shift">
          <option value="">All shifts</option>
          {(meta?.shifts ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}


/** Filter state kept in the URL so a filtered view can be refreshed or shared. */
export function useFilters(): [FilterValue, (v: FilterValue) => void] {
  const [f, setF] = useState<FilterValue>({ month: localToday().slice(0, 7), line: '', machineId: '', shift: '' });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setF((x) => ({ month: q.get('month') || x.month, line: q.get('line') || '', machineId: q.get('machine') || '', shift: q.get('shift') || '' }));
  }, []);
  const set = useCallback((v: FilterValue) => {
    setF(v);
    const u = new URL(window.location.href);
    for (const [k, val] of [['month', v.month], ['line', v.line], ['machine', v.machineId], ['shift', v.shift]] as const) {
      if (val) u.searchParams.set(k, val);
      else u.searchParams.delete(k);
    }
    window.history.replaceState(null, '', u.toString());
  }, []);
  return [f, set];
}
