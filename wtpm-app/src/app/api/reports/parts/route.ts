import { api, requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { readFilter } from '@/lib/params';
/** Part-wise production for a machine/month (the workbook's 'Part-wise Report'). */
export const GET = api(async (req: Request) => {
  await requireUser('reports.view');
  const f = readFilter(req.url);
  return query(
    `SELECT l.part_number AS part, m.name AS machine, count(DISTINCT e.id)::int AS records, sum(l.qty) AS qty, sum(l.defect) AS defect, sum(l.rework) AS rework, sum(l.hold) AS hold,
       sum(l.setting_changeover_count) AS setting, max(l.cycle_time_min) AS ct, max(l.bore) AS bore, sum(l.qty * COALESCE(l.cycle_time_min, 0)) AS operating
     FROM entry_lines l JOIN production_entries e ON e.id = l.entry_id AND e.deleted_at IS NULL JOIN machines m ON m.id = e.machine_id
     WHERE e.prod_date BETWEEN $1 AND $2 AND ($3::int[] IS NULL OR e.machine_id = ANY($3)) AND ($4::text IS NULL OR trim(m.line) = $4)
     GROUP BY l.part_number, m.name ORDER BY sum(l.qty) DESC LIMIT 300`,
    [f.from, f.to, f.machineIds.length ? f.machineIds : null, f.line],
  );
});
