import Link from 'next/link';
import { PageHeader } from '@/components/ui';

const FLOW = [
  ['Login', 'Same username on tablet and PC'],
  ['Dashboard', 'See what is already entered today'],
  ['WTPM Quick Entry', 'Open on the tablet at the line'],
  ['Date + Shift + Machine', 'Type “Rob” → Robot Welding 1/2/4'],
  ['Part number', 'Parts used on this machine come first'],
  ['Bore + Cycle time', 'Filled from the Cycletime & Bore master'],
  ['Quantity + Defects', 'Qty, Defect, R/W, Hold, Setting c/o'],
  ['Loss details', 'Minutes per loss category'],
  ['Remarks / photo', 'Optional WTPM note photo'],
  ['Review', 'Checks, warnings, duplicates, shift OEE'],
  ['Save', 'One tap — record number shown'],
  ['Database + OEE', 'Central PostgreSQL, one calculation engine'],
  ['Dashboard + reports', 'Every PC refreshes automatically'],
];

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="flex gap-4">
    <div className="w-9 h-9 rounded-full bg-navy-800 text-white grid place-items-center font-bold shrink-0">{n}</div>
    <div className="pb-5"><h3 className="font-bold">{title}</h3><div className="text-sm text-[#3d3a48] mt-1 space-y-1.5">{children}</div></div>
  </li>
);

export default function Help() {
  return (
    <div className="max-w-[1100px]">
      <PageHeader title="Help / User Guide" sub="How WTPM data moves from the production floor to the management dashboard" />

      <section className="card p-5 sm:p-6">
        <h2 className="text-lg font-bold mb-4">Working route</h2>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {FLOW.map(([t, s], i) => (
            <li key={t} className={`rounded-2xl p-3.5 border ${i === 10 ? 'bg-brand-500 border-brand-500 text-white' : i >= 11 ? 'bg-navy-800 border-navy-800 text-white' : 'bg-white border-line'}`}>
              <div className={`text-xs font-bold ${i >= 10 ? 'text-white/70' : 'text-brand-500'}`}>Step {i + 1}</div>
              <div className="font-bold">{t}</div>
              <div className={`text-[13px] ${i >= 10 ? 'text-white/80' : 'text-muted'}`}>{s}</div>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-bold mb-4">Entering a WTPM note on the tablet</h2>
          <ol>
            <Step n={1} title="Open WTPM Quick Entry">Tap <Link className="underline font-semibold" href="/entry">WTPM Quick Entry</Link>. Add it to the tablet home screen (browser menu → “Add to Home screen”) so it opens like an app.</Step>
            <Step n={2} title="A — Date, shift, machine">Date defaults to today and shift to the current shift (S1 6:30–15:00, S2 15:00–23:30, S3 23:30–6:30). Shift 3 belongs to the date it <b>started</b>. Type a few letters of the machine (“Rob”, “Ace”, “sier”). Machine code, line and FM/NFM fill in automatically.</Step>
            <Step n={3} title="Use previous data">The last entry and the previous shift for that machine are shown. <b>USE PREVIOUS ENTRY</b> copies part numbers and loss categories. Quantities and minutes are only copied if you tick them, and stay highlighted until you check them against today’s note.</Step>
            <Step n={4} title="B — Parts and quantities">Pick the part number — parts used on this machine are listed first. Bore and cycle time come from the master and cannot be typed by the operator. If the part has no CT, the record can still be saved; it is flagged for the administrator. Add more part numbers if the machine ran several parts.</Step>
            <Step n={5} title="C — Losses">Enter minutes for each loss written on the note. Common categories show first; tap “Show all” for the rest. “Other” needs the reason in detail. The bar shows losses against planned time. For a half shift, tap “Half shift / different planned time?” and give the reason.</Step>
            <Step n={6} title="D — Remarks and photo">Add remarks and, if useful, a photo of the WTPM note or of the issue. The photo is evidence only — the typed values are the record.</Step>
            <Step n={7} title="Review &amp; Save">The review shows every value, the shift OEE and any warnings. Tick each warning you have checked. If a record already exists for the same machine and shift, choose to edit that record or save this as a separate one (a second part or a second note is normal). After saving, tap <b>Next machine</b> — date and shift are kept.</Step>
          </ol>
          <p className="text-xs text-muted">No network for a moment? The form is kept on the tablet; tap Save again when the connection is back.</p>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-bold mb-3">How OEE is calculated</h2>
          <p className="text-sm text-muted mb-3">Exactly as the “OEE data 1” sheet of the OEE MAIN SHEET. Each machine + date + shift is one block; all times are minutes.</p>
          <table className="table-x text-[13px]">
            <tbody>
              {[
                ['Total Qty Produced (AN)', 'Σ Qty produced of all parts'],
                ['Defect (AO)', 'Σ Defect'],
                ['Planned Time (AP)', 'Shift planned time if Qty > 0, else 0 (445 / 460 / 370 min)'],
                ['Total Losses (AQ)', 'Σ all 22 loss categories'],
                ['Management Losses (AR)', 'No Power … TPM & Cleaning (10 categories)'],
                ['Operating Time (AS)', 'Σ Qty × Cycle time'],
                ['%A with mgmt loss', '(Planned − Total losses) ÷ Planned'],
                ['%A w/o mgmt loss', '(Planned − Total losses) ÷ (Planned − Mgmt losses)'],
                ['%P', 'Operating ÷ (Planned − Total losses)'],
                ['%Q', '(Qty − Defect) ÷ Qty'],
                ['%OEE', '%A × %P × %Q'],
                ['Losses not captured', 'Planned − Total losses − Operating'],
              ].map(([k, v]) => <tr key={k}><td className="font-semibold !whitespace-normal">{k}</td><td className="!whitespace-normal">{v}</td></tr>)}
            </tbody>
          </table>
          <ul className="text-sm mt-3 space-y-1.5 list-disc pl-5">
            <li>Reports add up the block minutes first, then apply the same formulas (SUMIFS method of the summary sheets).</li>
            <li>The dashboard “OEE – C1 Plant” donuts are the average of the machine rows (Excel SUBTOTAL 101), with management loss.</li>
            <li>Week = CEILING(DAY / 7). Daily Report “losses not captured” = (Planned − Losses) × 0.85 − Operating.</li>
            <li>Several records for one machine in one shift are added together and the shift planned time is counted once.</li>
          </ul>
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <section className="card p-5">
          <h2 className="text-lg font-bold mb-2">Roles</h2>
          <ul className="text-sm space-y-2">
            <li><b>Data Entry Operator</b> — Quick Entry, own records, edit own records until verified.</li>
            <li><b>Production Supervisor</b> — enter data, all records, verify, request corrections, reports, type operating time.</li>
            <li><b>Management / HOD</b> — dashboards, reports, exports, records (read only).</li>
            <li><b>Administrator</b> — everything, plus users, master data, settings, imports, delete.</li>
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="text-lg font-bold mb-2">Corrections</h2>
          <ul className="text-sm space-y-2">
            <li>Open the record → <b>Edit / correct</b>. A reason is required; the old and new values are kept in the audit trail.</li>
            <li>Supervisors can <b>Request correction</b>; the record shows red until the operator fixes it.</li>
            <li>If two people edit the same record at once, the second save is stopped and asked to reload — nothing is overwritten silently.</li>
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="text-lg font-bold mb-2">Month end</h2>
          <ul className="text-sm space-y-2">
            <li><Link className="underline font-semibold" href="/reports/monthly">Monthly Reports</Link> → pick the month → <b>Monthly Excel</b> gives the OEE Overall Summary, weekly reports, weekly graph data, MIS loss report, Daily Report and the record-level “OEE data 1” sheet.</li>
            <li><b>Monthly PDF</b>, <b>Loss analysis PDF</b> and the machine-wise PDF (Machine Performance) are one click.</li>
            <li>Missing cycle times: Records → filter “Missing CT”; after the admin adds the CT, Master Data → “Apply to records missing CT”.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
