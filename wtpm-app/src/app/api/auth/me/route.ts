import { api, requireUser } from '@/lib/auth';
import { PERMISSION_MATRIX } from '@/lib/roles';
export const GET = api(async () => {
  const u = await requireUser();
  return { user: u, permissions: PERMISSION_MATRIX[u.role] };
});
