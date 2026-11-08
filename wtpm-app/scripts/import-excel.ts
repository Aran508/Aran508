/**
 * Import a monthly "OEE MAIN SHEET" workbook (or just its master data).
 *   npm run db:import -- "path/to/2.OEE MAIN SHEET.xlsx" [--master-only] [--replace]
 */
import './env';
import fs from 'node:fs';
import { getPool, tx } from '../src/lib/db';
import { loadWorkbook, parseOeeData, parsePartMaster, importBlocks, upsertPartMaster } from '../src/lib/excel-import';

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: npm run db:import -- <workbook.xlsx> [--master-only] [--replace]');
  console.time('read workbook');
  const wb = await loadWorkbook(fs.readFileSync(file));
  console.timeEnd('read workbook');
  const { parts, duplicates } = await parsePartMaster(wb);
  const admin = (await (await getPool()).query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")).rows[0]?.id ?? null;
  await tx(async (c) => {
    const pm = await upsertPartMaster(c, parts, admin);
    console.log(`Cycletime and Bore: ${parts.length} parts (${duplicates} duplicate keys ignored, first match kept like VLOOKUP) → ${pm.inserted} new, ${pm.updated} updated; unknown machine codes: ${pm.unknownMachines.join(', ') || 'none'}`);
    if (process.argv.includes('--master-only')) return;
    const { month, blocks, notes } = await parseOeeData(wb);
    for (const n of notes) console.log(`  note row ${n.row}: ${n.note}`);
    const r = await importBlocks(c, blocks, { userId: admin, replaceExistingImport: process.argv.includes('--replace') });
    console.log(`OEE data 1 (${month}): ${r.imported} records imported, ${r.replaced} previous imported records replaced`);
    for (const s of r.skipped.slice(0, 20)) console.log(`  skipped row ${s.row}: ${s.reason}`);
  });
  await (await getPool()).end();
}
main().catch((e) => { console.error(e); process.exit(1); });
