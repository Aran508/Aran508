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
  const C = Object.fromEntries(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'AN', 'AP', 'AS', 'BB'].map((k) => [k, colToNum(k)]));
  const month = isoDate(ws.get(2, 2)?.v)?.slice(0, 7) ?? null;
  const last = ws.rowCount;
  const starts: number[] = [];
  for (let r = 4; r <= last; r++) if (ws.get(r, C.AN)) starts.push(r);
  const blocks: ParsedBlock[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const notes: { row: number; note: string }[] = [];
  // Planned minutes → shift, from the 'Shift Timings' sheet (445 / 460 / 370)
  const st = await wb.sheet('Shift Timings');
  const shiftByPlanned = new Map<number, number>();
  if (st) for (let r = 2; r <= 4; r++) { const sid = numOrNull(st.get(r, 1)?.v); const pm = numOrNull(st.get(r, 7)?.v); if (sid && pm) shiftByPlanned.set(pm, sid); }
  if (!shiftByPlanned.size) [[445, 1], [460, 2], [370, 3]].forEach(([a, b]) => shiftByPlanned.set(a, b));
  for (let si = 0; si < starts.length; si++) {
    const r = starts[si];
    const end = (starts[si + 1] ?? last + 1) - 1;
    // Columns E/F/G/H already carry date, shift, machine and code down in the workbook.
    // A block whose machine (G) is #N/A is ignored by every SUMIFS report, so it is skipped too.
    const carryDate = isoDate(ws.get(r, C.E)?.v) ?? '';
    let carryShift = numOr0(ws.get(r, C.F)?.v);
    const carryName = str(ws.get(r, C.G)?.v);
    const carryCode = str(ws.get(r, C.H)?.v);
    const ap = ws.get(r, C.AP);
    const as = ws.get(r, C.AS);
    // When the Shift cell (K) of a block was left blank, Excel carries the previous shift down,
    // but the typed planned time (445 / 460 / 370) shows which shift the note really was.
    const typedShift = numOrNull(ws.get(r, C.K)?.v);
    if (!typedShift && ap && !ap.f && typeof ap.v === 'number' && shiftByPlanned.has(ap.v) && shiftByPlanned.get(ap.v) !== carryShift) {
      notes.push({ row: r, note: `Shift cell blank; carried shift ${carryShift} replaced by shift ${shiftByPlanned.get(ap.v)} from typed planned time ${ap.v}` });
      carryShift = shiftByPlanned.get(ap.v)!;
    }
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
  const kept = new Set(blocks.map((b) => b.row));
  return { month, blocks, skipped, notes: notes.filter((n) => kept.has(n.row)) };
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
  // Bulk insert (few round-trips) — important when the database is far from the app server.
  type E = { ref: string; date: string; shift: number; machineId: number; pto: number | null; ptoR: string | null; oto: number | null; otoR: string | null; other: string | null; remarks: string | null; block: ParsedBlock };
  const rows: E[] = [];
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
    const otoRaw = b.as_formula != null && Number.isFinite(Number(b.as_formula)) ? Number(b.as_formula) : null;
    const oto = otoRaw != null && otoRaw >= 0 ? otoRaw : null;
    rows.push({
      ref: `${label}!row ${b.row}`, date: b.date, shift: b.shift, machineId,
      pto, ptoR: pto != null ? 'Typed value in Excel' : null, oto, otoR: oto != null ? 'Typed value in Excel' : null,
      other: b.losses.AM ? b.remarks.join('\n') || 'Imported from Excel' : null, remarks: b.remarks.join('\n') || null, block: b,
    });
  }
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const ins = await c.query(
      `INSERT INTO production_entries (prod_date, shift_id, machine_id, planned_time_override, planned_override_reason,
         operating_time_override, operating_override_reason, other_loss_reason, remarks, status, source, created_by, updated_by, import_ref)
       SELECT d, s, m, pto, ptor, oto, otor, oth, rem, 'verified', 'import', $10, $10, ref
       FROM unnest($1::date[], $2::int[], $3::int[], $4::numeric[], $5::text[], $6::numeric[], $7::text[], $8::text[], $9::text[], $11::text[])
         AS t(d, s, m, pto, ptor, oto, otor, oth, rem, ref)
       RETURNING id, import_ref`,
      [part.map((r) => r.date), part.map((r) => r.shift), part.map((r) => r.machineId), part.map((r) => r.pto), part.map((r) => r.ptoR), part.map((r) => r.oto), part.map((r) => r.otoR), part.map((r) => r.other), part.map((r) => r.remarks), opts.userId, part.map((r) => r.ref)],
    );
    const idOf = new Map((ins.rows as { id: string; import_ref: string }[]).map((r) => [r.import_ref, r.id]));
    const L = { e: [] as string[], n: [] as number[], p: [] as string[], pm: [] as (number | null)[], bore: [] as (number | null)[], ct: [] as (number | null)[], q: [] as number[], d: [] as number[], rw: [] as number[], h: [] as number[], st: [] as number[] };
    const X = { e: [] as string[], c: [] as string[], m: [] as number[] };
    for (const r of part) {
      const id = idOf.get(r.ref)!;
      r.block.lines.forEach((l, k) => {
        const pn = String(l.part ?? '').trim();
        L.e.push(id); L.n.push(k + 1); L.p.push(pn || '(blank)');
        L.pm.push(partId.get(`${r.machineId}|${pn.toUpperCase()}`) ?? null);
        L.bore.push(numOrNull(l.bore) || null); L.ct.push(numOrNull(l.ct));
        L.q.push(Math.max(0, numOr0(l.qty))); L.d.push(Math.max(0, numOr0(l.defect))); L.rw.push(Math.max(0, numOr0(l.rw)));
        L.h.push(Math.max(0, numOr0(l.hold))); L.st.push(Math.max(0, numOr0(l.setting)));
      });
      for (const [colL, minutes] of Object.entries(r.block.losses)) {
        const code = EXCEL_LOSS_COLUMNS[colL];
        if (code && minutes > 0) { X.e.push(id); X.c.push(code); X.m.push(minutes); }
      }
    }
    if (L.e.length)
      await c.query(
        `INSERT INTO entry_lines (entry_id, line_no, part_number, part_master_id, bore, cycle_time_min, qty, defect, rework, hold, setting_changeover_count)
         SELECT * FROM unnest($1::uuid[], $2::int[], $3::text[], $4::int[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[])`,
        [L.e, L.n, L.p, L.pm, L.bore, L.ct, L.q, L.d, L.rw, L.h, L.st],
      );
    if (X.e.length)
      await c.query(`INSERT INTO entry_losses (entry_id, category_code, minutes) SELECT * FROM unnest($1::uuid[], $2::text[], $3::numeric[])`, [X.e, X.c, X.m]);
    res.imported += part.length;
  }
  return res;
}

export async function upsertPartMaster(c: PoolClient, parts: ParsedPart[], userId: number | null) {
  const machines = (await c.query('SELECT id, code FROM machines')).rows as { id: number; code: string }[];
  const byCode = new Map(machines.map((m) => [m.code.toLowerCase(), m.id]));
  const unknown = new Set<string>();
  const seen = new Set<string>();
  const A = { m: [] as number[], p: [] as string[], ct: [] as number[], b: [] as (number | null)[] };
  for (const p of parts) {
    const mid = byCode.get(p.machine_code.toLowerCase());
    if (!mid) {
      unknown.add(p.machine_code);
      continue;
    }
    const key = `${mid}|${p.part_number.toUpperCase()}`;
    if (seen.has(key)) continue; // first match wins, like VLOOKUP
    seen.add(key);
    A.m.push(mid); A.p.push(p.part_number); A.ct.push(p.ct); A.b.push(p.bore);
  }
  let inserted = 0,
    updated = 0;
  for (let i = 0; i < A.m.length; i += 1000) {
    const r = await c.query(
      `INSERT INTO part_master (machine_id, part_number, cycle_time_min, bore, created_by, updated_by)
       SELECT m, p, ct, b, $5, $5 FROM unnest($1::int[], $2::text[], $3::numeric[], $4::numeric[]) AS t(m, p, ct, b)
       ON CONFLICT (machine_id, upper(part_number)) DO UPDATE SET cycle_time_min = EXCLUDED.cycle_time_min, bore = EXCLUDED.bore, updated_by = EXCLUDED.updated_by, updated_at = now()
         WHERE part_master.cycle_time_min IS DISTINCT FROM EXCLUDED.cycle_time_min OR part_master.bore IS DISTINCT FROM EXCLUDED.bore
       RETURNING (xmax = 0) AS inserted`,
      [A.m.slice(i, i + 1000), A.p.slice(i, i + 1000), A.ct.slice(i, i + 1000), A.b.slice(i, i + 1000), userId],
    );
    for (const row of r.rows) (row.inserted ? inserted++ : updated++);
  }
  return { inserted, updated, unknownMachines: [...unknown] };
}
