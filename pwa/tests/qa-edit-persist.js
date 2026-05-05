/**
 * Test that editing an entry persists. Common bug class: modal saves to
 * memory but not to IndexedDB, or vice versa.
 */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Add a meal entry directly
  const entryId = 'qa_meal_' + Date.now();
  await page.evaluate(async (eid) => {
    const today = UI.today(); // Honors 4am day boundary
    await DB.addEntry({
      id: eid,
      type: 'meal',
      date: today,
      timestamp: new Date().toISOString(),
      notes: 'Test meal: oatmeal with banana',
      photo: false,
      duration_minutes: null,
      weight_value: null,
      weight_unit: null,
      subtype: null,
    });
  }, entryId);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);

  // Find our entry and tap it
  const entryCount = await page.locator('.entry-card, .entry-row, .entry-item').count();
  console.log(`entries visible: ${entryCount}`);
  if (entryCount === 0) { console.log('FAIL: no entries on Today tab'); process.exit(1); }

  // Find the entry with "Test meal" text
  const targetEntry = page.locator('.entry-card, .entry-row, .entry-item').filter({ hasText: 'Test meal' }).first();
  if (!(await targetEntry.count())) { console.log('FAIL: test entry not found in DOM'); process.exit(1); }
  await targetEntry.click({ timeout: 3000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, 'screenshots/qa-deep/08-edit-meal.png'), fullPage: true });

  // The edit modal should show notes input
  const notesInput = page.locator('.modal-overlay textarea, .modal-overlay input[type="text"]').first();
  if (!(await notesInput.count())) { console.log('FAIL: no notes input in edit modal'); process.exit(1); }

  // Change notes
  const newNotes = 'Edited: oatmeal with apple and walnuts';
  await notesInput.fill(newNotes);
  await page.waitForTimeout(200);

  // Save
  const saveBtn = page.locator('.modal-overlay button:has-text("Save")').first();
  if (!(await saveBtn.count())) { console.log('FAIL: no Save button'); process.exit(1); }
  await saveBtn.click({ timeout: 3000 });
  await page.waitForTimeout(800);

  // Verify in DB
  const persisted = await page.evaluate(async (eid) => {
    const all = await DB.getAllEntries();
    const e = all.find(x => x.id === eid);
    return e ? { notes: e.notes, hasUpdatedAt: !!e.updatedAt } : null;
  }, entryId);

  console.log('persisted:', JSON.stringify(persisted));

  let failed = false;
  if (!persisted) { console.log('FAIL: entry missing from DB'); failed = true; }
  else if (!persisted.notes.includes('apple and walnuts')) {
    console.log(`FAIL: notes not updated. Got: "${persisted.notes}"`); failed = true;
  } else if (!persisted.hasUpdatedAt) {
    console.log('WARN: edit did not set updatedAt (may break stale-detection)');
  } else {
    console.log('PASS: edit persisted correctly');
  }

  // Verify visible on Today tab after save
  await page.waitForTimeout(500);
  const visibleAfter = await page.locator('.entry-card, .entry-row, .entry-item').filter({ hasText: 'apple and walnuts' }).count();
  if (!visibleAfter) {
    console.log(`FAIL: edited entry not visible on Today tab after save`);
    failed = true;
  } else {
    console.log('PASS: edited entry visible on Today tab');
  }

  if (errs.length) {
    console.log('JS errors during flow:');
    errs.forEach(e => console.log('  ' + e.slice(0, 200)));
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
