-- Optional in-database photo storage (PHOTO_STORAGE=database), used on hosts without a
-- persistent disk such as Vercel. On a company server photos stay in UPLOAD_DIR.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS data BYTEA;
