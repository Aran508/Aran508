'use client';
import { useApi } from '@/lib/client';
import { Card, Loading, ErrorBox, PageHeader, Segmented, Kpi, Empty } from '@/components/ui';
import { FilterBar, filterQuery, useFilters } from '@/components/Filters';
import { SummaryTable, RankingTables, ExportButtons, type SumRow } from '@/components/ReportTables';
import { WeekBars, OeeBars, MachineApqBars } from '@/components/charts';
import { LossMatrix, type LossData } from '@/components/LossMatrix';
import { useQueryState } from '@/lib/client';
import { hrs, num, pct } from '@/lib/format';
import type { Summary } from '@/lib/oee';

interface W { week: number; blocks: number; summary: { rows: SumRow[]; overall: Summary; fm: Summary; plantAverage: Record<string, number | null>; ranking: { rank: number; machine: string; line: string; OEE: number | null; band: string }[] }; loss: Omit<LossData, 'categories'> }
interface Monthly { label: string; weekly: W[]; weeklyMatrix: { weeks: number[]; rows: { machineId: number; machine: string; weeks: { week: number; OEE: number | null; lossesNotCaptured: number }[] }[] }; categories: LossData['categories']; settings: Record<string, unknown>; month: string; from: string }

export default function Weekly() {
  const [f, setF] = useFilters();
  const [wk, setWk] = useQueryState('week', '1');
  const { data, error, loading, reload } = useApi<Monthly>(`/api/reports/monthly?${filterQuery({ ...f, machineId: '', shift: '' })}`);
  const bands = (data?.settings.oee_bands as { low: number; high: number }) ?? { low: 0.6, high: 0.8 };
  const w = data?.weekly.find((x) => x.week === Number(wk));
  const [y, m] = f.month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const range = (n: number) => `${(n - 1) * 7 + 1}–${Math.min(n * 7, days)}`;
  return (
    <div>
      <PageHeader title="Weekly Reports" sub="'Weekly Report -data 1', 'Weekly Loss Report1-data' and 'Weekly report graph' · week = CEILING(DAY/7)"><ExportButtons month={f.month} line={f.line} /></PageHeader>
      <FilterBar value={f} onChange={setF} showMachine={false} showShift={false}>
        <Segmented value={wk} onChange={setWk} options={[1, 2, 3, 4, 5].filter((n) => (n - 1) * 7 < days).map((n) => ({ value: String(n), label: `W${n} · ${range(n)}` }))} />
      </FilterBar>
      {error && <ErrorBox text={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && w && (
        <div className="space-y-4">
          {!w.blocks ? <Card><Empty title={`No records in week ${w.week}`} /></Card> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                <Kpi label="Total Qty" value={num(w.summary.overall.qty)} />
                <Kpi label="Planned" value={`${hrs(w.summary.overall.plannedTime, 0)} h`} />
                <Kpi label="Total losses" value={`${hrs(w.summary.overall.totalLosses, 0)} h`} />
                <Kpi label="Overall %OEE" value={pct(w.summary.overall.OEE)} sub="from totals" />
                <Kpi label="FM %OEE" value={pct(w.summary.fm.OEE)} />
                <Kpi label="%OEE (avg of machines)" value={pct(w.summary.plantAverage.OEE)} tone="accent" />
              </div>
              <Card title={`Weekly Report — ${data.label} — Week ${w.week}`} sub="Minutes · both OEE methods" pad={false}><SummaryTable rows={w.summary.rows} overall={w.summary.overall} fm={w.summary.fm} onlyData bands={bands} /></Card>
              <div className="grid xl:grid-cols-2 gap-4">
                <Card title="Machine-wise APQ"><MachineApqBars data={w.summary.rows.filter((r) => r.hasData).map((r) => ({ machine: r.machine, A: r.A, P: r.P, Q: r.Q, OEE: r.OEE }))} /></Card>
                <Card title="Machine-wise OEE"><OeeBars data={w.summary.rows.filter((r) => r.hasData).map((r) => ({ name: r.machine, OEE: r.OEE }))} low={bands.low} high={bands.high} /></Card>
              </div>
              <Card title="OEE Ranking"><RankingTables ranking={w.summary.ranking} rows={w.summary.rows} bands={bands} /></Card>
              <LossMatrix title={`Weekly Loss Report — Week ${w.week}`} data={{ ...w.loss, categories: data.categories }} overall={w.summary.overall} />
            </>
          )}
          <Card title="Weekly report graph" sub="Each machine's %OEE by week of the month">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {data.weeklyMatrix.rows.map((r) => <div key={r.machineId} className="rounded-2xl border border-line p-3"><div className="text-sm font-bold">{r.machine}</div><WeekBars weeks={r.weeks} height={130} /></div>)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
