/**
 * Reconciliation of the imported October 2026 month (parsed from the real workbook) against the
 * workbook's own ' OEE Overall Summary 1' sheet. Every difference must be explained by a
 * specific hand-edited / mis-ranged cell in 'OEE data 1' — see docs/EXCEL-RECONCILIATION.md.
 */
import { describe, it, expect } from 'vitest';
import sample from '../db/seed-data/sample-oct-2026.json';
import machines from '../db/seed-data/machines.json';
import summary1 from './fixtures/excel-oct26-summary1.json';
import { buildBlocks, groupSummaries, type EntryCalcInput } from '@/lib/oee';
import { EXCEL_LOSS_COLUMNS, DEFAULT_CATEGORY_FLAGS } from '@/lib/loss-columns';

type B = { row: number; date: string; shift: number; code: string; lines: { qty: number; defect: number; ct: number | null }[]; losses: Record<string, number>; ap_formula: string | null; as_formula: string | null };
const byCode = new Map((machines as { code: string; name: string }[]).map((m, i) => [m.code.toLowerCase(), { id: i + 1, name: m.name }]));
const entries: EntryCalcInput[] = (sample.blocks as B[]).map((b) => ({
  prodDate: b.date, shiftId: b.shift, machineId: byCode.get(b.code.toLowerCase())!.id,
  plannedTimeOverride: b.ap_formula != null ? Number(b.ap_formula) : null,
  operatingTimeOverride: b.as_formula != null ? Number(b.as_formula) : null,
  lines: b.lines.map((l) => ({ qty: l.qty, defect: l.defect, cycleTimeMin: l.ct })),
  losses: Object.fromEntries(Object.entries(b.losses).map(([c, v]) => [EXCEL_LOSS_COLUMNS[c], v])),
}));
const per = groupSummaries(buildBlocks(entries, DEFAULT_CATEGORY_FLAGS, { 1: 445, 2: 460, 3: 370 }), (b) => b.machineId);
const S = summary1 as Record<string, Record<string, number>>;
const app = (name: string) => per.get([...byCode.values()].find((m) => m.name.trim() === name.trim())!.id)!;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Machines whose workbook totals contain a cell error, with the expected difference (app − Excel). */
const KNOWN: Record<string, Partial<Record<'qty' | 'defect' | 'plannedTime' | 'totalLosses' | 'operatingTime', number>>> = {
  'Robot Welding 1': { qty: -18, plannedTime: 75 },          // AN1298 range overlaps next block (+18 pcs); AP671 looks up K664 (shift 3) instead of K671 (shift 1)
  'Slewline Testing': { qty: -27, operatingTime: -81 },      // AN2214 / AS2214 range includes row 2219 of the next block
  'Sierra 2': { qty: -63, totalLosses: 10, operatingTime: 188.32224637681162 }, // AN2638/2643 overlaps; AQ1406 typed 140 instead of SUM = 150; AS2259 =SUM(J..,M..) instead of SUMPRODUCT
  'Mainline  1 Testing': { defect: 0 },                     // AO1777 sums the R/W column — defect shown separately below
};

describe('October 2026: app vs workbook OEE Overall Summary 1', () => {
  for (const [name, x] of Object.entries(S)) {
    if (!x.F) continue;
    it(name, () => {
      const a = app(name);
      const k = KNOWN[name] ?? {};
      expect(a.qty - x.F).toBeCloseTo(k.qty ?? 0, 6);
      expect(a.plannedTime - x.H).toBeCloseTo(k.plannedTime ?? 0, 6);
      expect(a.totalLosses - x.I).toBeCloseTo(k.totalLosses ?? 0, 6);
      expect(a.operatingTime - x.K).toBeCloseTo(k.operatingTime ?? 0, 6);
      if (!KNOWN[name]) {
        expect(close(a.OEE!, x.S)).toBe(true);
        expect(close(a.A!, x.P)).toBe(true);
        expect(close(a.woOEE!, x.O)).toBe(true);
      }
    });
  }
});
