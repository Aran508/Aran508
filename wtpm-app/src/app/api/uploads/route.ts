import { createHash } from 'node:crypto';
import { api, requireUser, HttpError, clientIp } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import { sniffImage, storeFile } from '@/lib/uploads';
import { audit } from '@/lib/audit';
import { assertCanEdit } from '@/lib/entries';

/** Upload a WTPM note photo or an issue photo. Optional entryId links it to an existing record. */
export const POST = api(async (req: Request) => {
  const user = await requireUser('entry.create');
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'No photo received');
  const maxMb = Number((await queryOne<{ value: number }>("SELECT value FROM settings WHERE key = 'max_photo_mb'"))?.value ?? 12);
  if (file.size > maxMb * 1024 * 1024) throw new HttpError(413, `Photo is larger than ${maxMb} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(415, 'Only JPEG, PNG, WebP or HEIC photos are accepted');
  const k = String(form.get('kind') || 'wtpm_note');
  if (!['wtpm_note', 'issue'].includes(k)) throw new HttpError(422, 'Invalid photo type');
  const entryId = (form.get('entryId') as string) || null;
  if (entryId) {
    const e = await queryOne<{ created_by: number; status: string }>('SELECT created_by, status FROM production_entries WHERE id = $1 AND deleted_at IS NULL', [entryId]);
    if (!e) throw new HttpError(404, 'Record not found');
    assertCanEdit(e, user);
  }
  const inDb = process.env.PHOTO_STORAGE === 'database';
  const stored = inDb ? { key: 'database', sha256: createHash('sha256').update(buf).digest('hex') } : await storeFile(buf, kind.ext);
  const [row] = await query<{ id: string }>(
    `INSERT INTO attachments (entry_id, kind, file_name, mime_type, size_bytes, storage_key, sha256, caption, uploaded_by, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [entryId, k, (file.name || `photo.${kind.ext}`).slice(0, 200), kind.mime, buf.length, stored.key, stored.sha256, (form.get('caption') as string)?.slice(0, 300) || null, user.uid, inDb ? buf : null],
  );
  if (entryId) await audit(null, { entity: 'production_entry', entityId: entryId, action: 'attach_photo', userId: user.uid, newValue: { attachment: row.id, kind: k }, ip: await clientIp() });
  return { id: row.id, kind: k, mime: kind.mime, size: buf.length };
});
