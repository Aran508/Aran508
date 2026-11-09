/**
 * Excel and PDF exports. Both use monthlyReport() — the same numbers as the screens.
 * Excel sheet names and column layouts follow "2.OEE MAIN SHEET" so the report can be pasted
 * into, or compared with, the existing workbook.
 */
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { query } from './db';
import { monthlyReport, loadBlocks, type MonthlyReport, type MachineSummaryRow } from './reports';
import type { Summary } from './oee';

const NAVY = 'FF261A66';
const ORANGE = 'FFEF5F18';
const pctFmt = '0.0%';
const numFmt = '#,##0.00';

const SUMMARY_HEAD = ['S.No.', 'Cat', 'LINE', 'Code', 'Machine', 'Total Qty Produced', 'Defects', 'Planned Time', 'Total Losses', 'Management Losses', 'Operating Time', '%A', '% P', '%Q', '%OEE', '%A2', '%P', '%Q3', '%OEE4', 'Losses not captured', 'Losses not captured (hrs)'];

function summaryValues(r: Summary & { sno?: number; category?: string; line?: string; code?: string; machine?: string }, label?: string) {
  return [r.sno ?? '', r.category ?? '', r.line ?? '', r.code ?? '', label ?? r.machine ?? '', r.qty, r.defect, r.plannedTime, r.totalLosses, r.managementLosses, r.operatingTime, r.woA, r.woP, r.woQ, r.woOEE, r.A, r.P, r.Q, r.OEE, r.lossesNotCaptured, r.lossesNotCaptured / 60];
}

function styleHeader(row: ExcelJS.Row, color = NAVY) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  row.height = 32;
}

function title(ws: ExcelJS.Worksheet, text: string, sub?: string) {
  ws.addRow([text]).font = { bold: true, size: 14, color: { argb: NAVY } };
  if (sub) ws.addRow([sub]).font = { italic: true, color: { argb: 'FF666666' } };
  ws.addRow([]);
}

function addSummaryTable(ws: ExcelJS.Worksheet, rows: MachineSummaryRow[], overall: Summary, fm: Summary) {
  ws.addRow(['', '', '', '', '', '', '', 'Minutes', '', '', '', 'w/o mgmt Loss', '', '', '', 'with mgmt Loss']).font = { italic: true, color: { argb: 'FF666666' } };
  styleHeader(ws.addRow(SUMMARY_HEAD));
  for (const r of rows) {
    const row = ws.addRow(summaryValues(r));
    if (r.band === 'low') row.getCell(19).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE2E1' } };
    else if (r.band === 'high') row.getCell(19).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCF5E3' } };
  }
  const o = ws.addRow(summaryValues(overall, 'Overall'));
  o.font = { bold: true };
  ws.addRow(summaryValues(fm, 'FM')).font = { bold: true };
  ws.columns.forEach((c, i) => {
    c.width = i === 4 ? 22 : i < 4 ? 8 : 13;
    if (i >= 11 && i <= 18) c.numFmt = pctFmt;
    else if (i >= 5) c.numFmt = numFmt;
  });
}

function addRanking(ws: ExcelJS.Worksheet, r: MonthlyReport['summary'], bands: { low: number; high: number }) {
  ws.addRow([]);
  styleHeader(ws.addRow(['', '', '', '', 'Machine', '%OEE4', 'OEE Ranking']), ORANGE);
  for (const x of r.ranking) ws.addRow(['', '', '', '', x.machine, x.OEE, x.rank]).getCell(6).numFmt = pctFmt;
  ws.addRow([]);
  styleHeader(ws.addRow(['S.No.', 'LINE ', 'Machine', `OEE(<${bands.low * 100}%)`, `OEE (${bands.low * 100}%-${bands.high * 100}%)`, `OEE (>${bands.high * 100}%)`]), ORANGE);
  r.rows.forEach((x, i) => {
    const row = ws.addRow([i + 1, x.line, x.machine, x.band === 'low' ? x.OEE : null, x.band === 'mid' ? x.OEE : null, x.band === 'high' ? x.OEE : null]);
    [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = pctFmt));
  });
}

export async function monthlyWorkbook(month: string, opts: { machineIds?: number[]; line?: string | null } = {}) {
  const r = await monthlyReport(month, opts);
  const cats = r.meta.categories;
  const bands = (r.meta.settings.oee_bands as { low: number; high: number }) ?? { low: 0.6, high: 0.8 };
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WTPM OEE System';
  wb.created = new Date();

  // 1 — OEE Overall Summary
  const s1 = wb.addWorksheet(' OEE Overall Summary 1', { views: [{ state: 'frozen', ySplit: 5 }] });
  title(s1, `OEE Overall Summary — ${r.label}`, `${r.from} to ${r.to} · ${r.entryCount} records · generated ${new Date().toLocaleString('en-GB')}`);
  addSummaryTable(s1, r.summary.rows, r.summary.overall, r.summary.fm);
  addRanking(s1, r.summary, bands);

  // 2 — Weekly reports (one sheet per week, same layout as 'Weekly Report -data 1')
  for (const w of r.weekly) {
    if (!w.blocks) continue;
    const ws = wb.addWorksheet(`Weekly Report W${w.week}`, { views: [{ state: 'frozen', ySplit: 5 }] });
    title(ws, `Weekly Report — ${r.label} — Week ${w.week}`, 'Week = CEILING(DAY(date)/7)');
    addSummaryTable(ws, w.summary.rows, w.summary.overall, w.summary.fm);
    addRanking(ws, w.summary, bands);
  }

  // 3 — Weekly report graph data
  const wg = wb.addWorksheet('Weekly report graph');
  title(wg, `Machine-wise weekly %OEE — ${r.label}`);
  styleHeader(wg.addRow(['Machine', ...r.weeklyMatrix.weeks.map((w) => `week ${w}`)]));
  for (const m of r.weeklyMatrix.rows) {
    const row = wg.addRow([m.machine, ...m.weeks.map((w) => w.OEE)]);
    m.weeks.forEach((_, i) => (row.getCell(i + 2).numFmt = pctFmt));
  }
  wg.addRow([]);
  styleHeader(wg.addRow(['Machine', ...r.weeklyMatrix.weeks.map((w) => `Losses not captured W${w}`)]));
  for (const m of r.weeklyMatrix.rows) wg.addRow([m.machine, ...m.weeks.map((w) => Math.round(w.lossesNotCaptured * 100) / 100)]);
  wg.getColumn(1).width = 24;

  // 4 — MIS loss report (minutes) + hours grouped as 'Weekly Loss Report1-data'
  const ml = wb.addWorksheet('MIS loss report', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] });
  title(ml, `MIS Loss Report (minutes) — ${r.label}`);
  styleHeader(ml.addRow(['S.No ', 'Machine ', 'OEE Ranking', ...cats.map((c) => c.name.toUpperCase()), 'Losses not captured', 'Total losses', 'Cat', 'Min Part change Time', 'Max Part change Time']));
  for (const x of r.loss.rows) ml.addRow([x.sno, x.machine, x.rank, ...cats.map((c) => x.losses[c.code] || 0), x.lossesNotCaptured, x.totalLosses, x.category, x.minPartChange, x.maxPartChange]);
  ml.addRow(['', 'Total', '', ...cats.map((c) => r.loss.totals[c.code] || 0), r.summary.overall.lossesNotCaptured, r.summary.overall.totalLosses]).font = { bold: true };
  ml.addRow([]);
  ml.addRow(['Hours, grouped by OEE factor (as Weekly Loss Report1-data)']).font = { bold: true, color: { argb: NAVY } };
  const g = (k: 'A' | 'P' | 'Q' | 'M') => cats.filter((c) => c.oee_group === k);
  styleHeader(ml.addRow(['S.No ', 'Machine ', 'A (BD+PC+TC+SU)', ...g('A').map((c) => c.name), 'P (MS+SL)', ...g('P').map((c) => c.name), 'Losses not captured', 'Q (Def+RW)', ...g('Q').map((c) => c.name), 'Planned / Mgmt', ...g('M').map((c) => c.name), 'Total losses']));
  for (const x of r.loss.rows) {
    const h = (code: string) => (x.losses[code] || 0) / 60;
    ml.addRow([x.sno, x.machine, x.groups.A / 60, ...g('A').map((c) => h(c.code)), x.groups.P / 60, ...g('P').map((c) => h(c.code)), x.lossesNotCaptured / 60, x.groups.Q / 60, ...g('Q').map((c) => h(c.code)), x.groups.M / 60, ...g('M').map((c) => h(c.code)), x.totalLosses / 60]).eachCell((c, i) => {
      if (i > 2) c.numFmt = '0.00';
    });
  }
  ml.getColumn(2).width = 24;

  // 5 — Daily Report
  const dr = wb.addWorksheet('Daily Report', { views: [{ state: 'frozen', ySplit: 5 }] });
  title(dr, `Daily Report — ${r.label}`, "Losses not captured = (Planned Time - Total Losses) × 0.85 - Operating Time, as in the workbook's Daily Report");
  dr.addRow(['', '', '', '', '', '', '', '', 'Without Mgmt Loss', '', '', '', 'With Mgmt Loss']).font = { italic: true };
  styleHeader(dr.addRow(['Date', 'Total Qty Produced', 'Defects', 'Planned Time', 'Total Losses', 'Management Losses', 'Operating Time', 'Losses not captured', '%A', '%P', '%Q', '%OEE', '%A', '%P', '%Q', '%OEE']));
  for (const d of r.daily) {
    const row = dr.addRow([d.date, d.qty, d.defect, d.plannedTime, d.totalLosses, d.managementLosses, d.operatingTime, d.blocks ? d.dailyLossesNotCaptured : 0, d.woA, d.woP, d.woQ, d.woOEE, d.A, d.P, d.Q, d.OEE]);
    for (let i = 9; i <= 16; i++) row.getCell(i).numFmt = pctFmt;
    for (let i = 2; i <= 8; i++) row.getCell(i).numFmt = numFmt;
  }
  dr.getColumn(1).width = 12;

  // 6 — Line & shift
  const ls = wb.addWorksheet('Line & Shift');
  title(ls, `Line-wise and shift-wise OEE — ${r.label}`);
  styleHeader(ls.addRow(['Line', 'Total Qty Produced', 'Defects', 'Planned Time', 'Total Losses', 'Management Losses', 'Operating Time', '%A', '%P', '%Q', '%OEE']));
  for (const l of r.lines) ls.addRow([l.line, l.qty, l.defect, l.plannedTime, l.totalLosses, l.managementLosses, l.operatingTime, l.A, l.P, l.Q, l.OEE]).eachCell((c, i) => (c.numFmt = i >= 8 ? pctFmt : i > 1 ? numFmt : '@'));
  ls.addRow([]);
  styleHeader(ls.addRow(['Shift', 'Total Qty Produced', 'Defects', 'Planned Time', 'Total Losses', 'Management Losses', 'Operating Time', '%A', '%P', '%Q', '%OEE']));
  for (const l of r.shifts) ls.addRow([`${l.shift} (${l.timings})`, l.qty, l.defect, l.plannedTime, l.totalLosses, l.managementLosses, l.operatingTime, l.A, l.P, l.Q, l.OEE]).eachCell((c, i) => (c.numFmt = i >= 8 ? pctFmt : i > 1 ? numFmt : '@'));
  ls.getColumn(1).width = 30;

  // 7 — OEE data (record-level, 'OEE data 1' column layout)
  await addOeeDataSheet(wb, r.from, r.to, opts);

  // 8 — Shift Timings (reference)
  const st = wb.addWorksheet('Shift Timings');
  styleHeader(st.addRow(['Shift', 'Timings', 'Total Time (mins)', 'Lunch (mins)', 'Tea (mins)', 'TPM (mins)', 'Planned Time (mins)']));
  for (const s of r.meta.shifts) st.addRow([s.id, s.timings, s.total_minutes, s.lunch_minutes, s.tea_minutes, s.tpm_minutes, s.planned_minutes]);
  st.getColumn(2).width = 22;

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), report: r };
}

/** Record-level sheet in the original 'OEE data 1' layout (one row per part line, block columns on the first line). */
async function addOeeDataSheet(wb: ExcelJS.Workbook, from: string, to: string, opts: { machineIds?: number[]; line?: string | null }) {
  const ws = wb.addWorksheet('OEE data 1', { views: [{ state: 'frozen', ySplit: 3, xSplit: 3 }] });
  const cats = (await query<{ code: string; name: string }>('SELECT code, name FROM loss_categories ORDER BY sort_order'));
  ws.addRow([`Records ${from} to ${to}`]).font = { bold: true, color: { argb: NAVY } };
  ws.addRow([]);
  styleHeader(ws.addRow(['DATE', 'Machine Code', 'Machine', 'Week', 'Date 2', 'Shift 2', 'Record No.', 'Line', 'Bore', 'CT', 'Shift', 'Part Number', 'Qty Produced', 'Defect ', 'R/W', 'Hold', 'Setting change over  count', ...cats.map((c) => c.name.toUpperCase()), 'Total Qty Produced', 'Defect', 'Planned Time', 'Total Losses', 'Management Losses', 'Operating Time', '%A', '%P', '%Q', '%OEE', '%A', '%P', '%Q', '%OEE', 'Remarks', 'Entered by', 'Status']));
  const { meta, blocks } = await loadBlocks({ from, to, machineIds: opts.machineIds, line: opts.line });
  const { computeMetrics } = await import('./oee');
  const blockMap = new Map(blocks.map((b) => [b.key, { b, m: computeMetrics(b) }]));
  const entries = await query<{ id: string; entry_no: number; prod_date: string; shift_id: number; machine_id: number; remarks: string | null; other_loss_reason: string | null; by: string | null; status: string; lines: { part: string; qty: number; defect: number; rework: number; hold: number; setting: number; ct: number | null; bore: number | null }[] | null; losses: Record<string, number> | null }>(
    `SELECT e.id, e.entry_no, e.prod_date::text AS prod_date, e.shift_id, e.machine_id, e.remarks, e.other_loss_reason, u.full_name AS by, e.status,
       (SELECT json_agg(json_build_object('part', part_number, 'qty', qty, 'defect', defect, 'rework', rework, 'hold', hold, 'setting', setting_changeover_count, 'ct', cycle_time_min, 'bore', bore) ORDER BY line_no) FROM entry_lines WHERE entry_id = e.id) AS lines,
       (SELECT json_object_agg(category_code, minutes) FROM entry_losses WHERE entry_id = e.id) AS losses
     FROM production_entries e LEFT JOIN users u ON u.id = e.created_by JOIN machines m ON m.id = e.machine_id
     WHERE e.deleted_at IS NULL AND e.prod_date BETWEEN $1 AND $2 AND ($3::int[] IS NULL OR e.machine_id = ANY($3)) AND ($4::text IS NULL OR trim(m.line) = $4)
     ORDER BY e.prod_date, e.shift_id, m.sort_order, e.created_at`,
    [from, to, opts.machineIds?.length ? opts.machineIds : null, opts.line ?? null],
  );
  const machines = new Map(meta.machines.map((m) => [m.id, m]));
  const seenBlock = new Set<string>();
  for (const e of entries) {
    const m = machines.get(e.machine_id)!;
    const key = `${e.prod_date}|${e.shift_id}|${e.machine_id}`;
    const first = !seenBlock.has(key);
    seenBlock.add(key);
    const bm = blockMap.get(key);
    const lines = e.lines?.length ? e.lines : [{ part: '', qty: 0, defect: 0, rework: 0, hold: 0, setting: 0, ct: null, bore: null }];
    lines.forEach((l, i) => {
      const lossCells = i === 0 ? cats.map((c) => (e.losses?.[c.code] ? Number(e.losses[c.code]) : null)) : cats.map(() => null);
      const blockCells = first && i === 0 && bm ? [bm.b.qty, bm.b.defect, bm.b.plannedTime, bm.b.totalLosses, bm.b.managementLosses, bm.b.operatingTime, bm.m.woA, bm.m.woP, bm.m.woQ, bm.m.woOEE, bm.m.A, bm.m.P, bm.m.Q, bm.m.OEE] : Array(14).fill(null);
      const row = ws.addRow([
        i === 0 ? Number(e.prod_date.slice(8, 10)) : null, i === 0 ? m.code : null, m.name, Math.ceil(Number(e.prod_date.slice(8, 10)) / 7), e.prod_date, e.shift_id, e.entry_no, m.line.trim(),
        l.bore, l.ct, i === 0 ? e.shift_id : null, l.part, Number(l.qty) || null, Number(l.defect) || null, Number(l.rework) || null, Number(l.hold) || null, Number(l.setting) || null,
        ...lossCells, ...blockCells, i === 0 ? [e.remarks, e.other_loss_reason].filter(Boolean).join(' | ') || null : null, i === 0 ? e.by : null, i === 0 ? e.status : null,
      ]);
      const base = 17 + cats.length;
      for (let k = base + 7; k <= base + 14; k++) row.getCell(k).numFmt = pctFmt;
    });
  }
  ws.getColumn(3).width = 20;
}

// ------------------------------------------------------------------ PDF
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const n0 = (v: number) => (Math.round(v * 100) / 100).toLocaleString('en-IN');
const hrs = (v: number) => (v / 60).toFixed(1);

function pdfHeader(doc: jsPDF, title: string, sub: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(38, 26, 102);
  doc.rect(0, 0, w, 54, 'F');
  doc.setFillColor(239, 95, 24);
  doc.rect(0, 54, w, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 28, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(sub, 28, 44);
  doc.setTextColor(30, 30, 30);
}

function pdfFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const h = doc.internal.pageSize.getHeight();
    doc.text(`WTPM OEE System · generated ${new Date().toLocaleString('en-GB')} · page ${i} of ${pages}`, 28, h - 14);
  }
}

const tableStyle = {
  styles: { fontSize: 7, cellPadding: 2.5, lineColor: [225, 225, 232] as [number, number, number], lineWidth: 0.4 },
  headStyles: { fillColor: [38, 26, 102] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, halign: 'center' as const },
  alternateRowStyles: { fillColor: [247, 246, 251] as [number, number, number] },
  margin: { left: 28, right: 28 },
};

function lastY(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
}

function kpiStrip(doc: jsPDF, y: number, items: [string, string][]) {
  const w = doc.internal.pageSize.getWidth() - 56;
  const cw = w / items.length;
  items.forEach(([k, v], i) => {
    const x = 28 + i * cw;
    doc.setDrawColor(225, 225, 232);
    doc.setFillColor(i === items.length - 1 ? 255 : 250, i === items.length - 1 ? 239 : 250, i === items.length - 1 ? 229 : 252);
    doc.roundedRect(x + 2, y, cw - 4, 40, 6, 6, 'FD');
    doc.setFontSize(7);
    doc.setTextColor(110, 110, 120);
    doc.text(k, x + 10, y + 13);
    doc.setFontSize(14);
    doc.setTextColor(38, 26, 102);
    doc.setFont('helvetica', 'bold');
    doc.text(v, x + 10, y + 32);
    doc.setFont('helvetica', 'normal');
  });
  doc.setTextColor(30, 30, 30);
  return y + 52;
}

function summaryBody(rows: MachineSummaryRow[]): RowInput[] {
  return rows.filter((r) => r.hasData).map((r) => [r.line, r.machine, n0(r.qty), n0(r.defect), hrs(r.plannedTime), hrs(r.totalLosses), hrs(r.managementLosses), hrs(r.operatingTime), pct(r.woA), pct(r.woOEE), pct(r.A), pct(r.P), pct(r.Q), pct(r.OEE), hrs(r.lossesNotCaptured), r.rank ?? '']);
}
const SUMMARY_PDF_HEAD = [['Line', 'Machine', 'Qty', 'Defects', 'Planned h', 'Losses h', 'Mgmt h', 'Operating h', '%A w/o', '%OEE w/o', '%A', '%P', '%Q', '%OEE', 'Not capt. h', 'Rank']];

export async function monthlyPdf(month: string, opts: { machineIds?: number[]; line?: string | null } = {}) {
  const r = await monthlyReport(month, opts);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  pdfHeader(doc, `Monthly OEE Report — ${r.label}`, `${r.meta.settings.plant_name ?? ''} · ${r.from} to ${r.to} · ${r.entryCount} WTPM records · with management loss method (dashboard) and without`);
  let y = kpiStrip(doc, 70, [
    ['Total Qty Produced', n0(r.summary.overall.qty)],
    ['Defects', n0(r.summary.overall.defect)],
    ['Planned Time (h)', hrs(r.summary.overall.plannedTime)],
    ['Total Losses (h)', hrs(r.summary.overall.totalLosses)],
    ['Availability', pct(r.summary.plantAverage.A)],
    ['Performance', pct(r.summary.plantAverage.P)],
    ['Quality', pct(r.summary.plantAverage.Q)],
    ['OEE (plant avg)', pct(r.summary.plantAverage.OEE)],
  ]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Machine-wise OEE summary (OEE Overall Summary 1)', 28, y + 4);
  doc.setFont('helvetica', 'normal');
  const o = r.summary.overall;
  autoTable(doc, { ...tableStyle, startY: y + 10, head: SUMMARY_PDF_HEAD, body: [...summaryBody(r.summary.rows), [{ content: 'Overall (from totals)', colSpan: 2, styles: { fontStyle: 'bold' } }, n0(o.qty), n0(o.defect), hrs(o.plannedTime), hrs(o.totalLosses), hrs(o.managementLosses), hrs(o.operatingTime), pct(o.woA), pct(o.woOEE), pct(o.A), pct(o.P), pct(o.Q), pct(o.OEE), hrs(o.lossesNotCaptured), '']],
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 13) { const v = parseFloat(String(d.cell.raw)); if (!Number.isNaN(v)) d.cell.styles.textColor = v < 60 ? [200, 30, 30] : v >= 80 ? [20, 130, 60] : [180, 120, 0]; d.cell.styles.fontStyle = 'bold'; } } });

  doc.addPage();
  pdfHeader(doc, `Weekly summary & loss analysis — ${r.label}`, 'Week = CEILING(DAY/7) · losses in hours');
  autoTable(doc, { ...tableStyle, startY: 70, head: [['Machine', ...r.weeklyMatrix.weeks.map((w) => `Week ${w} OEE`), 'Month OEE']], body: r.weeklyMatrix.rows.map((m) => [m.machine, ...m.weeks.map((w) => pct(w.OEE)), pct(r.summary.rows.find((x) => x.machineId === m.machineId)?.OEE)]) });
  const cats = r.meta.categories.filter((c) => (r.loss.totals[c.code] || 0) > 0);
  autoTable(doc, { ...tableStyle, startY: lastY(doc) + 16, head: [['Machine', ...cats.map((c) => c.name), 'Not capt.', 'Total']], body: [...r.loss.rows.filter((x) => x.hasData).map((x) => [x.machine, ...cats.map((c) => hrs(x.losses[c.code] || 0)), hrs(x.lossesNotCaptured), hrs(x.totalLosses)]), [{ content: 'Total', styles: { fontStyle: 'bold' } }, ...cats.map((c) => hrs(r.loss.totals[c.code] || 0)), hrs(o.lossesNotCaptured), hrs(o.totalLosses)]], styles: { ...tableStyle.styles, fontSize: 6 } });

  doc.addPage();
  pdfHeader(doc, `Daily performance — ${r.label}`, 'Daily Report sheet · losses not captured = (Planned − Losses) × 0.85 − Operating');
  autoTable(doc, { ...tableStyle, startY: 70, head: [['Date', 'Qty', 'Defects', 'Planned h', 'Losses h', 'Mgmt h', 'Operating h', 'Not capt. h', '%A', '%P', '%Q', '%OEE']], body: r.daily.filter((d) => d.blocks).map((d) => [d.date, n0(d.qty), n0(d.defect), hrs(d.plannedTime), hrs(d.totalLosses), hrs(d.managementLosses), hrs(d.operatingTime), hrs(d.dailyLossesNotCaptured), pct(d.A), pct(d.P), pct(d.Q), pct(d.OEE)]) });
  autoTable(doc, { ...tableStyle, startY: lastY(doc) + 16, head: [['Rank', 'Machine', 'Line', '%OEE', 'Band']], body: r.summary.ranking.map((x) => [x.rank, x.machine, x.line, pct(x.OEE), x.band === 'low' ? 'OEE < 60%' : x.band === 'mid' ? 'OEE 60–80%' : 'OEE > 80%']), tableWidth: 360 });
  pdfFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

export async function machinePdf(month: string, machineId: number) {
  const r = await monthlyReport(month, { machineIds: [machineId] });
  const row = r.summary.rows.find((x) => x.machineId === machineId);
  const m = r.meta.machines.find((x) => x.id === machineId);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  pdfHeader(doc, `Machine report — ${m?.name ?? machineId} — ${r.label}`, `Code ${m?.code} · Line ${m?.line} · ${m?.category} · ${r.entryCount} records`);
  let y = 70;
  if (row) {
    y = kpiStrip(doc, y, [['Total Qty', n0(row.qty)], ['Defects', n0(row.defect)], ['Planned h', hrs(row.plannedTime)], ['Losses h', hrs(row.totalLosses)], ['Operating h', hrs(row.operatingTime)], ['%A', pct(row.A)], ['%P', pct(row.P)], ['%Q', pct(row.Q)], ['%OEE', pct(row.OEE)]]);
  }
  autoTable(doc, { ...tableStyle, startY: y, head: [['Date', 'Qty', 'Defects', 'Planned h', 'Losses h', 'Mgmt h', 'Operating h', '%A', '%P', '%Q', '%OEE']], body: r.daily.filter((d) => d.blocks).map((d) => [d.date, n0(d.qty), n0(d.defect), hrs(d.plannedTime), hrs(d.totalLosses), hrs(d.managementLosses), hrs(d.operatingTime), pct(d.A), pct(d.P), pct(d.Q), pct(d.OEE)]) });
  autoTable(doc, { ...tableStyle, startY: lastY(doc) + 14, head: [['Loss category', 'Group', 'Minutes', 'Hours', 'Share']], body: r.pareto.map((p) => [p.name, p.group === 'M' ? (p.isManagement ? 'Management' : 'Planned / other') : p.group, n0(p.minutes), p.hours.toFixed(1), pct(p.share)]), tableWidth: 420 });
  autoTable(doc, { ...tableStyle, startY: lastY(doc) + 14, head: [['Shift', '%A', '%P', '%Q', '%OEE', 'Qty', 'Losses h']], body: r.shifts.map((s) => [`${s.shift} (${s.timings})`, pct(s.A), pct(s.P), pct(s.Q), pct(s.OEE), n0(s.qty), hrs(s.totalLosses)]), tableWidth: 420 });
  pdfFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}

export async function lossPdf(month: string, opts: { machineIds?: number[]; line?: string | null } = {}) {
  const r = await monthlyReport(month, opts);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  pdfHeader(doc, `Loss Analysis — ${r.label}`, 'MIS loss report · minutes and hours by category, grouped by OEE factor');
  const g = r.loss.groups;
  const y = kpiStrip(doc, 70, [['Availability losses (h)', hrs(g.A)], ['Performance losses (h)', hrs(g.P)], ['Quality losses (h)', hrs(g.Q)], ['Planned / mgmt (h)', hrs(g.M)], ['Management losses (h)', hrs(g.management)], ['Not captured (h)', hrs(r.summary.overall.lossesNotCaptured)]]);
  autoTable(doc, { ...tableStyle, startY: y, head: [['#', 'Loss category', 'Group', 'Counts in Mgmt Loss', 'Minutes', 'Hours', 'Share', 'Cumulative']], body: r.pareto.map((p, i) => [i + 1, p.name, p.group, p.isManagement ? 'Yes' : 'No', n0(p.minutes), p.hours.toFixed(1), pct(p.share), pct(p.cumulative)]) });
  doc.addPage();
  pdfHeader(doc, `Machine × loss category (minutes) — ${r.label}`, 'MIS loss report -data 1 layout');
  const cats = r.meta.categories;
  autoTable(doc, { ...tableStyle, startY: 70, head: [['Machine', 'Rank', ...cats.map((c) => c.name), 'Not capt.']], body: r.loss.rows.filter((x) => x.hasData).map((x) => [x.machine, x.rank ?? '', ...cats.map((c) => (x.losses[c.code] ? n0(x.losses[c.code]) : '')), n0(x.lossesNotCaptured)]), styles: { ...tableStyle.styles, fontSize: 5.5, cellPadding: 1.5 } });
  pdfFooter(doc);
  return Buffer.from(doc.output('arraybuffer'));
}
