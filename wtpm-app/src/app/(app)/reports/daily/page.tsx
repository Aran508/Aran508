'use client';
import { useApi, useQueryState } from '@/lib/client';
import { Card, Loading, ErrorBox, PageHeader, Kpi, Empty, OeeBadge } from '@/components/ui';
import { FilterBar, filterQuery, useFilters } from '@/components/Filters';
import { TrendChart } from '@/components/charts';
import { SummaryTable, ExportButtons, type SumRow } from '@/components/ReportTables';
import { LossMatrix, type LossData } from '@/components/LossMatrix';
import { fmtDate, hrs, num, pct, shortDay } from '@/lib/format';
import type { Summary } from '@/lib/oee';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Daily { label: string; series: (Summary & { date: string })[]; dayDetail: null | { date: string; summary: { rows: SumRow[]; overall: Summary; fm: Summary }; loss: Omit<LossData, 'categories'>; byShift: { shiftId: number; rows: SumRow[]; overall: Summary }[] }; categories: LossData['categories'] }

export default function DailyReport() {
  const [f, setF] = useFilters();
  const [day, setDay] = useQueryState('date', '');
  const { data, error, loading, reload } = useApi<Daily>(`/api/reports/daily?${filterQuery(f, { date: day })}`);
  const d = data?.dayDetail;
  return (
    <div>
      <PageHeader title="Daily Reports" sub="The workbook's 'Daily Report' sheet — pick a machine (or all) and click a date for the shift breakdown"><ExportButtons month={f.month} line={f.line} machineId={f.machineId} /></PageHeader>
      <FilterBar value={f} onChange={(v) => { setF(v); setDay(''); }} />
      {error && <ErrorBox text={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (
        <div className="space-y-4">
          <div className="grid xl:grid-cols-2 gap-4">
            <Card title="Daily %OEE"><TrendChart data={data.series} height={240} /></Card>
            <Card title="Total Losses" sub="Minutes per day (Daily Report chart)">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.series.map((s) => ({ day: shortDay(s.date), losses: s.totalLosses }))} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#ece9e3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={16} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                  <Line dataKey="losses" name="Total Losses (min)" stroke="#ef5f18" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>
          <Card title={`Daily Report — ${data.label}`} sub="Tap a date for its machine and shift breakdown" pad={false}>
            <div className="overflow-x-auto"><table className="table-x text-[13px]">
              <thead><tr><th>Date</th><th className="num">Total Qty Produced</th><th className="num">Defects</th><th className="num">Planned Time</th><th className="num">Total Losses</th><th className="num">Management Losses</th><th className="num">Operating Time</th><th className="num">Losses not captured</th><th className="num">%A w/o</th><th className="num">%OEE w/o</th><th className="num">%A</th><th className="num">%P</th><th className="num">%Q</th><th>%OEE</th></tr></thead>
              <tbody>{data.series.map((s) => (
                <tr key={s.date} onClick={() => s.blocks && setDay(s.date)} className={`${s.blocks ? 'cursor-pointer' : 'text-[#b5b2c0]'} ${day === s.date ? '[&>td]:!bg-brand-50' : ''}`}>
                  <td className="font-semibold">{shortDay(s.date)}</td><td className="num">{num(s.qty, 2)}</td><td className="num">{num(s.defect)}</td><td className="num">{num(s.plannedTime)}</td><td className="num">{num(s.totalLosses)}</td><td className="num">{num(s.managementLosses)}</td><td className="num">{num(s.operatingTime, 2)}</td><td className="num">{s.blocks ? num(s.dailyLossesNotCaptured, 2) : 0}</td>
                  <td className="num">{pct(s.woA)}</td><td className="num">{pct(s.woOEE)}</td><td className="num">{pct(s.A)}</td><td className="num">{pct(s.P)}</td><td className="num">{pct(s.Q)}</td><td>{s.blocks ? <OeeBadge v={s.OEE} /> : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
          {day && (d ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi label={`Qty · ${fmtDate(day)}`} value={num(d.summary.overall.qty)} />
                <Kpi label="Planned" value={`${hrs(d.summary.overall.plannedTime)} h`} />
                <Kpi label="Losses" value={`${hrs(d.summary.overall.totalLosses)} h`} />
                <Kpi label="Overall %OEE" value={pct(d.summary.overall.OEE)} tone="accent" />
              </div>
              <Card title={`Machines on ${fmtDate(day)}`} pad={false}><SummaryTable rows={d.summary.rows} overall={d.summary.overall} onlyData /></Card>
              <div className="grid lg:grid-cols-3 gap-4">
                {d.byShift.map((s) => (
                  <Card key={s.shiftId} title={`Shift ${s.shiftId}`} sub={`%OEE ${pct(s.overall.OEE)} · ${num(s.overall.qty)} pcs`} pad={false}>
                    {s.rows.length ? <table className="table-x"><thead><tr><th>Machine</th><th className="num">Qty</th><th className="num">Loss min</th><th>%OEE</th></tr></thead><tbody>{s.rows.map((r) => <tr key={r.machineId}><td className="font-semibold">{r.machine}</td><td className="num">{num(r.qty)}</td><td className="num">{num(r.totalLosses)}</td><td><OeeBadge v={r.OEE} /></td></tr>)}</tbody></table> : <Empty title="No entries" />}
                  </Card>
                ))}
              </div>
              <LossMatrix title={`Loss Report — ${fmtDate(day)}`} data={{ ...d.loss, categories: data.categories }} overall={d.summary.overall} />
            </>
          ) : <Loading />)}
        </div>
      )}
    </div>
  );
}
