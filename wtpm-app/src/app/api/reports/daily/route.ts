import { api, requireUser } from '@/lib/auth';
import { readFilter } from '@/lib/params';
import { loadBlocks, machineSummary, dailySeries, lossMatrix, monthLabel } from '@/lib/reports';
export const dynamic = 'force-dynamic';
/** 'Daily Report' sheet (per date of month, optional machine) + a single-day machine table. */
export const GET = api(async (req: Request) => {
  await requireUser('reports.view');
  const f = readFilter(req.url);
  const day = f.u.searchParams.get('date');
  const { meta, blocks } = await loadBlocks({ from: f.from, to: f.to, machineIds: f.machineIds, shiftId: f.shiftId, line: f.line });
  const series = dailySeries(blocks, f.from, f.to);
  let dayDetail = null;
  if (day) {
    const db = blocks.filter((b) => b.prodDate === day);
    const s = machineSummary(db, meta, { machineIds: f.machineIds, line: f.line });
    const byShift = [1, 2, 3].map((sh) => ({ shiftId: sh, summary: machineSummary(db.filter((b) => b.shiftId === sh), meta, { machineIds: f.machineIds, line: f.line }) }));
    dayDetail = { date: day, summary: s, loss: lossMatrix(db, meta, s.rows), byShift: byShift.map((x) => ({ shiftId: x.shiftId, rows: x.summary.rows.filter((r) => r.hasData), overall: x.summary.overall })) };
  }
  return { month: f.month, label: monthLabel(f.month), series, dayDetail, categories: meta.categories, machines: meta.machines };
});
