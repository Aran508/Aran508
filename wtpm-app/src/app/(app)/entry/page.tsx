'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Camera, CheckCircle2, ChevronDown, ChevronUp, ClipboardCopy, Clock, Factory, History, ImagePlus, Info, Plus, RotateCcw, Save, Trash2, TriangleAlert, Wrench, X,
} from 'lucide-react';
import { fetchJson, useMeta, useToast, useCan, ApiError, type MetaData } from '@/lib/client';
import { Combobox, type Option } from '@/components/Combobox';
import { Badge, Loading, Modal, NumberField, Notice, Spinner } from '@/components/ui';
import { compressImage } from '@/lib/image';
import { currentShift, fmtDate, fmtDateTime, localToday, num, pct } from '@/lib/format';

// ------------------------------------------------------------------ types
type N = number | '';
interface Line { key: string; partNumber: string; qty: N; defect: N; rework: N; hold: N; setting: N; copied?: boolean }
interface Attach { id: string; kind: 'wtpm_note' | 'issue'; url: string; caption?: string; existing?: boolean }
interface Form {
  prodDate: string;
  shiftId: number;
  machineId: number | null;
  lines: Line[];
  losses: Record<string, N>;
  copiedLosses: string[];
  otherLossReason: string;
  remarks: string;
  plannedOverride: N;
  plannedReason: string;
  showPlanned: boolean;
  opOverride: N;
  opReason: string;
  showOp: boolean;
  attachments: Attach[];
}
interface Issue { code: string; field?: string; message: string }
interface Preview { A: number | null; P: number | null; Q: number | null; OEE: number | null; woOEE: number | null; plannedTime: number; totalLosses: number; operatingTime: number; qty: number; lossesNotCaptured: number }
interface ValidateResult { errors: Issue[]; warnings: Issue[]; duplicates: Dup[]; preview: Preview | null; lines: { partNumber: string; cycleTimeMin: number | null; bore: number | null }[] }
interface Dup { id: string; entry_no: number; created_by_name: string | null; created_at: string; parts: string | null; qty: number; losses: number; status: string }
interface PartSug { part: string; ct: number | null; bore: number | null; uses?: number; last_used?: string; last_qty?: number }
interface PrevEntry { id: string; entry_no: number; prod_date: string; shift_id: number; by?: string; remarks?: string | null; lines: { part: string; qty: number; defect: number; rework?: number; hold?: number; setting?: number; ct: number | null; bore: number | null }[] | null; losses: Record<string, number> | null }
interface Suggest { recentParts: PartSug[]; masterParts: PartSug[]; lastEntry: PrevEntry | null; recentEntries: PrevEntry[]; previousShift: PrevEntry | null; frequentLosses: { code: string; uses: number; avg_minutes: number }[] }

const DRAFT_KEY = 'wtpm-quick-entry-draft-v1';
const RECENT_MACHINES_KEY = 'wtpm-recent-machines';
const newLine = (partNumber = ''): Line => ({ key: Math.random().toString(36).slice(2), partNumber, qty: '', defect: '', rework: '', hold: '', setting: '' });
const blank = (date: string, shift: number): Form => ({
  prodDate: date, shiftId: shift, machineId: null, lines: [newLine()], losses: {}, copiedLosses: [], otherLossReason: '', remarks: '',
  plannedOverride: '', plannedReason: '', showPlanned: false, opOverride: '', opReason: '', showOp: false, attachments: [],
});
const v = (x: N) => (x === '' ? 0 : Number(x));
const safeLS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, val: string) => { try { localStorage.setItem(k, val); } catch { /* storage unavailable */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

function toPayload(f: Form, extra: Record<string, unknown> = {}) {
  return {
    prodDate: f.prodDate,
    shiftId: f.shiftId,
    machineId: f.machineId ?? 0,
    lines: f.lines.filter((l) => l.partNumber.trim() || v(l.qty) > 0).map((l) => ({ partNumber: l.partNumber, qty: v(l.qty), defect: v(l.defect), rework: v(l.rework), hold: v(l.hold), settingChangeoverCount: v(l.setting) })),
    losses: Object.fromEntries(Object.entries(f.losses).filter(([, m]) => v(m) > 0).map(([k, m]) => [k, v(m)])),
    otherLossReason: f.otherLossReason || null,
    remarks: f.remarks || null,
    plannedTimeOverride: f.showPlanned && f.plannedOverride !== '' ? v(f.plannedOverride) : null,
    plannedOverrideReason: f.showPlanned ? f.plannedReason : null,
    operatingTimeOverride: f.showOp && f.opOverride !== '' ? v(f.opOverride) : null,
    operatingOverrideReason: f.showOp ? f.opReason : null,
    attachmentIds: f.attachments.filter((a) => !a.existing).map((a) => a.id),
    source: typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'tablet' : 'pc',
    ...extra,
  };
}

// ------------------------------------------------------------------ page
function QuickEntry() {
  const { meta } = useMeta();
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const editId = sp.get('id');
  const [form, setForm] = useState<Form>(() => blank(localToday(), currentShift()));
  const [editing, setEditing] = useState<{ id: string; version: number; entryNo: number } | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [sug, setSug] = useState<Suggest | null>(null);
  const [check, setCheck] = useState<ValidateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ack, setAck] = useState<string[]>([]);
  const [editReason, setEditReason] = useState('');
  const [saved, setSaved] = useState<null | { id: string; entryNo?: number; preview: Preview | null; machine: string }>(null);
  const [draftOffer, setDraftOffer] = useState<{ at: string; form: Form } | null>(null);
  const [showAllLosses, setShowAllLosses] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [addPartFor, setAddPartFor] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Issue[]>([]);
  const [recentMachines, setRecentMachines] = useState<number[]>([]);
  const sections = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null), c: useRef<HTMLDivElement>(null), d: useRef<HTMLDivElement>(null) };

  const set = useCallback(<K extends keyof Form>(k: K, val: Form[K]) => setForm((f) => ({ ...f, [k]: val })), []);
  const machine = meta?.machines.find((m) => m.id === form.machineId) ?? null;
  const shift = meta?.shifts.find((s) => s.id === form.shiftId) ?? null;

  // ---- initial: draft restore or edit load
  useEffect(() => {
    setRecentMachines(JSON.parse(safeLS.get(RECENT_MACHINES_KEY) || '[]'));
    if (editId) return;
    const raw = safeLS.get(DRAFT_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) as { at: string; form: Form };
        if (d.form.machineId || d.form.lines.some((l) => l.partNumber)) setDraftOffer(d);
      } catch { /* ignore broken draft */ }
    }
  }, [editId]);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const d = await fetchJson<{ entry: Record<string, unknown> & { lines: { part_number: string; qty: number; defect: number; rework: number; hold: number; setting_changeover_count: number }[]; losses: Record<string, number>; attachments: { id: string; kind: 'wtpm_note' | 'issue'; caption: string | null }[] } }>(`/api/entries/${editId}`);
        const e = d.entry;
        setForm({
          prodDate: String(e.prod_date), shiftId: Number(e.shift_id), machineId: Number(e.machine_id),
          lines: e.lines.length ? e.lines.map((l) => ({ ...newLine(l.part_number), qty: Number(l.qty), defect: Number(l.defect) || '', rework: Number(l.rework) || '', hold: Number(l.hold) || '', setting: Number(l.setting_changeover_count) || '' })) : [newLine()],
          losses: Object.fromEntries(Object.entries(e.losses).map(([k, m]) => [k, Number(m)])), copiedLosses: [],
          otherLossReason: (e.other_loss_reason as string) || '', remarks: (e.remarks as string) || '',
          plannedOverride: e.planned_time_override != null ? Number(e.planned_time_override) : '', plannedReason: (e.planned_override_reason as string) || '', showPlanned: e.planned_time_override != null,
          opOverride: e.operating_time_override != null ? Number(e.operating_time_override) : '', opReason: (e.operating_override_reason as string) || '', showOp: e.operating_time_override != null,
          attachments: e.attachments.map((a) => ({ id: a.id, kind: a.kind, url: `/api/uploads/${a.id}`, caption: a.caption ?? undefined, existing: true })),
        });
        setEditing({ id: editId, version: Number(e.version), entryNo: Number(e.entry_no) });
        setShowAllLosses(true);
      } catch (err) {
        toast('bad', (err as Error).message);
      } finally {
        setLoadingEdit(false);
      }
    })();
  }, [editId, toast]);

  // ---- autosave draft on this tablet (convenience only; the database is the record)
  useEffect(() => {
    if (editing || saved) return;
    const t = setTimeout(() => {
      if (form.machineId || form.lines.some((l) => l.partNumber || l.qty !== '')) safeLS.set(DRAFT_KEY, JSON.stringify({ at: new Date().toISOString(), form: { ...form, attachments: [] } }));
    }, 800);
    return () => clearTimeout(t);
  }, [form, editing, saved]);

  // ---- suggestions for machine
  useEffect(() => {
    if (!form.machineId) { setSug(null); return; }
    let live = true;
    fetchJson<Suggest>(`/api/suggest?machineId=${form.machineId}&date=${form.prodDate}&shift=${form.shiftId}`).then((s) => live && setSug(s)).catch(() => undefined);
    return () => { live = false; };
  }, [form.machineId, form.prodDate, form.shiftId]);

  // ---- live server validation + OEE preview (same engine as reports)
  const payloadKey = JSON.stringify(toPayload(form));
  useEffect(() => {
    if (!form.machineId || !form.prodDate || !form.shiftId) { setCheck(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetchJson<ValidateResult>('/api/entries/validate', { method: 'POST', json: { ...JSON.parse(payloadKey), id: editing?.id } });
        setCheck(r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) setCheck({ errors: [{ code: 'schema', message: e.message }], warnings: [], duplicates: [], preview: null, lines: [] });
      } finally {
        setChecking(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [payloadKey, editing?.id, form.machineId, form.prodDate, form.shiftId]);

  const errFor = (field: string) => [...serverErrors, ...(check?.errors ?? [])].find((e) => e.field === field)?.message ?? null;

  // ---- machine options grouped by line
  const machineOptions: Option[] = useMemo(() => {
    if (!meta) return [];
    const recent = recentMachines.map((id) => meta.machines.find((m) => m.id === id)).filter((m): m is MetaData['machines'][number] => !!m && m.active);
    const rest = [...meta.machines].filter((m) => m.active).sort((a, b) => a.line.localeCompare(b.line) || a.sort_order - b.sort_order);
    return [
      ...recent.map((m) => ({ value: String(m.id), label: m.name, hint: `${m.code} · ${m.line.trim()} · ${m.category}`, group: 'Recent on this tablet' })),
      ...rest.map((m) => ({ value: String(m.id), label: m.name, hint: `Code ${m.code} · ${m.category}`, group: `Line ${m.line.trim() || '—'}`, badge: m.code })),
    ];
  }, [meta, recentMachines]);

  const partOptions: Option[] = useMemo(() => {
    if (!sug) return [];
    const recent = new Set(sug.recentParts.map((p) => p.part.toUpperCase()));
    return [
      ...sug.recentParts.map((p) => ({ value: p.part, label: p.part, hint: `${p.ct != null ? `CT ${num(p.ct, 2)} min` : 'No CT in master'}${p.bore ? ` · Bore ${p.bore}` : ''} · used ${p.uses}× · last ${fmtDate(p.last_used)}`, group: `Used recently on ${machine?.name ?? 'this machine'}` })),
      ...sug.masterParts.filter((p) => !recent.has(p.part.toUpperCase())).map((p) => ({ value: p.part, label: p.part, hint: `CT ${num(p.ct, 2)} min${p.bore ? ` · Bore ${p.bore}` : ''}`, group: 'Cycletime & Bore master' })),
    ];
  }, [sug, machine?.name]);

  const partInfo = (part: string) => {
    if (!part || !sug) return null;
    const u = part.toUpperCase();
    return sug.masterParts.find((p) => p.part.toUpperCase() === u) ?? null;
  };

  const chooseMachine = (id: string) => {
    const mid = Number(id) || null;
    setForm((f) => ({ ...f, machineId: mid, lines: f.machineId && f.machineId !== mid ? [newLine()] : f.lines }));
    if (mid) {
      const next = [mid, ...recentMachines.filter((x) => x !== mid)].slice(0, 6);
      setRecentMachines(next);
      safeLS.set(RECENT_MACHINES_KEY, JSON.stringify(next));
    }
  };

  // ---- losses
  const cats = meta?.categories ?? [];
  const frequent = new Set(sug?.frequentLosses.slice(0, 6).map((x) => x.code) ?? []);
  const visibleCats = cats.filter((c) => showAllLosses || c.is_common || frequent.has(c.code) || v(form.losses[c.code] ?? '') > 0);
  const totalLoss = Object.values(form.losses).reduce<number>((s, m) => s + v(m), 0);
  const plannedRef = form.showPlanned && form.plannedOverride !== '' ? v(form.plannedOverride) : Number(shift?.planned_minutes ?? 0);
  const otherCat = cats.find((c) => c.requires_reason);
  const needOtherReason = !!otherCat && v(form.losses[otherCat.code] ?? '') > 0;

  // ---- attachments
  const upload = async (file: File, kind: Attach['kind']) => {
    const small = await compressImage(file);
    const fd = new FormData();
    fd.append('file', small);
    fd.append('kind', kind);
    if (editing) fd.append('entryId', editing.id);
    try {
      const r = await fetch('/api/uploads', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      set('attachments', [...form.attachments, { id: d.id, kind, url: URL.createObjectURL(small), existing: !!editing }]);
      toast('good', kind === 'wtpm_note' ? 'WTPM note photo attached' : 'Issue photo attached');
    } catch (e) {
      toast('bad', (e as Error).message);
    }
  };

  // ---- previous entry copy
  const prev = sug?.previousShift ?? sug?.lastEntry ?? null;

  // ---- save
  const openReview = async () => {
    setServerErrors([]);
    setAck([]);
    setReview(true);
  };
  const doSave = async () => {
    if (!meta) return;
    setSaving(true);
    try {
      const allAck = [...ack, ...(check?.warnings ?? []).filter((w) => ack.includes(w.code)).map((w) => w.code)];
      const body = toPayload(form, { acknowledge: allAck, editReason, version: editing?.version });
      const r = editing
        ? await fetchJson<{ id: string; entryNo?: number; preview: Preview }>(`/api/entries/${editing.id}`, { method: 'PUT', json: body })
        : await fetchJson<{ id: string; entryNo?: number; preview: Preview }>('/api/entries', { method: 'POST', json: body });
      safeLS.del(DRAFT_KEY);
      setReview(false);
      setSaved({ id: r.id, entryNo: r.entryNo ?? editing?.entryNo, preview: r.preview, machine: machine?.name ?? '' });
      toast('good', editing ? `Record #${editing.entryNo} corrected` : `Saved — record #${r.entryNo}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e instanceof ApiError) {
        const d = e.details as { errors?: Issue[]; pending?: Issue[]; warnings?: Issue[] } | undefined;
        if (d?.errors) setServerErrors(d.errors);
        if (e.status === 409 && d?.warnings) setCheck((c) => (c ? { ...c, warnings: d.warnings! } : c));
        toast('bad', e.message);
      } else toast('bad', 'Could not reach the server. Your entry is kept on this tablet — try Save again.');
    } finally {
      setSaving(false);
    }
  };

  const next = (keepMachine: boolean) => {
    const f = blank(form.prodDate, form.shiftId);
    if (keepMachine) f.machineId = form.machineId;
    setForm(f);
    setSaved(null);
    setEditing(null);
    setCheck(null);
    setEditReason('');
    if (editId) router.replace('/entry');
    setTimeout(() => sections.a.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  if (!meta || loadingEdit) return <Loading />;
  if (!can('entry.create')) return <Notice tone="warn">Your role can view reports but cannot enter WTPM data.</Notice>;

  const blockingErrors = check?.errors ?? [];
  const warnings = check?.warnings ?? [];
  const pendingWarnings = warnings.filter((w) => !ack.includes(w.code));
  const pv = check?.preview;

  // ------------------------------------------------------------------ success screen
  if (saved) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card p-6 sm:p-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-good-bg grid place-items-center"><CheckCircle2 className="text-good" size={34} /></div>
          <h1 className="text-2xl font-bold mt-4">{editing ? 'Correction saved' : 'Production entry saved'}</h1>
          <p className="text-muted mt-1">Record #{saved.entryNo} · {saved.machine} · {fmtDate(form.prodDate)} · {shift?.name}</p>
          <p className="text-sm text-muted mt-1">Dashboard and reports on every PC have been updated.</p>
          {saved.preview && (
            <div className="grid grid-cols-4 gap-2 mt-6">
              {(['A', 'P', 'Q', 'OEE'] as const).map((k) => (
                <div key={k} className={`rounded-2xl p-3 ${k === 'OEE' ? 'bg-brand-500 text-white' : 'bg-canvas'}`}>
                  <div className={`text-xs ${k === 'OEE' ? 'text-white/80' : 'text-muted'}`}>{k === 'A' ? 'Availability' : k === 'P' ? 'Performance' : k === 'Q' ? 'Quality' : 'Shift OEE'}</div>
                  <div className="text-xl font-bold mt-1">{pct(saved.preview?.[k])}</div>
                </div>
              ))}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3 mt-7">
            <button className="btn btn-lg btn-primary" onClick={() => next(false)}><Factory size={20} /> Next machine</button>
            <button className="btn btn-lg btn-ghost" onClick={() => next(true)}><Plus size={20} /> Same machine, new note</button>
          </div>
          <div className="mt-3 flex justify-center gap-4 text-sm font-semibold">
            <Link className="text-navy-700 underline" href={`/records/${saved.id}`}>View record</Link>
            <Link className="text-navy-700 underline" href="/records?mine=1">My records</Link>
          </div>
        </div>
      </div>
    );
  }

  const steps = [
    { k: 'a', label: 'Identify', done: !!form.machineId },
    { k: 'b', label: 'Production', done: form.lines.some((l) => l.partNumber && v(l.qty) > 0) },
    { k: 'c', label: 'Losses', done: totalLoss > 0 },
    { k: 'd', label: 'Remarks & photo', done: !!form.remarks || form.attachments.length > 0 },
  ] as const;

  return (
    <div className="max-w-[1100px] mx-auto pb-40">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-brand-500">{editing ? `Correcting record #${editing.entryNo}` : 'Production floor'}</div>
          <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-tight">WTPM Quick Entry</h1>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <Link href={`/records/${editing.id}`} className="btn btn-md btn-ghost"><X size={16} /> Cancel correction</Link>
          ) : (
            <button className="btn btn-md btn-ghost" onClick={() => { if (confirm('Clear this form?')) { safeLS.del(DRAFT_KEY); next(false); } }}><RotateCcw size={16} /> Clear</button>
          )}
        </div>
      </div>

      {/* step chips */}
      <div className="sticky top-14 lg:top-0 z-30 -mx-3 sm:mx-0 px-3 sm:px-0 py-2 bg-canvas/95 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {steps.map((s, i) => (
            <button key={s.k} onClick={() => sections[s.k].current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={`shrink-0 h-11 rounded-full pl-1.5 pr-4 flex items-center gap-2 text-sm font-semibold border ${s.done ? 'bg-white border-line' : 'bg-white/60 border-line text-muted'}`}>
              <span className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold ${s.done ? 'bg-good text-white' : 'bg-canvas text-muted'}`}>{s.done ? <CheckCircle2 size={16} /> : String.fromCharCode(65 + i)}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {draftOffer && (
        <div className="mt-3"><Notice tone="info">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <span>Unsent entry found on this tablet from {fmtDateTime(draftOffer.at)}.</span>
            <span className="flex gap-2">
              <button className="btn btn-md btn-navy" onClick={() => { setForm({ ...draftOffer.form, attachments: [] }); setDraftOffer(null); }}>Restore</button>
              <button className="btn btn-md btn-ghost" onClick={() => { safeLS.del(DRAFT_KEY); setDraftOffer(null); }}>Discard</button>
            </span>
          </div>
        </Notice></div>
      )}

      {/* ---------------- A: identification */}
      <section ref={sections.a} className="card p-4 sm:p-6 mt-3 scroll-mt-32">
        <SectionTitle letter="A" title="Production identification" sub="Date, shift and machine from the WTPM note" />
        <div className="grid md:grid-cols-[1fr_1.4fr] gap-4">
          <div>
            <label className="label" htmlFor="date">Production date</label>
            <input id="date" type="date" className={`input input-lg font-semibold ${errFor('prodDate') ? 'border-bad ring-4 ring-bad-bg' : ''}`} max={meta.serverToday} value={form.prodDate} onChange={(e) => set('prodDate', e.target.value)} />
            <div className="flex gap-2 mt-2">
              {[0, 1].map((d) => {
                const iso = new Date(Date.now() - d * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
                return <button key={d} type="button" onClick={() => set('prodDate', iso)} className={`chip h-8 px-3 ${form.prodDate === iso ? 'bg-ink text-white' : 'bg-canvas text-muted'}`}>{d === 0 ? 'Today' : 'Yesterday'}</button>;
              })}
            </div>
            {errFor('prodDate') && <p className="text-bad text-xs font-semibold mt-1">{errFor('prodDate')}</p>}
          </div>
          <div>
            <span className="label">Shift</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {meta.shifts.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={form.shiftId === s.id} onClick={() => set('shiftId', s.id)} className={`rounded-2xl border px-3 py-2.5 text-left transition ${form.shiftId === s.id ? 'bg-navy-800 text-white border-navy-800 shadow' : 'bg-white border-line'}`}>
                  <div className="font-bold text-lg leading-tight">Shift {s.id}</div>
                  <div className={`text-[11.5px] leading-tight mt-0.5 ${form.shiftId === s.id ? 'text-white/75' : 'text-muted'}`}>{s.timings}</div>
                  <div className={`text-[11.5px] font-semibold ${form.shiftId === s.id ? 'text-brand-400' : 'text-navy-700'}`}>{s.planned_minutes} min planned</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-[1.4fr_1fr] gap-4 mt-5">
          <div>
            <label className="label" htmlFor="machine">Machine (type to search, e.g. “Rob”)</label>
            <Combobox id="machine" value={form.machineId ? String(form.machineId) : ''} options={machineOptions} onChange={chooseMachine} placeholder="Search machine name or code" invalid={errFor('machineId')} />
            {recentMachines.length > 0 && !form.machineId && (
              <div className="flex flex-wrap gap-2 mt-2">
                {recentMachines.slice(0, 5).map((id) => {
                  const m = meta.machines.find((x) => x.id === id);
                  return m ? <button key={id} type="button" onClick={() => chooseMachine(String(id))} className="chip h-9 px-3.5 bg-white border border-line text-ink">{m.name}</button> : null;
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ReadField label="Machine code" value={machine?.code} />
            <ReadField label="Line" value={machine?.line.trim()} />
            <ReadField label="Category" value={machine?.category} />
          </div>
        </div>

        {machine && sug && (
          <div className="mt-5 rounded-2xl bg-canvas p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><History size={16} className="text-navy-700" /> Previous data for {machine.name}</div>
              {prev && <button type="button" className="btn btn-md btn-dark" onClick={() => setCopyOpen(true)}><ClipboardCopy size={16} /> USE PREVIOUS ENTRY</button>}
            </div>
            {prev ? (
              <div className="grid sm:grid-cols-2 gap-2 mt-3">
                <PrevCard title={sug.previousShift ? 'Previous shift' : 'Last entry'} e={prev} cats={cats} />
                {sug.previousShift && sug.lastEntry && sug.lastEntry.id !== sug.previousShift.id && <PrevCard title="Last entry" e={sug.lastEntry} cats={cats} />}
                {!sug.previousShift && sug.recentEntries[1] && <PrevCard title="Entry before that" e={sug.recentEntries[1]} cats={cats} />}
              </div>
            ) : (
              <p className="text-sm text-muted mt-2">No earlier entries for this machine yet.</p>
            )}
          </div>
        )}
        {check?.duplicates && check.duplicates.length > 0 && !editing && (
          <div className="mt-4"><Notice tone="warn">
            <b>{check.duplicates.length} record(s) already saved</b> for {machine?.name}, {shift?.name}, {fmtDate(form.prodDate)}. A machine can run several parts in one shift, so you may add another record — or open the existing one to correct it.
            <div className="flex flex-wrap gap-2 mt-2">
              {check.duplicates.map((d) => (
                <Link key={d.id} href={`/entry?id=${d.id}`} className="chip h-9 px-3 bg-white text-ink border border-line">Edit #{d.entry_no} · {d.parts || 'losses only'} · {num(d.qty)} pcs</Link>
              ))}
            </div>
          </Notice></div>
        )}
      </section>

      {/* ---------------- B: production */}
      <section ref={sections.b} className="card p-4 sm:p-6 mt-4 scroll-mt-32">
        <SectionTitle letter="B" title="Production information" sub="One block per part number on the WTPM note. Bore and cycle time come from the master." />
        {!machine && <Notice>Select the machine first — part numbers used on it will be suggested.</Notice>}
        <div className="space-y-4">
          {form.lines.map((l, i) => {
            const info = partInfo(l.partNumber);
            const missing = machine && l.partNumber && sug && !info;
            const ot = info?.ct != null ? v(l.qty) * Number(info.ct) : 0;
            const upd = (patch: Partial<Line>) => set('lines', form.lines.map((x) => (x.key === l.key ? { ...x, ...patch, copied: patch.qty !== undefined ? false : x.copied } : x)));
            return (
              <div key={l.key} className={`rounded-2xl border p-3 sm:p-4 ${l.copied ? 'border-alert bg-[#fffbea]' : 'border-line'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold">Part {i + 1}{l.copied && <Badge tone="yellow">Copied — check quantity</Badge>}</div>
                  {form.lines.length > 1 && <button type="button" className="w-10 h-10 grid place-items-center rounded-full text-bad hover:bg-bad-bg" onClick={() => set('lines', form.lines.filter((x) => x.key !== l.key))} aria-label="Remove part"><Trash2 size={18} /></button>}
                </div>
                <div className="grid md:grid-cols-[1.3fr_1fr] gap-3">
                  <div>
                    <label className="label">Part number</label>
                    <Combobox value={l.partNumber} options={partOptions} onChange={(val) => upd({ partNumber: val })} placeholder={machine ? 'Search part number' : 'Select machine first'} allowCustom customLabel="Use new part" invalid={errFor(`lines.${i}.partNumber`)} emptyText="Not in master for this machine — type the full number" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ReadField label="Bore" value={info ? (info.bore ?? '—') : l.partNumber && sug ? '?' : ''} />
                    <ReadField label="Cycle time" value={info?.ct != null ? `${num(Number(info.ct), 3)} min` : l.partNumber && sug ? 'Missing' : ''} tone={missing ? 'bad' : info ? 'good' : undefined} />
                    <ReadField label="Op. time" value={ot ? `${num(ot, 1)} min` : ''} />
                  </div>
                </div>
                {missing && (
                  <div className="mt-2 rounded-xl bg-bad-bg text-bad text-[13px] px-3 py-2 flex flex-wrap items-center gap-2">
                    <TriangleAlert size={16} /> <span className="flex-1">No cycle time / bore for <b>{l.partNumber}</b> on {machine?.name}. The record can be saved, but operating time stays 0 until master data is added.</span>
                    {can('master.edit') && <button type="button" className="btn btn-md btn-danger" onClick={() => setAddPartFor(l.partNumber)}>Add to master</button>}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
                  <NumberField label="Qty produced" value={l.qty} onChange={(x) => upd({ qty: x })} invalid={errFor(`lines.${i}.qty`)} />
                  <NumberField label="Defect" value={l.defect} onChange={(x) => upd({ defect: x })} invalid={errFor(`lines.${i}.defect`)} />
                  <NumberField label="R/W" value={l.rework} onChange={(x) => upd({ rework: x })} />
                  <NumberField label="Hold" value={l.hold} onChange={(x) => upd({ hold: x })} />
                  <NumberField label="Setting changeover" value={l.setting} onChange={(x) => upd({ setting: x })} />
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn btn-lg btn-ghost w-full mt-4 border-dashed" onClick={() => set('lines', [...form.lines, newLine()])}><Plus size={20} /> Add another part number</button>

        <div className="mt-5 rounded-2xl bg-canvas p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold">Planned time:</span> {plannedRef} min{' '}
              <span className="text-muted">{form.showPlanned ? '(changed)' : `(${shift?.name} standard: ${shift?.total_minutes} − lunch ${shift?.lunch_minutes} − tea ${shift?.tea_minutes}${shift?.tpm_minutes ? ` − TPM ${shift.tpm_minutes}` : ''}; 0 if nothing produced)`}</span>
            </div>
            <button type="button" className="text-sm font-semibold text-navy-700 underline" onClick={() => set('showPlanned', !form.showPlanned)}>{form.showPlanned ? 'Use standard planned time' : 'Half shift / different planned time?'}</button>
          </div>
          {form.showPlanned && (
            <div className="grid sm:grid-cols-[200px_1fr] gap-3 mt-3">
              <NumberField label="Planned time" unit="min" step={5} value={form.plannedOverride} onChange={(x) => set('plannedOverride', x)} compact />
              <div><label className="label">Reason</label><input className={`input input-lg ${errFor('plannedOverrideReason') ? 'border-bad' : ''}`} placeholder="e.g. Half shift — machine started 11 am" value={form.plannedReason} onChange={(e) => set('plannedReason', e.target.value)} /></div>
            </div>
          )}
          {can('entry.override_times') && (
            <>
              <button type="button" className="text-xs font-semibold text-muted underline mt-2" onClick={() => set('showOp', !form.showOp)}>{form.showOp ? 'Use calculated operating time (Qty × CT)' : 'Supervisor: type operating time manually'}</button>
              {form.showOp && (
                <div className="grid sm:grid-cols-[200px_1fr] gap-3 mt-3">
                  <NumberField label="Operating time" unit="min" step={5} value={form.opOverride} onChange={(x) => set('opOverride', x)} compact />
                  <div><label className="label">Reason</label><input className="input input-lg" value={form.opReason} onChange={(e) => set('opReason', e.target.value)} placeholder="Why the calculated value is not right" /></div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ---------------- C: losses */}
      <section ref={sections.c} className="card p-4 sm:p-6 mt-4 scroll-mt-32">
        <SectionTitle letter="C" title="Production loss entry" sub="All losses in minutes, exactly as the WTPM note / Excel loss columns" />
        <div className="rounded-2xl bg-canvas p-3 mb-4">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Total losses {totalLoss} min</span>
            <span className="text-muted">of {plannedRef || '—'} min planned</span>
          </div>
          <div className="h-2.5 rounded-full bg-white mt-2 overflow-hidden">
            <div className={`h-full rounded-full ${plannedRef && totalLoss / plannedRef > 0.6 ? 'bg-bad' : plannedRef && totalLoss / plannedRef > 0.3 ? 'bg-alert' : 'bg-good'}`} style={{ width: `${Math.min(100, plannedRef ? (totalLoss / plannedRef) * 100 : 0)}%` }} />
          </div>
        </div>
        {(['process', 'management'] as const).map((sec) => {
          const list = visibleCats.filter((c) => c.section === sec);
          if (!list.length) return null;
          return (
            <div key={sec} className="mb-4">
              <div className="text-xs font-bold uppercase tracking-wider text-muted mb-2">{sec === 'process' ? 'Production / process losses' : 'Management / planned losses'}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {list.map((c) => {
                  const copied = form.copiedLosses.includes(c.code);
                  return (
                    <div key={c.code} className={copied ? 'rounded-xl ring-2 ring-alert ring-offset-2' : ''}>
                      <NumberField
                        label={`${c.name}${c.is_management ? ' ·M' : ''}`}
                        step={5}
                        value={form.losses[c.code] ?? ''}
                        compact
                        onChange={(x) => setForm((f) => ({ ...f, losses: { ...f.losses, [c.code]: x }, copiedLosses: f.copiedLosses.filter((k) => k !== c.code) }))}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-md btn-ghost" onClick={() => setShowAllLosses(!showAllLosses)}>
          {showAllLosses ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {showAllLosses ? 'Show common losses only' : `Show all ${cats.length} loss categories`}
        </button>
        <p className="text-xs text-muted mt-2">·M = counted in Management Losses (Excel columns No Power … TPM &amp; Cleaning).</p>
        {needOtherReason && (
          <div className="mt-4">
            <label className="label" htmlFor="other">Other loss — reason in detail (required)</label>
            <textarea id="other" rows={3} className={`input py-3 text-base ${errFor('otherLossReason') ? 'border-bad ring-4 ring-bad-bg' : ''}`} value={form.otherLossReason} onChange={(e) => set('otherLossReason', e.target.value)} placeholder="What happened, how long, action taken" />
            {errFor('otherLossReason') && <p className="text-bad text-xs font-semibold mt-1">{errFor('otherLossReason')}</p>}
          </div>
        )}
      </section>

      {/* ---------------- D: remarks & photos */}
      <section ref={sections.d} className="card p-4 sm:p-6 mt-4 scroll-mt-32">
        <SectionTitle letter="D" title="Remarks and evidence" sub={meta.settings.photo_mandatory ? 'A photo of the WTPM note is required' : 'Photo is optional — the typed values are the record'} />
        <label className="label" htmlFor="remarks">Remarks</label>
        <textarea id="remarks" rows={3} className="input py-3 text-base" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="e.g. coil change, ID chatter mark, setting change dia 120 → 125" />
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <PhotoButton label="WTPM note photo" icon={<Camera size={20} />} onFile={(f) => upload(f, 'wtpm_note')} />
          <PhotoButton label="Issue photo (optional)" icon={<ImagePlus size={20} />} onFile={(f) => upload(f, 'issue')} />
        </div>
        {form.attachments.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-4">
            {form.attachments.map((a) => (
              <div key={a.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.kind} className="w-28 h-28 object-cover rounded-2xl border border-line" />
                <span className="absolute left-1.5 bottom-1.5 chip bg-white/90 text-ink">{a.kind === 'wtpm_note' ? 'WTPM note' : 'Issue'}</span>
                {!a.existing && <button type="button" className="absolute -right-2 -top-2 w-8 h-8 rounded-full bg-ink text-white grid place-items-center" onClick={() => set('attachments', form.attachments.filter((x) => x.id !== a.id))} aria-label="Remove photo"><X size={14} /></button>}
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <ReadField label="Entry submitted by" value={meta.user.name} />
          <ReadField label="Entry timestamp" value={editing ? 'Updated on save' : 'Recorded on save'} />
        </div>
      </section>

      {/* ---------------- sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[264px] z-40 no-print">
        <div className="max-w-[1100px] mx-auto px-3 sm:px-5 pb-3">
          <div className="rounded-3xl bg-ink text-white shadow-2xl p-2.5 sm:p-3 flex items-center gap-2 sm:gap-3">
            <div className="flex-1 min-w-0 grid grid-cols-4 gap-1 sm:gap-2 pl-1">
              {(['A', 'P', 'Q', 'OEE'] as const).map((k) => (
                <div key={k} className="min-w-0">
                  <div className="text-[10.5px] text-white/60 uppercase tracking-wide">{k === 'OEE' ? 'Shift OEE' : k}</div>
                  <div className={`text-base sm:text-lg font-bold tabular-nums ${k === 'OEE' ? 'text-brand-400' : ''}`}>{pv ? pct(pv[k], 0) : '—'}</div>
                </div>
              ))}
            </div>
            <div className="hidden md:block text-xs text-white/70 text-right leading-tight">
              {checking ? <Spinner className="inline" /> : blockingErrors.length ? <span className="text-[#ffb4ab] font-semibold">{blockingErrors.length} to fix</span> : warnings.length ? <span className="text-alert font-semibold">{warnings.length} warning(s)</span> : form.machineId ? <span className="text-[#9be3b0] font-semibold">Ready</span> : 'Select machine'}
              <div>{totalLoss} min losses</div>
            </div>
            <button className="btn btn-lg btn-primary min-w-[150px]" disabled={!form.machineId} onClick={openReview}><Save size={20} /> Review &amp; Save</button>
          </div>
        </div>
      </div>

      {/* ---------------- review modal */}
      <Modal open={review} onClose={() => setReview(false)} wide title={editing ? `Review correction — #${editing.entryNo}` : 'Review entry before saving'}
        footer={<>
          <button className="btn btn-lg btn-ghost" onClick={() => setReview(false)}>Back to edit</button>
          <button className="btn btn-lg btn-primary" disabled={saving || checking || blockingErrors.length > 0 || pendingWarnings.length > 0 || (!!editing && editReason.trim().length < 3)} onClick={doSave}>
            {saving ? <Spinner /> : <Save size={20} />} {editing ? 'Save correction' : check?.duplicates.length ? 'Save as separate entry' : 'Confirm & save'}
          </button>
        </>}>
        <div className="grid sm:grid-cols-3 gap-2 text-sm">
          <ReadField label="Date" value={fmtDate(form.prodDate)} />
          <ReadField label="Shift" value={`${shift?.name} · ${shift?.timings}`} />
          <ReadField label="Machine" value={`${machine?.name} (${machine?.code}) · ${machine?.line.trim()}`} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-x">
            <thead><tr><th>Part</th><th className="num">Qty</th><th className="num">Defect</th><th className="num">R/W</th><th className="num">Hold</th><th className="num">Setting</th><th className="num">Bore</th><th className="num">CT (min)</th></tr></thead>
            <tbody>
              {toPayload(form).lines.map((l, i) => {
                const r = check?.lines[i];
                return <tr key={i}><td className="font-semibold">{l.partNumber}</td><td className="num">{num(l.qty, 2)}</td><td className="num">{num(l.defect)}</td><td className="num">{num(l.rework)}</td><td className="num">{num(l.hold)}</td><td className="num">{num(l.settingChangeoverCount)}</td><td className="num">{r?.bore ?? '—'}</td><td className={`num ${r && r.cycleTimeMin == null ? 'text-bad font-bold' : ''}`}>{r ? (r.cycleTimeMin == null ? 'missing' : num(r.cycleTimeMin, 3)) : '…'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {Object.entries(toPayload(form).losses).map(([k, m]) => <Badge key={k} tone={cats.find((c) => c.code === k)?.section === 'management' ? 'navy' : 'brand'}>{cats.find((c) => c.code === k)?.name}: {m} min</Badge>)}
          {!Object.keys(toPayload(form).losses).length && <span className="text-sm text-muted">No losses entered.</span>}
        </div>
        {form.remarks && <p className="text-sm mt-3"><b>Remarks:</b> {form.remarks}</p>}
        {pv && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
            <Mini k="Planned" val={`${num(pv.plannedTime)} min`} />
            <Mini k="Losses" val={`${num(pv.totalLosses)} min`} />
            <Mini k="Operating" val={`${num(pv.operatingTime, 1)} min`} />
            <Mini k="%A" val={pct(pv.A)} />
            <Mini k="%P" val={pct(pv.P)} />
            <div className="rounded-xl bg-brand-500 text-white px-3 py-2"><div className="text-[11px] text-white/80">Shift OEE</div><div className="font-bold">{pct(pv.OEE)}</div></div>
          </div>
        )}
        {pv && check?.duplicates.length ? <p className="text-xs text-muted mt-1">Shift figures include the {check.duplicates.length} record(s) already saved for this machine and shift.</p> : null}

        <div className="space-y-2 mt-4">
          {checking && <div className="text-sm text-muted flex items-center gap-2"><Spinner /> Checking with the server…</div>}
          {[...serverErrors, ...blockingErrors].filter((e, i, a) => a.findIndex((x) => x.message === e.message) === i).map((e) => <Notice key={e.code + e.message} tone="bad">{e.message}</Notice>)}
          {warnings.map((w) => (
            <label key={w.code} className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm cursor-pointer ${ack.includes(w.code) ? 'bg-canvas' : 'bg-warn-bg text-warn'}`}>
              <input type="checkbox" className="mt-0.5 w-6 h-6 accent-[#261a66] shrink-0" checked={ack.includes(w.code)} onChange={(e) => setAck(e.target.checked ? [...ack, w.code] : ack.filter((x) => x !== w.code))} />
              <span><b className="block">{w.code === 'duplicate' ? 'Existing record for this machine & shift' : 'Please confirm'}</b>{w.message}{w.code === 'duplicate' && <span className="block text-ink/70 mt-1">Tick to save this as a separate record (e.g. a different part or a second WTPM note). To change the earlier one instead, close this and use “Edit #…” in section A.</span>}</span>
            </label>
          ))}
          {!checking && !blockingErrors.length && !warnings.length && <Notice tone="good">All checks passed.</Notice>}
        </div>
        {editing && (
          <div className="mt-4">
            <label className="label" htmlFor="reason">Reason for correction (saved in the audit trail)</label>
            <input id="reason" className="input input-lg" value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="e.g. Qty misread from note — 25 not 52" />
          </div>
        )}
      </Modal>

      {/* ---------------- use previous entry */}
      {prev && (
        <CopyPrevious open={copyOpen} onClose={() => setCopyOpen(false)} prev={prev} cats={cats}
          onApply={(opt) => {
            setForm((f) => {
              const lines = opt.parts ? (prev.lines ?? []).map((l) => ({ ...newLine(l.part), qty: (opt.qty ? Number(l.qty) : '') as N, defect: (opt.qty ? Number(l.defect) || '' : '') as N, rework: (opt.qty ? Number(l.rework) || '' : '') as N, hold: (opt.qty ? Number(l.hold) || '' : '') as N, setting: (opt.qty ? Number(l.setting) || '' : '') as N, copied: opt.qty })) : f.lines;
              const lossCodes = Object.keys(prev.losses ?? {});
              const losses = opt.lossCats ? { ...f.losses, ...Object.fromEntries(lossCodes.map((k) => [k, (opt.lossMin ? Number(prev.losses![k]) : f.losses[k] ?? '') as N])) } : f.losses;
              return { ...f, lines: lines.length ? lines : [newLine()], losses, copiedLosses: opt.lossMin ? lossCodes : [], remarks: opt.remarks ? prev.remarks || f.remarks : f.remarks };
            });
            if (opt.lossCats) setShowAllLosses(true);
            setCopyOpen(false);
            toast('info', opt.qty || opt.lossMin ? 'Copied values are highlighted — check each one against today’s note' : 'Part numbers copied — enter today’s quantities');
          }} />
      )}

      {addPartFor && machine && (
        <AddPartModal machineId={machine.id} machineName={machine.name} part={addPartFor} onClose={() => setAddPartFor(null)}
          onSaved={async () => { setAddPartFor(null); setSug(await fetchJson<Suggest>(`/api/suggest?machineId=${machine.id}&date=${form.prodDate}&shift=${form.shiftId}`)); setForm((f) => ({ ...f })); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces
function SectionTitle({ letter, title, sub }: { letter: string; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-10 h-10 rounded-2xl bg-navy-800 text-white grid place-items-center font-bold shrink-0">{letter}</div>
      <div><h2 className="text-lg font-bold leading-tight">{title}</h2><p className="text-[13px] text-muted">{sub}</p></div>
    </div>
  );
}

function ReadField({ label, value, tone }: { label: string; value?: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className={`h-14 rounded-xl px-3 flex items-center font-bold truncate ${tone === 'bad' ? 'bg-bad-bg text-bad' : tone === 'good' ? 'bg-good-bg text-good' : 'bg-canvas text-ink'}`}>{value === undefined || value === null || value === '' ? <span className="text-[#b5b2c0] font-normal">auto</span> : value}</div>
    </div>
  );
}

function Mini({ k, val }: { k: string; val: string }) {
  return <div className="rounded-xl bg-canvas px-3 py-2"><div className="text-[11px] text-muted">{k}</div><div className="font-bold tabular-nums">{val}</div></div>;
}

function PrevCard({ title, e, cats }: { title: string; e: PrevEntry; cats: MetaData['categories'] }) {
  const losses = Object.entries(e.losses ?? {});
  return (
    <div className="rounded-xl bg-white border border-line p-3 text-[13px]">
      <div className="flex items-center justify-between"><b>{title}</b><span className="text-muted flex items-center gap-1"><Clock size={13} /> {fmtDate(e.prod_date)} · S{e.shift_id}</span></div>
      <div className="mt-1.5 space-y-0.5">
        {(e.lines ?? []).slice(0, 4).map((l, i) => <div key={i} className="flex justify-between gap-2"><span className="font-semibold truncate">{l.part}</span><span className="text-muted shrink-0">{num(l.qty)} pcs · CT {l.ct != null ? num(Number(l.ct), 2) : '—'}{l.bore ? ` · Ø${l.bore}` : ''}</span></div>)}
        {(e.lines?.length ?? 0) > 4 && <div className="text-muted">+{(e.lines?.length ?? 0) - 4} more parts</div>}
      </div>
      {losses.length > 0 && <div className="mt-1.5 text-muted truncate">Losses: {losses.map(([k, m]) => `${cats.find((c) => c.code === k)?.name ?? k} ${m}`).join(' · ')}</div>}
      {e.by && <div className="mt-1 text-[11.5px] text-muted">by {e.by}</div>}
    </div>
  );
}

function CopyPrevious({ open, onClose, prev, cats, onApply }: { open: boolean; onClose: () => void; prev: PrevEntry; cats: MetaData['categories']; onApply: (o: { parts: boolean; qty: boolean; lossCats: boolean; lossMin: boolean; remarks: boolean }) => void }) {
  const [o, setO] = useState({ parts: true, qty: false, lossCats: true, lossMin: false, remarks: false });
  const row = (k: keyof typeof o, title: string, sub: string, risky?: boolean) => (
    <label className={`flex gap-3 items-start rounded-2xl border p-3.5 cursor-pointer ${o[k] ? (risky ? 'border-alert bg-[#fffbea]' : 'border-navy-600 bg-navy-50') : 'border-line'}`}>
      <input type="checkbox" className="w-6 h-6 mt-0.5 accent-[#261a66]" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked, ...(k === 'parts' && !e.target.checked ? { qty: false } : {}), ...(k === 'lossCats' && !e.target.checked ? { lossMin: false } : {}) })} disabled={(k === 'qty' && !o.parts) || (k === 'lossMin' && !o.lossCats)} />
      <span><b className="block">{title}</b><span className="text-[13px] text-muted">{sub}</span></span>
    </label>
  );
  return (
    <Modal open={open} onClose={onClose} title="Use previous entry" footer={<><button className="btn btn-lg btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-lg btn-primary" onClick={() => onApply(o)}><ClipboardCopy size={18} /> Copy selected</button></>}>
      <p className="text-sm text-muted mb-3">From {fmtDate(prev.prod_date)}, shift {prev.shift_id} (record #{prev.entry_no}). Date, shift and machine stay as you selected.</p>
      <div className="space-y-2">
        {row('parts', `Part numbers (${prev.lines?.length ?? 0})`, (prev.lines ?? []).map((l) => l.part).join(', ') || 'none')}
        {row('qty', 'Also copy quantities, defects, R/W, hold', 'Only if today’s note really shows the same numbers — they will be highlighted until you check them', true)}
        {row('lossCats', 'Loss categories used', Object.keys(prev.losses ?? {}).map((k) => cats.find((c) => c.code === k)?.name).join(', ') || 'none')}
        {row('lossMin', 'Also copy loss minutes', 'Downtime is rarely identical — highlighted until checked', true)}
        {row('remarks', 'Remarks', prev.remarks || '—')}
      </div>
      <div className="mt-3"><Notice tone="info"><Info size={14} className="inline" /> Nothing is saved until you review and confirm the entry.</Notice></div>
    </Modal>
  );
}

function PhotoButton({ label, icon, onFile }: { label: string; icon: React.ReactNode; onFile: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-lg btn-ghost w-full" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Spinner /> : icon} {label}</button>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        try { await onFile(f); } finally { setBusy(false); }
      }} />
    </>
  );
}

function AddPartModal({ machineId, machineName, part, onClose, onSaved }: { machineId: number; machineName: string; part: string; onClose: () => void; onSaved: () => void }) {
  const [ct, setCt] = useState<N>('');
  const [bore, setBore] = useState<N>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title={`Add ${part} to master`} footer={<><button className="btn btn-lg btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-lg btn-primary" disabled={busy || ct === ''} onClick={async () => {
      setBusy(true); setErr(null);
      try { await fetchJson('/api/master/parts', { method: 'POST', json: { machine_id: machineId, part_number: part, cycle_time_min: v(ct), bore: bore === '' ? null : v(bore), reason: 'Added from Quick Entry' } }); toast('good', 'Part added to Cycletime & Bore master'); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
    }}><Wrench size={18} /> Save master data</button></>}>
      <p className="text-sm text-muted mb-3">Machine: <b>{machineName}</b>. Enter the approved cycle time from the process sheet — it is used for every future OEE calculation of this part.</p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Cycle time" unit="min per piece" step={0.1} value={ct} onChange={setCt} />
        <NumberField label="Bore" step={1} value={bore} onChange={setBore} />
      </div>
      {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
    </Modal>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading />}><QuickEntry /></Suspense>;
}

