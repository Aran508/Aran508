'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Camera, CheckCheck, Pencil, Search, TriangleAlert } from 'lucide-react';
import { useApi, useMeta, useQueryState, fetchJson, useToast } from '@/lib/client';
import { Card, Loading, ErrorBox, StatusBadge, PageHeader, Empty, Badge } from '@/components/ui';
import { Combobox } from '@/components/Combobox';
import { fmtDate, fmtDateTime, num } from '@/lib/format';

interface Rec { id: string; entry_no: number; prod_date: string; shift_id: number; machine: string; line: string; status: string; source: string; created_at: string; created_by_name: string; parts: string | null; qty: number; defect: number; operating_calc: number; losses: number; missing_ct: boolean; photos: number; planned_time_override: number | null; operating_time_override: number | null }

export default function Records() {
  const { meta } = useMeta();
  const toast = useToast();
  const [from, setFrom] = useQueryState('from', '');
  const [to, setTo] = useQueryState('to', '');
  const [machine, setMachine] = useQueryState('machineId', '');
  const [shift, setShift] = useQueryState('shift', '');
  const [status, setStatus] = useQueryState('status', '');
  const [mine, setMine] = useQueryState('mine', '');
  const [missingCt, setMissingCt] = useQueryState('missingCt', '');
  const [q, setQ] = useQueryState('q', '');
  const [qd, setQd] = useState(q);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => setQ(qd), 350); return () => clearTimeout(t); }, [qd, setQ]);
  useEffect(() => setQd(q), [q]);
  const params = new URLSearchParams(Object.entries({ from, to, machineId: machine, shift, status, mine, missingCt, q, limit: '100', offset: String(page * 100) }).filter(([, v]) => v));
  const { data, error, loading, reload } = useApi<{ rows: Rec[]; total: number }>(`/api/entries?${params}`);
  const canVerify = meta?.permissions.includes('entry.verify');
  const verifyMany = async () => {
    for (const id of sel) await fetchJson(`/api/entries/${id}/status`, { method: 'POST', json: { status: 'verified' } }).catch(() => undefined);
    toast('good', `${sel.length} record(s) verified`);
    setSel([]);
    reload();
  };
  return (
    <div>
      <PageHeader title="Production Records" sub="Every WTPM entry saved from tablets and PCs — one central database">
        {canVerify && sel.length > 0 && <button className="btn btn-md btn-navy" onClick={verifyMany}><CheckCheck size={16} /> Verify {sel.length} selected</button>}
        {meta?.permissions.includes('entry.create') && <Link href="/entry" className="btn btn-md btn-primary">New entry</Link>}
      </PageHeader>
      <div className="card p-3 flex flex-wrap gap-2 items-center mb-4">
        <div className="relative w-[240px]"><Search size={16} className="absolute left-3 top-3 text-muted" /><input className="input input-md pl-9" placeholder="Part no., machine, remarks, #no." value={qd} onChange={(e) => setQd(e.target.value)} /></div>
        <input type="date" className="input input-md w-auto" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} aria-label="From date" />
        <span className="text-muted text-sm">to</span>
        <input type="date" className="input input-md w-auto" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} aria-label="To date" />
        <div className="w-[210px]"><Combobox size="md" value={machine} onChange={(v) => { setMachine(v); setPage(0); }} placeholder="All machines" options={(meta?.machines ?? []).map((m) => ({ value: String(m.id), label: m.name, hint: m.line }))} /></div>
        <select className="input input-md w-auto" value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Shift"><option value="">All shifts</option>{meta?.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="input input-md w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="submitted">Submitted</option><option value="verified">Verified</option><option value="correction_requested">Correction requested</option></select>
        <label className="chip h-9 px-3 bg-canvas text-ink cursor-pointer"><input type="checkbox" checked={mine === '1'} onChange={(e) => setMine(e.target.checked ? '1' : '')} /> My entries</label>
        <label className="chip h-9 px-3 bg-canvas text-ink cursor-pointer"><input type="checkbox" checked={missingCt === '1'} onChange={(e) => setMissingCt(e.target.checked ? '1' : '')} /> Missing CT</label>
      </div>
      {error && <ErrorBox text={error} onRetry={reload} />}
      <Card pad={false}>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty title="No records match these filters" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-x">
                <thead><tr>{canVerify && <th />}<th>No.</th><th>Date</th><th>Shift</th><th>Machine</th><th>Parts</th><th className="num">Qty</th><th className="num">Defect</th><th className="num">Losses (min)</th><th>Status</th><th>Entered by</th><th /></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      {canVerify && <td>{r.status !== 'verified' && <input type="checkbox" className="w-4 h-4" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} aria-label={`Select #${r.entry_no}`} />}</td>}
                      <td><Link className="font-bold text-navy-700 hover:underline" href={`/records/${r.id}`}>#{r.entry_no}</Link></td>
                      <td>{fmtDate(r.prod_date)}</td><td>S{r.shift_id}</td>
                      <td><span className="font-semibold">{r.machine}</span> <span className="text-xs text-muted">{r.line}</span></td>
                      <td className="max-w-[220px] truncate" title={r.parts ?? ''}>{r.parts || <span className="text-muted">losses only</span>} {r.missing_ct && <Badge tone="bad"><TriangleAlert size={11} /> CT</Badge>}</td>
                      <td className="num font-semibold">{num(r.qty, 2)}</td><td className="num">{num(r.defect)}</td><td className="num">{num(r.losses)}</td>
                      <td><StatusBadge status={r.status} /> {r.photos > 0 && <Camera size={14} className="inline text-muted ml-1" />} {r.source === 'import' && <Badge>Excel</Badge>}</td>
                      <td className="text-xs"><div>{r.created_by_name}</div><div className="text-muted">{fmtDateTime(r.created_at)}</div></td>
                      <td><Link href={`/entry?id=${r.id}`} className="w-9 h-9 rounded-full hover:bg-canvas grid place-items-center" title="Edit"><Pencil size={15} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 text-sm text-muted">
              <span>{data.total} records</span>
              <span className="flex gap-2"><button className="btn btn-md btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-md btn-ghost" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage(page + 1)}>Next</button></span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
