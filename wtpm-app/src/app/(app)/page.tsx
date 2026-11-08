'use client';
import Link from 'next/link';
import { ArrowUpRight, ClipboardPen, Factory, AlertTriangle, CircleCheck, Clock3 } from 'lucide-react';
import { useApi, useMeta } from '@/lib/client';
import { Card, Kpi, Loading, ErrorBox, StatusBadge, OeeBadge, Empty, MiniBar, Notice } from '@/components/ui';
import { Donut, RankBars, TrendChart, ParetoChart, C, OeeBars } from '@/components/charts';
import { FilterBar, filterQuery, useFilters, shiftMonth } from '@/components/Filters';
import { fmtDateTime, hrs, num, pct, monthName, fmtDate } from '@/lib/format';
import type { Summary } from '@/lib/oee';

type Row = Summary & { machineId: number; machine: string; line: string; code: string; category: string; rank: number | null };
interface Dash {
  filter: { month: string; label: string; from: string; to: string };
  plant: { A: number | null; P: number | null; Q: number | null; OEE: number | null; woOEE: number | null };
  overall: Summary;
  table: Row[];
  leading: { machine: string; OEE: number | null }[];
  lagging: { machine: string; OEE: number | null }[];
  ranking: { rank: number; machine: string; OEE: number | null }[];
  daily: { date: string; OEE: number | null; A: number | null; P: number | null; Q: number | null; qty: number; losses: number; planned: number }[];
  pareto: { name: string; hours: number; cumulative: number; group: string }[];
  lossGroups: { A: number; P: number; Q: number; M: number; management: number };
  lines: { line: string; OEE: number | null; A: number | null; P: number | null; Q: number | null; qty: number }[];
  shifts: { shiftId: number; shift: string; OEE: number | null; qty: number; losses: number }[];
  counts: { total: number; pending: number; corrections: number; missing_ct: number; today: number };
  recent: { id: string; entry_no: number; prod_date: string; shift_id: number; machine: string; status: string; created_at: string; by: string; qty: number; losses: number }[];
  today: { date: string; grid: { machine_id: number; shift_id: number; n: number }[]; machines: { id: number; name: string; line: string }[] };
  settings: { target: number; bands: { low: number; high: number }; plant: string };
}

export default function Dashboard() {
  const { meta } = useMeta();
  const [f, setF] = useFilters();
  const { data, error, loading, reload, refreshing } = useApi<Dash>(`/api/dashboard?${filterQuery(f)}`);
  const canReports = meta?.permissions.includes('reports.view');
  const canEntry = meta?.permissions.includes('entry.create');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const bands = data?.settings.bands ?? { low: 0.6, high: 0.8 };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-tight">{greet}, {meta?.user.name.split(' ')[0] ?? ''}</h1>
          <p className="text-muted text-sm">OEE – {data?.settings.plant ?? 'C1 Plant'} · {monthName(f.month)} {refreshing && '· updating…'}</p>
        </div>
        <div className="flex gap-2">
          {canEntry && <Link href="/entry" className="btn btn-md btn-dark"><ClipboardPen size={16} /> WTPM Quick Entry</Link>}
          {canReports && <Link href={`/reports/monthly?month=${f.month}`} className="btn btn-md btn-ghost">Monthly report <ArrowUpRight size={16} /></Link>}
        </div>
      </div>
      <FilterBar value={f} onChange={setF} />
      {error && <ErrorBox text={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
            <Kpi label="Total Qty Produced" value={num(data.overall.qty)} sub={`${data.counts.total} WTPM records`} />
            <Kpi label="Defects" value={num(data.overall.defect)} sub={`Quality ${pct(data.overall.Q)}`} />
            <Kpi label="Planned Time" value={`${hrs(data.overall.plannedTime, 0)} h`} sub="sum of shift planned time" />
            <Kpi label="Total Losses" value={`${hrs(data.overall.totalLosses, 0)} h`} sub={`${hrs(data.overall.managementLosses, 0)} h management`} />
            <Kpi label="Operating Time" value={`${hrs(data.overall.operatingTime, 0)} h`} sub="Σ Qty × CT" />
            <Kpi label="Losses not captured" value={`${hrs(data.overall.lossesNotCaptured, 0)} h`} sub="Planned − losses − operating" tone={data.overall.lossesNotCaptured > data.overall.plannedTime * 0.15 ? 'warn' : 'plain'} />
            <Kpi label="Awaiting verification" value={num(data.counts.pending)} sub={data.counts.corrections ? `${data.counts.corrections} need correction` : `${data.counts.today} entered today`} tone={data.counts.corrections ? 'bad' : 'plain'} />
            <Kpi label={`OEE – ${data.settings.plant}`} value={pct(data.plant.OEE)} sub={`target ${pct(data.settings.target, 0)}`} tone="accent" />
          </div>

          {!data.table.length && (
            <div className="mt-4"><Notice tone="info">
              No production saved for {monthName(f.month)}{f.line ? ` on line ${f.line}` : ''} yet.{' '}
              <button className="underline font-semibold" onClick={() => setF({ ...f, month: shiftMonth(f.month, -1) })}>Show {monthName(shiftMonth(f.month, -1))}</button>
            </Notice></div>
          )}

          {/* Excel dashboard: donuts + leading / lagging */}
          <div className="grid xl:grid-cols-[1.35fr_1fr] gap-4 mt-4">
            <Card title={`OEE – ${data.settings.plant} · ${data.filter.label}`} sub="Average of machine rows, with management loss — as the Excel dashboard">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 place-items-center py-2">
                <Donut value={data.plant.A} label="Availability" color={C.navy} />
                <Donut value={data.plant.P} label="Performance" color={C.orange} />
                <Donut value={data.plant.Q} label="Quality" color={C.good} />
                <Donut value={data.plant.OEE} label="OEE" sub={`w/o mgmt ${pct(data.plant.woOEE)}`} />
              </div>
            </Card>
            <div className="grid sm:grid-cols-2 xl:grid-cols-1 gap-4">
              <Card title="Leading machines" sub="Top 3 %OEE">{data.leading.length ? <RankBars data={data.leading} color={C.good} height={120} /> : <Empty title="No data" />}</Card>
              <Card title="Lagging machines" sub="Bottom 3 %OEE">{data.lagging.length ? <RankBars data={data.lagging} color={C.bad} height={120} /> : <Empty title="No data" />}</Card>
            </div>
          </div>

          {/* machine table — Excel Table4 */}
          <Card className="mt-4" pad={false} title="Machine-wise OEE" sub="Hours · sorted by %OEE (lowest first) · %A/%P/%Q/%OEE with management loss" action={canReports && <Link href={`/machines?month=${f.month}`} className="btn btn-md btn-ghost">Machine performance <ArrowUpRight size={15} /></Link>}>
            <div className="overflow-x-auto">
              <table className="table-x">
                <thead><tr><th>Line</th><th>Machine</th><th className="num">Total Qty Produced</th><th className="num">Defects</th><th className="num">Planned Time</th><th className="num">Total Losses</th><th className="num">Management Losses</th><th className="num">Operating Time</th><th className="num">%A</th><th className="num">%P</th><th className="num">%Q</th><th>%OEE</th><th className="num">Losses not captured</th></tr></thead>
                <tbody>
                  {data.table.map((r) => (
                    <tr key={r.machineId}>
                      <td>{r.line}</td><td className="font-semibold">{r.machine}</td>
                      <td className="num">{num(r.qty, 2)}</td><td className="num">{num(r.defect)}</td><td className="num">{hrs(r.plannedTime, 2)}</td><td className="num">{hrs(r.totalLosses, 2)}</td><td className="num">{hrs(r.managementLosses, 2)}</td><td className="num">{hrs(r.operatingTime, 2)}</td>
                      <td className="num">{pct(r.A)}</td><td className="num">{pct(r.P)}</td><td className="num">{pct(r.Q)}</td>
                      <td className="min-w-[120px]"><div className="flex items-center gap-2"><OeeBadge v={r.OEE} low={bands.low} high={bands.high} /><MiniBar value={r.OEE} /></div></td>
                      <td className={`num ${r.lossesNotCaptured < 0 ? 'text-bad' : ''}`}>{hrs(r.lossesNotCaptured, 2)}</td>
                    </tr>
                  ))}
                </tbody>
                {data.table.length > 0 && (
                  <tfoot><tr className="font-bold bg-[#faf9f7]">
                    <td /><td>Total</td><td className="num">{num(data.overall.qty, 2)}</td><td className="num">{num(data.overall.defect)}</td><td className="num">{hrs(data.overall.plannedTime, 2)}</td><td className="num">{hrs(data.overall.totalLosses, 2)}</td><td className="num">{hrs(data.overall.managementLosses, 2)}</td><td className="num">{hrs(data.overall.operatingTime, 2)}</td>
                    <td className="num">{pct(data.plant.A)}</td><td className="num">{pct(data.plant.P)}</td><td className="num">{pct(data.plant.Q)}</td><td><OeeBadge v={data.plant.OEE} /></td><td className="num">{hrs(data.overall.lossesNotCaptured, 2)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
            <p className="text-xs text-muted px-5 py-3">Totals: sums of hours; percentages are the average of machine rows (Excel SUBTOTAL 101). Report “Overall” rows calculated from totals: %OEE {pct(data.overall.OEE)}.</p>
          </Card>

          <div className="grid xl:grid-cols-[1.5fr_1fr] gap-4 mt-4">
            <Card title="OEE trend" sub="Daily %OEE with %A and %P (plant, from totals)"><TrendChart data={data.daily} target={data.settings.target} /></Card>
            <Card title="Machine OEE comparison" sub="%OEE by machine"><OeeBars data={[...data.table].reverse().map((r) => ({ name: r.machine, OEE: r.OEE }))} height={260} target={data.settings.target} low={bands.low} high={bands.high} /></Card>
          </div>

          <div className="grid xl:grid-cols-[1.5fr_1fr] gap-4 mt-4">
            <Card title="Top losses" sub="Hours by loss category with cumulative share" action={canReports && <Link href={`/losses?month=${f.month}`} className="btn btn-md btn-ghost">Loss analysis <ArrowUpRight size={15} /></Link>}>
              {data.pareto.length ? <ParetoChart data={data.pareto} /> : <Empty title="No losses recorded" />}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                {([['A', 'Availability', C.navy], ['P', 'Performance', C.orange], ['Q', 'Quality', C.good], ['M', 'Planned / mgmt', C.navy3]] as const).map(([k, l, c]) => (
                  <div key={k} className="rounded-xl bg-canvas px-3 py-2 text-sm"><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: c }} />{l}<div className="font-bold">{hrs(data.lossGroups[k], 1)} h</div></div>
                ))}
              </div>
            </Card>
            <div className="grid gap-4">
              <Card title="Line-wise" sub="%OEE from line totals">
                <div className="space-y-2.5">
                  {data.lines.map((l) => (
                    <div key={l.line} className="flex items-center gap-3 text-sm"><span className="w-14 font-semibold">{l.line}</span><MiniBar value={l.OEE} /><span className="w-14 text-right font-bold tabular-nums">{pct(l.OEE)}</span></div>
                  ))}
                  {!data.lines.length && <Empty title="No data" />}
                </div>
              </Card>
              <Card title="Shift-wise" sub="%OEE and quantity per shift">
                <div className="grid grid-cols-3 gap-2">
                  {data.shifts.map((s) => (
                    <div key={s.shiftId} className="rounded-2xl bg-canvas p-3">
                      <div className="text-xs text-muted">{s.shift}</div>
                      <div className="text-xl font-bold">{pct(s.OEE)}</div>
                      <div className="text-xs text-muted">{num(s.qty)} pcs · {hrs(s.losses, 0)} h loss</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          <div className="grid xl:grid-cols-[1.4fr_1fr] gap-4 mt-4">
            <Card title="Today's data collection" sub={`${fmtDate(data.today.date)} · which machines and shifts have a WTPM entry`} pad={false}>
              <div className="overflow-x-auto px-4 sm:px-5 pb-4">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted"><th className="text-left py-2 font-semibold">Machine</th>{[1, 2, 3].map((s) => <th key={s} className="py-2 font-semibold">Shift {s}</th>)}</tr></thead>
                  <tbody>
                    {data.today.machines.map((m) => (
                      <tr key={m.id} className="border-t border-line/70">
                        <td className="py-1.5"><span className="font-semibold">{m.name}</span> <span className="text-xs text-muted">{m.line}</span></td>
                        {[1, 2, 3].map((s) => {
                          const n = data.today.grid.find((g) => g.machine_id === m.id && g.shift_id === s)?.n ?? 0;
                          return <td key={s} className="py-1.5 text-center">{n ? <span className="chip bg-good-bg text-good"><CircleCheck size={13} /> {n}</span> : <span className="chip bg-canvas text-[#a9a6b5]"><Clock3 size={13} /> —</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Latest entries" sub="Updates live as tablets save" pad={false}>
              <ul className="px-4 sm:px-5 pb-4 divide-y divide-line/70">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/records/${r.id}`} className="flex items-center gap-3 py-2.5">
                      <div className="w-9 h-9 rounded-xl bg-navy-50 text-navy-800 grid place-items-center shrink-0"><Factory size={16} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{r.machine} · S{r.shift_id} · {fmtDate(r.prod_date)}</div>
                        <div className="text-xs text-muted truncate">#{r.entry_no} · {num(r.qty)} pcs · {num(r.losses)} min loss · {r.by} · {fmtDateTime(r.created_at)}</div>
                      </div>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
                {!data.recent.length && <Empty title="No entries yet" />}
              </ul>
              {data.counts.missing_ct > 0 && <div className="px-5 pb-4"><Notice tone="warn"><AlertTriangle size={14} className="inline" /> {data.counts.missing_ct} record(s) have parts without cycle time — <Link className="underline font-semibold" href="/records?missingCt=1">review</Link></Notice></div>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
