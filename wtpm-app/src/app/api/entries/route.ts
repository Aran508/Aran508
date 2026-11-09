import { api, requireUser, clientIp } from '@/lib/auth';
import { query } from '@/lib/db';
import { can } from '@/lib/roles';
import { EntrySchema, createEntry } from '@/lib/entries';

export const dynamic = 'force-dynamic';

export const GET = api(async (req: Request) => {
  const user = await requireUser();
  const u = new URL(req.url);
  const p: unknown[] = [];
  const w: string[] = ['e.deleted_at IS NULL'];
  const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (u.searchParams.get('from')) add('e.prod_date >= ?', u.searchParams.get('from'));
  if (u.searchParams.get('to')) add('e.prod_date <= ?', u.searchParams.get('to'));
  if (u.searchParams.get('machineId')) add('e.machine_id = ?', Number(u.searchParams.get('machineId')));
  if (u.searchParams.get('shift')) add('e.shift_id = ?', Number(u.searchParams.get('shift')));
  if (u.searchParams.get('status')) add('e.status = ?', u.searchParams.get('status'));
  if (u.searchParams.get('line')) add('trim(m.line) = ?', u.searchParams.get('line'));
  if (u.searchParams.get('source')) add('e.source = ?', u.searchParams.get('source'));
  if (u.searchParams.get('missingCt') === '1') w.push('EXISTS (SELECT 1 FROM entry_lines l WHERE l.entry_id = e.id AND l.cycle_time_min IS NULL AND l.qty > 0)');
  const q = u.searchParams.get('q')?.trim();
  if (q) {
    p.push(`%${q}%`, q);
    const a = p.length - 1, b = p.length;
    w.push(`(EXISTS (SELECT 1 FROM entry_lines l WHERE l.entry_id = e.id AND l.part_number ILIKE $${a}) OR e.remarks ILIKE $${a} OR m.name ILIKE $${a} OR e.entry_no::text = $${b})`);
  }
  if (!can(user.role, 'records.view_all') || u.searchParams.get('mine') === '1') add('e.created_by = ?', user.uid);
  const limit = Math.min(500, Number(u.searchParams.get('limit') || 100));
  const offset = Number(u.searchParams.get('offset') || 0);
  const rows = await query(
    `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id, e.machine_id, m.name AS machine, m.code AS machine_code, trim(m.line) AS line,
       e.status, e.source, e.created_at, e.updated_at, e.version, cu.full_name AS created_by_name, e.created_by,
       e.planned_time_override, e.operating_time_override, e.remarks,
       (SELECT string_agg(part_number, ', ' ORDER BY line_no) FROM entry_lines WHERE entry_id = e.id) AS parts,
       COALESCE((SELECT sum(qty) FROM entry_lines WHERE entry_id = e.id), 0) AS qty,
       COALESCE((SELECT sum(defect) FROM entry_lines WHERE entry_id = e.id), 0) AS defect,
       COALESCE((SELECT sum(qty * COALESCE(cycle_time_min, 0)) FROM entry_lines WHERE entry_id = e.id), 0) AS operating_calc,
       COALESCE((SELECT sum(minutes) FROM entry_losses WHERE entry_id = e.id), 0) AS losses,
       EXISTS (SELECT 1 FROM entry_lines l WHERE l.entry_id = e.id AND l.cycle_time_min IS NULL AND l.qty > 0) AS missing_ct,
       (SELECT count(*)::int FROM attachments a WHERE a.entry_id = e.id) AS photos,
       count(*) OVER () AS total
     FROM production_entries e JOIN machines m ON m.id = e.machine_id LEFT JOIN users cu ON cu.id = e.created_by
     WHERE ${w.join(' AND ')}
     ORDER BY e.prod_date DESC, e.shift_id DESC, e.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    p,
  );
  return { rows, total: Number((rows[0] as { total?: number })?.total ?? 0) };
});

export const POST = api(async (req: Request) => {
  const user = await requireUser('entry.create');
  const input = EntrySchema.parse(await req.json());
  return createEntry(input, user, await clientIp());
});
