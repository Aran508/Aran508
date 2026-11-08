'use client';
import { useState } from 'react';
import { useApi } from '@/lib/client';
import { Card, Loading, ErrorBox, PageHeader, Segmented, Kpi, Notice } from '@/components/ui';
import { FilterBar, filterQuery, useFilters } from '@/components/Filters';
import { SummaryTable, RankingTables, ExportButtons, type SumRow } from '@/components/ReportTables';
import { MachineApqBars, OeeBars, WeekBars, TrendChart } from '@/components/charts';
import { LossMatrix, type LossData } from '@/components/LossMatrix';
import { hrs, num, pct, shortDay } from '@/lib/format';
import type { Summary } from '@/lib/oee';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

interface Monthly {
  label: string; from: string; to: string; blockCount: number; entryCount: number;
  summary: { rows: SumRow[]; overall: Summary; fm: Summary; plantAverage: Record<string, number | null>; ranking: { rank: number; machine: string; line: string; OEE: number | null; band: string }[] };
  revisedPlant: Summary;
  daily: (Summary & { date: string })[];
  weekly: { week: number; blocks: number; summary: { rows: SumRow[]; overall: Summary; fm: Summary } }[];
  weeklyMatrix: { weeks: number[]; rows: { machineId: number; machine: string; weeks: { week: number; OEE: number | null }[] }[] };
  loss: LossData;
  lines: (Summary & { line: string })[];
  shifts: (Summary & { shift: string; timings: string })[];
  categories: LossData['categories'];
  settings: Record<string, unknown>;
}

export default function MonthlyReport() {
  const [f, setF] = useFilters();
  const [tab, setTab] = useState<'summary' | 'weekly' | 'daily' | 'loss' | 'line'>('summary');
  const { data, error, loading, reload } = useApi<Monthly>(`/api/reports/monthly?${filterQuery({ ...f, machineId: '', shift: '' })}`);
  const bands = (data?.settings.oee_bands as { low: number; high: number }) ?? { low: 0.6, high: 0.8 };
  return (
    <div>
      <PageHeader title="Monthly Report" sub="Recreates ' OEE Overall Summary 1', weekly, MIS loss and daily report sheets of the OEE MAIN SHEET">
        <ExportButtons month={f.month} line={f.line} />
      </PageHeader>
      <FilterBar value={f} onChange={setF} showMachine={false} showShift={false} />
      {error && <ErrorBox text={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
            <Kpi label="Total Qty Produced" value={num(data.summary.overall.qty)} sub={`${data.entryCount} records · ${data.blockCount} machine-shifts`} />
            <Kpi label="Defects" value={num(data.summary.overall.defect)} />
            <Kpi label="Planned Time" value={`${hrs(data.summary.overall.plannedTime, 0)} h`} />
            <Kpi label="Total Losses" value={`${hrs(data.summary.overall.totalLosses, 0)} h`} sub={`${hrs(data.summary.overall.managementLosses, 0)} h mgmt`} />
            <Kpi label="%A (avg)" value={pct(data.summary.plantAverage.A)} />
            <Kpi label="%P (avg)" value={pct(data.summary.plantAverage.P)} />
            <Kpi label="%Q (avg)" value={pct(data.summary.plantAverage.Q)} />
            <Kpi label="%OEE (avg)" value={pct(data.summary.plantAverage.OEE)} sub={`Overall from totals ${pct(data.summary.overall.OEE)}`} tone="accent" />
          </div>
          <div className="mb-4 overflow-x-auto">
            <Segmented value={tab} onChange={setTab} options={[{ value: 'summary', label: 'OEE Overall Summary' }, { value: 'weekly', label: 'Weekly' }, { value: 'daily', label: 'Daily' }, { value: 'loss', label: 'MIS Loss Report' }, { value: 'line', label: 'Line & Shift' }]} />
          </div>

          {tab === 'summary' && (
            <div className="space-y-4">
              <Card title={`OEE Overall Summary — ${data.label}`} sub="All times in minutes (as the workbook). Overall/FM rows are calculated from the summed totals." pad={false}>
                <SummaryTable rows={data.summary.rows} overall={data.summary.overall} fm={data.summary.fm} bands={bands} />
              </Card>
              <div className="grid xl:grid-cols-2 gap-4">
                <Card title="Machine-wise APQ" sub="%A, %P, %Q, %OEE with management loss"><MachineApqBars data={data.summary.rows.filter((r) => r.hasData).map((r) => ({ machine: r.machine, A: r.A, P: r.P, Q: r.Q, OEE: r.OEE }))} /></Card>
                <Card title="Machine-wise OEE" sub="%OEE4"><OeeBars data={data.summary.rows.filter((r) => r.hasData).map((r) => ({ name: r.machine, OEE: r.OEE }))} low={bands.low} high={bands.high} target={Number(data.settings.oee_target ?? 0.85)} /></Card>
              </div>
              <Card title="Machine-wise Quality Details" sub="Total Qty Produced and Defects">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.summary.rows.filter((r) => r.hasData).map((r) => ({ name: r.machine, Qty: r.qty, Defects: r.defect }))} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid stroke="#ece9e3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={60} /><YAxis yAxisId="q" tick={{ fontSize: 11 }} /><YAxis yAxisId="d" orientation="right" tick={{ fontSize: 11 }} /><Tooltip /><Legend verticalAlign="top" height={28} />
                    <Bar yAxisId="q" dataKey="Qty" name="Total Qty Produced" fill="#261a66" radius={[4, 4, 0, 0]} /><Bar yAxisId="d" dataKey="Defects" fill="#ef5f18" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card title="OEE Ranking & OEE bands"><RankingTables ranking={data.summary.ranking} rows={data.summary.rows} bands={bands} /></Card>
              <Card title="Revised OEE method (workbook columns BC–BS)" sub="Planned time revised = Planned − (Planned downtime + No manpower + No material + No schedule + Try out & development + TPM & cleaning)">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-sm">
                  {[['Excluded (BC)', `${num(data.revisedPlant.revisedExcl)} min`], ['Planned revised (BF)', `${num(data.revisedPlant.revised.plannedRevised)} min`], ['%A (BH)', pct(data.revisedPlant.revised.A)], ['%P (BI)', pct(data.revisedPlant.revised.P)], ['%OEE (BK)', pct(data.revisedPlant.revised.OEE)], ['Loss not captured (BL)', `${num(data.revisedPlant.revised.lossNotCaptured)} min`], ['Planned revised 2 (BN)', `${num(data.revisedPlant.revised.plannedRevised2)} min`], ['%OEE (BS)', pct(data.revisedPlant.revised.OEE2)]].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-canvas px-3 py-2"><div className="text-[11px] text-muted">{k}</div><div className="font-bold">{v}</div></div>
                  ))}
                </div>
                <p className="text-xs text-muted mt-2">BN = BF − 0.85 × BL. In the workbook these columns only read the first row of each block; here they use the whole machine-shift.</p>
              </Card>
            </div>
          )}

          {tab === 'weekly' && (
            <div className="space-y-4">
              <Card title="Weekly report graph" sub="Machine-wise %OEE per week (week = CEILING(DAY/7))">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {data.weeklyMatrix.rows.map((m) => (
                    <div key={m.machineId} className="rounded-2xl border border-line p-3"><div className="text-sm font-bold">{m.machine}</div><WeekBars weeks={m.weeks} height={130} /></div>
                  ))}
                </div>
              </Card>
              {data.weekly.filter((w) => w.blocks).map((w) => (
                <Card key={w.week} title={`Week ${w.week}`} sub={`Weekly Report -data 1 · Overall %OEE ${pct(w.summary.overall.OEE)}`} pad={false}>
                  <SummaryTable rows={w.summary.rows} overall={w.summary.overall} fm={w.summary.fm} onlyData bands={bands} />
                </Card>
              ))}
            </div>
          )}

          {tab === 'daily' && (
            <div className="space-y-4">
              <Card title="Daily %OEE"><TrendChart data={data.daily} target={Number(data.settings.oee_target ?? 0.85)} /></Card>
              <Card title="Daily Report" sub="Losses not captured = (Planned − Total Losses) × 0.85 − Operating Time (as the workbook's Daily Report)" pad={false}>
                <div className="overflow-x-auto"><table className="table-x text-[13px]">
                  <thead><tr><th>Date</th><th className="num">Total Qty Produced</th><th className="num">Defects</th><th className="num">Planned Time</th><th className="num">Total Losses</th><th className="num">Mgmt Losses</th><th className="num">Operating Time</th><th className="num">Losses not captured</th><th className="num border-l border-line">%A</th><th className="num">%P</th><th className="num">%Q</th><th className="num">%OEE</th><th className="num border-l border-line">%A</th><th className="num">%P</th><th className="num">%Q</th><th className="num">%OEE</th></tr>
                  <tr><th colSpan={8} /><th colSpan={4} className="!text-center border-l border-line">Without Mgmt Loss</th><th colSpan={4} className="!text-center border-l border-line">With Mgmt Loss</th></tr></thead>
                  <tbody>{data.daily.map((d) => (
                    <tr key={d.date} className={d.blocks ? '' : 'text-[#b5b2c0]'}><td className="font-semibold">{shortDay(d.date)}</td><td className="num">{num(d.qty, 2)}</td><td className="num">{num(d.defect)}</td><td className="num">{num(d.plannedTime)}</td><td className="num">{num(d.totalLosses)}</td><td className="num">{num(d.managementLosses)}</td><td className="num">{num(d.operatingTime, 2)}</td><td className="num">{d.blocks ? num(d.dailyLossesNotCaptured, 2) : '0'}</td>
                      <td className="num border-l border-line">{pct(d.woA)}</td><td className="num">{pct(d.woP)}</td><td className="num">{pct(d.woQ)}</td><td className="num font-semibold">{pct(d.woOEE)}</td><td className="num border-l border-line">{pct(d.A)}</td><td className="num">{pct(d.P)}</td><td className="num">{pct(d.Q)}</td><td className="num font-semibold">{pct(d.OEE)}</td></tr>
                  ))}</tbody>
                </table></div>
              </Card>
            </div>
          )}

          {tab === 'loss' && <LossMatrix data={{ ...data.loss, categories: data.categories }} overall={data.summary.overall} />}

          {tab === 'line' && (
            <div className="grid xl:grid-cols-2 gap-4">
              {[{ title: 'Line-wise', rows: data.lines.map((l) => ({ k: l.line, s: l })) }, { title: 'Shift-wise', rows: data.shifts.map((s) => ({ k: `${s.shift} (${s.timings})`, s })) }].map((blk) => (
                <Card key={blk.title} title={blk.title} pad={false}>
                  <div className="overflow-x-auto"><table className="table-x">
                    <thead><tr><th>{blk.title.split('-')[0]}</th><th className="num">Qty</th><th className="num">Planned h</th><th className="num">Losses h</th><th className="num">Operating h</th><th className="num">%A</th><th className="num">%P</th><th className="num">%Q</th><th className="num">%OEE</th></tr></thead>
                    <tbody>{blk.rows.map(({ k, s }) => <tr key={k}><td className="font-semibold">{k}</td><td className="num">{num(s.qty)}</td><td className="num">{hrs(s.plannedTime)}</td><td className="num">{hrs(s.totalLosses)}</td><td className="num">{hrs(s.operatingTime)}</td><td className="num">{pct(s.A)}</td><td className="num">{pct(s.P)}</td><td className="num">{pct(s.Q)}</td><td className="num font-bold">{pct(s.OEE)}</td></tr>)}</tbody>
                  </table></div>
                </Card>
              ))}
            </div>
          )}
          {!data.entryCount && <div className="mt-4"><Notice>No records for this month yet.</Notice></div>}
        </>
      )}
    </div>
  );
}
