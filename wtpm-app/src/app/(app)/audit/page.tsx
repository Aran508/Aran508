'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi, useQueryState } from '@/lib/client';
import { Card, Loading, PageHeader, Badge, Empty, Modal } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

interface A { id: number; entity: string; entity_id: string; action: string; reason: string | null; old_value: unknown; new_value: (Record<string, unknown> & { changes?: Record<string, { from: unknown; to: unknown }> }) | null; changed_at: string; by: string | null; username: string | null; entry_no: number | null; ip_address: string | null }

export default function Audit() {
  const [entity, setEntity] = useQueryState('entity', '');
  const [action, setAction] = useQueryState('action', '');
  const [from, setFrom] = useQueryState('from', '');
  const [to, setTo] = useQueryState('to', '');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<A | null>(null);
  const q = new URLSearchParams(Object.entries({ entity, action, from, to, limit: '100', offset: String(page * 100) }).filter(([, v]) => v));
  const { data, loading } = useApi<{ rows: A[]; total: number }>(`/api/audit?${q}`);
  const tone = (a: string) => (a === 'delete' ? 'bad' : a === 'create' ? 'good' : a === 'verify' ? 'navy' : a.includes('correction') ? 'warn' : 'plain');
  return (
    <div>
      <PageHeader title="Audit History" sub="Who created, changed, verified or deleted what — with original and updated values and the reason" />
      <div className="card p-3 flex flex-wrap gap-2 mb-4">
        <select className="input input-md w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }}><option value="">All items</option><option value="production_entry">Production records</option><option value="part_master">Cycletime & Bore</option><option value="machine">Machines</option><option value="shift">Shifts</option><option value="setting">Settings</option><option value="user">Users</option><option value="import">Imports</option><option value="export">Exports</option></select>
        <select className="input input-md w-auto" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}><option value="">All actions</option>{['create', 'update', 'verify', 'request_correction', 'delete', 'attach_photo', 'login', 'import_workbook', 'import_master', 'apply_ct_to_records'].map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select>
        <input type="date" className="input input-md w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input input-md w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty title="No history for these filters" /> : (
          <>
            <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Changes</th><th>Reason</th></tr></thead>
              <tbody>{data.rows.map((a) => {
                const ch = a.new_value?.changes ? Object.entries(a.new_value.changes) : [];
                return (
                  <tr key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
                    <td className="text-xs">{fmtDateTime(a.changed_at)}</td><td className="font-semibold">{a.by ?? 'system'}</td><td><Badge tone={tone(a.action) as 'plain'}>{a.action.replace(/_/g, ' ')}</Badge></td>
                    <td>{a.entity === 'production_entry' ? <Link onClick={(e) => e.stopPropagation()} className="font-semibold text-navy-700" href={`/records/${a.entity_id}`}>Record #{a.entry_no ?? '…'}</Link> : <span>{a.entity.replace(/_/g, ' ')} {a.entity_id}</span>}</td>
                    <td className="text-xs max-w-[380px] truncate">{ch.slice(0, 3).map(([k, c]) => `${k}: ${String(c.from ?? '—')} → ${String(c.to ?? '—')}`).join(' · ')}{ch.length > 3 ? ` +${ch.length - 3}` : ''}</td>
                    <td className="text-xs max-w-[260px] truncate">{a.reason}</td>
                  </tr>
                );
              })}</tbody></table></div>
            <div className="flex items-center justify-between px-5 py-3 text-sm text-muted"><span>{data.total} events</span><span className="flex gap-2"><button className="btn btn-md btn-ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-md btn-ghost" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage(page + 1)}>Next</button></span></div>
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open ? `${open.action.replace(/_/g, ' ')} · ${fmtDateTime(open.changed_at)}` : ''}>
        {open && <div className="grid md:grid-cols-2 gap-3 text-xs">
          <div><div className="label">Original value</div><pre className="bg-canvas rounded-xl p-3 overflow-auto max-h-[50vh]">{JSON.stringify(open.old_value, null, 2) ?? '—'}</pre></div>
          <div><div className="label">Updated value</div><pre className="bg-canvas rounded-xl p-3 overflow-auto max-h-[50vh]">{JSON.stringify(open.new_value, null, 2) ?? '—'}</pre></div>
          <div className="col-span-full text-muted">By {open.by} ({open.username}) from {open.ip_address ?? 'unknown address'}{open.reason ? ` · Reason: ${open.reason}` : ''}</div>
        </div>}
      </Modal>
    </div>
  );
}
