import { api, requireUser, clientIp, HttpError } from '@/lib/auth';
import { can } from '@/lib/roles';
import { EntrySchema, updateEntry, deleteEntry, entryDetail } from '@/lib/entries';
import { query } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export const GET = api(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const d = await entryDetail(id);
  if (!d) throw new HttpError(404, 'Record not found');
  if (!can(user.role, 'records.view_all') && d.entry.created_by !== user.uid) throw new HttpError(403, 'You can only view your own records');
  const history = await query(
    `SELECT a.id, a.action, a.reason, a.changed_at, u.full_name AS by, a.new_value -> 'changes' AS changes
     FROM audit_log a LEFT JOIN users u ON u.id = a.changed_by WHERE a.entity = 'production_entry' AND a.entity_id = $1 ORDER BY a.changed_at DESC`,
    [id],
  );
  return { ...d, history };
});

export const PUT = api(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = EntrySchema.parse(await req.json());
  return updateEntry(id, input, user, await clientIp());
});

export const DELETE = api(async (req: Request, ctx: Ctx) => {
  const user = await requireUser('entry.delete');
  const { id } = await ctx.params;
  const reason = new URL(req.url).searchParams.get('reason') || '';
  await deleteEntry(id, reason, user, await clientIp());
  return { ok: true };
});
