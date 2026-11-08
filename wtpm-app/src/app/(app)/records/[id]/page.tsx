'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MessageSquareWarning, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { useApi, useMeta, fetchJson, useToast } from '@/lib/client';
import { Card, Loading, ErrorBox, StatusBadge, Badge, Modal, Notice } from '@/components/ui';
import { fmtDate, fmtDateTime, num, pct } from '@/lib/format';

interface Detail {
  entry: Record<string, unknown> & { lines: Record<string, number | string | null>[]; losses: Record<string, number>; attachments: { id: string; kind: string; caption: string | null; created_at: string }[] };
  operatingTime: number;
  own: Record<string, number | null> & { plannedTime: number; totalLosses: number; managementLosses: number; operatingTime: number; qty: number; defect: number; lossesNotCaptured: number };
  block: Record<string, number | null> & { plannedTime: number; totalLosses: number; managementLosses: number; operatingTime: number; qty: number; defect: number; entries: number; lossesNotCaptured: number };
  siblings: { id: string; entry_no: number; parts: string | null; qty: number }[];
  categories: { code: string; name: string; section: string; is_management: boolean; oee_group: string }[];
  shift: { name: string; timings: string; planned_minutes: number };
  history: { id: number; action: string; reason: string | null; changed_at: string; by: string; changes: Record<string, { from: unknown; to: unknown }> | null }[];
}

export default function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { meta } = useMeta();
  const toast = useToast();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Detail>(`/api/entries/${id}`);
  const [modal, setModal] = useState<null | 'correction' | 'delete'>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data) return null;
  const e = data.entry;
  const can = (p: string) => meta?.permissions.includes(p);
  const act = async (status: 'verified' | 'correction_requested') => {
    try {
      await fetchJson(`/api/entries/${id}/status`, { method: 'POST', json: { status, note } });
      toast('good', status === 'verified' ? 'Record verified' : 'Correction requested');
      setModal(null); setNote(''); reload();
    } catch (err) { toast('bad', (err as Error).message); }
  };
  const del = async () => {
    try {
      await fetchJson(`/api/entries/${id}?reason=${encodeURIComponent(note)}`, { method: 'DELETE' });
      toast('good', 'Record deleted (kept in audit history)');
      router.replace('/records');
    } catch (err) { toast('bad', (err as Error).message); }
  };
  const catName = (c: string) => data.categories.find((x) => x.code === c)?.name ?? c;
  const M = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="rounded-xl bg-canvas px-3 py-2"><div className="text-[11px] text-muted">{k}</div><div className="font-bold tabular-nums">{v}</div></div>;
  return (
    <div className="max-w-[1200px]">
      <Link href="/records" className="inline-flex items-center gap-1 text-sm text-muted mb-2"><ArrowLeft size={15} /> Production records</Link>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Record #{String(e.entry_no)} <StatusBadge status={String(e.status)} /></h1>
          <p className="text-muted text-sm">{String(e.machine_name)} ({String(e.machine_code)}) · Line {String(e.line)} · {fmtDate(String(e.prod_date))} · {data.shift.name} ({data.shift.timings})</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/entry?id=${id}`} className="btn btn-md btn-ghost"><Pencil size={16} /> Edit / correct</Link>
          {can('entry.verify') && e.status !== 'verified' && <button className="btn btn-md btn-navy" onClick={() => act('verified')}><CheckCircle2 size={16} /> Verify</button>}
          {can('entry.verify') && <button className="btn btn-md btn-ghost" onClick={() => setModal('correction')}><MessageSquareWarning size={16} /> Request correction</button>}
          {can('entry.delete') && <button className="btn btn-md btn-ghost text-bad" onClick={() => setModal('delete')}><Trash2 size={16} /> Delete</button>}
        </div>
      </div>
      {e.status === 'correction_requested' && <div className="mb-4"><Notice tone="bad"><b>Correction requested:</b> {String(e.correction_note)}</Notice></div>}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
        <div className="space-y-4">
          <Card title="Production" pad={false}>
            <div className="overflow-x-auto"><table className="table-x">
              <thead><tr><th>#</th><th>Part number</th><th className="num">Bore</th><th className="num">CT (min)</th><th className="num">Qty</th><th className="num">Defect</th><th className="num">R/W</th><th className="num">Hold</th><th className="num">Setting c/o</th><th className="num">Qty × CT</th></tr></thead>
              <tbody>{e.lines.map((l) => (
                <tr key={String(l.id)}><td>{String(l.line_no)}</td><td className="font-semibold">{String(l.part_number)}</td><td className="num">{l.bore ?? '—'}</td><td className={`num ${l.cycle_time_min == null ? 'text-bad font-bold' : ''}`}>{l.cycle_time_min == null ? 'missing' : num(Number(l.cycle_time_min), 3)}</td><td className="num font-semibold">{num(Number(l.qty), 2)}</td><td className="num">{num(Number(l.defect))}</td><td className="num">{num(Number(l.rework))}</td><td className="num">{num(Number(l.hold))}</td><td className="num">{num(Number(l.setting_changeover_count))}</td><td className="num">{num(Number(l.qty) * Number(l.cycle_time_min ?? 0), 2)}</td></tr>
              ))}{!e.lines.length && <tr><td colSpan={10} className="text-muted">No production (losses only)</td></tr>}</tbody>
            </table></div>
          </Card>
          <Card title="Losses (minutes)">
            <div className="flex flex-wrap gap-2">
              {Object.entries(e.losses).map(([k, v]) => <Badge key={k} tone={data.categories.find((c) => c.code === k)?.section === 'management' ? 'navy' : 'brand'}>{catName(k)}: {v}</Badge>)}
              {!Object.keys(e.losses).length && <span className="text-sm text-muted">None</span>}
            </div>
            {e.other_loss_reason ? <p className="text-sm mt-3"><b>Other — reason:</b> {String(e.other_loss_reason)}</p> : null}
            {e.remarks ? <p className="text-sm mt-2 whitespace-pre-line"><b>Remarks:</b> {String(e.remarks)}</p> : null}
            {e.planned_time_override != null && <p className="text-sm mt-2"><b>Planned time set to {String(e.planned_time_override)} min</b> — {String(e.planned_override_reason)}</p>}
            {e.operating_time_override != null && <p className="text-sm mt-1"><b>Operating time set to {String(e.operating_time_override)} min</b> — {String(e.operating_override_reason)}</p>}
          </Card>
          <Card title="Photos" sub="WTPM note and issue photos linked to this record">
            <div className="flex flex-wrap gap-3">
              {e.attachments.map((a) => (
                <button key={a.id} onClick={() => setPhoto(a.id)} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/uploads/${a.id}`} alt={a.kind} className="w-36 h-36 object-cover rounded-2xl border border-line" />
                  <span className="absolute left-2 bottom-2 chip bg-white/90 text-ink">{a.kind === 'wtpm_note' ? 'WTPM note' : 'Issue'}</span>
                </button>
              ))}
              {!e.attachments.length && <span className="text-sm text-muted">No photos attached.</span>}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="OEE of this shift" sub={data.block.entries > 1 ? `Machine block: ${data.block.entries} records for this machine & shift` : 'This record is the whole shift block'}>
            <div className="grid grid-cols-3 gap-2">
              <M k="Planned time" v={`${num(data.block.plannedTime)} min`} /><M k="Total losses" v={`${num(data.block.totalLosses)} min`} /><M k="Mgmt losses" v={`${num(data.block.managementLosses)} min`} />
              <M k="Operating time" v={`${num(data.block.operatingTime, 1)} min`} /><M k="Qty" v={num(data.block.qty, 2)} /><M k="Not captured" v={`${num(data.block.lossesNotCaptured, 1)} min`} />
              <M k="%A" v={pct(data.block.A)} /><M k="%P" v={pct(data.block.P)} /><M k="%Q" v={pct(data.block.Q)} />
            </div>
            <div className="flex items-center justify-between mt-3 rounded-2xl bg-brand-500 text-white px-4 py-3"><span className="font-semibold">%OEE (with mgmt loss)</span><span className="text-2xl font-bold">{pct(data.block.OEE)}</span></div>
            <div className="text-xs text-muted mt-2">Without management loss: %A {pct(data.block.woA)} · %OEE {pct(data.block.woOEE)}</div>
            {data.siblings.length > 0 && <div className="mt-3 text-sm">Other records in this block: {data.siblings.map((s) => <Link key={s.id} className="underline font-semibold mr-2" href={`/records/${s.id}`}>#{s.entry_no}</Link>)}</div>}
          </Card>
          <Card title="Audit trail">
            <div className="text-xs text-muted mb-3">Created by <b className="text-ink">{String(e.created_by_name)}</b> · {fmtDateTime(String(e.created_at))} · via {String(e.source)}{e.import_ref ? ` (${String(e.import_ref)})` : ''}<br />Last modified by <b className="text-ink">{String(e.updated_by_name ?? '—')}</b> · {fmtDateTime(String(e.updated_at))}{e.verified_by_name ? <><br />Verified by <b className="text-ink">{String(e.verified_by_name)}</b> · {fmtDateTime(String(e.verified_at))}</> : null}</div>
            <ol className="relative border-l-2 border-line ml-1.5 space-y-3">
              {data.history.map((h) => (
                <li key={h.id} className="pl-4 relative">
                  <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-navy-800" />
                  <div className="text-sm font-semibold capitalize">{h.action.replace(/_/g, ' ')} <span className="font-normal text-muted">· {h.by} · {fmtDateTime(h.changed_at)}</span></div>
                  {h.reason && <div className="text-xs mt-0.5">Reason: {h.reason}</div>}
                  {h.changes && Object.keys(h.changes).length > 0 && (
                    <div className="mt-1 space-y-0.5">{Object.entries(h.changes).slice(0, 12).map(([k, c]) => <div key={k} className="text-xs"><span className="text-muted">{k}:</span> <span className="line-through text-bad">{String(c.from ?? '—')}</span> → <span className="text-good font-semibold">{String(c.to ?? '—')}</span></div>)}</div>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'delete' ? 'Delete record' : 'Request correction'} footer={<><button className="btn btn-lg btn-ghost" onClick={() => setModal(null)}>Cancel</button>{modal === 'delete' ? <button className="btn btn-lg btn-danger" disabled={note.length < 3} onClick={del}>Delete</button> : <button className="btn btn-lg btn-primary" disabled={note.length < 3} onClick={() => act('correction_requested')}>Send to operator</button>}</>}>
        <label className="label">{modal === 'delete' ? 'Reason for deleting (kept in audit history)' : 'What should be corrected?'}</label>
        <textarea className="input py-3" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </Modal>
      <Modal open={!!photo} onClose={() => setPhoto(null)} wide title="Photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo && <img src={`/api/uploads/${photo}`} alt="attachment" className="w-full rounded-2xl" />}
      </Modal>
    </div>
  );
}
