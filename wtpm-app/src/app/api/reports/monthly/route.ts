import { api, requireUser } from '@/lib/auth';
import { readFilter } from '@/lib/params';
import { monthlyReport } from '@/lib/reports';
export const dynamic = 'force-dynamic';
export const GET = api(async (req: Request) => {
  await requireUser('reports.view');
  const f = readFilter(req.url);
  const r = await monthlyReport(f.month, { machineIds: f.machineIds, line: f.line, shiftId: f.shiftId });
  const { meta, ...rest } = r;
  return { ...rest, categories: meta.categories, machines: meta.machines, shiftsMeta: meta.shifts, settings: meta.settings };
});
