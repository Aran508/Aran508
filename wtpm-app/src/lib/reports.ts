/**
 * Server-side report builder. Reads production records from PostgreSQL, turns them into
 * Excel blocks with the OEE engine, and lays them out like the workbook's report sheets.
 * The dashboard, all report pages and all exports call these functions — one source of truth.
 */
import { query } from './db';
import {
  buildBlocks,
  groupSummaries,
  summarize,
  averageOf,
  lossGroupTotals,
  oeeBand,
  type BlockResult,
  type EntryCalcInput,
  type LossCategoryDef,
  type Summary,
} from './oee';

export interface MachineRow {
  id: number;
  code: string;
  name: string;
  line: string;
  category: string;
  sort_order: number;
  active: boolean;
}
export interface ShiftRow {
  id: number;
  name: string;
  timings: string;
  total_minutes: number;
  lunch_minutes: number;
  tea_minutes: number;
  tpm_minutes: number;
  planned_minutes: number;
}
export interface Meta {
  machines: MachineRow[];
  shifts: ShiftRow[];
  categories: LossCategoryDef[];
  settings: Record<string, unknown>;
}

export async function loadMeta(): Promise<Meta> {
  const [machines, shifts, categories, settings] = await Promise.all([
    query<MachineRow>('SELECT id, code, name, line, category, sort_order, active FROM machines ORDER BY sort_order, id'),
    query<ShiftRow>('SELECT id, name, timings, total_minutes, lunch_minutes, tea_minutes, tpm_minutes, planned_minutes FROM shifts ORDER BY id'),
    query<LossCategoryDef>('SELECT * FROM loss_categories ORDER BY sort_order'),
    query<{ key: string; value: unknown }>('SELECT key, value FROM settings'),
  ]);
  return { machines, shifts, categories, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) };
}

export interface Filter {
  from: string;
  to: string;
  machineIds?: number[];
  shiftId?: number | null;
  line?: string | null;
}

export async function loadEntries(f: Filter): Promise<EntryCalcInput[]> {
  const params: unknown[] = [f.from, f.to];
  let where = 'e.deleted_at IS NULL AND e.prod_date BETWEEN $1 AND $2';
  if (f.machineIds?.length) {
    params.push(f.machineIds);
    where += ` AND e.machine_id = ANY($${params.length})`;
  }
  if (f.shiftId) {
    params.push(f.shiftId);
    where += ` AND e.shift_id = $${params.length}`;
  }
  if (f.line) {
    params.push(f.line.trim());
    where += ` AND e.machine_id IN (SELECT id FROM machines WHERE trim(line) = $${params.length})`;
  }
  const rows = await query<{
    prod_date: string;
    shift_id: number;
    machine_id: number;
    planned_time_override: number | null;
    operating_time_override: number | null;
    lines: { qty: number; defect: number; ct: number | null }[] | null;
    losses: Record<string, number> | null;
  }>(
    `SELECT e.prod_date, e.shift_id, e.machine_id, e.planned_time_override, e.operating_time_override,
       (SELECT json_agg(json_build_object('qty', l.qty, 'defect', l.defect, 'ct', l.cycle_time_min) ORDER BY l.line_no) FROM entry_lines l WHERE l.entry_id = e.id) AS lines,
       (SELECT json_object_agg(x.category_code, x.minutes) FROM entry_losses x WHERE x.entry_id = e.id) AS losses
     FROM production_entries e WHERE ${where}`,
    params,
  );
  return rows.map((r) => ({
    prodDate: r.prod_date,
    shiftId: r.shift_id,
    machineId: r.machine_id,
    plannedTimeOverride: r.planned_time_override,
    operatingTimeOverride: r.operating_time_override,
    lines: (r.lines || []).map((l) => ({ qty: Number(l.qty), defect: Number(l.defect), cycleTimeMin: l.ct == null ? null : Number(l.ct) })),
    losses: Object.fromEntries(Object.entries(r.losses || {}).map(([k, v]) => [k, Number(v)])),
  }));
}

export async function loadBlocks(f: Filter, meta?: Meta) {
  const m = meta ?? (await loadMeta());
  const entries = await loadEntries(f);
  const shiftPlanned = Object.fromEntries(m.shifts.map((s) => [s.id, Number(s.planned_minutes)]));
  return { meta: m, blocks: buildBlocks(entries, m.categories, shiftPlanned) };
}

export function monthRange(month: string) {
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, days: last };
}

export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}'${String(y).slice(2)}`;
};

export interface MachineSummaryRow extends Summary {
  sno: number;
  machineId: number;
  code: string;
  machine: string;
  line: string;
  category: string;
  hasData: boolean;
  rank: number | null;
  band: ReturnType<typeof oeeBand>;
}

/** ' OEE Overall Summary 1' / 'Weekly Report -data 1' layout: one row per machine of the Machine List. */
export function machineSummary(blocks: BlockResult[], meta: Meta, opts: { includeInactive?: boolean; machineIds?: number[]; line?: string | null } = {}) {
  const per = groupSummaries(blocks, (b) => b.machineId);
  const bands = (meta.settings.oee_bands as { low: number; high: number }) ?? { low: 0.6, high: 0.8 };
  let machines = meta.machines.filter((m) => opts.includeInactive || m.active || per.has(m.id));
  if (opts.machineIds?.length) machines = machines.filter((m) => opts.machineIds!.includes(m.id));
  if (opts.line) machines = machines.filter((m) => m.line.trim() === opts.line!.trim());
  const rows: MachineSummaryRow[] = machines.map((m, i) => {
    const s = per.get(m.id) ?? summarize([]);
    return {
      ...s,
      sno: i + 1,
      machineId: m.id,
      code: m.code,
      machine: m.name,
      line: m.line.trim(),
      category: m.category,
      hasData: s.blocks > 0 && s.plannedTime + s.qty + s.totalLosses > 0,
      rank: null,
      band: oeeBand(s.OEE, bands.low, bands.high),
    };
  });
  // 'OEE Ranking' = RANK(%OEE4) descending among machines with an OEE value
  const ranked = rows.filter((r) => r.OEE != null).sort((a, b) => (b.OEE as number) - (a.OEE as number));
  ranked.forEach((r, i) => (r.rank = i + 1));
  const overall = summarize(rows.filter((r) => r.hasData).map((r) => r));
  const fm = summarize(rows.filter((r) => r.category === 'FM'));
  const withData = rows.filter((r) => r.hasData);
  const plantAverage = {
    A: averageOf(withData.map((r) => r.A)),
    P: averageOf(withData.map((r) => r.P)),
    Q: averageOf(withData.map((r) => r.Q)),
    OEE: averageOf(withData.map((r) => r.OEE)),
    woA: averageOf(withData.map((r) => r.woA)),
    woP: averageOf(withData.map((r) => r.woP)),
    woOEE: averageOf(withData.map((r) => r.woOEE)),
  };
  return { rows, overall, fm, plantAverage, ranking: ranked.map((r) => ({ rank: r.rank!, machine: r.machine, line: r.line, OEE: r.OEE, band: r.band })) };
}

export function lineSummary(blocks: BlockResult[], meta: Meta) {
  const lineOf = new Map(meta.machines.map((m) => [m.id, m.line.trim() || '—']));
  const per = groupSummaries(blocks, (b) => lineOf.get(b.machineId) ?? '—');
  return [...per.entries()].map(([line, s]) => ({ line, ...s })).sort((a, b) => a.line.localeCompare(b.line));
}

export function shiftSummary(blocks: BlockResult[], meta: Meta) {
  const per = groupSummaries(blocks, (b) => b.shiftId);
  return meta.shifts.map((s) => ({ shiftId: s.id, shift: s.name, timings: s.timings, ...(per.get(s.id) ?? summarize([])) }));
}

/** 'Daily Report' sheet: one row per calendar date of the month. */
export function dailySeries(blocks: BlockResult[], from: string, to: string) {
  const per = groupSummaries(blocks, (b) => b.prodDate);
  const out: (Summary & { date: string })[] = [];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, ...(per.get(iso) ?? summarize([])) });
  }
  return out;
}

/** 'Weekly report graph': per machine, per week of month (CEILING(DAY/7)). */
export function weeklyMatrix(blocks: BlockResult[], meta: Meta) {
  const weeks = [1, 2, 3, 4, 5].filter((w) => blocks.some((b) => b.week === w) || w <= 4);
  const machines = meta.machines.filter((m) => blocks.some((b) => b.machineId === m.id));
  return {
    weeks,
    rows: machines.map((m) => {
      const mine = blocks.filter((b) => b.machineId === m.id);
      const byWeek = groupSummaries(mine, (b) => b.week);
      return {
        machineId: m.id,
        machine: m.name,
        line: m.line.trim(),
        weeks: weeks.map((w) => {
          const s = byWeek.get(w);
          return { week: w, OEE: s?.OEE ?? null, A: s?.A ?? null, P: s?.P ?? null, Q: s?.Q ?? null, lossesNotCaptured: s?.lossesNotCaptured ?? 0, qty: s?.qty ?? 0 };
        }),
      };
    }),
  };
}

/** 'MIS loss report' / 'Weekly Loss Report1-data' / 'Loss Report': minutes per machine per loss category. */
export function lossMatrix(blocks: BlockResult[], meta: Meta, rows: MachineSummaryRow[]) {
  const out = rows.map((r) => {
    const mine = blocks.filter((b) => b.machineId === r.machineId);
    const losses: Record<string, number> = {};
    for (const b of mine) for (const [k, v] of Object.entries(b.losses)) losses[k] = (losses[k] || 0) + v;
    const partChanges = mine.map((b) => b.losses.part_change || 0).filter((v) => v > 0);
    return {
      sno: r.sno,
      machineId: r.machineId,
      machine: r.machine,
      line: r.line,
      category: r.category,
      rank: r.rank,
      losses,
      groups: lossGroupTotals(losses, meta.categories),
      totalLosses: r.totalLosses,
      lossesNotCaptured: r.lossesNotCaptured,
      plannedTime: r.plannedTime,
      operatingTime: r.operatingTime,
      minPartChange: partChanges.length ? Math.min(...partChanges) : null,
      maxPartChange: partChanges.length ? Math.max(...partChanges) : null,
      hasData: r.hasData,
    };
  });
  const totals: Record<string, number> = {};
  for (const r of out) for (const [k, v] of Object.entries(r.losses)) totals[k] = (totals[k] || 0) + v;
  return { rows: out, totals, groups: lossGroupTotals(totals, meta.categories) };
}

export function paretoOf(totals: Record<string, number>, meta: Meta) {
  const items = meta.categories
    .map((c) => ({ code: c.code, name: c.name, group: c.oee_group, isManagement: c.is_management, minutes: totals[c.code] || 0 }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const sum = items.reduce((s, x) => s + x.minutes, 0);
  let cum = 0;
  return items.map((x) => ({ ...x, hours: x.minutes / 60, share: sum ? x.minutes / sum : 0, cumulative: sum ? (cum += x.minutes) / sum : 0 }));
}

/** Full month package used by the monthly report page and the Excel/PDF exports. */
export async function monthlyReport(month: string, f: { machineIds?: number[]; line?: string | null; shiftId?: number | null } = {}) {
  const { from, to } = monthRange(month);
  const { meta, blocks } = await loadBlocks({ from, to, ...f });
  const summary = machineSummary(blocks, meta, { machineIds: f.machineIds, line: f.line });
  const loss = lossMatrix(blocks, meta, summary.rows);
  const weeks = [1, 2, 3, 4, 5].map((w) => {
    const wb = blocks.filter((b) => b.week === w);
    return { week: w, summary: machineSummary(wb, meta, { machineIds: f.machineIds, line: f.line }), loss: null as unknown, blocks: wb.length };
  });
  for (const w of weeks) w.loss = lossMatrix(blocks.filter((b) => b.week === w.week), meta, w.summary.rows);
  return {
    month,
    label: monthLabel(month),
    from,
    to,
    meta,
    summary,
    revisedPlant: summarize(blocks),
    daily: dailySeries(blocks, from, to),
    weekly: weeks,
    weeklyMatrix: weeklyMatrix(blocks, meta),
    loss,
    pareto: paretoOf(loss.totals, meta),
    lines: lineSummary(blocks, meta),
    shifts: shiftSummary(blocks, meta),
    blockCount: blocks.length,
    entryCount: blocks.reduce((s, b) => s + b.entries, 0),
  };
}
export type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>;
