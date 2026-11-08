/**
 * Seeds master data taken from the supplied workbooks and creates the first users.
 *   npm run db:seed              → machines, part master, users (+ October 2026 sample month if DB has no records)
 *   npm run db:seed -- --no-sample
 */
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { getPool, tx } from '../src/lib/db';
import { migrate } from './migrate';
import { hashPassword } from '../src/lib/password';
import { importBlocks, upsertPartMaster, type ParsedBlock, type ParsedPart } from '../src/lib/excel-import';

const dataDir = path.resolve(__dirname, '../db/seed-data');

async function main() {
  await migrate();
  const machines = JSON.parse(fs.readFileSync(path.join(dataDir, 'machines.json'), 'utf8')) as { sno: number; code: string; name: string; line: string; category: string }[];
  const parts = JSON.parse(fs.readFileSync(path.join(dataDir, 'part-master.json'), 'utf8')) as ParsedPart[];
  await tx(async (c) => {
    for (const m of machines) {
      await c.query(
        `INSERT INTO machines (code, name, line, category, sort_order) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (lower(code)) DO UPDATE SET name = EXCLUDED.name, line = EXCLUDED.line, category = EXCLUDED.category, sort_order = EXCLUDED.sort_order`,
        [m.code, m.name, m.line, m.category, m.sno],
      );
    }
    console.log(`machines: ${machines.length}`);
    const adminUser = process.env.SEED_ADMIN_USER || 'admin';
    const adminPass = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
    const users: [string, string, string, string][] = [
      [adminUser, 'System Administrator', 'admin', adminPass],
      ['supervisor', 'Production Supervisor', 'supervisor', process.env.SEED_DEMO_PASSWORD || 'Super@123'],
      ['manager', 'Plant HOD', 'management', process.env.SEED_DEMO_PASSWORD || 'Manager@123'],
      ['operator', 'WTPM Data Entry', 'operator', process.env.SEED_DEMO_PASSWORD || 'Operator@123'],
    ];
    for (const [u, name, role, pass] of users) {
      const exists = await c.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [u]);
      if (exists.rowCount) continue;
      await c.query('INSERT INTO users (username, full_name, role, password_hash) VALUES ($1,$2,$3,$4)', [u, name, role, await hashPassword(pass)]);
      console.log(`user created: ${u} (${role})${process.env.VERCEL ? '' : ` / ${pass}`} — change this password after first login`);
    }
    const pm = await upsertPartMaster(c, parts, null);
    console.log(`part master (Cycletime and Bore): ${pm.inserted} inserted, ${pm.updated} updated`);
  });

  const noSample = process.argv.includes('--no-sample');
  const count = Number((await (await getPool()).query('SELECT count(*) FROM production_entries')).rows[0].count);
  if (!noSample && count === 0) {
    const sample = JSON.parse(fs.readFileSync(path.join(dataDir, 'sample-oct-2026.json'), 'utf8')) as { blocks: ParsedBlock[] };
    const usable = sample.blocks;
    const admin = (await (await getPool()).query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")).rows[0]?.id ?? null;
    const r = await tx((c) => importBlocks(c, usable, { userId: admin, label: "2.OEE MAIN SHEET- Nov'26 / OEE data 1" }));
    console.log(`sample month (October 2026 from the OEE MAIN SHEET): ${r.imported} records imported, ${r.skipped.length} skipped`);
  }
  await (await getPool()).end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
