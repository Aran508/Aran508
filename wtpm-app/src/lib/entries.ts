import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, queryOne, tx, notifyChange } from './db';
import { audit, diff } from './audit';
import { HttpError } from './auth';
import { can } from './roles';
import type { SessionPayload } from './session';
import { buildBlocks, computeMetrics, entryOperatingTime } from './oee';
import { loadMeta } from './reports';

const nonNeg = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number` }).finite(`${label} must be a number`).min(0, `${label} cannot be negative`);

export const LineSchema = z.object({
  partNumber: z.string().trim().min(1, 'Part number is required').max(60),
  qty: nonNeg('Quantity'),
  defect: nonNeg('Defect').default(0),
  rework: nonNeg('R/W').default(0),
  hold: nonNeg('Hold').default(0),
  settingChangeoverCount: nonNeg('Setting change over count').default(0),
});

export const EntrySchema = z.object({
  prodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a valid production date'),
  shiftId: z.coerce.number().int().min(1, 'Select a shift'),
  machineId: z.coerce.number().int().min(1, 'Select a machine'),
  lines: z.array(LineSchema).max(20, 'At most 20 part lines per record').default([]),
  losses: z.record(z.string(), nonNeg('Loss minutes')).default({}),
  otherLossReason: z.string().trim().max(2000).optional().nullable(),
  remarks: z.string().trim().max(4000).optional().nullable(),
  plannedTimeOverride: z.union([nonNeg('Planned time'), z.null()]).optional(),
  plannedOverrideReason: z.string().trim().max(500).optional().nullable(),
  operatingTimeOverride: z.union([nonNeg('Operating time'), z.null()]).optional(),
  operatingOverrideReason: z.string().trim().max(500).optional().nullable(),
  source: z.enum(['tablet', 'pc']).default('tablet'),
  acknowledge: z.array(z.string()).default([]),
  editReason: z.string().trim().max(1000).optional().nullable(),
  version: z.coerce.number().int().optional(),
  attachmentIds: z.array(z.string().uuid()).default([]),
});
export type EntryInput = z.infer<typeof EntrySchema>;

export interface Issue {
  code: string;
  field?: string;
  message: string;
}

export interface ResolvedLine {
  partNumber: string;
  partMasterId: number | null;
  bore: number | null;
  cycleTimeMin: number | null;
  qty: number;
  defect: number;
  rework: number;
  hold: number;
  settingChangeoverCount: number;
}

const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Validate an entry. Errors block saving; warnings must be acknowledged by the user. */
export async function validateEntry(input: EntryInput, user: SessionPayload, excludeId?: string) {
  const meta = await loadMeta();
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const machine = meta.machines.find((m) => m.id === input.machineId);
  const shift = meta.shifts.find((s) => s.id === input.shiftId);
  if (!machine) errors.push({ code: 'machine', field: 'machineId', message: 'Select a machine from the Machine List' });
  else if (!machine.active) errors.push({ code: 'machine_inactive', field: 'machineId', message: `${machine.name} is marked inactive in master data` });
  if (!shift) errors.push({ code: 'shift', field: 'shiftId', message: 'Select shift 1, 2 or 3' });

  const date = new Date(input.prodDate + 'T00:00:00Z');
  const today = todayLocal();
  if (Number.isNaN(date.getTime())) errors.push({ code: 'date', field: 'prodDate', message: 'Invalid date' });
  else if (input.prodDate > today) errors.push({ code: 'date_future', field: 'prodDate', message: 'Production date cannot be in the future' });
  else {
    const ageDays = (Date.parse(today) - date.getTime()) / 86400000;
    if (ageDays > 7) warnings.push({ code: 'date_old', field: 'prodDate', message: `This date is ${Math.round(ageDays)} days ago — please confirm it matches the WTPM note` });
    if (input.prodDate === today && shift) {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const start = { 1: 390, 2: 900, 3: 1410 }[shift.id as 1 | 2 | 3] ?? 0;
      if (mins < start) warnings.push({ code: 'shift_not_started', field: 'shiftId', message: `${shift.name} (${shift.timings}) has not started yet today — check the date and shift` });
    }
  }

  // Lines: resolve Bore and CT from the 'Cycletime and Bore' master (key = machine + part number)
  const lines: ResolvedLine[] = [];
  const parts = machine
    ? await query<{ id: number; part_number: string; cycle_time_min: number; bore: number | null; active: boolean }>(
        'SELECT id, part_number, cycle_time_min, bore, active FROM part_master WHERE machine_id = $1 AND upper(part_number) = ANY($2)',
        [machine.id, input.lines.map((l) => l.partNumber.trim().toUpperCase())],
      )
    : [];
  const byPart = new Map(parts.map((p) => [p.part_number.toUpperCase(), p]));
  const seenParts = new Set<string>();
  input.lines.forEach((l, i) => {
    const key = l.partNumber.trim().toUpperCase();
    const pm = byPart.get(key);
    if (!pm && machine)
      warnings.push({ code: `ct_missing_${i}`, field: `lines.${i}.partNumber`, message: `Part ${l.partNumber} has no cycle time / bore for ${machine.name} in master data. It will be saved without CT (operating time 0) and flagged for the administrator.` });
    if (seenParts.has(key)) warnings.push({ code: `part_repeat_${i}`, field: `lines.${i}.partNumber`, message: `Part ${l.partNumber} is entered twice in this record` });
    seenParts.add(key);
    if (l.defect > l.qty) errors.push({ code: 'defect_gt_qty', field: `lines.${i}.defect`, message: `Defect (${l.defect}) cannot exceed quantity produced (${l.qty}) for ${l.partNumber}` });
    if (l.qty === 0 && (l.defect > 0 || l.rework > 0)) errors.push({ code: 'zero_qty', field: `lines.${i}.qty`, message: `Enter the quantity produced for ${l.partNumber}` });
    if (l.qty > 0 && !Number.isInteger(l.qty)) warnings.push({ code: `qty_decimal_${i}`, field: `lines.${i}.qty`, message: `Quantity ${l.qty} for ${l.partNumber} is not a whole number` });
    lines.push({
      partNumber: l.partNumber.trim(),
      partMasterId: pm?.id ?? null,
      bore: pm?.bore ?? null,
      cycleTimeMin: pm ? Number(pm.cycle_time_min) : null,
      qty: l.qty,
      defect: l.defect,
      rework: l.rework,
      hold: l.hold,
      settingChangeoverCount: l.settingChangeoverCount,
    });
  });

  // Losses
  const known = new Set(meta.categories.map((c) => c.code));
  const losses: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.losses)) {
    if (!known.has(k)) errors.push({ code: 'loss_unknown', message: `Unknown loss category ${k}` });
    else if (v > 0) losses[k] = v;
  }
  const otherCat = meta.categories.filter((c) => c.requires_reason);
  for (const c of otherCat)
    if ((losses[c.code] || 0) > 0 && !(input.otherLossReason && input.otherLossReason.trim().length >= 5))
      errors.push({ code: 'other_reason', field: 'otherLossReason', message: `"${c.name}" needs the reason written in detail (at least 5 characters)` });

  if (!lines.length && !Object.keys(losses).length)
    errors.push({ code: 'empty', field: 'lines', message: 'Add at least one part with quantity, or the loss minutes for this shift' });

  // Overrides (Excel sometimes had planned / operating time typed in)
  if (input.plannedTimeOverride != null && !(input.plannedOverrideReason && input.plannedOverrideReason.length >= 3))
    errors.push({ code: 'planned_reason', field: 'plannedOverrideReason', message: 'Give a reason for changing the planned time (e.g. half shift)' });
  if (input.operatingTimeOverride != null) {
    if (!can(user.role, 'entry.override_times')) errors.push({ code: 'override_perm', field: 'operatingTimeOverride', message: 'Only a supervisor or administrator can type in operating time' });
    if (!(input.operatingOverrideReason && input.operatingOverrideReason.length >= 3))
      errors.push({ code: 'operating_reason', field: 'operatingOverrideReason', message: 'Give a reason for typing in the operating time' });
  }

  // Shift-level plausibility (whole block = this record + other records for same machine/shift)
  let preview = null as null | ReturnType<typeof computeMetrics> & { plannedTime: number; totalLosses: number; operatingTime: number; qty: number };
  if (machine && shift) {
    const siblings = await siblingEntries(input.prodDate, input.shiftId, input.machineId, excludeId);
    const mine = {
      prodDate: input.prodDate,
      shiftId: input.shiftId,
      machineId: input.machineId,
      plannedTimeOverride: input.plannedTimeOverride ?? null,
      operatingTimeOverride: input.operatingTimeOverride ?? null,
      lines: lines.map((l) => ({ qty: l.qty, defect: l.defect, cycleTimeMin: l.cycleTimeMin })),
      losses,
    };
    const [block] = buildBlocks([...siblings.calc, mine], meta.categories, { [shift.id]: Number(shift.planned_minutes) });
    const m = computeMetrics(block);
    preview = { ...m, plannedTime: block.plannedTime, totalLosses: block.totalLosses, operatingTime: block.operatingTime, qty: block.qty };
    const shiftTotal = Number(shift.total_minutes);
    const pct = Number(meta.settings.high_downtime_pct ?? 60) / 100;
    const ref = block.plannedTime || Number(shift.planned_minutes);
    if (block.totalLosses > shiftTotal) errors.push({ code: 'loss_gt_shift', field: 'losses', message: `Total losses for ${machine.name} in ${shift.name} would be ${block.totalLosses} min — more than the whole shift (${shiftTotal} min)` });
    else if (block.totalLosses > ref * pct)
      warnings.push({ code: 'high_downtime', field: 'losses', message: `Unusually high downtime: ${block.totalLosses} min of ${ref} min planned (${Math.round((block.totalLosses / ref) * 100)}%)` });
    if (block.plannedTime > 0 && block.totalLosses + block.operatingTime > block.plannedTime * 1.1)
      warnings.push({ code: 'over_time', field: 'lines', message: `Operating time ${block.operatingTime.toFixed(0)} min + losses ${block.totalLosses} min exceed planned time ${block.plannedTime} min — check quantities and losses` });
    if (siblings.list.length)
      warnings.push({ code: 'duplicate', message: `${siblings.list.length} record(s) already exist for ${machine.name}, ${shift.name}, ${input.prodDate}` });
    return { meta, machine, shift, errors, warnings, lines, losses, preview, duplicates: siblings.list };
  }
  return { meta, machine, shift, errors, warnings, lines, losses, preview, duplicates: [] as SiblingSummary[] };
}

export interface SiblingSummary {
  id: string;
  entry_no: number;
  created_by_name: string | null;
  created_at: string;
  parts: string | null;
  qty: number;
  losses: number;
  status: string;
}

async function siblingEntries(date: string, shiftId: number, machineId: number, excludeId?: string) {
  const list = await query<SiblingSummary>(
    `SELECT e.id, e.entry_no, u.full_name AS created_by_name, e.created_at, e.status,
       (SELECT string_agg(part_number, ', ' ORDER BY line_no) FROM entry_lines WHERE entry_id = e.id) AS parts,
       COALESCE((SELECT sum(qty) FROM entry_lines WHERE entry_id = e.id), 0) AS qty,
       COALESCE((SELECT sum(minutes) FROM entry_losses WHERE entry_id = e.id), 0) AS losses
     FROM production_entries e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.deleted_at IS NULL AND e.prod_date = $1 AND e.shift_id = $2 AND e.machine_id = $3 AND ($4::uuid IS NULL OR e.id <> $4::uuid)
     ORDER BY e.created_at`,
    [date, shiftId, machineId, excludeId ?? null],
  );
  const calc = list.length
    ? (
        await query<{ planned_time_override: number | null; operating_time_override: number | null; lines: { qty: number; defect: number; ct: number | null }[] | null; losses: Record<string, number> | null }>(
          `SELECT e.planned_time_override, e.operating_time_override,
             (SELECT json_agg(json_build_object('qty', qty, 'defect', defect, 'ct', cycle_time_min)) FROM entry_lines WHERE entry_id = e.id) AS lines,
             (SELECT json_object_agg(category_code, minutes) FROM entry_losses WHERE entry_id = e.id) AS losses
           FROM production_entries e WHERE e.id = ANY($1)`,
          [list.map((l) => l.id)],
        )
      ).map((r) => ({
        prodDate: date,
        shiftId,
        machineId,
        plannedTimeOverride: r.planned_time_override,
        operatingTimeOverride: r.operating_time_override,
        lines: (r.lines || []).map((l) => ({ qty: Number(l.qty), defect: Number(l.defect), cycleTimeMin: l.ct == null ? null : Number(l.ct) })),
        losses: Object.fromEntries(Object.entries(r.losses || {}).map(([k, v]) => [k, Number(v)])),
      }))
    : [];
  return { list, calc };
}

/** Throws 422 for errors, 409 for warnings that the user has not acknowledged yet. */
function enforce(v: Awaited<ReturnType<typeof validateEntry>>, acknowledge: string[]) {
  if (v.errors.length) throw new HttpError(422, v.errors[0].message, { errors: v.errors, warnings: v.warnings, preview: v.preview });
  const pending = v.warnings.filter((w) => !acknowledge.includes(w.code) && !acknowledge.includes('*'));
  if (pending.length) throw new HttpError(409, 'Please review the warnings before saving', { warnings: v.warnings, pending, duplicates: v.duplicates, preview: v.preview });
}

async function writeChildren(c: PoolClient, id: string, v: Awaited<ReturnType<typeof validateEntry>>) {
  await c.query('DELETE FROM entry_lines WHERE entry_id = $1', [id]);
  await c.query('DELETE FROM entry_losses WHERE entry_id = $1', [id]);
  let n = 1;
  for (const l of v.lines)
    await c.query(
      `INSERT INTO entry_lines (entry_id, line_no, part_number, part_master_id, bore, cycle_time_min, qty, defect, rework, hold, setting_changeover_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, n++, l.partNumber, l.partMasterId, l.bore, l.cycleTimeMin, l.qty, l.defect, l.rework, l.hold, l.settingChangeoverCount],
    );
  for (const [code, minutes] of Object.entries(v.losses))
    await c.query('INSERT INTO entry_losses (entry_id, category_code, minutes) VALUES ($1,$2,$3)', [id, code, minutes]);
}

export async function createEntry(input: EntryInput, user: SessionPayload, ip: string | null) {
  const v = await validateEntry(input, user);
  enforce(v, input.acknowledge);
  const photoMandatory = v.meta.settings.photo_mandatory === true;
  if (photoMandatory && !input.attachmentIds.length) throw new HttpError(422, 'A photo of the WTPM note is required (set by the administrator)', { errors: [{ code: 'photo', field: 'photo', message: 'Attach the WTPM note photo' }] });
  return tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO production_entries (prod_date, shift_id, machine_id, planned_time_override, planned_override_reason, operating_time_override, operating_override_reason,
          other_loss_reason, remarks, source, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id, entry_no`,
      [input.prodDate, input.shiftId, input.machineId, input.plannedTimeOverride ?? null, input.plannedOverrideReason || null, input.operatingTimeOverride ?? null, input.operatingOverrideReason || null, input.otherLossReason || null, input.remarks || null, input.source, user.uid],
    );
    const id = rows[0].id as string;
    await writeChildren(c, id, v);
    if (input.attachmentIds.length)
      await c.query('UPDATE attachments SET entry_id = $1 WHERE id = ANY($2) AND (entry_id IS NULL OR entry_id = $1) AND uploaded_by = $3', [id, input.attachmentIds, user.uid]);
    const snap = await snapshot(c, id);
    await audit(c, { entity: 'production_entry', entityId: id, action: 'create', userId: user.uid, newValue: snap, ip, reason: input.acknowledge.length ? `Warnings acknowledged: ${input.acknowledge.join(', ')}` : null });
    await notifyChange(c, { type: 'entry', action: 'create', id, date: input.prodDate, machineId: input.machineId });
    return { id, entryNo: rows[0].entry_no as number, warnings: v.warnings, preview: v.preview };
  });
}

export async function updateEntry(id: string, input: EntryInput, user: SessionPayload, ip: string | null) {
  const existing = await queryOne<{ id: string; created_by: number; status: string; version: number; deleted_at: string | null }>(
    'SELECT id, created_by, status, version, deleted_at FROM production_entries WHERE id = $1',
    [id],
  );
  if (!existing || existing.deleted_at) throw new HttpError(404, 'Record not found');
  assertCanEdit(existing, user);
  if (!input.editReason || input.editReason.trim().length < 3) throw new HttpError(422, 'Enter the reason for this correction', { errors: [{ code: 'edit_reason', field: 'editReason', message: 'Reason for correction is required' }] });
  if (input.version != null && input.version !== existing.version)
    throw new HttpError(409, 'This record was changed by someone else while you were editing. Reload it and apply your change again.', { conflict: true });
  const v = await validateEntry(input, user, id);
  enforce(v, [...input.acknowledge, 'duplicate']);
  return tx(async (c) => {
    const lock = await c.query('SELECT version FROM production_entries WHERE id = $1 FOR UPDATE', [id]);
    if (input.version != null && lock.rows[0].version !== input.version) throw new HttpError(409, 'This record was changed by someone else. Reload and try again.', { conflict: true });
    const before = await snapshot(c, id);
    const newStatus = existing.status === 'correction_requested' || existing.status === 'verified' ? 'submitted' : existing.status;
    await c.query(
      `UPDATE production_entries SET prod_date=$2, shift_id=$3, machine_id=$4, planned_time_override=$5, planned_override_reason=$6, operating_time_override=$7, operating_override_reason=$8,
         other_loss_reason=$9, remarks=$10, updated_by=$11, updated_at=now(), version = version + 1, status=$12, verified_by = NULL, verified_at = NULL
       WHERE id = $1`,
      [id, input.prodDate, input.shiftId, input.machineId, input.plannedTimeOverride ?? null, input.plannedOverrideReason || null, input.operatingTimeOverride ?? null, input.operatingOverrideReason || null, input.otherLossReason || null, input.remarks || null, user.uid, newStatus],
    );
    await writeChildren(c, id, v);
    if (input.attachmentIds.length) await c.query('UPDATE attachments SET entry_id = $1 WHERE id = ANY($2) AND entry_id IS NULL', [id, input.attachmentIds]);
    const after = await snapshot(c, id);
    await audit(c, { entity: 'production_entry', entityId: id, action: 'update', userId: user.uid, oldValue: before, newValue: { ...after, changes: diff(flat(before), flat(after)) }, reason: input.editReason, ip });
    await notifyChange(c, { type: 'entry', action: 'update', id, date: input.prodDate, machineId: input.machineId });
    return { id, warnings: v.warnings, preview: v.preview };
  });
}

export function assertCanEdit(e: { created_by: number; status: string }, user: SessionPayload) {
  if (can(user.role, 'entry.edit_any')) return;
  if (can(user.role, 'entry.edit_own') && e.created_by === user.uid && e.status !== 'verified') return;
  if (e.status === 'verified') throw new HttpError(403, 'This record is verified. Ask a supervisor to make the correction.');
  throw new HttpError(403, 'You can only edit records that you submitted');
}

export async function setStatus(id: string, status: 'verified' | 'correction_requested', note: string | null, user: SessionPayload, ip: string | null) {
  return tx(async (c) => {
    const r = await c.query('SELECT status FROM production_entries WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Record not found');
    if (status === 'correction_requested' && !(note && note.trim().length >= 3)) throw new HttpError(422, 'Describe what needs to be corrected');
    await c.query(
      `UPDATE production_entries SET status = $2, correction_note = $3, verified_by = CASE WHEN $2 = 'verified' THEN $4::int END, verified_at = CASE WHEN $2 = 'verified' THEN now() END WHERE id = $1`,
      [id, status, status === 'correction_requested' ? note : null, user.uid],
    );
    await audit(c, { entity: 'production_entry', entityId: id, action: status === 'verified' ? 'verify' : 'request_correction', userId: user.uid, oldValue: { status: r.rows[0].status }, newValue: { status }, reason: note, ip });
    await notifyChange(c, { type: 'entry', action: status, id });
  });
}

export async function deleteEntry(id: string, reason: string, user: SessionPayload, ip: string | null) {
  if (!reason || reason.trim().length < 3) throw new HttpError(422, 'Enter the reason for deleting this record');
  return tx(async (c) => {
    const before = await snapshot(c, id);
    if (!before) throw new HttpError(404, 'Record not found');
    await c.query('UPDATE production_entries SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [id, user.uid]);
    await audit(c, { entity: 'production_entry', entityId: id, action: 'delete', userId: user.uid, oldValue: before, reason, ip });
    await notifyChange(c, { type: 'entry', action: 'delete', id });
  });
}

function flat(s: Record<string, unknown> | null): Record<string, unknown> {
  if (!s) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (['updated_at', 'version', 'updated_by_name', 'attachments'].includes(k)) continue;
    if (k === 'lines' && Array.isArray(v))
      v.forEach((l: Record<string, unknown>, i: number) => {
        for (const [lk, lv] of Object.entries(l)) if (lk !== 'id' && lk !== 'part_master_id') out[`line ${i + 1} ${lk}`] = lv;
      });
    else if (k === 'losses' && v && typeof v === 'object') for (const [lk, lv] of Object.entries(v)) out[`loss ${lk}`] = lv;
    else out[k] = v;
  }
  return out;
}

/** Full record incl. lines, losses, attachments, user names. */
export async function snapshot(c: PoolClient | null, id: string): Promise<Record<string, unknown> | null> {
  const run = async (sql: string, p: unknown[]) => (c ? (await c.query(sql, p)).rows : await query(sql, p));
  const [e] = await run(
    `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id, e.machine_id, m.name AS machine_name, m.code AS machine_code, trim(m.line) AS line, m.category,
       e.planned_time_override, e.planned_override_reason, e.operating_time_override, e.operating_override_reason, e.other_loss_reason, e.remarks,
       e.status, e.correction_note, e.source, e.version, e.created_by, cu.full_name AS created_by_name, e.created_at, e.updated_by, uu.full_name AS updated_by_name, e.updated_at,
       e.verified_by, vu.full_name AS verified_by_name, e.verified_at, e.import_ref, e.deleted_at
     FROM production_entries e JOIN machines m ON m.id = e.machine_id
     LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users uu ON uu.id = e.updated_by LEFT JOIN users vu ON vu.id = e.verified_by
     WHERE e.id = $1`,
    [id],
  );
  if (!e) return null;
  const lines = await run(
    'SELECT id, line_no, part_number, part_master_id, bore, cycle_time_min, qty, defect, rework, hold, setting_changeover_count FROM entry_lines WHERE entry_id = $1 ORDER BY line_no',
    [id],
  );
  const losses = await run('SELECT category_code, minutes FROM entry_losses WHERE entry_id = $1', [id]);
  const attachments = await run('SELECT id, kind, file_name, mime_type, size_bytes, caption, created_at FROM attachments WHERE entry_id = $1 ORDER BY created_at', [id]);
  return { ...e, lines, losses: Object.fromEntries(losses.map((l: { category_code: string; minutes: number }) => [l.category_code, Number(l.minutes)])), attachments };
}

/** Entry detail with the OEE of this record alone and of the whole shift block. */
export async function entryDetail(id: string) {
  const s = await snapshot(null, id);
  if (!s) return null;
  const meta = await loadMeta();
  const shift = meta.shifts.find((x) => x.id === s.shift_id)!;
  const lines = (s.lines as { qty: number; defect: number; cycle_time_min: number | null }[]).map((l) => ({ qty: Number(l.qty), defect: Number(l.defect), cycleTimeMin: l.cycle_time_min }));
  const me = { prodDate: s.prod_date as string, shiftId: s.shift_id as number, machineId: s.machine_id as number, plannedTimeOverride: s.planned_time_override as number | null, operatingTimeOverride: s.operating_time_override as number | null, lines, losses: s.losses as Record<string, number> };
  const sib = await siblingEntries(me.prodDate, me.shiftId, me.machineId, id);
  const sp = { [shift.id]: Number(shift.planned_minutes) };
  const [own] = buildBlocks([me], meta.categories, sp);
  const [block] = buildBlocks([...sib.calc, me], meta.categories, sp);
  return {
    entry: s,
    operatingTime: entryOperatingTime(me),
    own: { ...own, ...computeMetrics(own) },
    block: { ...block, ...computeMetrics(block) },
    siblings: sib.list,
    categories: meta.categories,
    shift,
  };
}
