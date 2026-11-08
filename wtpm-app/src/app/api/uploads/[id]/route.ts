import fs from 'node:fs/promises';
import { api, requireUser, HttpError } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { resolveKey } from '@/lib/uploads';
import { can } from '@/lib/roles';

/** Photos are served only to logged-in users allowed to see the record. */
export const GET = api(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const a = await queryOne<{ storage_key: string; mime_type: string; uploaded_by: number; created_by: number | null }>(
    'SELECT a.storage_key, a.mime_type, a.uploaded_by, e.created_by FROM attachments a LEFT JOIN production_entries e ON e.id = a.entry_id WHERE a.id = $1',
    [id],
  );
  if (!a) throw new HttpError(404, 'Photo not found');
  if (!can(user.role, 'records.view_all') && a.uploaded_by !== user.uid && a.created_by !== user.uid) throw new HttpError(403, 'Not allowed');
  const buf = await fs.readFile(resolveKey(a.storage_key)).catch(() => null);
  if (!buf) throw new HttpError(404, 'Photo file is missing on the server');
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': a.mime_type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
});
