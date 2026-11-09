import { z } from 'zod';
import { api, requireUser, clientIp } from '@/lib/auth';
import { setStatus } from '@/lib/entries';
export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser('entry.verify');
  const { id } = await ctx.params;
  const b = z.object({ status: z.enum(['verified', 'correction_requested']), note: z.string().optional().nullable() }).parse(await req.json());
  await setStatus(id, b.status, b.note ?? null, user, await clientIp());
  return { ok: true };
});
