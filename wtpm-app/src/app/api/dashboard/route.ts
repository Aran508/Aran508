import { api, requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { readFilter } from '@/lib/params';
import { loadBlocks, machineSummary, dailySeries, lineSummary, shiftSummary, lossMatrix, paretoOf, monthLabel } from '@/lib/reports';
import { can } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export const GET = api(async (req: Request) => {
  const user = await requireUser();
  const f = readFilter(req.url);
  const { meta, blocks } = await loadBlocks({ from: f.from, to: f.to, machineIds: f.machineIds, shiftId: f.shiftId, line: f.line });
  const summary = machineSummary(blocks, meta, { machineIds: f.machineIds, line: f.line });
  const active = summary.rows.filter((r) => r.hasData);
  // Excel dashboard machine table is ordered by %OEE ascending (lagging machines first)
  const table = [...active].sort((a, b) => (a.OEE ?? -1) - (b.OEE ?? -1));
  const byOee = active.filter((r) => r.OEE != null).sort((a, b) => (b.OEE as number) - (a.OEE as number));
  const loss = lossMatrix(blocks, meta, summary.rows);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const mineOnly = !can(user.role, 'records.view_all');
  const [counts, recent, todayGrid] = await Promise.all([
    query<{ total: number; pending: number; corrections: number; missing_ct: number; today: number }>(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status = 'submitted')::int AS pending,
         count(*) FILTER (WHERE status = 'correction_requested')::int AS corrections,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM entry_lines l WHERE l.entry_id = e.id AND l.cycle_time_min IS NULL AND l.qty > 0))::int AS missing_ct,
         count(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today
       FROM production_entries e WHERE deleted_at IS NULL AND prod_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR created_by = $3)`,
      [f.from, f.to, mineOnly ? user.uid : null],
    ),
    query(
      `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id, m.name AS machine, e.status, e.created_at, u.full_name AS by,
         COALESCE((SELECT sum(qty) FROM entry_lines WHERE entry_id = e.id), 0) AS qty,
         COALESCE((SELECT sum(minutes) FROM entry_losses WHERE entry_id = e.id), 0) AS losses
       FROM production_entries e JOIN machines m ON m.id = e.machine_id LEFT JOIN users u ON u.id = e.created_by
       WHERE e.deleted_at IS NULL AND ($1::int IS NULL OR e.created_by = $1) ORDER BY e.created_at DESC LIMIT 8`,
      [mineOnly ? user.uid : null],
    ),
    query<{ machine_id: number; shift_id: number; n: number }>(
      `SELECT machine_id, shift_id, count(*)::int AS n FROM production_entries WHERE deleted_at IS NULL AND prod_date = $1 GROUP BY 1, 2`,
      [today],
    ),
  ]);
  const daily = dailySeries(blocks, f.from, f.to);
  return {
    filter: { month: f.month, label: monthLabel(f.month), from: f.from, to: f.to, machineIds: f.machineIds, shiftId: f.shiftId, line: f.line },
    plant: summary.plantAverage,
    overall: summary.overall,
    table,
    leading: byOee.slice(0, 3).map((r) => ({ machine: r.machine, OEE: r.OEE })),
    lagging: byOee.slice(-3).reverse().map((r) => ({ machine: r.machine, OEE: r.OEE })),
    ranking: summary.ranking,
    daily: daily.map((d) => ({ date: d.date, OEE: d.OEE, A: d.A, P: d.P, Q: d.Q, qty: d.qty, losses: d.totalLosses, planned: d.plannedTime })),
    pareto: paretoOf(loss.totals, meta).slice(0, 12),
    lossGroups: loss.groups,
    lines: lineSummary(blocks, meta).map((l) => ({ line: l.line, OEE: l.OEE, A: l.A, P: l.P, Q: l.Q, qty: l.qty })),
    shifts: shiftSummary(blocks, meta).map((s) => ({ shiftId: s.shiftId, shift: s.shift, OEE: s.OEE, A: s.A, P: s.P, Q: s.Q, qty: s.qty, losses: s.totalLosses })),
    counts: counts[0],
    recent,
    today: { date: today, grid: todayGrid, machines: meta.machines.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, line: m.line.trim() })) },
    settings: { target: meta.settings.oee_target ?? 0.85, bands: meta.settings.oee_bands, plant: meta.settings.plant_name },
    lines_available: [...new Set(meta.machines.map((m) => m.line.trim()).filter(Boolean))].sort(),
  };
});
