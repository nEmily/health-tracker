/**
 * Comprehensive QA — exercise the app like a user, capture console errors,
 * screenshot each tab, find bugs.
 *
 * Run: node pwa/tests/qa-comprehensive.js
 * Requires server on localhost:8083.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa');
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
function bug(severity, area, detail) { findings.push({ severity, area, detail }); console.log(`  [${severity}] ${area}: ${detail}`); }
function ok(area) { console.log(`  PASS ${area}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const consoleWarns = [];
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    if (m.type() === 'warning') consoleWarns.push(m.text());
  });
  page.on('pageerror', e => consoleErrors.push(`PAGEERROR: ${e.message}`));

  // ── Skip welcome.html ───────────────────────────────────────────────────────
  console.log('\n[1] Loading app');
  // First visit — set onboarded flag in localStorage to bypass welcome
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('coach-onboarded', '1'));
  await page.evaluate(() => localStorage.setItem('coach-sync-key', 'test-uuid-qa'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '01-loaded.png') });

  // ── Inject analyses via DB ─────────────────────────────────────────────────
  console.log('\n[2] Injecting test analysis data via IndexedDB');
  const dates = ['2026-05-02', '2026-05-03', '2026-05-04'];
  let injected = 0;
  for (const d of dates) {
    const filePath = path.resolve(__dirname, `../../coach/analysis/${d}.json`);
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const success = await page.evaluate(async (data) => {
      try {
        if (!window.DB) return 'DB-undefined';
        await DB.importAnalysis(data.date, data);
        // Also save dailySummary so chat user-side messages render
        const log_path_data = data; // proxy — analysis has entries
        const summary = {
          date: data.date,
          entries: data.entries || [],
          coachChat: [], // user messages live in log.json which we don't have here; chat may be empty in test
        };
        await DB.updateDailySummary(data.date, summary);
        return 'ok';
      } catch (e) { return 'error: ' + e.message; }
    }, data);
    if (success === 'ok') injected++;
    else bug('HIGH', `inject-${d}`, success);
  }
  console.log(`  injected: ${injected}/${dates.length} analyses`);

  // Reload to render with the injected data
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // ── Today tab ──────────────────────────────────────────────────────────────
  console.log('\n[3] Today tab');
  const todayBtn = page.locator('.nav-item[data-screen="today"]').first();
  await todayBtn.click({ timeout: 3000 }).catch(e => bug('HIGH', 'nav-today', e.message));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '02-today.png'), fullPage: true });

  // Check for entries rendering
  const entriesList = await page.locator('.entry-card, .entry-item, [data-entry-id]').count();
  console.log(`  entries rendered: ${entriesList}`);
  if (entriesList === 0) bug('MEDIUM', 'today-entries', 'no entry items rendered despite 10 entries in analysis');

  // Check totals display
  const totalsText = await page.locator('body').innerText();
  if (!/cal/i.test(totalsText)) bug('MEDIUM', 'today-totals', 'no calorie info visible');

  // ── Coach tab ──────────────────────────────────────────────────────────────
  console.log('\n[4] Coach tab — chat rendering');
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  // Wait for CoachChat.render to complete (it's async)
  await page.waitForFunction(
    () => document.querySelectorAll('.chat-bubble').length > 0 || document.querySelector('.coach-empty-state'),
    { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, '03-coach.png'), fullPage: true });
  const chatBubbles = await page.locator('.chat-bubble').count();
  const coachBubbles = await page.locator('.chat-coach').count();
  const userBubbles = await page.locator('.chat-user').count();
  console.log(`  chat bubbles: ${chatBubbles} (coach=${coachBubbles}, user=${userBubbles})`);
  if (chatBubbles === 0) {
    bug('HIGH', 'coach-empty', 'no chat bubbles rendered despite 2 coachResponses in 2026-05-04 analysis');
  }

  // Look for duplicate-message bug (the bug we just fixed server-side)
  const allBubbleTexts = await page.locator('.chat-bubble .chat-text').allInnerTexts();
  const bubbleCounts = {};
  for (const t of allBubbleTexts) bubbleCounts[t] = (bubbleCounts[t] || 0) + 1;
  const dupes = Object.entries(bubbleCounts).filter(([t, n]) => n > 1 && t.length > 30);
  if (dupes.length) bug('HIGH', 'coach-dupe-text', `${dupes.length} duplicate bubble texts: ${dupes.map(([t,n]) => `${n}x "${t.slice(0,40)}..."`).join(' | ')}`);

  // Check date navigation (prev/next day)
  const prevBtn = page.locator('#header-prev').first();
  if (await prevBtn.count()) {
    try {
      await prevBtn.click({ timeout: 2000 });
      await page.waitForTimeout(400);
      ok('coach-prev-day');
    } catch (e) { bug('MEDIUM', 'coach-prev-day', e.message); }
  }

  // ── Progress tab ───────────────────────────────────────────────────────────
  console.log('\n[5] Progress tab');
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '04-progress.png'), fullPage: true });
  const charts = await page.locator('canvas, svg.chart, [data-chart]').count();
  console.log(`  chart elements: ${charts}`);

  // ── Settings tab + goals editor ────────────────────────────────────────────
  console.log('\n[6] Settings tab');
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '05-settings.png'), fullPage: true });

  // Find a goals-edit button
  const editButtons = await page.locator('button:has-text("Edit")').all();
  console.log(`  Edit buttons found: ${editButtons.length}`);
  if (editButtons.length) {
    try {
      await editButtons[0].scrollIntoViewIfNeeded();
      await editButtons[0].click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, '06-goals-editor.png'), fullPage: true });
      const inputs = await page.locator('input[type="number"]').count();
      console.log(`  goal inputs: ${inputs}`);
      if (inputs === 0) bug('MEDIUM', 'goals-editor-no-inputs', 'modal opened but no number inputs found');
      // Try saving without changes (should not crash)
      const saveBtn = page.locator('button:has-text("Save"), button[type="submit"]').first();
      if (await saveBtn.count()) {
        await saveBtn.click({ timeout: 2000 }).catch(e => bug('MEDIUM', 'goals-save', e.message));
        await page.waitForTimeout(300);
      }
    } catch (e) {
      bug('MEDIUM', 'goals-editor-open', e.message);
    }
  }

  // ── Dismiss any open modal before next steps ───────────────────────────────
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  });
  await page.waitForTimeout(200);

  // ── Narrow viewport (320px) ────────────────────────────────────────────────
  console.log('\n[7] Narrow viewport 320px');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '07-narrow-320.png'), fullPage: true });
  const overflow = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    viewW: window.innerWidth,
  }));
  if (overflow.docW > overflow.viewW + 1) {
    bug('HIGH', 'narrow-overflow', `body overflows: docW=${overflow.docW} viewW=${overflow.viewW}`);
  } else { ok('narrow-no-overflow'); }

  // Tap-target sizing at 320 (per WCAG: at least 44x44)
  const navItems = await page.locator('.nav-item').all();
  for (const it of navItems) {
    const box = await it.boundingBox();
    if (box && (box.width < 44 || box.height < 44)) {
      const text = (await it.innerText()).slice(0, 20);
      bug('LOW', 'tap-target-small', `nav-item "${text}": ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }

  // ── Console diagnostics ────────────────────────────────────────────────────
  console.log('\n[8] Console diagnostics');
  if (consoleErrors.length) {
    consoleErrors.slice(0, 10).forEach(e => bug('HIGH', 'console-error', e.slice(0, 180)));
  } else { ok('no console errors'); }
  if (consoleWarns.length) {
    console.log(`  ${consoleWarns.length} warnings (informational)`);
    consoleWarns.slice(0, 3).forEach(w => console.log(`    WARN: ${w.slice(0,100)}`));
  }

  console.log('\n=== SUMMARY ===');
  const bySev = findings.reduce((a,f) => { a[f.severity] = (a[f.severity]||0)+1; return a; }, {});
  console.log(`Findings: ${JSON.stringify(bySev)}  Total: ${findings.length}`);
  fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify(findings, null, 2));
  console.log(`Screenshots + findings: ${SHOTS}`);

  await browser.close();
  process.exit(findings.some(f => f.severity === 'CRITICAL') ? 2 : (findings.length ? 1 : 0));
})().catch(e => { console.error('FATAL:', e); process.exit(3); });
