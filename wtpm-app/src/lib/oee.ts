/**
 * Central OEE calculation engine.
 *
 * Every number shown anywhere in the application (dashboard, records, daily / weekly /
 * monthly reports, loss analysis, Excel and PDF exports) is produced by the functions in
 * this file. Nothing else calculates OEE.
 *
 * The logic is a direct port of the formulas in "2.OEE MAIN SHEET" (sheet 'OEE data 1'
 * and the report sheets built on it). All times are minutes.
 *
 *  Block (= one machine, one date, one shift; Excel rows grouped by the AN..BS formulas)
 *    AN Total Qty Produced   = SUM(Qty Produced)
 *    AO Defect               = SUM(Defect)
 *    AP Planned Time         = IF(AN>0, 'Shift Timings'!G(shift), 0)   (or a typed-in value)
 *    AQ Total Losses         = SUM(R:AM)            all 22 loss columns
 *    AR Management Losses    = SUM(AA:AJ)           No Power … TPM & Cleaning
 *    AS Operating Time       = SUMPRODUCT(Qty, CT)  (or a typed-in value)
 *    Without mgmt loss: %A = (AP-AQ)/(AP-AR)   %P = AS/(AP-AQ)   %Q = (AN-AO)/AN
 *    With mgmt loss:    %A = (AP-AQ)/AP        %P = AS/(AP-AQ)   %Q = (AN-AO)/AN
 *    %OEE = %A × %P × %Q
 *    BC = Z+AB+AE+AF+AI+AJ ; BF = AP-BC ; BH = (BF-AQ)/BF ; BI = AS/(BF-AQ) ; BL = BF-AQ-AS
 *    BN = BF-0.85×BL ; BP = (BN-AQ)/BN ; BQ = AS/(BN-AQ)
 *
 *  Reports ('OEE Overall Summary 1', 'Weekly Report -data 1', 'Daily Report' …) SUMIFS the
 *  block columns AN..AS and then re-apply the same percentage formulas on the sums.
 *  "Losses not captured" = Planned Time - Total Losses - Operating Time (summary sheets),
 *  and (Planned - Losses) × 0.85 - Operating Time on the 'Daily Report' sheet.
 *  The dashboard plant KPIs are SUBTOTAL(101, …) = simple average of the machine rows.
 */

export type LossMap = Record<string, number>;

export interface LossCategoryDef {
  code: string;
  name: string;
  excel_column: string;
  oee_group: 'A' | 'P' | 'Q' | 'M';
  section: 'process' | 'management';
  is_management: boolean;
  is_revised_excl: boolean;
  requires_reason: boolean;
  is_common: boolean;
  sort_order: number;
}

export interface LineCalcInput {
  qty: number;
  defect: number;
  cycleTimeMin: number | null | undefined;
}

export interface EntryCalcInput {
  prodDate: string; // YYYY-MM-DD
  shiftId: number;
  machineId: number;
  plannedTimeOverride?: number | null;
  operatingTimeOverride?: number | null;
  lines: LineCalcInput[];
  losses: LossMap;
}

/** Summable totals (Excel columns AN..AS + BC). */
export interface Totals {
  qty: number; // AN
  defect: number; // AO
  plannedTime: number; // AP
  totalLosses: number; // AQ
  managementLosses: number; // AR
  operatingTime: number; // AS
  revisedExcl: number; // BC
  losses: LossMap; // per category minutes (R..AM)
  blocks: number;
  entries: number;
}

export interface Metrics {
  /** Without management loss (Excel 'w/o mgmt Loss' columns L..O). */
  woA: number | null;
  woP: number | null;
  woQ: number | null;
  woOEE: number | null;
  /** With management loss (Excel 'with mgmt Loss' columns P..S) — used by the dashboard. */
  A: number | null;
  P: number | null;
  Q: number | null;
  OEE: number | null;
  /** Planned - Total Losses - Operating Time (summary sheets col T). */
  lossesNotCaptured: number;
  /** (Planned - Total Losses) × 0.85 - Operating Time ('Daily Report' col H). */
  dailyLossesNotCaptured: number;
  /** Revised method, Excel BF..BS. */
  revised: {
    plannedRevised: number; // BF
    A: number | null; // BH
    P: number | null; // BI
    Q: number | null; // BJ
    OEE: number | null; // BK
    lossNotCaptured: number; // BL
    plannedRevised2: number; // BN
    A2: number | null; // BP
    P2: number | null; // BQ
    OEE2: number | null; // BS
  };
}

export type Summary = Totals & Metrics;

export const LNC_FACTOR = 0.85;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : v == null || v === '' ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Excel IFERROR(x/y, "") → null when the division is invalid. */
export function div(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}
const mul = (...xs: (number | null)[]): number | null =>
  xs.some((x) => x == null) ? null : xs.reduce<number>((p, x) => p * (x as number), 1);

/** Excel: D = CEILING(DAY(date)/7, 1)  → week 1..5 inside the month. */
export function weekOfMonth(isoDate: string): number {
  const day = Number(isoDate.slice(8, 10));
  return Math.ceil(day / 7);
}

export function emptyTotals(): Totals {
  return {
    qty: 0,
    defect: 0,
    plannedTime: 0,
    totalLosses: 0,
    managementLosses: 0,
    operatingTime: 0,
    revisedExcl: 0,
    losses: {},
    blocks: 0,
    entries: 0,
  };
}

/** Operating time of one record: SUMPRODUCT(Qty, CT) unless an override was typed. */
export function entryOperatingTime(e: Pick<EntryCalcInput, 'lines' | 'operatingTimeOverride'>): number {
  if (e.operatingTimeOverride != null && Number.isFinite(Number(e.operatingTimeOverride)))
    return num(e.operatingTimeOverride);
  return e.lines.reduce((s, l) => s + num(l.qty) * num(l.cycleTimeMin), 0);
}

export const blockKey = (e: { prodDate: string; shiftId: number; machineId: number }) =>
  `${e.prodDate}|${e.shiftId}|${e.machineId}`;

export interface BlockResult extends Totals {
  key: string;
  prodDate: string;
  shiftId: number;
  machineId: number;
  week: number;
}

/**
 * Groups records into Excel blocks (date + shift + machine) and computes AN..AS, BC.
 * Several records for the same machine and shift are legitimate (different WTPM notes or
 * parts); shift planned time is counted once for the block.
 */
export function buildBlocks(
  entries: EntryCalcInput[],
  categories: Pick<LossCategoryDef, 'code' | 'is_management' | 'is_revised_excl'>[],
  shiftPlanned: Record<number, number>,
): BlockResult[] {
  const mg = new Set(categories.filter((c) => c.is_management).map((c) => c.code));
  const rv = new Set(categories.filter((c) => c.is_revised_excl).map((c) => c.code));
  const map = new Map<string, BlockResult & { _override: number | null; _producing: boolean }>();
  for (const e of entries) {
    const key = blockKey(e);
    let b = map.get(key);
    if (!b) {
      b = {
        ...emptyTotals(),
        key,
        prodDate: e.prodDate,
        shiftId: e.shiftId,
        machineId: e.machineId,
        week: weekOfMonth(e.prodDate),
        blocks: 1,
        _override: null,
        _producing: false,
      };
      map.set(key, b);
    }
    b.entries += 1;
    let entryQty = 0;
    for (const l of e.lines) {
      b.qty += num(l.qty);
      b.defect += num(l.defect);
      entryQty += num(l.qty);
    }
    b.operatingTime += entryOperatingTime(e);
    for (const [code, raw] of Object.entries(e.losses || {})) {
      const m = num(raw);
      if (!m) continue;
      b.losses[code] = (b.losses[code] || 0) + m;
      b.totalLosses += m;
      if (mg.has(code)) b.managementLosses += m;
      if (rv.has(code)) b.revisedExcl += m;
    }
    const hasOverride = e.plannedTimeOverride != null && Number.isFinite(Number(e.plannedTimeOverride));
    if (hasOverride && num(e.plannedTimeOverride) > 0) b._override = Math.max(b._override ?? 0, num(e.plannedTimeOverride));
    // A record with a typed planned time of 0 is a continuation of the shift (Excel practice for a
    // second block of the same machine & shift) and does not make the shift count again.
    if (!hasOverride && entryQty > 0) b._producing = true;
  }
  const out: BlockResult[] = [];
  for (const b of map.values()) {
    // AP = IF(AN>0, VLOOKUP(shift,'Shift Timings'!A:G,7), 0) — or the typed value.
    // Planned time is counted once per machine & shift: a typed non-zero value (half shift, etc.)
    // wins; otherwise the shift's planned time if any record without a typed value produced parts.
    b.plannedTime = b._override != null ? b._override : b._producing ? num(shiftPlanned[b.shiftId]) : 0;
    const { _override, _producing, ...rest } = b;
    void _override;
    void _producing;
    out.push(rest);
  }
  out.sort((a, b) => a.prodDate.localeCompare(b.prodDate) || a.shiftId - b.shiftId || a.machineId - b.machineId);
  return out;
}

export function addTotals(into: Totals, t: Totals): Totals {
  into.qty += t.qty;
  into.defect += t.defect;
  into.plannedTime += t.plannedTime;
  into.totalLosses += t.totalLosses;
  into.managementLosses += t.managementLosses;
  into.operatingTime += t.operatingTime;
  into.revisedExcl += t.revisedExcl;
  into.blocks += t.blocks;
  into.entries += t.entries;
  for (const [k, v] of Object.entries(t.losses)) into.losses[k] = (into.losses[k] || 0) + v;
  return into;
}

/** Percentage formulas applied to (summed) totals — identical for a block or a report row. */
export function computeMetrics(t: Totals): Metrics {
  const PT = t.plannedTime,
    TL = t.totalLosses,
    ML = t.managementLosses,
    OT = t.operatingTime;
  const Qv = div(t.qty - t.defect, t.qty);
  const woA = div(PT - TL, PT - ML);
  const P = div(OT, PT - TL);
  const A = div(PT - TL, PT);
  const BF = PT - t.revisedExcl;
  const BH = div(BF - TL, BF);
  const BI = div(OT, BF - TL);
  const BL = BF - TL - OT;
  const BN = BF - LNC_FACTOR * BL;
  const BP = div(BN - TL, BN);
  const BQ = div(OT, BN - TL);
  return {
    woA,
    woP: P,
    woQ: Qv,
    woOEE: mul(woA, P, Qv),
    A,
    P,
    Q: Qv,
    OEE: mul(A, P, Qv),
    lossesNotCaptured: PT - TL - OT,
    dailyLossesNotCaptured: (PT - TL) * LNC_FACTOR - OT,
    revised: {
      plannedRevised: BF,
      A: BH,
      P: BI,
      Q: Qv,
      OEE: mul(BH, BI, Qv),
      lossNotCaptured: BL,
      plannedRevised2: BN,
      A2: BP,
      P2: BQ,
      OEE2: mul(BP, BQ, Qv),
    },
  };
}

export function summarize(blocks: Totals[]): Summary {
  const t = emptyTotals();
  for (const b of blocks) addTotals(t, b);
  return { ...t, ...computeMetrics(t) };
}

/** SUMIFS-style grouping of blocks by any key, then the same formulas on each group. */
export function groupSummaries<K extends string | number>(
  blocks: BlockResult[],
  keyFn: (b: BlockResult) => K,
): Map<K, Summary> {
  const groups = new Map<K, BlockResult[]>();
  for (const b of blocks) {
    const k = keyFn(b);
    const arr = groups.get(k);
    if (arr) arr.push(b);
    else groups.set(k, [b]);
  }
  const out = new Map<K, Summary>();
  for (const [k, arr] of groups) out.set(k, summarize(arr));
  return out;
}

/**
 * Dashboard plant KPI: Excel Table4 totals use SUBTOTAL(101, …) = simple average of the
 * machine rows that have a value (rows with "" are ignored).
 */
export function averageOf(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function lossGroupTotals(losses: LossMap, categories: LossCategoryDef[]) {
  const g = { A: 0, P: 0, Q: 0, M: 0, management: 0 };
  for (const c of categories) {
    const v = losses[c.code] || 0;
    g[c.oee_group] += v;
    if (c.is_management) g.management += v;
  }
  return g;
}

/** OEE banding used by the Excel ranking tables: OEE(<60%) and OEE(60%-80%). */
export function oeeBand(oee: number | null, low = 0.6, high = 0.8): 'low' | 'mid' | 'high' | 'none' {
  if (oee == null) return 'none';
  if (oee < low) return 'low';
  if (oee <= high) return 'mid';
  return 'high';
}
