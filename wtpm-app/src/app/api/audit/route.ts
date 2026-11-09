import { api, requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
export const GET = api(async (req: Request) => {
  await requireUser('audit.view');
  const u = new URL(req.url);
  const p: unknown[] = [];
  const w: string[] = ['TRUE'];
  const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (u.searchParams.get('entity')) add('a.entity = ?', u.searchParams.get('entity'));
  if (u.searchParams.get('entityId')) add('a.entity_id = ?', u.searchParams.get('entityId'));
  if (u.searchParams.get('action')) add('a.action = ?', u.searchParams.get('action'));
  if (u.searchParams.get('userId')) add('a.changed_by = ?', Number(u.searchParams.get('userId')));
  if (u.searchParams.get('from')) add('a.changed_at >= ?::date', u.searchParams.get('from'));
  if (u.searchParams.get('to')) add("a.changed_at < (?::date + 1)", u.searchParams.get('to'));
  const limit = Math.min(500, Number(u.searchParams.get('limit') || 100));
  const offset = Number(u.searchParams.get('offset') || 0);
  const rows = await query(
    `SELECT a.id, a.entity, a.entity_id, a.action, a.reason, a.old_value, a.new_value, a.changed_at, a.ip_address, u.full_name AS by, u.username,
       CASE WHEN a.entity = 'production_entry' THEN (SELECT entry_no FROM production_entries WHERE id::text = a.entity_id) END AS entry_no,
       count(*) OVER () AS total
     FROM audit_log a LEFT JOIN users u ON u.id = a.changed_by WHERE ${w.join(' AND ')} ORDER BY a.changed_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`,
    p,
  );
  return { rows, total: Number((rows[0] as { total?: number })?.total ?? 0) };
});
