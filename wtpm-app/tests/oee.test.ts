import { describe, it, expect } from 'vitest';
import blocksRaw from './fixtures/excel-oct26-blocks.json';
import summary1 from './fixtures/excel-oct26-summary1.json';
import { buildBlocks, summarize, groupSummaries, computeMetrics, weekOfMonth, averageOf, type EntryCalcInput, type Totals } from '@/lib/oee';
import { EXCEL_LOSS_COLUMNS, DEFAULT_CATEGORY_FLAGS } from '@/lib/loss-columns';

type XL = Record<string, number | string | null>;
interface RawBlock { row: number; date: string; shift: number; machine: string; code: string; lines: { part: string; qty: number; defect: number; ct: number | null }[]; losses: Record<string, number>; ap_formula: string | null; as_formula: string | null; xl: XL; excel_issues: string[] }
const blocks = blocksRaw as unknown as RawBlock[];
const SHIFT = { 1: 445, 2: 460, 3: 370 };
const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const close = (a: number | null, b: unknown, eps = 1e-9) => {
  if (typeof b !== 'number') return a == null;
  return a != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
};


function toEntry(b: RawBlock, machineId = 1): EntryCalcInput {
  const losses: Record<string, number> = {};
  for (const [col, v] of Object.entries(b.losses)) if (v) losses[EXCEL_LOSS_COLUMNS[col]] = v;
  return {
    prodDate: b.date, shiftId: b.shift, machineId,
    plannedTimeOverride: b.ap_formula != null ? Number(b.ap_formula) : null,
    operatingTimeOverride: b.as_formula != null ? Number(b.as_formula) : null,
    lines: b.lines.map((l) => ({ qty: n(l.qty), defect: n(l.defect), cycleTimeMin: typeof l.ct === 'number' ? l.ct : null })),
    losses,
  };
}

describe('block calculation reproduces Excel "OEE data 1" (October 2026 data)', () => {
  const checked: number[] = [];
  const mismatched: number[] = [];
  for (const b of blocks) {
    const [res] = buildBlocks([toEntry(b)], DEFAULT_CATEGORY_FLAGS, SHIFT);
    const m = computeMetrics(res);
    const ok =
      close(res.qty, b.xl.AN) && close(res.defect, b.xl.AO ?? 0) && close(res.plannedTime, b.xl.AP) &&
      close(res.totalLosses, b.xl.AQ) && close(res.managementLosses, b.xl.AR) && close(res.operatingTime, b.xl.AS) &&
      (typeof b.xl.AT !== 'number' || close(m.woA, b.xl.AT)) && (typeof b.xl.AU !== 'number' || close(m.woP, b.xl.AU)) &&
      (typeof b.xl.AV !== 'number' || close(m.Q, b.xl.AV)) && (typeof b.xl.AW !== 'number' || close(m.woOEE, b.xl.AW)) &&
      (typeof b.xl.AX !== 'number' || close(m.A, b.xl.AX)) && (typeof b.xl.BA !== 'number' || close(m.OEE, b.xl.BA));
    (ok ? checked : mismatched).push(b.row);
  }
  it('matches every block whose Excel formulas are intact', () => {
    const clean = new Set(blocks.filter((b) => b.excel_issues.length === 0).map((b) => b.row));
    expect(clean.size).toBeGreaterThan(560);
    // every mismatch is a block where a formula in the workbook was hand-edited / mis-ranged
    expect(mismatched.filter((r) => clean.has(r))).toEqual([]);
    expect(checked.length).toBeGreaterThanOrEqual(clean.size);
  });
});

describe('monthly machine summary reproduces " OEE Overall Summary 1"', () => {
  // Feed Excel's own block values (AN..AS) through the engine's SUMIFS + formulas.
  const S = summary1 as Record<string, Record<string, number | string | null>>;
  const byMachine = new Map<string, Totals[]>();
  for (const b of blocks) {
    const t: Totals = { qty: n(b.xl.AN), defect: n(b.xl.AO), plannedTime: n(b.xl.AP), totalLosses: n(b.xl.AQ), managementLosses: n(b.xl.AR), operatingTime: n(b.xl.AS), revisedExcl: n(b.xl.BC), losses: {}, blocks: 1, entries: 1 };
    byMachine.set(b.machine, [...(byMachine.get(b.machine) || []), t]);
  }
  for (const [machine, row] of Object.entries(S)) {
    it(machine, () => {
      const s = summarize(byMachine.get(machine) || []);
      expect(close(s.qty, row.F)).toBe(true);
      expect(close(s.plannedTime, row.H)).toBe(true);
      expect(close(s.totalLosses, row.I)).toBe(true);
      expect(close(s.managementLosses, row.J)).toBe(true);
      expect(close(s.operatingTime, row.K)).toBe(true);
      expect(close(s.A, row.P)).toBe(true);
      expect(close(s.P, row.Q)).toBe(true);
      expect(close(s.Q, row.R)).toBe(true);
      expect(close(s.OEE, row.S)).toBe(true);
      expect(close(s.lossesNotCaptured, row.T)).toBe(true);
    });
  }
});

describe('dashboard formulas (1.DASHBOARD)', () => {
  it('Robot Welding 4 row: A/P/Q/OEE use the with-management-loss method', () => {
    const m = computeMetrics({ qty: 1995, defect: 1, plannedTime: 14974.708999999997, totalLosses: 4685, managementLosses: 1075, operatingTime: 9675.54, revisedExcl: 0, losses: {}, blocks: 1, entries: 1 });
    expect(close(m.A, 0.6871391624371465)).toBe(true);
    expect(close(m.P, 0.9403123062080768)).toBe(true);
    expect(close(m.Q, 0.9994987468671679)).toBe(true);
    expect(close(m.OEE, 0.6458015381309354)).toBe(true);
    expect(close(m.lossesNotCaptured, 614.1689999999962, 1e-6)).toBe(true);
  });
  it('plant KPI is SUBTOTAL(101) average of machine rows, ignoring blanks', () => {
    expect(averageOf([0.5, null, 0.7])).toBeCloseTo(0.6);
  });
  it('week number = CEILING(DAY/7)', () => {
    expect([1, 7, 8, 14, 15, 29, 31].map((d) => weekOfMonth(`2026-10-${String(d).padStart(2, '0')}`))).toEqual([1, 1, 2, 2, 3, 5, 5]);
  });
});

describe('multiple records for one machine & shift', () => {
  it('count shift planned time once and add quantities, losses and operating time', () => {
    const base = { prodDate: '2026-11-02', shiftId: 1, machineId: 7 };
    const blocks = buildBlocks([
      { ...base, lines: [{ qty: 10, defect: 1, cycleTimeMin: 5 }], losses: { breakdown: 30 } },
      { ...base, lines: [{ qty: 20, defect: 0, cycleTimeMin: 4 }], losses: { no_material: 60 } },
    ], DEFAULT_CATEGORY_FLAGS, SHIFT);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.plannedTime).toBe(445);
    expect(b.qty).toBe(30);
    expect(b.operatingTime).toBe(130);
    expect(b.totalLosses).toBe(90);
    expect(b.managementLosses).toBe(60);
    expect(groupSummaries(blocks, (x) => x.machineId).get(7)!.OEE).toBeCloseTo(((445 - 90) / 445) * (130 / 355) * (29 / 30));
  });
  it('planned time is 0 when nothing was produced (Excel IF(AN>0,…,0))', () => {
    const [b] = buildBlocks([{ prodDate: '2026-11-02', shiftId: 2, machineId: 1, lines: [], losses: { breakdown: 460 } }], DEFAULT_CATEGORY_FLAGS, SHIFT);
    expect(b.plannedTime).toBe(0);
    expect(b.totalLosses).toBe(460);
  });
});
