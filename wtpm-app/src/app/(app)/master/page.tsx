'use client';
import { useEffect, useState } from 'react';
import { Pencil, Plus, Search, Upload, Link2 } from 'lucide-react';
import { useApi, useMeta, fetchJson, useToast, useQueryState } from '@/lib/client';
import { Card, Loading, PageHeader, Segmented, Modal, Notice, Badge, Empty, Spinner } from '@/components/ui';
import { Combobox } from '@/components/Combobox';
import { fmtDate, fmtDateTime, num } from '@/lib/format';

type Tab = 'machines' | 'parts' | 'shifts' | 'losses' | 'settings' | 'import';

export default function Master() {
  const { meta } = useMeta();
  const [tab, setTab] = useQueryState('tab', 'parts');
  const canEdit = !!meta?.permissions.includes('master.edit');
  return (
    <div>
      <PageHeader title="Master Data" sub={canEdit ? 'Machine List, Cycletime and Bore, Shift Timings, loss categories and settings' : 'Read only — only administrators can change master data'} />
      <div className="mb-4 overflow-x-auto"><Segmented value={tab as Tab} onChange={(t) => setTab(t)} options={[{ value: 'parts', label: 'Cycletime & Bore' }, { value: 'machines', label: 'Machine List' }, { value: 'shifts', label: 'Shift Timings' }, { value: 'losses', label: 'Loss categories' }, ...(canEdit ? [{ value: 'settings' as Tab, label: 'Settings' }, { value: 'import' as Tab, label: 'Excel import' }] : [])]} /></div>
      {tab === 'parts' && <Parts canEdit={canEdit} />}
      {tab === 'machines' && <Machines canEdit={canEdit} />}
      {tab === 'shifts' && <Shifts canEdit={canEdit} />}
      {tab === 'losses' && <LossCats canEdit={canEdit} />}
      {tab === 'settings' && canEdit && <Settings />}
      {tab === 'import' && canEdit && <ImportXlsx />}
    </div>
  );
}

interface PartRow { id: number; machine_id: number; machine: string; machine_code: string; part_number: string; cycle_time_min: number; bore: number | null; active: boolean; notes: string | null; updated_at: string; updated_by_name: string | null; uses: number }

function Parts({ canEdit }: { canEdit: boolean }) {
  const { meta } = useMeta();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [machine, setMachine] = useState('');
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Partial<PartRow> & { reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setQd(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, loading, reload } = useApi<{ rows: PartRow[]; total: number }>(`/api/master/parts?q=${encodeURIComponent(qd)}&machineId=${machine}&limit=100&offset=${page * 100}`);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await fetchJson('/api/master/parts', { method: 'POST', json: { ...edit, bore: edit.bore === undefined || (edit.bore as unknown) === '' ? null : edit.bore } });
      toast('good', 'Cycletime & Bore saved');
      setEdit(null);
      reload();
    } catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };
  const relink = async () => {
    const r = await fetchJson<{ updated: number }>('/api/master/parts/relink', { method: 'POST' });
    toast('good', r.updated ? `${r.updated} saved part lines received their cycle time` : 'No saved records were missing a cycle time that is now in master');
  };
  return (
    <Card pad={false} title="Cycletime and Bore" sub="Key = Machine Code + Part Number · CT in minutes per piece (the VLOOKUP source for every entry)"
      action={canEdit && <><button className="btn btn-md btn-ghost" onClick={relink} title="Apply master CT to records saved without it"><Link2 size={16} /> Apply to records missing CT</button><button className="btn btn-md btn-primary" onClick={() => setEdit({ active: true })}><Plus size={16} /> Add part</button></>}>
      <div className="px-5 pb-3 flex flex-wrap gap-2">
        <div className="relative w-[240px]"><Search size={16} className="absolute left-3 top-3 text-muted" /><input className="input input-md pl-9" placeholder="Search part number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-[220px]"><Combobox size="md" value={machine} onChange={(v) => { setMachine(v); setPage(0); }} placeholder="All machines" options={(meta?.machines ?? []).map((m) => ({ value: String(m.id), label: m.name, hint: m.code }))} /></div>
      </div>
      {loading && !data ? <Loading /> : !data?.rows.length ? <Empty title="No parts found" /> : (
        <>
          <div className="overflow-x-auto"><table className="table-x">
            <thead><tr><th>Machine code</th><th>Machine</th><th>Part number</th><th className="num">CT (min)</th><th className="num">Bore</th><th className="num">Used in records</th><th>Last change</th><th /></tr></thead>
            <tbody>{data.rows.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'text-muted'}><td>{p.machine_code}</td><td>{p.machine}</td><td className="font-semibold">{p.part_number} {!p.active && <Badge>inactive</Badge>}</td><td className="num font-semibold">{num(p.cycle_time_min, 4)}</td><td className="num">{p.bore ?? '—'}</td><td className="num">{p.uses}</td><td className="text-xs text-muted">{p.updated_by_name ?? 'Excel import'} · {fmtDate(p.updated_at)}</td>
                <td>{canEdit && <button className="w-9 h-9 rounded-full hover:bg-canvas grid place-items-center" onClick={() => setEdit({ ...p })} aria-label="Edit"><Pencil size={15} /></button>}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="flex items-center justify-between px-5 py-3 text-sm text-muted"><span>{data.total} parts</span><span className="flex gap-2"><button className="btn btn-md btn-ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-md btn-ghost" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage(page + 1)}>Next</button></span></div>
        </>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.part_number}` : 'Add part to Cycletime & Bore'} footer={<><button className="btn btn-lg btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-lg btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />} Save</button></>}>
        {edit && (
          <div className="space-y-3">
            <div><label className="label">Machine</label><Combobox size="md" value={edit.machine_id ? String(edit.machine_id) : ''} onChange={(v) => setEdit({ ...edit, machine_id: Number(v) })} options={(meta?.machines ?? []).map((m) => ({ value: String(m.id), label: m.name, hint: m.code }))} /></div>
            <div><label className="label">Part number</label><input className="input input-md" value={edit.part_number ?? ''} onChange={(e) => setEdit({ ...edit, part_number: e.target.value.toUpperCase() })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Cycle time (min / piece)</label><input type="number" step="0.0001" inputMode="decimal" className="input input-md" value={edit.cycle_time_min ?? ''} onChange={(e) => setEdit({ ...edit, cycle_time_min: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
              <div><label className="label">Bore</label><input type="number" inputMode="decimal" className="input input-md" value={edit.bore ?? ''} onChange={(e) => setEdit({ ...edit, bore: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (offered in Quick Entry)</label>
            {edit.id && <div><label className="label">Reason for change (required when CT changes)</label><input className="input input-md" value={edit.reason ?? ''} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. Revised per process sheet rev C" /></div>}
            <Notice tone="info">Changing the CT affects new entries. Saved records keep the CT that was valid when they were entered (audit-safe).</Notice>
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface MRow { id: number; code: string; name: string; line: string; category: string; sort_order: number; active: boolean; parts: number; last_entry: string | null }
function Machines({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { reload: reloadMeta } = useMeta();
  const { data, loading, reload } = useApi<MRow[]>('/api/master/machines');
  const [edit, setEdit] = useState<Partial<MRow> | null>(null);
  const save = async () => {
    try { await fetchJson('/api/master/machines', { method: 'POST', json: { ...edit, line: edit?.line ?? '', category: edit?.category || 'NFM' } }); toast('good', 'Machine saved'); setEdit(null); reload(); reloadMeta(); } catch (e) { toast('bad', (e as Error).message); }
  };
  return (
    <Card pad={false} title="Machine List" sub="Code, machine name, line and FM / NFM category (from 'Machine List' and the summary sheet)" action={canEdit && <button className="btn btn-md btn-primary" onClick={() => setEdit({ active: true, category: 'NFM' })}><Plus size={16} /> Add machine</button>}>
      {loading && !data ? <Loading /> : (
        <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>S.No.</th><th>Code</th><th>Machine</th><th>Line</th><th>Cat</th><th className="num">Parts in master</th><th>Last entry</th><th>Status</th><th /></tr></thead>
          <tbody>{data?.map((m) => <tr key={m.id}><td>{m.sort_order}</td><td className="font-mono">{m.code}</td><td className="font-semibold">{m.name}</td><td>{m.line}</td><td>{m.category}</td><td className="num">{m.parts}</td><td>{fmtDate(m.last_entry)}</td><td>{m.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td><td>{canEdit && <button className="w-9 h-9 rounded-full hover:bg-canvas grid place-items-center" onClick={() => setEdit(m)} aria-label="Edit"><Pencil size={15} /></button>}</td></tr>)}</tbody></table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'Add machine'} footer={<><button className="btn btn-lg btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-lg btn-primary" onClick={save}>Save</button></>}>
        {edit && <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Code</label><input className="input input-md" value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></div>
          <div><label className="label">Machine name</label><input className="input input-md" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div><label className="label">Line</label><input className="input input-md" value={edit.line ?? ''} onChange={(e) => setEdit({ ...edit, line: e.target.value.toUpperCase() })} placeholder="SCP / MCP / LCC / VSCP / JCB" /></div>
          <div><label className="label">Category</label><select className="input input-md" value={edit.category ?? 'NFM'} onChange={(e) => setEdit({ ...edit, category: e.target.value })}><option>FM</option><option>NFM</option></select></div>
          <div><label className="label">Sort order (S.No.)</label><input type="number" className="input input-md" value={edit.sort_order ?? ''} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></div>
          <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
        </div>}
      </Modal>
    </Card>
  );
}

function Shifts({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, reload } = useApi<{ id: number; name: string; timings: string; total_minutes: number; lunch_minutes: number; tea_minutes: number; tpm_minutes: number; planned_minutes: number; updated_at: string }[]>('/api/master/shifts');
  const [edit, setEdit] = useState<Record<string, string | number> | null>(null);
  return (
    <Card pad={false} title="Shift Timings" sub="Planned Time (mins) = Total − Lunch − Tea − TPM — used as AP when a machine produced in the shift">
      <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>Shift</th><th>Timings</th><th className="num">Total Time</th><th className="num">Lunch</th><th className="num">Tea</th><th className="num">TPM</th><th className="num">Planned Time</th><th>Updated</th><th /></tr></thead>
        <tbody>{data?.map((s) => <tr key={s.id}><td className="font-bold">{s.id}</td><td>{s.timings}</td><td className="num">{s.total_minutes}</td><td className="num">{s.lunch_minutes}</td><td className="num">{s.tea_minutes}</td><td className="num">{s.tpm_minutes}</td><td className="num font-bold">{s.planned_minutes}</td><td className="text-xs text-muted">{fmtDateTime(s.updated_at)}</td><td>{canEdit && <button className="w-9 h-9 rounded-full hover:bg-canvas grid place-items-center" onClick={() => setEdit({ ...s, reason: '' })}><Pencil size={15} /></button>}</td></tr>)}</tbody>
        <tfoot><tr className="font-bold bg-[#faf9f7]"><td colSpan={2}>Total (hrs)</td><td className="num">{data && num(data.reduce((a, s) => a + s.total_minutes, 0) / 60, 2)}</td><td colSpan={3} /><td className="num">{data && num(data.reduce((a, s) => a + s.planned_minutes, 0) / 60, 2)}</td><td colSpan={2} /></tr></tfoot></table></div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit shift ${edit?.id}`} footer={<><button className="btn btn-lg btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-lg btn-primary" onClick={async () => { try { await fetchJson('/api/master/shifts', { method: 'POST', json: edit }); toast('good', 'Shift saved'); setEdit(null); reload(); } catch (e) { toast('bad', (e as Error).message); } }}>Save</button></>}>
        {edit && <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Timings</label><input className="input input-md" value={edit.timings} onChange={(e) => setEdit({ ...edit, timings: e.target.value })} /></div>
          {(['total_minutes', 'lunch_minutes', 'tea_minutes', 'tpm_minutes'] as const).map((k) => <div key={k}><label className="label">{k.replace('_minutes', '').toUpperCase()} (min)</label><input type="number" className="input input-md" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} /></div>)}
          <div className="col-span-2"><label className="label">Reason</label><input className="input input-md" value={String(edit.reason)} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></div>
          <div className="col-span-2"><Notice tone="warn">Changing planned time changes OEE for all records in every report (planned time is not stored per record unless typed in).</Notice></div>
        </div>}
      </Modal>
    </Card>
  );
}

function LossCats({ canEdit }: { canEdit: boolean }) {
  const { meta, reload } = useMeta();
  const toast = useToast();
  return (
    <Card pad={false} title="Loss categories" sub="Fixed to the workbook's loss columns R–AM. ‘Show first’ controls which appear before ‘Show all’ in Quick Entry.">
      <div className="overflow-x-auto"><table className="table-x"><thead><tr><th>Excel column</th><th>Category</th><th>Section</th><th>OEE group</th><th>Management Loss (AR)</th><th>Revised excl. (BC)</th><th>Reason required</th><th>Show first</th></tr></thead>
        <tbody>{meta?.categories.map((c) => <tr key={c.code}><td className="font-mono">{c.excel_column}</td><td className="font-semibold">{c.name}</td><td>{c.section}</td><td>{c.oee_group}</td><td>{c.is_management ? <Badge tone="navy">Yes</Badge> : 'No'}</td><td>{c.is_revised_excl ? 'Yes' : ''}</td><td>{c.requires_reason ? 'Yes' : ''}</td>
          <td><input type="checkbox" className="w-5 h-5" disabled={!canEdit} checked={c.is_common} onChange={async (e) => { await fetchJson('/api/master/categories', { method: 'POST', json: { code: c.code, is_common: e.target.checked } }); toast('good', 'Saved'); reload(); }} /></td></tr>)}</tbody></table></div>
    </Card>
  );
}

function Settings() {
  const { meta, reload } = useMeta();
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (meta) setS(meta.settings); }, [meta]);
  if (!s) return <Loading />;
  const bands = (s.oee_bands as { low: number; high: number }) ?? { low: 0.6, high: 0.8 };
  return (
    <Card title="Settings" action={<button className="btn btn-md btn-primary" onClick={async () => { try { await fetchJson('/api/master/settings', { method: 'POST', json: s }); toast('good', 'Settings saved'); reload(); } catch (e) { toast('bad', (e as Error).message); } }}>Save settings</button>}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
        <label className="flex items-center gap-3 rounded-2xl border border-line p-4 col-span-full sm:col-span-1"><input type="checkbox" className="w-6 h-6" checked={s.photo_mandatory === true} onChange={(e) => setS({ ...s, photo_mandatory: e.target.checked })} /><span><b className="block">WTPM note photo mandatory</b><span className="text-sm text-muted">Operators must attach the note photo to save</span></span></label>
        <div><label className="label">Plant name</label><input className="input input-md" value={String(s.plant_name ?? '')} onChange={(e) => setS({ ...s, plant_name: e.target.value })} /></div>
        <div><label className="label">OEE target (%)</label><input type="number" className="input input-md" value={Math.round(Number(s.oee_target ?? 0.85) * 100)} onChange={(e) => setS({ ...s, oee_target: Number(e.target.value) / 100 })} /></div>
        <div><label className="label">“High downtime” warning above (% of planned time)</label><input type="number" className="input input-md" value={Number(s.high_downtime_pct ?? 60)} onChange={(e) => setS({ ...s, high_downtime_pct: Number(e.target.value) })} /></div>
        <div><label className="label">OEE band low / high (%)</label><div className="flex gap-2"><input type="number" className="input input-md" value={Math.round(bands.low * 100)} onChange={(e) => setS({ ...s, oee_bands: { ...bands, low: Number(e.target.value) / 100 } })} /><input type="number" className="input input-md" value={Math.round(bands.high * 100)} onChange={(e) => setS({ ...s, oee_bands: { ...bands, high: Number(e.target.value) / 100 } })} /></div></div>
        <div><label className="label">Max photo size (MB)</label><input type="number" className="input input-md" value={Number(s.max_photo_mb ?? 12)} onChange={(e) => setS({ ...s, max_photo_mb: Number(e.target.value) })} /></div>
      </div>
    </Card>
  );
}

function ImportXlsx() {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'master' | 'data'>('master');
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (pv: boolean) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file); fd.append('mode', mode); if (pv) fd.append('preview', '1'); if (replace) fd.append('replace', '1');
    try {
      const r = await fetch('/api/master/import', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (pv) setPreview(d); else { setResult(d); toast('good', 'Import finished'); }
    } catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title="Import from the Excel workbook" sub="Upload “2.OEE MAIN SHEET” (.xlsx). Reads 'Cycletime and Bore' and, optionally, the 'OEE data 1' month.">
      <div className="max-w-2xl space-y-4">
        <Segmented value={mode} onChange={(m) => { setMode(m); setPreview(null); setResult(null); }} options={[{ value: 'master', label: 'Cycletime & Bore only' }, { value: 'data', label: 'Master + OEE data month' }]} />
        <label className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-line p-6 cursor-pointer hover:border-navy-600">
          <Upload className="text-navy-700" />
          <span className="flex-1"><b className="block">{file ? file.name : 'Choose .xlsx workbook'}</b><span className="text-sm text-muted">{file ? `${(file.size / 1e6).toFixed(1)} MB` : 'The file is read on the server; nothing is changed until you click Import'}</span></span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }} />
        </label>
        {mode === 'data' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace records imported earlier for the same dates (records typed in the app are never touched)</label>}
        <div className="flex gap-2"><button className="btn btn-md btn-ghost" disabled={!file || busy} onClick={() => send(true)}>{busy && <Spinner />} Check file</button><button className="btn btn-md btn-primary" disabled={!file || busy || !preview} onClick={() => send(false)}>Import</button></div>
        {preview && <Notice tone="info">Sheets found: {(preview.sheets as string[]).length}. Parts in Cycletime and Bore: <b>{String(preview.parts)}</b> ({String(preview.duplicates)} duplicate keys — first one kept, as VLOOKUP does).{mode === 'data' && <> Month {String(preview.month)}: <b>{String(preview.blocks)}</b> machine-shift blocks, {num(Number(preview.qty))} pcs. {(preview.skipped as unknown[]).length} blocks skipped (machine #N/A in Excel).</>}</Notice>}
        {result && <Notice tone="good"><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre></Notice>}
      </div>
    </Card>
  );
}
