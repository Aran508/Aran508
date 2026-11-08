/**
 * Import of the existing Excel workbooks into the central database.
 *
 *  - 'Cycletime and Bore'  → part_master  (Part Number & Machine Code → CT, Bore)
 *  - 'Machine List'        → machines
 *  - 'OEE data 1'          → production_entries (one record per Excel block = machine/date/shift)
 *
 * A block in 'OEE data 1' starts on the row that holds the AN (Total Qty Produced) formula and
 * runs until the next block. Typed-in Planned Time (AP) or Operating Time (AS) values are kept
 * as overrides so the imported month reproduces the workbook's own totals.
 */
import type { PoolClient } from 'pg';
import { EXCEL_LOSS_COLUMNS } from './loss-columns';
import { XlsxLite, colToNum, type Grid } from './xlsx-lite';

export interface ParsedLine {
  part: string;
  qty: number;
  defect: number;
  rw: number;
  hold: number;
  setting: number;
  ct: number | null;
  bore: number | null;
}
export interface ParsedBlock {
  row: number;
  date: string;
  shift: number;
  code: string;
  machine: string;
  lines: ParsedLine[];
  losses: Record<string, number>; // keyed by Excel column letter R..AM
  remarks: string[];
  ap_formula: string | null; // numeric string when Planned Time was typed in
  as_formula: string | null; // numeric string when Operating Time was typed in
}
export interface ParsedPart {
  machine_code: string;
  part_number: string;
  ct: number;
  bore: number | null;
}

const LOSS_COLS = Object.keys(EXCEL_LOSS_COLUMNS);
const numOr0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isoDate = (v: unknown): string | null =>
  typeof v === 'number' && v > 20000 ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : null;
const str = (v: unknown) => (v == null ? '' : String(v).trim());

export const loadWorkbook = (buf: ArrayBuffer | Buffer | Uint8Array) => XlsxLite.open(buf);

export async function parseMachineList(wb: XlsxLite) {
  const ws = await wb.sheet('Machine List');
  const out: { sno: number; code: string; name: string }[] = [];
  if (!ws) return out;
  for (let r = 2; r <= ws.rowCount; r++) {
    const code = str(ws.get(r, 2)?.v);
    const name = str(ws.get(r, 3)?.v);
    if (code && name) out.push({ sno: numOr0(ws.get(r, 1)?.v) || out.length + 1, code, name });
  }
  return out;
}

export async function parsePartMaster(wb: XlsxLite): Promise<{ parts: ParsedPart[]; duplicates: number }> {
  const ws = await wb.sheet('Cycletime and Bore');
  if (!ws) return { parts: [], duplicates: 0 };
  const seen = new Map<string, ParsedPart>();
  let duplicates = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const code = str(ws.get(r, 2)?.v);
    const part = str(ws.get(r, 3)?.v);
    const ct = numOrNull(ws.get(r, 4)?.v);
    const bore = numOrNull(ws.get(r, 5)?.v);
    if (!code || !part || ct == null) continue;
    const key = `${part.toUpperCase()}|${code.toLowerCase()}`; // VLOOKUP key = Part & Code, first match wins
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.set(key, { machine_code: code, part_number: part, ct, bore: bore && bore !== 0 ? bore : null });
  }
  return { parts: [...seen.values()], duplicates };
}

/** Parse 'OEE data 1' into blocks (works for any month's OEE MAIN SHEET). */
export async function parseOeeData(wb: XlsxLite, sheetName = 'OEE data 1') {
  const ws: Grid | null = await wb.sheet(sheetName);
  if (!ws) throw new Error(`Sheet '${sheetName}' was not found in the workbook`);
  const C = Object.fromEntries(['E', 'F', 'G', 'H', 'I', 'J', 'L', 'M', 'N', 'O', 'P', 'Q', 'AN', 'AP', 'AS', 'BB'].map((k) => [k, colToNum(k)]));
  const month = isoDate(ws.get(2, 2)?.v)?.slice(0, 7) ?? null;
  const last = ws.rowCount;
  const starts: number[] = [];
  for (let r = 4; r <= last; r++) if (ws.get(r, C.AN)) starts.push(r);
  const blocks: ParsedBlock[] = [];
  const skipped: { row: number; reason: string }[] = [];
  for (let si = 0; si < starts.length; si++) {
    const r = starts[si];
    const end = (starts[si + 1] ?? last + 1) - 1;
    // Columns E/F/G/H already carry date, shift, machine and code down in the workbook.
    // A block whose machine (G) is #N/A is ignored by every SUMIFS report, so it is skipped too.
    const carryDate = isoDate(ws.get(r, C.E)?.v) ?? '';
    const carryShift = numOr0(ws.get(r, C.F)?.v);
    const carryName = str(ws.get(r, C.G)?.v);
    const carryCode = str(ws.get(r, C.H)?.v);
    const ap = ws.get(r, C.AP);
    const as = ws.get(r, C.AS);
    const block: ParsedBlock = {
      row: r,
      date: carryDate,
      shift: carryShift,
      code: carryCode,
      machine: carryName,
      lines: [],
      losses: {},
      remarks: [],
      ap_formula: ap && !ap.f && typeof ap.v === 'number' ? String(ap.v) : null,
      as_formula: as && !as.f && typeof as.v === 'number' ? String(as.v) : null,
    };
    for (let rr = r; rr <= end; rr++) {
      const part = str(ws.get(rr, C.L)?.v);
      const qty = numOr0(ws.get(rr, C.M)?.v);
      if (part || qty) {
        block.lines.push({
          part,
          qty,
          defect: numOr0(ws.get(rr, C.N)?.v),
          rw: numOr0(ws.get(rr, C.O)?.v),
          hold: numOr0(ws.get(rr, C.P)?.v),
          setting: numOr0(ws.get(rr, C.Q)?.v),
          ct: numOrNull(ws.get(rr, C.J)?.v),
          bore: numOrNull(ws.get(rr, C.I)?.v),
        });
      }
      for (const L of LOSS_COLS) {
        const v = numOr0(ws.get(rr, colToNum(L))?.v);
        if (v) block.losses[L] = (block.losses[L] || 0) + v;
      }
      const rem = str(ws.get(rr, C.BB)?.v);
      if (rem && !ws.get(rr, C.BB)?.f) block.remarks.push(rem);
    }
    const hasData = block.lines.length || Object.keys(block.losses).length || block.ap_formula || block.as_formula;
    if (!hasData) continue;
    if (!carryName || carryName.startsWith('#') || !block.date || !block.shift) {
      skipped.push({ row: r, reason: `machine/date/shift not resolved in Excel (${carryName || 'blank'})` });
      continue;
    }
    blocks.push(block);
  }
  return { month, blocks, skipped };
}

export interface ImportResult {
  imported: number;
  skipped: { row: number; reason: string }[];
  replaced: number;
}

/** Insert parsed blocks as production records (source = 'import'). */
export async function importBlocks(
  c: PoolClient,
  blocks: ParsedBlock[],
  opts: { userId: number | null; replaceExistingImport?: boolean; label?: string },
): Promise<ImportResult> {
  const machines = (await c.query('SELECT id, code, name FROM machines')).rows as { id: number; code: string; name: string }[];
  const byCode = new Map(machines.map((m) => [m.code.toLowerCase(), m.id]));
  const byName = new Map(machines.map((m) => [m.name.trim().toLowerCase().replace(/\s+/g, ' '), m.id]));
  const parts = (await c.query('SELECT id, machine_id, upper(part_number) AS p FROM part_master')).rows as { id: number; machine_id: number; p: string }[];
  const partId = new Map(parts.map((p) => [`${p.machine_id}|${p.p}`, p.id]));
  const res: ImportResult = { imported: 0, skipped: [], replaced: 0 };
  const label = opts.label ?? 'OEE data 1';
  if (opts.replaceExistingImport && blocks.length) {
    const dates = blocks.map((b) => b.date).sort();
    const r = await c.query(
      `UPDATE production_entries SET deleted_at = now(), deleted_by = $3 WHERE source = 'import' AND deleted_at IS NULL AND prod_date BETWEEN $1 AND $2`,
      [dates[0], dates[dates.length - 1], opts.userId],
    );
    res.replaced = r.rowCount ?? 0;
  }
  for (const b of blocks) {
    const machineId = byCode.get(b.code.toLowerCase()) ?? byName.get(b.machine.toLowerCase().replace(/\s+/g, ' '));
    if (!machineId) {
      res.skipped.push({ row: b.row, reason: `Unknown machine code '${b.code}'` });
      continue;
    }
    if (![1, 2, 3].includes(b.shift)) {
      res.skipped.push({ row: b.row, reason: `Invalid shift '${b.shift}'` });
      continue;
    }
    const pto = b.ap_formula != null && Number.isFinite(Number(b.ap_formula)) ? Number(b.ap_formula) : null;
    const oto = b.as_formula != null && Number.isFinite(Number(b.as_formula)) ? Number(b.as_formula) : null;
    const other = b.losses.AM ? b.remarks.join('\n') || 'Imported from Excel' : null;
    const { rows } = await c.query(
      `INSERT INTO production_entries (prod_date, shift_id, machine_id, planned_time_override, planned_override_reason,
         operating_time_override, operating_override_reason, other_loss_reason, remarks, status, source, created_by, updated_by, import_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified','import',$10,$10,$11) RETURNING id`,
      [
        b.date, b.shift, machineId,
        pto, pto != null ? 'Typed value in Excel' : null,
        oto != null && oto >= 0 ? oto : null, oto != null ? 'Typed value in Excel' : null,
        other, b.remarks.join('\n') || null, opts.userId, `${label}!row ${b.row}`,
      ],
    );
    const id = rows[0].id;
    let n = 1;
    for (const l of b.lines) {
      await c.query(
        `INSERT INTO entry_lines (entry_id, line_no, part_number, part_master_id, bore, cycle_time_min, qty, defect, rework, hold, setting_changeover_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, n++, String(l.part ?? '').trim() || '(blank)', partId.get(`${machineId}|${String(l.part ?? '').toUpperCase()}`) ?? null, numOrNull(l.bore) || null, numOrNull(l.ct), Math.max(0, numOr0(l.qty)), Math.max(0, numOr0(l.defect)), Math.max(0, numOr0(l.rw)), Math.max(0, numOr0(l.hold)), Math.max(0, numOr0(l.setting))],
      );
    }
    for (const [colL, minutes] of Object.entries(b.losses)) {
      const code = EXCEL_LOSS_COLUMNS[colL];
      if (code && minutes > 0) await c.query('INSERT INTO entry_losses (entry_id, category_code, minutes) VALUES ($1,$2,$3)', [id, code, minutes]);
    }
    res.imported++;
  }
  return res;
}

export async function upsertPartMaster(c: PoolClient, parts: ParsedPart[], userId: number | null) {
  const machines = (await c.query('SELECT id, code FROM machines')).rows as { id: number; code: string }[];
  const byCode = new Map(machines.map((m) => [m.code.toLowerCase(), m.id]));
  let inserted = 0,
    updated = 0;
  const unknown = new Set<string>();
  for (const p of parts) {
    const mid = byCode.get(p.machine_code.toLowerCase());
    if (!mid) {
      unknown.add(p.machine_code);
      continue;
    }
    const r = await c.query(
      `INSERT INTO part_master (machine_id, part_number, cycle_time_min, bore, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (machine_id, upper(part_number)) DO UPDATE SET cycle_time_min = EXCLUDED.cycle_time_min, bore = EXCLUDED.bore, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [mid, p.part_number, p.ct, p.bore, userId],
    );
    if (r.rows[0].inserted) inserted++;
    else updated++;
  }
  return { inserted, updated, unknownMachines: [...unknown] };
}
