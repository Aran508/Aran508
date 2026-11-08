'use client';
import type { Summary } from '@/lib/oee';
import { hrs, num, pct, oeeTone } from '@/lib/format';
import { Badge } from './ui';

export type SumRow = Summary & { sno: number; machineId: number; code: string; machine: string; line: string; category: string; hasData: boolean; rank: number | null; band: string };

const toneCls = (v: number | null, low = 0.6, high = 0.8) => {
  const t = oeeTone(v, low, high);
  return t === 'good' ? 'bg-good-bg text-good' : t === 'warn' ? 'bg-warn-bg text-warn' : t === 'bad' ? 'bg-bad-bg text-bad' : '';
};

/** ' OEE Overall Summary 1' / 'Weekly Report -data 1' table (minutes, both OEE methods). */
export function SummaryTable({ rows, overall, fm, onlyData = false, unit = 'min', bands }: { rows: SumRow[]; overall: Summary; fm?: Summary; onlyData?: boolean; unit?: 'min' | 'h'; bands?: { low: number; high: number } }) {
  const t = (v: number) => (unit === 'h' ? hrs(v, 2) : num(v, 2));
  const list = onlyData ? rows.filter((r) => r.hasData) : rows;
  const cells = (r: Summary) => (
    <>
      <td className="num font-semibold">{num(r.qty, 2)}</td><td className="num">{num(r.defect)}</td><td className="num">{t(r.plannedTime)}</td><td className="num">{t(r.totalLosses)}</td><td className="num">{t(r.managementLosses)}</td><td className="num">{t(r.operatingTime)}</td>
      <td className="num border-l border-line">{pct(r.woA)}</td><td className="num">{pct(r.woP)}</td><td className="num">{pct(r.woQ)}</td><td className="num font-semibold">{pct(r.woOEE)}</td>
      <td className="num border-l border-line">{pct(r.A)}</td><td className="num">{pct(r.P)}</td><td className="num">{pct(r.Q)}</td>
      <td className="num"><span className={`chip ${toneCls(r.OEE, bands?.low, bands?.high)}`}>{pct(r.OEE)}</span></td>
      <td className={`num border-l border-line ${r.lossesNotCaptured < 0 ? 'text-bad' : ''}`}>{num(r.lossesNotCaptured, 2)}</td><td className="num">{hrs(r.lossesNotCaptured, 2)}</td>
    </>
  );
  return (
    <div className="overflow-x-auto">
      <table className="table-x text-[13px]">
        <thead>
          <tr><th colSpan={5} /><th colSpan={6} className="!text-center">{unit === 'h' ? 'Hours' : 'Minutes'}</th><th colSpan={4} className="!text-center border-l border-line">w/o mgmt Loss</th><th colSpan={4} className="!text-center border-l border-line">with mgmt Loss</th><th colSpan={2} className="!text-center border-l border-line">Losses not captured</th></tr>
          <tr><th>S.No.</th><th>Cat</th><th>LINE</th><th>Code</th><th>Machine</th><th className="num">Total Qty Produced</th><th className="num">Defects</th><th className="num">Planned Time</th><th className="num">Total Losses</th><th className="num">Management Losses</th><th className="num">Operating Time</th><th className="num border-l border-line">%A</th><th className="num">% P</th><th className="num">%Q</th><th className="num">%OEE</th><th className="num border-l border-line">%A2</th><th className="num">%P</th><th className="num">%Q3</th><th className="num">%OEE4</th><th className="num border-l border-line">min</th><th className="num">hrs</th></tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.machineId} className={r.hasData ? '' : 'text-[#b5b2c0]'}>
              <td>{r.sno}</td><td>{r.category === 'FM' ? <Badge tone="navy">FM</Badge> : ''}</td><td>{r.line}</td><td>{r.code}</td><td className="font-semibold text-ink">{r.machine}</td>
              {cells(r)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold bg-[#faf9f7]"><td colSpan={5}>Overall</td>{cells(overall)}</tr>
          {fm && <tr className="font-bold bg-[#faf9f7]"><td colSpan={5}>FM</td>{cells(fm)}</tr>}
        </tfoot>
      </table>
    </div>
  );
}

export function RankingTables({ ranking, rows, bands }: { ranking: { rank: number; machine: string; line: string; OEE: number | null; band: string }[]; rows: SumRow[]; bands: { low: number; high: number } }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="overflow-x-auto">
        <table className="table-x">
          <thead><tr><th>OEE Ranking</th><th>Machine</th><th>Line</th><th className="num">%OEE4</th></tr></thead>
          <tbody>{ranking.map((r) => <tr key={r.machine}><td className="font-bold">{r.rank}</td><td className="font-semibold">{r.machine}</td><td>{r.line}</td><td className="num"><span className={`chip ${toneCls(r.OEE, bands.low, bands.high)}`}>{pct(r.OEE)}</span></td></tr>)}</tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="table-x">
          <thead><tr><th>S.No.</th><th>LINE</th><th>Machine</th><th className="num">OEE (&lt;{bands.low * 100}%)</th><th className="num">OEE ({bands.low * 100}%–{bands.high * 100}%)</th><th className="num">OEE (&gt;{bands.high * 100}%)</th></tr></thead>
          <tbody>{rows.filter((r) => r.hasData).map((r, i) => (
            <tr key={r.machineId}><td>{i + 1}</td><td>{r.line}</td><td className="font-semibold">{r.machine}</td>
              <td className="num text-bad font-semibold">{r.band === 'low' ? pct(r.OEE, 2) : ''}</td><td className="num text-warn font-semibold">{r.band === 'mid' ? pct(r.OEE, 2) : ''}</td><td className="num text-good font-semibold">{r.band === 'high' ? pct(r.OEE, 2) : ''}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

export function ExportButtons({ month, line, machineId }: { month: string; line?: string; machineId?: string }) {
  const q = new URLSearchParams({ month, ...(line ? { line } : {}), ...(machineId ? { machineIds: machineId } : {}) }).toString();
  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn btn-md btn-dark" href={`/api/export/excel?${q}`}>Monthly Excel</a>
      <a className="btn btn-md btn-ghost" href={`/api/export/pdf?type=monthly&${q}`}>Monthly PDF</a>
      <a className="btn btn-md btn-ghost" href={`/api/export/pdf?type=loss&${q}`}>Loss analysis PDF</a>
    </div>
  );
}
