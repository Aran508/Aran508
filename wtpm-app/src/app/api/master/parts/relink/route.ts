import { api, requireUser, clientIp } from '@/lib/auth';
import { tx, notifyChange } from '@/lib/db';
import { audit } from '@/lib/audit';
/** Apply master CT / bore to saved part lines that were entered before the part existed in master data. */
export const POST = api(async () => {
  const user = await requireUser('master.edit');
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE entry_lines l SET part_master_id = p.id, cycle_time_min = p.cycle_time_min, bore = p.bore
       FROM production_entries e, part_master p
       WHERE e.id = l.entry_id AND e.deleted_at IS NULL AND l.cycle_time_min IS NULL AND p.machine_id = e.machine_id AND upper(p.part_number) = upper(l.part_number)
       RETURNING l.entry_id, l.part_number, p.cycle_time_min`,
    );
    if (r.rowCount) {
      await audit(c, { entity: 'part_master', entityId: 'relink', action: 'apply_ct_to_records', userId: user.uid, newValue: r.rows.slice(0, 200), reason: `${r.rowCount} part lines received their master cycle time`, ip: await clientIp() });
      await notifyChange(c, { type: 'entry', action: 'relink' });
    }
    return { updated: r.rowCount };
  });
});
