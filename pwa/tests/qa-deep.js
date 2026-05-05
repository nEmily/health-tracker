/**
 * Deep QA — exercise interactive flows that the surface QA didn't reach.
 *
 * Focus: edit entries, send chat, date nav, goals save, trends sub-tabs,
 * photo display.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-deep');
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
function bug(sev, area, detail) { findings.push({ sev, area, detail }); console.log(`  [${sev}] ${area}: ${detail}`); }
function ok(area) { console.log(`  PASS ${area}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'test-uuid-qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject test data
  const date = '2026-05-04';
  const log = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../coach/incoming/extracted/daily/${date}/log.json`), 'utf-8'));
  const analysis = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../coach/analysis/${date}.json`), 'utf-8'));
  const userMsgs = (log.coachChat || []).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));

  await page.evaluate(async ({ analysis, log, userMsgs, date }) => {
    await DB.importAnalysis(date, analysis);
    // Save raw log entries via DB.addEntry per entry
    for (const e of (log.entries || [])) {
      try { await DB.addEntry(e); } catch (err) { /* ignore dups */ }
    }
    await DB.updateDailySummary(date, {
      date, entries: analysis.entries || [], coachChat: userMsgs,
    });
  }, { analysis, log, userMsgs, date });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // ── 1. Today tab — entries should be visible ──
  console.log('\n[1] Today tab entries');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  const entryEls = await page.locator('.entry-card, .entry-row, .entry-item, [data-entry-id]').count();
  console.log(`  visible entries: ${entryEls}`);
  await page.screenshot({ path: path.join(SHOTS, '01-today.png'), fullPage: true });

  // ── 2. Tap an entry to edit ──
  console.log('\n[2] Edit entry flow');
  if (entryEls > 0) {
    const entry = page.locator('.entry-card, .entry-row, .entry-item, [data-entry-id]').first();
    try {
      await entry.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, '02-edit-modal.png'), fullPage: true });
      const modalVisible = await page.locator('.modal-overlay, .edit-entry-modal, [role="dialog"]').count();
      if (!modalVisible) bug('HIGH', 'edit-modal-no-open', 'tapping entry did not open edit modal');
      else ok('edit-modal-opens');

      // Find a numeric input (calories, protein, etc.)
      const inputs = await page.locator('.modal-overlay input[type="number"], .modal-overlay input[type="text"]').count();
      console.log(`  modal inputs: ${inputs}`);
      // Close modal
      const closeBtn = page.locator('.modal-overlay button:has-text("Cancel"), .modal-overlay .modal-close, button[aria-label="Close"]').first();
      if (await closeBtn.count()) await closeBtn.click().catch(() => {});
      await page.waitForTimeout(300);
      // Force-remove if still present
      await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));
    } catch (e) {
      bug('HIGH', 'edit-modal', `entry click failed: ${e.message.slice(0,150)}`);
    }
  }

  // ── 3. Send a chat message ──
  console.log('\n[3] Send chat message');
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(800);
  const inputBox = page.locator('#coach-input, .coach-input').first();
  if (await inputBox.count()) {
    try {
      await inputBox.fill('test message from QA');
      await page.waitForTimeout(200);
      const sendBtn = page.locator('#coach-send, .coach-send').first();
      await sendBtn.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      // Check it appears in chat
      const lastBubble = await page.locator('.chat-bubble.chat-user').last().innerText().catch(() => '');
      if (lastBubble.includes('test message from QA')) ok('chat-send');
      else bug('HIGH', 'chat-send', `sent message not visible. Last user bubble: "${lastBubble}"`);
      await page.screenshot({ path: path.join(SHOTS, '03-chat-sent.png'), fullPage: true });
    } catch (e) {
      bug('HIGH', 'chat-send', e.message.slice(0,150));
    }
  } else {
    bug('HIGH', 'chat-input-missing', 'no #coach-input found on coach tab');
  }

  // ── 4. Date navigation ──
  console.log('\n[4] Date nav (prev day)');
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(400);
  const prevBtn = page.locator('#header-prev').first();
  const isVisible = await prevBtn.isVisible().catch(() => false);
  console.log(`  #header-prev visible: ${isVisible}`);
  if (isVisible) {
    await prevBtn.click();
    await page.waitForTimeout(500);
    const headerText = await page.locator('#header-date, header .date-display, header').first().innerText();
    console.log(`  after prev nav: header text contains date? "${headerText.slice(0,80)}"`);
    ok('date-nav-prev');
    // Go back
    await page.locator('#header-next').first().click().catch(() => {});
  } else {
    bug('LOW', 'header-prev-hidden', 'prev day button not visible on Today tab');
  }

  // ── 5. Goals editor save ──
  console.log('\n[5] Goals editor save');
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(500);
  const editBtn = page.locator('button:has-text("Edit")').first();
  if (await editBtn.count()) {
    try {
      await editBtn.scrollIntoViewIfNeeded();
      await editBtn.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, '04-goals-editor.png'), fullPage: true });
      // Find the calorie input and bump it
      const calInput = page.locator('input[type="number"]').first();
      if (await calInput.count()) {
        const originalVal = await calInput.inputValue();
        await calInput.fill(String(parseInt(originalVal || '900') + 50));
        await page.waitForTimeout(200);
        // Save
        const saveBtn = page.locator('button:has-text("Save")').first();
        if (await saveBtn.count()) {
          await saveBtn.click({ timeout: 3000 });
          await page.waitForTimeout(500);
          ok('goals-save-clicked');
        } else {
          bug('MEDIUM', 'goals-save-btn', 'no Save button found in goals editor');
        }
      } else {
        bug('MEDIUM', 'goals-no-input', 'no number input in goals editor');
      }
    } catch (e) {
      bug('HIGH', 'goals-edit', e.message.slice(0,150));
    }
  }

  // ── 6. Progress > Trends sub-tab ──
  console.log('\n[6] Progress > Trends');
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  const trendsTab = page.locator('[data-ptab="trends"]').first();
  if (await trendsTab.count()) {
    try {
      await trendsTab.click({ timeout: 2000 });
      await page.waitForTimeout(800);
      const svgs = await page.locator('svg').count();
      console.log(`  svg charts: ${svgs}`);
      if (svgs === 0) bug('MEDIUM', 'trends-no-charts', 'no svg elements on Trends sub-tab');
      else ok('trends-renders');
      await page.screenshot({ path: path.join(SHOTS, '05-trends.png'), fullPage: true });
    } catch (e) {
      bug('MEDIUM', 'trends-click', e.message.slice(0,150));
    }
  }

  // ── 7. Console & page errors ──
  console.log('\n[7] Errors check');
  if (errs.length) errs.slice(0,8).forEach(e => bug('HIGH', 'js-error', e.slice(0,180)));
  else ok('no JS errors during deep flow');

  console.log('\n=== SUMMARY ===');
  const bySev = findings.reduce((a,f) => { a[f.sev] = (a[f.sev]||0)+1; return a; }, {});
  console.log(`Findings: ${JSON.stringify(bySev)} Total: ${findings.length}`);
  fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify(findings, null, 2));

  await browser.close();
  process.exit(findings.some(f => f.sev === 'CRITICAL') ? 2 : (findings.length ? 1 : 0));
})().catch(e => { console.error('FATAL:', e); process.exit(3); });
