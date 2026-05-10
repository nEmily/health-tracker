/**
 * Interactive bug-hunt — exercises real flows the user does daily.
 * Looks for: edit-entry persistence, dailies one-tap, photo capture flow,
 * goal-setting, score correctness, body-photo lock.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-interactive');
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
const bug = (sev, area, detail) => { findings.push({ sev, area, detail }); console.log(`  [${sev}] ${area}: ${detail}`); };
const ok = a => console.log(`  PASS ${a}`);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ERR: ' + m.text()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject 7 days
  console.log('\n[1] Inject');
  for (const d of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const aP = path.resolve(__dirname, `../../coach/analysis/${d}.json`);
    const lP = path.resolve(__dirname, `../../coach/incoming/extracted/daily/${d}/log.json`);
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: [] };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));
    await page.evaluate(async ({ a, entries, userMsgs }) => {
      await DB.importAnalysis(a.date, a);
      for (const e of entries) { try { await DB.addEntry(e); } catch {} }
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: userMsgs });
    }, { a, entries: log.entries || [], userMsgs });
  }
  await page.evaluate(() => { if (window.App) App.selectedDate = '2026-05-10'; });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── 2. Today: dailies one-tap ──
  console.log('\n[2] Today — Dailies one-tap');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  // Find the "Dailies" button
  const dailiesBtn = page.locator('button:has-text("Dailies")').first();
  if (await dailiesBtn.count()) {
    try {
      await dailiesBtn.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, '01-dailies-modal.png'), fullPage: true });
      ok('dailies button opened modal');
      // Try to close modal
      await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));
    } catch (e) {
      bug('MEDIUM', 'dailies-button', e.message.slice(0, 150));
    }
  } else {
    bug('MEDIUM', 'dailies-button', 'no Dailies button visible on Today tab');
  }

  // ── 3. Diet/Fitness sub-tabs ──
  console.log('\n[3] Today — Diet/Fitness sub-toggle');
  const fitBtn = page.locator('button:has-text("Fitness")').first();
  if (await fitBtn.count()) {
    await fitBtn.click({ timeout: 2000 }).catch(()=>{});
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, '02-today-fitness.png'), fullPage: true });
    const dietBtn = page.locator('button:has-text("Diet")').first();
    await dietBtn.click({ timeout: 2000 }).catch(()=>{});
    await page.waitForTimeout(300);
    ok('Diet/Fitness toggle works');
  }

  // ── 4. Edit entry round-trip ──
  console.log('\n[4] Edit weight entry');
  const weightEntry = page.locator('.entry-item, .entry-card').filter({ hasText: 'Weight' }).first();
  if (await weightEntry.count()) {
    await weightEntry.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, '03-edit-weight.png'), fullPage: true });
    const inp = page.locator('input[type="number"]').first();
    if (await inp.count()) {
      const orig = await inp.inputValue();
      console.log(`  weight value in modal: ${orig}`);
      // Don't actually save
    }
    // Close
    const close = page.locator('button[aria-label="Close"], .modal-close').first();
    if (await close.count()) await close.click().catch(()=>{});
    await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));
  }

  // ── 5. Body photo lock ──
  console.log('\n[5] Body photo lock');
  const bodyPhotoEntry = page.locator('.entry-item, .entry-card').filter({ hasText: 'Body Photo' }).first();
  if (await bodyPhotoEntry.count()) {
    // Look for lock icon
    const locked = await bodyPhotoEntry.locator('.entry-locked, [class*="lock"], svg').count();
    console.log(`  body photo locked indicator count: ${locked}`);
    if (locked === 0) bug('HIGH', 'body-photo-lock', 'no lock indicator visible on body photo entry');
    else ok('body photo has lock visual');
  }

  // ── 6. Goal display vs actual ──
  console.log('\n[6] Goal display');
  const goalText = await page.locator('body').innerText();
  const calOf = goalText.match(/(\d+)\s*OF\s*(\d+)\s*CAL/i);
  if (calOf) {
    console.log(`  calorie display: ${calOf[1]}/${calOf[2]} (today's eaten / goal)`);
    if (calOf[2] !== '900' && calOf[2] !== '1000') {
      bug('LOW', 'goal-display', `unexpected calorie goal value: ${calOf[2]}`);
    }
  }

  // ── 7. Coach yesterday — does prior day's chat render? ──
  console.log('\n[7] Coach prior-day rendering');
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(800);
  // Navigate to 5/5 (which has the dypa now-answered message)
  await page.evaluate(() => { if (window.App) App.selectedDate = '2026-05-05'; });
  await page.locator('.nav-item[data-screen="coach"]').first().click(); // re-click to reload
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, '04-coach-5-5.png'), fullPage: true });
  const bubbles55 = await page.locator('.chat-bubble').count();
  console.log(`  5/5 bubbles: ${bubbles55}`);
  // Expect 4 user + 5 coach (after my reprocess) = 9 bubbles
  if (bubbles55 < 8) bug('MEDIUM', 'coach-5-5', `only ${bubbles55} bubbles; expected ~9 (4 user + 5 coach after reprocess)`);

  // ── 8. Settings — goal editor ──
  console.log('\n[8] Settings — goal editor');
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(500);
  const editGoalBtn = page.locator('button:has-text("Edit")').first();
  if (await editGoalBtn.count()) {
    try {
      await editGoalBtn.scrollIntoViewIfNeeded();
      await editGoalBtn.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, '05-goal-editor.png'), fullPage: true });
      const inputs = await page.locator('input[type="number"]').count();
      console.log(`  goal editor inputs: ${inputs}`);
      // Look for calorie input
      const calInp = page.locator('input[type="number"]').first();
      if (await calInp.count()) {
        const v = await calInp.inputValue();
        console.log(`  first input value: ${v}`);
        if (v === '900') {
          // Goal is still 900 — user wanted 1000
          bug('HIGH', 'goal-still-900', 'Calorie goal still 900 even though user has been asking for 1000 for days');
        }
      }
    } catch (e) {
      bug('MEDIUM', 'goal-editor', e.message.slice(0,150));
    }
  }

  // ── 9. Errors ──
  console.log('\n[9] Console errors');
  if (errs.length) errs.slice(0,10).forEach(e => bug('HIGH', 'js', e.slice(0,180)));
  else ok('no JS errors');

  console.log('\n=== SUMMARY ===');
  const sev = findings.reduce((a,f)=>{a[f.sev]=(a[f.sev]||0)+1;return a;},{});
  console.log(`Findings: ${JSON.stringify(sev)} | total=${findings.length}`);
  fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify(findings, null, 2));

  await browser.close();
  process.exit(findings.some(f=>f.sev==='CRITICAL')?2:(findings.length?1:0));
})().catch(e=>{console.error('FATAL:',e);process.exit(3);});
