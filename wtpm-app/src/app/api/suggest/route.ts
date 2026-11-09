import { api, requireUser, HttpError } from '@/lib/auth';
import { query } from '@/lib/db';

/** Smart suggestions for WTPM Quick Entry: parts used on the machine, master CT/bore, last & previous-shift entries, frequent losses. */
export const GET = api(async (req: Request) => {
  await requireUser();
  const u = new URL(req.url);
  const machineId = Number(u.searchParams.get('machineId'));
  if (!machineId) throw new HttpError(400, 'machineId required');
  const date = u.searchParams.get('date');
  const shift = Number(u.searchParams.get('shift') || 0);

  const [recentParts, masterParts, lastEntries, frequentLosses] = await Promise.all([
    query(
      `SELECT l.part_number AS part, count(*)::int AS uses, max(e.prod_date)::text AS last_used,
         (array_agg(l.qty ORDER BY e.prod_date DESC, e.shift_id DESC))[1] AS last_qty,
         pm.cycle_time_min AS ct, pm.bore
       FROM entry_lines l JOIN production_entries e ON e.id = l.entry_id AND e.deleted_at IS NULL
       LEFT JOIN part_master pm ON pm.machine_id = e.machine_id AND upper(pm.part_number) = upper(l.part_number)
       WHERE e.machine_id = $1 AND e.prod_date > (CURRENT_DATE - 180)
       GROUP BY l.part_number, pm.cycle_time_min, pm.bore
       ORDER BY max(e.prod_date) DESC, count(*) DESC LIMIT 25`,
      [machineId],
    ),
    query('SELECT part_number AS part, cycle_time_min AS ct, bore FROM part_master WHERE machine_id = $1 AND active ORDER BY part_number', [machineId]),
    query(
      `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id, e.remarks, e.other_loss_reason, u.full_name AS by,
         (SELECT json_agg(json_build_object('part', part_number, 'qty', qty, 'defect', defect, 'rework', rework, 'hold', hold, 'setting', setting_changeover_count, 'ct', cycle_time_min, 'bore', bore) ORDER BY line_no) FROM entry_lines WHERE entry_id = e.id) AS lines,
         (SELECT json_object_agg(category_code, minutes) FROM entry_losses WHERE entry_id = e.id) AS losses
       FROM production_entries e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.machine_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.prod_date DESC, e.shift_id DESC, e.created_at DESC LIMIT 6`,
      [machineId],
    ),
    query(
      `SELECT x.category_code AS code, count(*)::int AS uses, round(avg(x.minutes))::int AS avg_minutes
       FROM entry_losses x JOIN production_entries e ON e.id = x.entry_id AND e.deleted_at IS NULL
       WHERE e.machine_id = $1 AND e.prod_date > (CURRENT_DATE - 90)
       GROUP BY x.category_code ORDER BY count(*) DESC LIMIT 8`,
      [machineId],
    ),
  ]);
  // previous shift relative to the selected date/shift (shift 1 → previous day's shift 3)
  let previousShift = null;
  if (date && shift) {
    const prev = shift > 1 ? { d: date, s: shift - 1 } : { d: new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10), s: 3 };
    previousShift = (lastEntries as { prod_date: string; shift_id: number }[]).find((e) => e.prod_date === prev.d && e.shift_id === prev.s) ?? null;
    if (!previousShift) {
      const r = await query(
        `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id,
           (SELECT json_agg(json_build_object('part', part_number, 'qty', qty, 'defect', defect, 'ct', cycle_time_min, 'bore', bore) ORDER BY line_no) FROM entry_lines WHERE entry_id = e.id) AS lines,
           (SELECT json_object_agg(category_code, minutes) FROM entry_losses WHERE entry_id = e.id) AS losses
         FROM production_entries e WHERE e.machine_id = $1 AND e.prod_date = $2 AND e.shift_id = $3 AND e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 1`,
        [machineId, prev.d, prev.s],
      );
      previousShift = r[0] ?? null;
    }
  }
  return { recentParts, masterParts, lastEntry: lastEntries[0] ?? null, recentEntries: lastEntries, previousShift, frequentLosses };
});
