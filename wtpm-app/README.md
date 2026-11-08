# WTPM Digital Data Collection & OEE Management System

Replaces the paper → photo → office Excel → dashboard loop with **direct entry on a tablet at the
production line** and one central database that every PC reads live.

| Tablet — WTPM Quick Entry | PC — Dashboard (recreates `1.DASHBOARD`) |
|---|---|
| ![Quick entry](docs/screenshots/tablet-entry-b.png) | ![Dashboard](docs/screenshots/dashboard.png) |

* **WTPM Quick Entry** (tablet-first): date / shift / machine → part number → bore and cycle time from
  the master → quantities → losses → remarks and photo → review → save. Searchable dropdowns
  (“Rob” → Robot Welding 1/2/4), parts used on the machine first, previous-shift and last entry,
  **USE PREVIOUS ENTRY** (quantities and minutes are only copied when ticked and stay highlighted),
  live shift OEE while typing, duplicate detection, draft kept on the tablet if the network drops.
* **One calculation engine** (`src/lib/oee.ts`) ported from the formulas of `2.OEE MAIN SHEET` and
  tested against the workbook (see *Accuracy* below). Dashboard, records, reports and exports all use it.
* **Live sync**: a save on any tablet updates every open dashboard/report within about a second
  (PostgreSQL `LISTEN/NOTIFY` → Server-Sent Events, 60-second fallback refresh).
* **Reports** recreating the workbook: OEE Overall Summary (with and without management loss, Overall
  and FM rows, OEE ranking, OEE bands), Weekly Report per week, Weekly report graph, Weekly Loss /
  MIS Loss Report, Daily Report, line and shift summaries, revised method (cols BC–BS).
* **Exports**: Monthly Excel (sheets named and laid out like the workbook, incl. a record-level
  `OEE data 1` sheet), Monthly PDF, Loss-analysis PDF, Machine-wise PDF.
* **Roles**: Data Entry Operator, Production Supervisor, Management/HOD, Administrator.
* **Audit trail**: created/modified by and when, original and new values, reason for every
  correction, verifications, deletions (soft), master-data changes, imports, exports, logins.
* **Master data**: Machine List, Cycletime and Bore (2,406 parts imported), Shift Timings, loss
  categories, settings (photo mandatory, downtime warning %, OEE target and bands), Excel import.

---

## 1. Run it locally (developer PC)

Requirements: **Node.js 20+** and **PostgreSQL 14+** (16 recommended).

```bash
cd wtpm-app
cp .env.example .env            # set DATABASE_URL and a long AUTH_SECRET
npm install
createdb wtpm                   # or: psql -c "CREATE DATABASE wtpm"
npm run db:seed                 # migrations + Machine List + Cycletime & Bore + users + Oct-2026 sample month
npm run dev                     # http://localhost:3000  (also reachable from a tablet on the same Wi-Fi: http://<pc-ip>:3000)
```

First users (change the passwords after first login — *My account*):

| User | Password | Role |
|---|---|---|
| admin | Admin@123 (or `SEED_ADMIN_PASSWORD`) | Administrator |
| supervisor | Super@123 | Production Supervisor |
| manager | Manager@123 | Management / HOD |
| operator | Operator@123 | Data Entry Operator |

`npm run db:seed -- --no-sample` skips the October 2026 sample month (taken from the supplied
workbook). To load another month from a real workbook:

```bash
npm run db:import -- "D:/OEE/2.OEE MAIN SHEET- Dec'26.xlsx"            # Cycletime & Bore + OEE data 1
npm run db:import -- "D:/OEE/2.OEE MAIN SHEET- Dec'26.xlsx" --master-only
npm run db:import -- "...xlsx" --replace    # replace records imported earlier for the same dates
```
The same import is available in the app: *Master Data → Excel import* (with a “Check file” preview).

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `postgres://user:password@host:5432/wtpm` — the one central database |
| `AUTH_SECRET` | long random string that signs logins (`openssl rand -hex 32`) |
| `UPLOAD_DIR` | folder for WTPM note photos (outside the web root; include in backups) |
| `BACKUP_DIR` | where `npm run db:backup` writes dumps |
| `COOKIE_SECURE` | `true` when served over HTTPS |
| `SEED_ADMIN_USER`, `SEED_ADMIN_PASSWORD` | first administrator created by `db:seed` |
| `DB_POOL_MAX` | optional, default 20 connections |

---

## 2. Hosting options

| | Local development | Company LAN server (recommended) | Cloud hosting |
|---|---|---|---|
| Where it runs | your own PC | one always-on PC/VM in the plant | a hosted VM or platform |
| Who can open it | that PC (and tablets on the same Wi-Fi while the PC is on) | every tablet/PC on the company network | anywhere with internet |
| Data stays | on that PC | inside the company | with the provider |
| Internet needed | no | no | yes, at the line |
| Effort | none | small, IT keeps it running | domain, HTTPS, firewall, cost |

**Recommended: company LAN server.** Production tablets only need the plant Wi-Fi, data stays on
site, and there are no running costs. Typical setup:

1. A small server or VM (2 CPU, 4 GB RAM, 50 GB disk is plenty for years of data) with a fixed IP
   or DNS name, e.g. `http://wtpm.plant.local`.
2. Install PostgreSQL 16 and Node.js 22 (Windows or Linux), then:
   ```bash
   npm ci && npm run build && npm run db:migrate && npm run db:seed
   npm start          # serves on port 3000
   ```
   Keep it running as a service (Linux: systemd; Windows: NSSM or `pm2` + `pm2-windows-startup`).
   *Or* with Docker: `cp .env.example .env`, set `AUTH_SECRET` and `DB_PASSWORD`, then
   `docker compose up -d` and once `docker compose exec app npx tsx scripts/seed.ts`.
   (The Dockerfile/compose file are provided but were not built in the development sandbox — test once on the server.)
3. Optional but recommended: put **Nginx / IIS** in front with an internal HTTPS certificate and set
   `COOKIE_SECURE=true`. For the live updates, disable proxy buffering for `/api/stream`
   (`proxy_buffering off;` in Nginx).
4. On each tablet open the address and “Add to Home screen” — it opens straight into Quick Entry.
5. Allow port 3000 (or 80/443 behind the proxy) in the server firewall for the plant network only.

**Cloud** works the same way (any Node host + managed PostgreSQL, e.g. a VM, Render, Railway,
Supabase Postgres). Put it behind HTTPS, set `COOKIE_SECURE=true`, use strong passwords, and store
photos on a persistent disk (or change `src/lib/uploads.ts` to object storage).

Many users at once: each save is a single transaction; parallel saves for different machines never
block each other; two people editing the *same* record are protected by a version check (the second
save is refused with “reload and apply again”), so nothing is overwritten silently.

### Backups

```bash
npm run db:backup     # pg_dump (custom format) + tar of the photo folder → BACKUP_DIR, keeps 30 of each
```
Schedule it daily (cron / Task Scheduler) and copy `BACKUP_DIR` to another machine.
Restore: `createdb wtpm && pg_restore -d wtpm wtpm-YYYY-MM-DD-HH-MM.dump`, then copy the photo folder back.

---

## 3. How the workbook maps to the app

| Workbook sheet | Kind | In the app |
|---|---|---|
| `OEE data 1` (cols A–BB) | operational input | `production_entries` + `entry_lines` + `entry_losses`, entered in **WTPM Quick Entry** |
| `OEE data 1` (cols AN–BS) | per-block calculation | `src/lib/oee.ts` `buildBlocks` / `computeMetrics` |
| `Machine List` (+ Line, Cat from the summary) | master | `machines` — Master Data → Machine List |
| `Cycletime and Bore` | master | `part_master` — Master Data → Cycletime & Bore |
| `Shift Timings` | master | `shifts` — planned 445 / 460 / 370 min |
| ` OEE Overall Summary 1` | report | Monthly Reports → OEE Overall Summary |
| `Weekly Report -data 1`, `Weekly reports` | report | Weekly Reports (per week) |
| `Weekly report graph` | report | Weekly Reports / Monthly → Weekly |
| `Weekly Loss Report1-data`, `MIS loss report -data 1`, `Loss Report`, `Loss Report1-data 1` | report | Loss Analysis, Monthly → MIS Loss Report, Daily → loss report |
| `Daily Report` | report | Daily Reports |
| `1.DASHBOARD` (Table4, doughnuts, Leading/Lagging, Line & Machine slicers) | report | Dashboard |
| `Data  2`, `Overall Summary 2`, `Weekly reports `, `Detail2`, `Part-wise Report`, `Calc Info`, `Dashboad `, `Sheet1`, `Bottle Neck machine` | archive / scratch / copies | not separate pages (part-wise production is on Machine Performance) |

### Calculation rules (all minutes)

* Block = machine + date + shift. **AN** = Σ qty, **AO** = Σ defect, **AP** = shift planned time if
  AN > 0 else 0 (or a typed value), **AQ** = Σ all 22 loss columns, **AR** = Σ No Power … TPM &
  Cleaning, **AS** = Σ qty × CT.
* With management loss (dashboard): %A = (AP−AQ)/AP. Without: %A = (AP−AQ)/(AP−AR).
  %P = AS/(AP−AQ), %Q = (AN−AO)/AN, %OEE = %A×%P×%Q (IFERROR → blank).
* Reports SUMIFS the block minutes, then apply the same formulas; “Losses not captured” =
  AP − AQ − AS; Daily Report uses (AP − AQ) × 0.85 − AS. Dashboard plant donuts are the simple
  average of the machine rows (Excel `SUBTOTAL(101)`). Week = `CEILING(DAY/7)`.
* Revised method (BC–BS): BC = Planned downtime + No manpower + No material + No schedule + Try out
  + TPM; BF = AP − BC; BL = BF − AQ − AS; BN = BF − 0.85 × BL.
* Several records for the same machine and shift (different parts / notes) are one block; shift
  planned time counts once. A typed non-zero planned time (half shift) wins; a typed 0 is the
  workbook’s “continuation block” convention.
* Bore and CT are always looked up from the master (key = machine code + part number, first match,
  case-insensitive, like `VLOOKUP`) and stored with the record, so later CT changes do not rewrite
  history. Parts without a CT can be saved but are flagged; *Master Data → Apply to records missing CT*
  fills them after the admin adds the CT.

---

## 4. Accuracy and tests

```bash
npm test              # 43 unit/reconciliation tests (no database needed)
npm run test:e2e      # 17 end-to-end checks against a running server (needs Playwright + Chromium)
```

* **Block level**: every block of October 2026 whose workbook formulas are intact (560+) is
  reproduced exactly — AN, AO, AP, AQ, AR, AS and %A/%P/%Q/%OEE for both methods.
* **Monthly summary**: feeding the workbook’s own block values through the engine reproduces
  ` OEE Overall Summary 1` exactly for all 23 machines.
* **Import reconciliation**: importing October from the raw cells matches the workbook exactly for
  5 of the 9 active machines; the other 4 differ only by amounts traced to specific broken cells in
  the workbook — see [docs/EXCEL-RECONCILIATION.md](docs/EXCEL-RECONCILIATION.md).
* **End to end**: tablet entry with smart dropdowns and master CT/bore, live dashboard update on a
  second PC session, duplicate detection, validation (defect > qty, negative minutes, future date,
  Other without reason), photo upload and type check, correction with reason + audit + stale-version
  protection, verification lock, role permissions, report/Excel/PDF contents, portrait layout.

## 5. Project layout

```
wtpm-app/
  db/migrations/        SQL schema + reference data (shifts, loss categories, settings)
  db/seed-data/         Machine List, Cycletime & Bore, October 2026 sample month (from the workbooks)
  scripts/              migrate, seed, import-excel, backup
  src/lib/oee.ts        the OEE calculation engine
  src/lib/reports.ts    report builder (dashboard, summary, weekly, daily, loss) — single source of truth
  src/lib/entries.ts    validation, duplicate checks, save / correct / verify / delete + audit
  src/lib/exports.ts    Excel and PDF exports
  src/lib/excel-import.ts, xlsx-lite.ts   workbook import
  src/app/(app)/        pages: dashboard, entry, records, machines, reports, losses, master, users, audit, help
  src/app/api/          JSON API (auth, entries, suggest, uploads, stream, reports, exports, master, users, audit)
  tests/                engine + reconciliation tests, fixtures from the workbook, e2e script
```
