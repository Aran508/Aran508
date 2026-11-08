import { api, requireUser, HttpError } from '@/lib/auth';
import { readFilter } from '@/lib/params';
import { monthlyPdf, machinePdf, lossPdf } from '@/lib/exports';
import { audit } from '@/lib/audit';
import { monthLabel } from '@/lib/reports';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const GET = api(async (req: Request) => {
  const user = await requireUser('reports.view');
  const f = readFilter(req.url);
  const type = f.u.searchParams.get('type') || 'monthly';
  let buf: Buffer, name: string;
  const label = monthLabel(f.month).replace("'", '');
  if (type === 'machine') {
    const id = Number(f.u.searchParams.get('machineId'));
    if (!id) throw new HttpError(422, 'Select a machine');
    buf = await machinePdf(f.month, id);
    name = `Machine OEE ${label} M${id}.pdf`;
  } else if (type === 'loss') {
    buf = await lossPdf(f.month, { machineIds: f.machineIds, line: f.line });
    name = `Loss Analysis ${label}.pdf`;
  } else {
    buf = await monthlyPdf(f.month, { machineIds: f.machineIds, line: f.line });
    name = `OEE Monthly Report ${label}.pdf`;
  }
  await audit(null, { entity: 'export', entityId: f.month, action: `export_pdf_${type}`, userId: user.uid });
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"` } });
});
