/**
 * Full dogfood pass — every tab, every panel, both viewports.
 * Focused on the recent stack: chat-only Chat tab, day-analysis card
 * on Insights, Fitness Progress strip, A/B split rendering on Today
 * Fitness panel, scroll/overscroll feel.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = '.claude/test-screenshots/dogfood';
let n = 0;
const shot = async (page, label) => {
  n++;
  const fname = `${String(n).padStart(2,'0')}-${label}.png`;
  await page.screenshot({ path: path.join(SHOTS, fname), fullPage: true });
  return fname;
};

async function setupDataDir(page) {
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  // Inject regimen so fitness panel + plan tab have content
  try {
    const regimen = JSON.parse(fs.readFileSync('coach/profile/regimen.json', 'utf-8'));
    await page.evaluate(async (r) => {
      const db = await DB.openDB();
      const tx = db.transaction('profile', 'readwrite');
      tx.objectStore('profile').put({ key: 'regimen', value: r });
      await new Promise(res => tx.oncomplete = res);
    }, regimen);
  } catch (e) {}
  // Inject 7 days of analysis so Insights/Trends/Fitness have data
  for (const date of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const aP = `coach/analysis/${date}.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    await page.evaluate(async (a) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [] });
    }, a);
  }
}

async function runViewport(browser, vp, vpLabel) {
  console.log(`\n══════ ${vpLabel} (${vp.width}x${vp.height}) ══════`);
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(`[${vpLabel}] PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(`[${vpLabel}] ${m.text().slice(0, 180)}`); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await setupDataDir(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── TODAY tab ────────────────────────────────────────────
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(700);
  console.log(`  ${vpLabel} Today (Diet panel default): ${await shot(page, `${vpLabel}-today-diet`)}`);

  // Switch to Fitness panel
  await page.locator('.today-seg-btn[data-panel="fitness"]').click();
  await page.waitForTimeout(500);
  console.log(`  ${vpLabel} Today (Fitness panel, Sun=rest): ${await shot(page, `${vpLabel}-today-fitness-sun`)}`);

  // Try a strength day (Tue 2026-05-12)
  await page.evaluate(async () => {
    App.selectedDate = '2026-05-12';
    if (App.updateHeaderDate) App.updateHeaderDate();
    await App.loadDayView();
    App.switchPanel('fitness');
  });
  await page.waitForTimeout(800);
  console.log(`  ${vpLabel} Today (Fitness panel, Tue=Day A): ${await shot(page, `${vpLabel}-today-fitness-dayA`)}`);

  // Reset to today + diet
  await page.evaluate(async () => {
    App.selectedDate = UI.today();
    if (App.updateHeaderDate) App.updateHeaderDate();
    await App.loadDayView();
    App.switchPanel('diet');
  });
  await page.waitForTimeout(500);

  // ── CHAT tab ─────────────────────────────────────────────
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1200);
  console.log(`  ${vpLabel} Chat (continuous history): ${await shot(page, `${vpLabel}-chat`)}`);

  // ── PROGRESS tab — each segment ──────────────────────────
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(700);
  for (const seg of ['insights','plan','trends','challenges','fitness']) {
    await page.evaluate(async (s) => {
      ProgressView._tab = s;
      await ProgressView.init();
    }, seg);
    await page.waitForTimeout(900);
    console.log(`  ${vpLabel} Progress [${seg}]: ${await shot(page, `${vpLabel}-progress-${seg}`)}`);
  }

  // ── SETTINGS tab ─────────────────────────────────────────
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(700);
  console.log(`  ${vpLabel} Settings: ${await shot(page, `${vpLabel}-settings`)}`);

  // ── Scroll feel: scroll Insights to bottom, capture ─────
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    ProgressView._tab = 'insights';
    ProgressView.init();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const s = document.querySelector('.screen.active');
    if (s) s.scrollTo({ top: s.scrollHeight, behavior: 'instant' });
  });
  await page.waitForTimeout(400);
  console.log(`  ${vpLabel} Progress > Insights scrolled bottom: ${await shot(page, `${vpLabel}-insights-bottom`)}`);

  if (errs.length) {
    console.log(`\n  ⚠ ${errs.length} console errors in ${vpLabel}:`);
    errs.slice(0, 6).forEach(e => console.log('    ' + e));
  } else {
    console.log(`\n  ✓ no console errors in ${vpLabel}`);
  }

  await page.close();
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await runViewport(browser, { width: 390, height: 844 }, 'iPhone14Pro');
  await runViewport(browser, { width: 320, height: 568 }, 'iPhoneSE');
  await browser.close();
  console.log(`\nTotal screenshots: ${n}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
