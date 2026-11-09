/**
 * Backup: PostgreSQL dump + photo folder.  npm run db:backup
 * Schedule daily (Windows Task Scheduler / cron) and copy BACKUP_DIR to another machine.
 * Restore: createdb wtpm && pg_restore -d wtpm <file>.dump ; copy the uploads folder back.
 */
import './env';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.env.BACKUP_DIR || './backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const dump = path.join(dir, `wtpm-${stamp}.dump`);
execFileSync('pg_dump', ['--format=custom', '--no-owner', `--file=${dump}`, process.env.DATABASE_URL!], { stdio: 'inherit' });
console.log(`database → ${dump} (${(fs.statSync(dump).size / 1e6).toFixed(1)} MB)`);
const up = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (fs.existsSync(up)) {
  const tar = path.join(dir, `wtpm-photos-${stamp}.tar.gz`);
  execFileSync('tar', ['-czf', tar, '-C', path.dirname(up), path.basename(up)], { stdio: 'inherit' });
  console.log(`photos   → ${tar}`);
}
// keep the last 30 backups of each kind
for (const prefix of ['wtpm-2', 'wtpm-photos-']) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(dir, f));
}
