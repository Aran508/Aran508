'use client';
import { useApi, useMeta } from '@/lib/client';
import { Card, Loading, ErrorBox, PageHeader, Kpi, Empty, OeeBadge, MiniBar } from '@/components/ui';
import { FilterBar, filterQuery, useFilters } from '@/components/Filters';
import { TrendChart, WeekBars, ParetoChart, OeeBars, MachineApqBars } from '@/components/charts';
import { hrs, num, pct } from '@/lib/format';
import type { Summary } from '@/lib/oee';
import type { SumRow } from '@/components/ReportTables';

interface Monthly {
  label: string; entryCount: number;
  summary: { rows: SumRow[]; overall: Summary; plantAverage: Record<string, number | null> };
  daily: (Summary & { date: string })[];
  weeklyMatrix: { rows: { machineId: number; machine: string; weeks: { week: number; OEE: number | null }[] }[] };
  pareto: { name: string; hours: number; cumulative: number; group: string; minutes: number }[];
  shifts: (Summary & { shift: string; timings: string })[];
  settings: Record<string, unknown>;
}
interface Part { part: string; machine: string; records: number; qty: number; defect: number; rework: number; hold: number; setting: number; ct: number | null; bore: number | null; operating: number }

export default function Machines() {
  const { meta } = useMeta();
  const [f, setF] = useFilters();
  const one = f.machineId ? meta?.machines.find((m) => String(m.id) === f.machineId) : null;
  const { data, error, loading, reload } = useApi<Monthly>(`/api/reports/monthly?${filterQuery({ ...f, shift: '' })}`);
  const { data: parts } = useApi<Part[]>(`/api/reports/parts?${filterQuery(f)}`);
  const bands = (data?.settings.oee_bands as { low: number; high: number }) ?? { low: 0.6, high: 0.8 };
  const row = one && data?.summary.rows.find((r) => r.machineId === one.id);
  return (
    <div>
      <PageHeader title="Machine Performance" sub={one ? `${one.name} · code ${one.code} · line ${one.line.trim()} · ${one.category}` : 'Machine-wise comparison — select a machine for its detail page'}>
        {one && <a className="btn btn-md btn-dark" href={`/api/export/pdf?type=machine&month=${f.month}&machineId=${one.id}`}>Machine-wise PDF</a>}
      </PageHeader>
      <FilterBar value={f} onChange={setF} showShift={false} />
      {error && <ErrorBox text={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (
        one ? (
          <div className="space-y-4">
            {!row?.hasData ? <Card><Empty title={`No records for ${one.name} in ${data.label}`} /></Card> : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                  <Kpi label="Total Qty" value={num(row.qty, 2)} sub={`${data.entryCount} records`} />
                  <Kpi label="Defects" value={num(row.defect)} />
                  <Kpi label="Planned" value={`${hrs(row.plannedTime)} h`} />
                  <Kpi label="Total losses" value={`${hrs(row.totalLosses)} h`} sub={`${hrs(row.managementLosses)} h mgmt`} />
                  <Kpi label="%A" value={pct(row.A)} sub={`w/o mgmt ${pct(row.woA)}`} />
                  <Kpi label="%P" value={pct(row.P)} />
                  <Kpi label="%Q" value={pct(row.Q)} />
                  <Kpi label="%OEE" value={pct(row.OEE)} sub={`rank ${row.rank ?? '—'} · w/o mgmt ${pct(row.woOEE)}`} tone="accent" />
                </div>
                <div className="grid xl:grid-cols-[1.6fr_1fr] gap-4">
                  <Card title="Daily OEE"><TrendChart data={data.daily.map((d) => ({ ...d, OEE: d.blocks ? d.OEE : null, A: d.blocks ? d.A : null, P: d.blocks ? d.P : null }))} target={Number(data.settings.oee_target ?? 0.85)} /></Card>
                  <Card title="Weekly %OEE"><WeekBars weeks={data.weeklyMatrix.rows[0]?.weeks ?? []} height={240} /></Card>
                </div>
                <div className="grid xl:grid-cols-[1.4fr_1fr] gap-4">
                  <Card title="Losses" sub="Hours by category">{data.pareto.length ? <ParetoChart data={data.pareto} /> : <Empty title="No losses" />}</Card>
                  <Card title="Shift-wise" pad={false}>
                    <table className="table-x"><thead><tr><th>Shift</th><th className="num">Qty</th><th className="num">Loss h</th><th className="num">%A</th><th className="num">%P</th><th>%OEE</th></tr></thead>
                      <tbody>{data.shifts.map((s) => <tr key={s.shift}><td className="font-semibold">{s.shift}</td><td className="num">{num(s.qty)}</td><td className="num">{hrs(s.totalLosses)}</td><td className="num">{pct(s.A)}</td><td className="num">{pct(s.P)}</td><td><OeeBadge v={s.OEE} /></td></tr>)}</tbody></table>
                  </Card>
                </div>
              </>
            )}
            <Card title="Part-wise production" sub="Part numbers run on this machine with master CT and bore" pad={false}>
              {parts?.length ? (
                <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>Part number</th><th className="num">Records</th><th className="num">Qty</th><th className="num">Defect</th><th className="num">R/W</th><th className="num">Hold</th><th className="num">Setting c/o</th><th className="num">Bore</th><th className="num">CT (min)</th><th className="num">Operating (h)</th></tr></thead>
                  <tbody>{parts.map((p) => <tr key={p.part}><td className="font-semibold">{p.part}</td><td className="num">{p.records}</td><td className="num">{num(p.qty, 2)}</td><td className="num">{num(p.defect)}</td><td className="num">{num(p.rework)}</td><td className="num">{num(p.hold)}</td><td className="num">{num(p.setting)}</td><td className="num">{p.bore ?? '—'}</td><td className={`num ${p.ct == null ? 'text-bad font-bold' : ''}`}>{p.ct == null ? 'missing' : num(p.ct, 3)}</td><td className="num">{hrs(p.operating, 2)}</td></tr>)}</tbody></table></div>
              ) : <Empty title="No parts recorded" />}
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid xl:grid-cols-2 gap-4">
              <Card title="Machine-wise OEE"><OeeBars data={data.summary.rows.filter((r) => r.hasData).map((r) => ({ name: r.machine, OEE: r.OEE }))} low={bands.low} high={bands.high} target={Number(data.settings.oee_target ?? 0.85)} /></Card>
              <Card title="Machine-wise APQ"><MachineApqBars data={data.summary.rows.filter((r) => r.hasData).map((r) => ({ machine: r.machine, A: r.A, P: r.P, Q: r.Q, OEE: r.OEE }))} /></Card>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {data.summary.rows.map((r) => (
                <button key={r.machineId} onClick={() => setF({ ...f, machineId: String(r.machineId) })} className={`card p-4 text-left hover:border-navy-600 transition ${r.hasData ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2"><div><div className="font-bold">{r.machine}</div><div className="text-xs text-muted">{r.code} · {r.line} {r.category === 'FM' ? '· FM' : ''}</div></div><OeeBadge v={r.OEE} low={bands.low} high={bands.high} /></div>
                  <div className="mt-3"><MiniBar value={r.OEE} /></div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs"><div><div className="text-muted">%A</div><b>{pct(r.A)}</b></div><div><div className="text-muted">%P</div><b>{pct(r.P)}</b></div><div><div className="text-muted">%Q</div><b>{pct(r.Q)}</b></div></div>
                  <div className="text-xs text-muted mt-2">{num(r.qty)} pcs · {hrs(r.totalLosses, 0)} h losses{r.rank ? ` · rank ${r.rank}` : ''}</div>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
