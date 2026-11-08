/**
 * End-to-end check against a running server (npm run dev / npm start) with the seeded users.
 *   BASE_URL=http://localhost:3000 node tests/e2e/run-e2e.cjs
 * Uses the Playwright that is installed on the machine (no browser download needed if present).
 */
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.BASE_URL || 'http://localhost:3000';
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const month = today.slice(0, 7);
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push(['PASS', name, Date.now() - t]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push(['FAIL', name, Date.now() - t]);
    console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`);
  }
};

async function login(browser, user, pass, device) {
  const ctx = await browser.newContext(device ?? { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${user} page error] ${e.message}`));
  await page.goto(`${base}/login`);
  await page.fill('#u', user);
  await page.fill('#p', pass);
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState('networkidle');
  return page;
}
const numField = (page, label) => page.locator(`label:text-is("${label}")`).locator('xpath=..').locator('input[type=number]');
const kpi = async (page, label) => (await page.locator(`text=${label}`).first().locator('xpath=../..').innerText()).split('\n')[1];

(async () => {
  const browser = await chromium.launch();
  const pc = await login(browser, 'manager', 'Manager@123');
  const tablet = await login(browser, 'operator', 'Operator@123', devices['iPad Pro 11 landscape']);
  let recordId = null;

  await step('operator lands on WTPM Quick Entry after login', async () => {
    assert.match(tablet.url(), /\/entry$/);
  });

  await pc.goto(`${base}/?month=${month}`);
  await pc.waitForLoadState('networkidle');
  await pc.waitForTimeout(1000);
  const qtyBefore = Number((await kpi(pc, 'Total Qty Produced')).replace(/,/g, ''));

  await step('typing "Rob" suggests Robot Welding machines from the Machine List', async () => {
    await tablet.click('#machine');
    await tablet.keyboard.type('Rob');
    const opts = (await tablet.locator('[role=option]').allInnerTexts()).map((o) => o.split('\n')[0]);
    assert.ok(opts.length >= 3 && opts.every((o) => o.startsWith('Robot Welding')), opts.join(','));
    await tablet.locator('[role=option]', { hasText: 'Robot Welding 2' }).first().click();
  });

  await step('machine selection fills code, line and category', async () => {
    const t = await tablet.locator('text=Machine code').locator('xpath=..').innerText();
    assert.match(t, /R2/);
  });

  await step('part number lookup fills bore and cycle time from master', async () => {
    await tablet.waitForTimeout(800);
    const master = await (await tablet.request.get(`${base}/api/suggest?machineId=2`)).json();
    const part = master.masterParts[0];
    await tablet.locator('input[placeholder="Search part number"]').first().click();
    await tablet.keyboard.type(part.part);
    await tablet.locator('[role=option]', { hasText: part.part }).first().click();
    await tablet.waitForTimeout(400);
    const ct = await tablet.locator('div.label:text-is("Cycle time")').first().locator('xpath=..').innerText();
    const bore = await tablet.locator('div.label:text-is("Bore")').first().locator('xpath=..').innerText();
    assert.ok(ct.includes(String(Number(part.ct).toFixed(3)).replace(/0+$/, '').replace(/\.$/, '')), `CT shown "${ct}" vs master ${part.ct}`);
    assert.ok(bore.includes(part.bore == null ? '—' : String(part.bore)), `bore shown "${bore}" vs ${part.bore}`);
  });

  await step('save a record with quantity, defect and a loss', async () => {
    await numField(tablet, 'Qty produced').first().fill('42');
    await numField(tablet, 'Defect').first().fill('2');
    await numField(tablet, 'Break Down').fill('25');
    await tablet.waitForTimeout(1500);
    await tablet.click('button:has-text("Review & Save")');
    await tablet.waitForSelector('[role=dialog]');
    await tablet.waitForTimeout(1500);
    const boxes = tablet.locator('[role=dialog] input[type=checkbox]');
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
    await tablet.click('[role=dialog] button:has-text("save")');
    await tablet.waitForSelector('text=Production entry saved', { timeout: 15000 });
    const href = await tablet.locator('a:has-text("View record")').getAttribute('href');
    recordId = href.split('/').pop();
    assert.ok(recordId);
  });

  await step('manager dashboard updates live without reload', async () => {
    const t0 = Date.now();
    let q = qtyBefore;
    while (Date.now() - t0 < 10000 && q === qtyBefore) {
      await pc.waitForTimeout(250);
      q = Number((await kpi(pc, 'Total Qty Produced')).replace(/,/g, ''));
    }
    assert.equal(q, qtyBefore + 42);
  });

  await step('same machine & shift again shows the existing record (duplicate check)', async () => {
    await tablet.click('button:has-text("Same machine, new note")');
    await tablet.waitForTimeout(2500);
    assert.ok((await tablet.locator('text=/record\\(s\\) already saved/').count()) > 0);
  });

  await step('defect greater than quantity blocks saving', async () => {
    await tablet.locator('input[placeholder="Search part number"]').first().click();
    await tablet.locator('[role=option]').first().click();
    await numField(tablet, 'Qty produced').first().fill('3');
    await numField(tablet, 'Defect').first().fill('9');
    await tablet.waitForTimeout(1800);
    await tablet.click('button:has-text("Review & Save")');
    await tablet.waitForTimeout(800);
    assert.ok(await tablet.locator('[role=dialog] button:has-text("save")').isDisabled());
    await tablet.click('[role=dialog] button:has-text("Back to edit")');
  });

  await step('"Other" loss requires a written reason (API)', async () => {
    const r = await tablet.request.post(`${base}/api/entries/validate`, { data: { prodDate: today, shiftId: 1, machineId: 2, lines: [], losses: { other: 30 } } });
    const d = await r.json();
    assert.ok(d.errors.some((e) => e.code === 'other_reason'));
  });

  await step('negative downtime is rejected (API)', async () => {
    const r = await tablet.request.post(`${base}/api/entries`, { data: { prodDate: today, shiftId: 1, machineId: 2, lines: [], losses: { breakdown: -5 } } });
    assert.equal(r.status(), 422);
  });

  await step('future date is rejected (API)', async () => {
    const r = await tablet.request.post(`${base}/api/entries/validate`, { data: { prodDate: '2099-01-01', shiftId: 1, machineId: 2, lines: [{ partNumber: 'X', qty: 1 }] } });
    assert.ok((await r.json()).errors.some((e) => e.code === 'date_future'));
  });

  await step('photo upload is stored and linked to the record', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
    const r = await tablet.request.post(`${base}/api/uploads`, { multipart: { file: { name: 'note.png', mimeType: 'image/png', buffer: png }, kind: 'wtpm_note', entryId: recordId } });
    assert.equal(r.status(), 200, await r.text());
    const id = (await r.json()).id;
    const g = await pc.request.get(`${base}/api/uploads/${id}`);
    assert.equal(g.headers()['content-type'], 'image/png');
    const bad = await tablet.request.post(`${base}/api/uploads`, { multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }, kind: 'wtpm_note' } });
    assert.equal(bad.status(), 415);
  });

  await step('operator correction needs a reason and is kept in the audit trail', async () => {
    const d = await (await tablet.request.get(`${base}/api/entries/${recordId}`)).json();
    const e = d.entry;
    const body = { prodDate: e.prod_date, shiftId: e.shift_id, machineId: e.machine_id, version: e.version, lines: e.lines.map((l) => ({ partNumber: l.part_number, qty: Number(l.qty) + 1, defect: Number(l.defect) })), losses: e.losses, acknowledge: ['*'] };
    const noReason = await tablet.request.put(`${base}/api/entries/${recordId}`, { data: body });
    assert.equal(noReason.status(), 422);
    const ok = await tablet.request.put(`${base}/api/entries/${recordId}`, { data: { ...body, editReason: 'Qty misread on note' } });
    assert.equal(ok.status(), 200, await ok.text());
    const stale = await tablet.request.put(`${base}/api/entries/${recordId}`, { data: { ...body, editReason: 'second edit with old version' } });
    assert.equal(stale.status(), 409);
    const h = await (await pc.request.get(`${base}/api/entries/${recordId}`)).json();
    const upd = h.history.find((x) => x.action === 'update');
    assert.ok(upd && upd.reason === 'Qty misread on note' && Object.keys(upd.changes).some((k) => k.includes('qty')));
  });

  await step('roles: operator cannot see users/reports, manager cannot enter data', async () => {
    assert.equal((await tablet.request.get(`${base}/api/users`)).status(), 403);
    assert.equal((await tablet.request.get(`${base}/api/reports/monthly?month=${month}`)).status(), 403);
    assert.equal((await pc.request.post(`${base}/api/entries`, { data: {} })).status(), 403);
  });

  await step('supervisor verifies the record; operator can no longer edit it', async () => {
    const sup = await login(browser, 'supervisor', 'Super@123');
    assert.equal((await sup.request.post(`${base}/api/entries/${recordId}/status`, { data: { status: 'verified' } })).status(), 200);
    const d = await (await tablet.request.get(`${base}/api/entries/${recordId}`)).json();
    const e = d.entry;
    const r = await tablet.request.put(`${base}/api/entries/${recordId}`, { data: { prodDate: e.prod_date, shiftId: e.shift_id, machineId: e.machine_id, lines: [], losses: { breakdown: 5 }, editReason: 'try', acknowledge: ['*'] } });
    assert.equal(r.status(), 403);
  });

  await step('record appears in daily, monthly, loss reports and Excel/PDF exports', async () => {
    const m = await (await pc.request.get(`${base}/api/reports/monthly?month=${month}`)).json();
    const row = m.summary.rows.find((r) => r.machine === 'Robot Welding 2');
    assert.ok(row.qty >= 43 && row.losses !== undefined || row.totalLosses >= 25);
    const day = m.daily.find((d) => d.date === today);
    assert.ok(day.qty >= 43);
    for (const [u, type] of [[`/api/export/excel?month=${month}`, 'spreadsheetml'], [`/api/export/pdf?type=monthly&month=${month}`, 'pdf'], [`/api/export/pdf?type=loss&month=${month}`, 'pdf'], [`/api/export/pdf?type=machine&month=${month}&machineId=2`, 'pdf']]) {
      const r = await pc.request.get(base + u);
      assert.equal(r.status(), 200, u);
      assert.ok(r.headers()['content-type'].includes(type), u);
      assert.ok((await r.body()).length > 2000, u);
    }
  });

  await step('portrait tablet has no horizontal scrolling', async () => {
    const p = await login(browser, 'operator', 'Operator@123', devices['iPad Mini']);
    await p.goto(`${base}/entry`);
    await p.waitForTimeout(1000);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  });

  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} end-to-end checks passed`);
  process.exit(failed ? 1 : 0);
})();
