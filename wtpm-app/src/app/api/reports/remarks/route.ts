import { api, requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { readFilter } from '@/lib/params';
/** Remarks and "Other" loss reasons written on the WTPM notes for the period. */
export const GET = api(async (req: Request) => {
  await requireUser('reports.view');
  const f = readFilter(req.url);
  return query(
    `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id, m.name AS machine, e.remarks, e.other_loss_reason,
       (SELECT minutes FROM entry_losses x WHERE x.entry_id = e.id AND x.category_code = 'other') AS other_minutes,
       COALESCE((SELECT sum(minutes) FROM entry_losses x WHERE x.entry_id = e.id), 0) AS losses
     FROM production_entries e JOIN machines m ON m.id = e.machine_id
     WHERE e.deleted_at IS NULL AND e.prod_date BETWEEN $1 AND $2 AND (e.remarks IS NOT NULL OR e.other_loss_reason IS NOT NULL)
       AND ($3::int[] IS NULL OR e.machine_id = ANY($3)) AND ($4::text IS NULL OR trim(m.line) = $4)
     ORDER BY losses DESC, e.prod_date DESC LIMIT 60`,
    [f.from, f.to, f.machineIds.length ? f.machineIds : null, f.line],
  );
});
