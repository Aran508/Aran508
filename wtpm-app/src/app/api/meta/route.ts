import { api, requireUser } from '@/lib/auth';
import { loadMeta } from '@/lib/reports';
import { PERMISSION_MATRIX } from '@/lib/roles';
export const dynamic = 'force-dynamic';
export const GET = api(async () => {
  const user = await requireUser();
  const meta = await loadMeta();
  return { ...meta, user, permissions: PERMISSION_MATRIX[user.role], serverToday: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
});
