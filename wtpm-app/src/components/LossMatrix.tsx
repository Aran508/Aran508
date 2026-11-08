'use client';
import { useState } from 'react';
import type { Summary } from '@/lib/oee';
import { num, hrs } from '@/lib/format';
import { Card, Segmented } from './ui';

export interface LossData {
  rows: { sno: number; machineId: number; machine: string; line: string; category: string; rank: number | null; losses: Record<string, number>; groups: { A: number; P: number; Q: number; M: number; management: number }; totalLosses: number; lossesNotCaptured: number; minPartChange: number | null; maxPartChange: number | null; hasData: boolean }[];
  totals: Record<string, number>;
  groups: { A: number; P: number; Q: number; M: number; management: number };
  categories: { code: string; name: string; oee_group: 'A' | 'P' | 'Q' | 'M'; is_management: boolean }[];
}

/** 'MIS loss report -data 1' (minutes) and 'Weekly Loss Report1-data' (hours grouped A / P / Q / mgmt). */
export function LossMatrix({ data, overall, title = 'MIS Loss Report' }: { data: LossData; overall: Summary; title?: string }) {
  const [unit, setUnit] = useState<'min' | 'h'>('min');
  const f = (v: number) => (unit === 'h' ? hrs(v, 2) : num(v));
  const groups = (['A', 'P', 'Q', 'M'] as const).map((g) => ({ g, cats: data.categories.filter((c) => c.oee_group === g) }));
  const gName = { A: 'A — Availability', P: 'P — Performance', Q: 'Q — Quality', M: 'Planned / management' };
  const rows = data.rows.filter((r) => r.hasData);
  return (
    <Card title={title} sub="Machine × loss category · ·M = counted in Management Losses" action={<Segmented value={unit} onChange={setUnit} options={[{ value: 'min', label: 'Minutes' }, { value: 'h', label: 'Hours' }]} />} pad={false}>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="table-x text-[12.5px]">
          <thead>
            <tr><th colSpan={3} className="!bg-white" />{groups.map(({ g, cats }) => <th key={g} colSpan={cats.length + 1 + (g === 'P' ? 1 : 0)} className="!text-center border-l border-line">{gName[g]}</th>)}<th colSpan={4} className="border-l border-line" /></tr>
            <tr>
              <th>S.No</th><th className="sticky left-0 z-[2]">Machine</th><th className="num">OEE Ranking</th>
              {groups.map(({ g, cats }) => [
                ...cats.map((c) => <th key={c.code} className={`num ${c === cats[0] ? 'border-l border-line' : ''}`} title={c.name}>{c.name}{c.is_management ? ' ·M' : ''}</th>),
                ...(g === 'P' ? [<th key="lnc" className="num">Losses not captured</th>] : []),
                <th key={g + 't'} className="num bg-navy-50">Σ {g}</th>,
              ])}
              <th className="num border-l border-line">Total losses</th><th>Cat</th><th className="num">Min Part change</th><th className="num">Max Part change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.machineId}>
                <td>{r.sno}</td><td className="font-semibold sticky left-0 bg-white">{r.machine}</td><td className="num">{r.rank ?? ''}</td>
                {groups.map(({ g, cats }) => [
                  ...cats.map((c, i) => <td key={c.code} className={`num ${i === 0 ? 'border-l border-line' : ''} ${r.losses[c.code] ? '' : 'text-[#c9c6d2]'}`}>{r.losses[c.code] ? f(r.losses[c.code]) : '0'}</td>),
                  ...(g === 'P' ? [<td key="lnc" className={`num ${r.lossesNotCaptured < 0 ? 'text-bad' : ''}`}>{f(r.lossesNotCaptured)}</td>] : []),
                  <td key={g + 't'} className="num font-semibold bg-navy-50/60">{f(r.groups[g])}</td>,
                ])}
                <td className="num font-bold border-l border-line">{f(r.totalLosses)}</td><td>{r.category}</td><td className="num">{r.minPartChange ?? ''}</td><td className="num">{r.maxPartChange ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-[#faf9f7]">
              <td /><td className="sticky left-0 bg-[#faf9f7]">Total</td><td />
              {groups.map(({ g, cats }) => [
                ...cats.map((c, i) => <td key={c.code} className={`num ${i === 0 ? 'border-l border-line' : ''}`}>{f(data.totals[c.code] || 0)}</td>),
                ...(g === 'P' ? [<td key="lnc" className="num">{f(overall.lossesNotCaptured)}</td>] : []),
                <td key={g + 't'} className="num bg-navy-50">{f(data.groups[g])}</td>,
              ])}
              <td className="num border-l border-line">{f(overall.totalLosses)}</td><td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
