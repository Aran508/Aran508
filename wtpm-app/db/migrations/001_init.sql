-- WTPM Digital Data Collection & OEE Management System
-- Initial schema. All times are stored in MINUTES, exactly like the Excel "OEE data 1" sheet.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('operator','supervisor','management','admin')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));

-- ---------------------------------------------------------------- master data
-- Excel: 'Machine List' (S.No., Code, Machine) + Line / Cat columns of 'OEE Overall Summary 1'
CREATE TABLE machines (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  line       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',          -- FM / NFM
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX machines_code_uq ON machines (lower(code));

-- Excel: 'Shift Timings'. planned_minutes = total - lunch - tea - tpm (column G)
CREATE TABLE shifts (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  timings       TEXT NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  total_minutes NUMERIC NOT NULL,
  lunch_minutes NUMERIC NOT NULL DEFAULT 0,
  tea_minutes   NUMERIC NOT NULL DEFAULT 0,
  tpm_minutes   NUMERIC NOT NULL DEFAULT 0,
  planned_minutes NUMERIC GENERATED ALWAYS AS (total_minutes - lunch_minutes - tea_minutes - tpm_minutes) STORED,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Excel: 'Cycletime and Bore' (key = Part Number & Machine Code, CT in minutes per piece)
CREATE TABLE part_master (
  id             SERIAL PRIMARY KEY,
  machine_id     INTEGER NOT NULL REFERENCES machines(id),
  part_number    TEXT NOT NULL,
  cycle_time_min NUMERIC NOT NULL CHECK (cycle_time_min >= 0),
  bore           NUMERIC,
  notes          TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     INTEGER REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX part_master_uq ON part_master (machine_id, upper(part_number));
CREATE INDEX part_master_part_idx ON part_master (upper(part_number));

-- Excel loss columns R..AM of 'OEE data 1'
CREATE TABLE loss_categories (
  code             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  excel_column     TEXT NOT NULL,
  oee_group        TEXT NOT NULL CHECK (oee_group IN ('A','P','Q','M')),
  section          TEXT NOT NULL CHECK (section IN ('process','management')),
  is_management    BOOLEAN NOT NULL,   -- counted in "Management Losses" (Excel AR = SUM(AA:AJ))
  is_revised_excl  BOOLEAN NOT NULL,   -- Excel BC: Planned downtime + No manpower + No material + No schedule + Try out + TPM
  requires_reason  BOOLEAN NOT NULL DEFAULT FALSE,
  is_common        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INTEGER NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- production records
-- One record = one WTPM note entry for a machine in a shift. A machine can have several
-- records in the same shift; for OEE they are grouped into the Excel "block"
-- (date + shift + machine) so shift planned time is counted once.
CREATE SEQUENCE entry_no_seq START 1001;
CREATE TABLE production_entries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no                 INTEGER NOT NULL DEFAULT nextval('entry_no_seq') UNIQUE,
  prod_date                DATE NOT NULL,
  shift_id                 INTEGER NOT NULL REFERENCES shifts(id),
  machine_id               INTEGER NOT NULL REFERENCES machines(id),
  planned_time_override    NUMERIC CHECK (planned_time_override >= 0),
  planned_override_reason  TEXT,
  operating_time_override  NUMERIC CHECK (operating_time_override >= 0),
  operating_override_reason TEXT,
  other_loss_reason        TEXT,
  remarks                  TEXT,
  status                   TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','verified','correction_requested')),
  correction_note          TEXT,
  source                   TEXT NOT NULL DEFAULT 'tablet' CHECK (source IN ('tablet','pc','import')),
  version                  INTEGER NOT NULL DEFAULT 1,
  created_by               INTEGER REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               INTEGER REFERENCES users(id),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by              INTEGER REFERENCES users(id),
  verified_at              TIMESTAMPTZ,
  deleted_at               TIMESTAMPTZ,
  deleted_by               INTEGER REFERENCES users(id),
  import_ref               TEXT
);
CREATE INDEX entries_block_idx ON production_entries (prod_date, shift_id, machine_id) WHERE deleted_at IS NULL;
CREATE INDEX entries_machine_idx ON production_entries (machine_id, prod_date DESC);
CREATE INDEX entries_created_by_idx ON production_entries (created_by);

-- Part lines (Excel rows inside a block: Part Number, Qty, Defect, R/W, Hold, Setting change over count, Bore, CT)
CREATE TABLE entry_lines (
  id               SERIAL PRIMARY KEY,
  entry_id         UUID NOT NULL REFERENCES production_entries(id) ON DELETE CASCADE,
  line_no          INTEGER NOT NULL,
  part_number      TEXT NOT NULL,
  part_master_id   INTEGER REFERENCES part_master(id),
  bore             NUMERIC,
  cycle_time_min   NUMERIC,             -- snapshot of the master CT at save time
  qty              NUMERIC NOT NULL DEFAULT 0 CHECK (qty >= 0),
  defect           NUMERIC NOT NULL DEFAULT 0 CHECK (defect >= 0),
  rework           NUMERIC NOT NULL DEFAULT 0 CHECK (rework >= 0),
  hold             NUMERIC NOT NULL DEFAULT 0 CHECK (hold >= 0),
  setting_changeover_count NUMERIC NOT NULL DEFAULT 0 CHECK (setting_changeover_count >= 0),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX entry_lines_part_idx ON entry_lines (upper(part_number));

CREATE TABLE entry_losses (
  entry_id      UUID NOT NULL REFERENCES production_entries(id) ON DELETE CASCADE,
  category_code TEXT NOT NULL REFERENCES loss_categories(code),
  minutes       NUMERIC NOT NULL CHECK (minutes >= 0),
  PRIMARY KEY (entry_id, category_code)
);

CREATE TABLE attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     UUID REFERENCES production_entries(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('wtpm_note','issue')),
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_key  TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  caption      TEXT,
  uploaded_by  INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entry_idx ON attachments (entry_id);

-- ---------------------------------------------------------------- audit trail
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  reason      TEXT,
  old_value   JSONB,
  new_value   JSONB,
  changed_by  INTEGER REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address  TEXT
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_time_idx ON audit_log (changed_at DESC);
