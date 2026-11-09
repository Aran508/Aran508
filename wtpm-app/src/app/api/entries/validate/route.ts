import { api, requireUser } from '@/lib/auth';
import { EntrySchema, validateEntry } from '@/lib/entries';
/** Dry run: returns errors, warnings, duplicates and the OEE preview without saving. */
export const POST = api(async (req: Request) => {
  const user = await requireUser('entry.create');
  const body = await req.json();
  const input = EntrySchema.parse(body);
  const v = await validateEntry(input, user, body.id || undefined);
  return { errors: v.errors, warnings: v.warnings, duplicates: v.duplicates, preview: v.preview, lines: v.lines };
});
