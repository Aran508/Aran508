import { api, requireUser } from '@/lib/auth';
import { readFilter } from '@/lib/params';
import { monthlyWorkbook } from '@/lib/exports';
import { audit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const GET = api(async (req: Request) => {
  const user = await requireUser('reports.view');
  const f = readFilter(req.url);
  const { buffer, report } = await monthlyWorkbook(f.month, { machineIds: f.machineIds, line: f.line });
  await audit(null, { entity: 'export', entityId: f.month, action: 'export_excel', userId: user.uid, newValue: { machineIds: f.machineIds, line: f.line } });
  const name = `OEE Monthly Report ${report.label.replace("'", '')}${f.line ? ' ' + f.line : ''}.xlsx`;
  return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"` } });
});
