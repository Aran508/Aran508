import { api, requireUser, clientIp, HttpError } from '@/lib/auth';
import { tx, notifyChange } from '@/lib/db';
import { audit } from '@/lib/audit';
import { loadWorkbook, parsePartMaster, parseOeeData, upsertPartMaster, importBlocks } from '@/lib/excel-import';

export const maxDuration = 300;

/** Upload the monthly "OEE MAIN SHEET" workbook: mode=master (Cycletime and Bore) or mode=data (also OEE data 1). */
export const POST = api(async (req: Request) => {
  const user = await requireUser('import.run');
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'Choose the .xlsx workbook');
  const mode = String(form.get('mode') || 'master');
  const preview = form.get('preview') === '1';
  const wb = await loadWorkbook(Buffer.from(await file.arrayBuffer())).catch(() => { throw new HttpError(422, 'This file could not be read as an Excel .xlsx workbook'); });
  const { parts, duplicates } = await parsePartMaster(wb);
  const parsed = mode === 'data' ? await parseOeeData(wb) : null;
  if (preview) {
    return {
      sheets: wb.sheetNames(), parts: parts.length, duplicates,
      month: parsed?.month ?? null, blocks: parsed?.blocks.length ?? 0, skipped: parsed?.skipped.slice(0, 50) ?? [],
      qty: parsed?.blocks.reduce((s, b) => s + b.lines.reduce((x, l) => x + l.qty, 0), 0) ?? 0,
    };
  }
  const result = await tx(async (c) => {
    const pm = parts.length ? await upsertPartMaster(c, parts, user.uid) : { inserted: 0, updated: 0, unknownMachines: [] as string[] };
    let data = null;
    if (parsed) data = await importBlocks(c, parsed.blocks, { userId: user.uid, replaceExistingImport: form.get('replace') === '1', label: `${file.name} / OEE data 1` });
    await audit(c, { entity: 'import', entityId: file.name, action: mode === 'data' ? 'import_workbook' : 'import_master', userId: user.uid, newValue: { parts: pm, data: data && { imported: data.imported, replaced: data.replaced, skipped: data.skipped.length }, month: parsed?.month }, ip: await clientIp() });
    return { parts: pm, data };
  });
  await notifyChange(null, { type: 'entry', action: 'import' });
  return result;
});
