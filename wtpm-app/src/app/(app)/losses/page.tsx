'use client';
import Link from 'next/link';
import { useApi } from '@/lib/client';
import { Card, Loading, ErrorBox, PageHeader, Kpi, Empty } from '@/components/ui';
import { FilterBar, filterQuery, useFilters } from '@/components/Filters';
import { ParetoChart, StackedLossBars } from '@/components/charts';
import { LossMatrix, type LossData } from '@/components/LossMatrix';
import { ExportButtons } from '@/components/ReportTables';
import { fmtDate, hrs, num, pct } from '@/lib/format';
import type { Summary } from '@/lib/oee';

interface Monthly { label: string; summary: { overall: Summary }; loss: Omit<LossData, 'categories'>; pareto: { code: string; name: string; group: string; isManagement: boolean; minutes: number; hours: number; share: number; cumulative: number }[]; categories: LossData['categories'] }
interface Rem { id: string; entry_no: number; prod_date: string; shift_id: number; machine: string; remarks: string | null; other_loss_reason: string | null; other_minutes: number | null; losses: number }

export default function Losses() {
  const [f, setF] = useFilters();
  const q = filterQuery({ ...f, shift: '' });
  const { data, error, loading, reload } = useApi<Monthly>(`/api/reports/monthly?${q}`);
  const { data: rem } = useApi<Rem[]>(`/api/reports/remarks?${q}`);
  const g = data?.loss.groups;
  return (
    <div>
      <PageHeader title="Loss Analysis" sub="Process vs management losses, Pareto and machine × category matrix"><ExportButtons month={f.month} line={f.line} machineId={f.machineId} /></PageHeader>
      <FilterBar value={f} onChange={setF} showShift={false} />
      {error && <ErrorBox text={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && g && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Total losses" value={`${hrs(data.summary.overall.totalLosses, 0)} h`} sub={`${num(data.summary.overall.totalLosses)} min`} tone="navy" />
            <Kpi label="Availability losses" value={`${hrs(g.A, 0)} h`} sub="Breakdown, part/tool change, start-up" />
            <Kpi label="Performance losses" value={`${hrs(g.P, 0)} h`} sub="Minor stoppage, speed loss" />
            <Kpi label="Quality losses" value={`${hrs(g.Q, 0)} h`} sub="Defect, rework (minutes)" />
            <Kpi label="Management losses" value={`${hrs(g.management, 0)} h`} sub={`Planned / other ${hrs(g.M - g.management, 0)} h`} />
            <Kpi label="Losses not captured" value={`${hrs(data.summary.overall.lossesNotCaptured, 0)} h`} sub="Planned − losses − operating" tone={data.summary.overall.lossesNotCaptured < 0 ? 'bad' : 'warn'} />
          </div>
          <div className="grid xl:grid-cols-[1.5fr_1fr] gap-4">
            <Card title="Loss Pareto" sub={`${data.label} · hours by category · line = cumulative share`}>{data.pareto.length ? <ParetoChart data={data.pareto} height={320} /> : <Empty title="No losses" />}</Card>
            <Card title="Top categories" pad={false}>
              <table className="table-x"><thead><tr><th>Category</th><th className="num">Hours</th><th className="num">Share</th><th className="num">Cum.</th></tr></thead>
                <tbody>{data.pareto.slice(0, 12).map((p) => <tr key={p.code}><td><span className="font-semibold">{p.name}</span> <span className="text-xs text-muted">{p.group === 'M' ? (p.isManagement ? 'mgmt' : 'planned') : p.group}</span></td><td className="num">{p.hours.toFixed(1)}</td><td className="num">{pct(p.share)}</td><td className="num">{pct(p.cumulative)}</td></tr>)}</tbody></table>
            </Card>
          </div>
          <Card title="Losses by machine" sub="Hours, stacked by OEE factor"><StackedLossBars data={data.loss.rows.filter((r) => r.hasData).map((r) => ({ name: r.machine, A: r.groups.A / 60, P: r.groups.P / 60, Q: r.groups.Q / 60, M: r.groups.M / 60 }))} /></Card>
          <LossMatrix data={{ ...data.loss, categories: data.categories }} overall={data.summary.overall} />
          <Card title="Remarks and “Other” loss reasons" sub="Written on the WTPM notes — highest-loss records first" pad={false}>
            {rem?.length ? (
              <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>Record</th><th>Date</th><th>Machine</th><th className="num">Losses</th><th>Other reason</th><th>Remarks</th></tr></thead>
                <tbody>{rem.map((r) => <tr key={r.id}><td><Link className="font-bold text-navy-700" href={`/records/${r.id}`}>#{r.entry_no}</Link></td><td>{fmtDate(r.prod_date)} S{r.shift_id}</td><td className="font-semibold">{r.machine}</td><td className="num">{num(r.losses)}</td><td className="whitespace-normal min-w-[200px]">{r.other_loss_reason ? `${r.other_minutes ?? ''} min — ${r.other_loss_reason}` : ''}</td><td className="whitespace-normal min-w-[260px] text-muted">{r.remarks}</td></tr>)}</tbody></table></div>
            ) : <Empty title="No remarks" />}
          </Card>
        </div>
      )}
    </div>
  );
}
