/**
 * Drive Progress tabs (Insights, Plan, Trends, Fitness) AND Fitness tab on
 * Today nav-back through historical workout days. Capture what's actually
 * shown vs what's in the data.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-progress');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ERR: ' + m.text()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  // Inject 30 days of analyses + dailySummaries (so Trends/Plan have data)
  const dates = [];
  for (let d = 14; d <= 30; d++) dates.push(`2026-04-${String(d).padStart(2,'0')}`);
  for (let d = 1; d <= 10; d++) dates.push(`2026-05-${String(d).padStart(2,'0')}`);

  let injected = 0;
  for (const date of dates) {
    const aP = path.resolve(__dirname, `../../coach/analysis/${date}.json`);
    const lP = path.resolve(__dirname, `../../coach/incoming/extracted/daily/${date}/log.json`);
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: [] };
    await page.evaluate(async ({ a, log }) => {
      await DB.importAnalysis(a.date, a);
      for (const e of (log.entries || [])) {
        try { await DB.addEntry(e); } catch {}
      }
      // Preserve fitness_notes / fitness_checked / fitness_sets from log
      await DB.updateDailySummary(a.date, {
        date: a.date,
        entries: a.entries || [],
        coachChat: log.coachChat || null,
        fitness_notes: log.fitness_notes || null,
        fitness_checked: log.fitness_checked || null,
        fitness_sets: log.fitness_sets || null,
      });
    }, { a, log });
    injected++;
  }
  console.log(`Injected ${injected} days`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── Progress tab — Insights ──
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '01-progress-insights.png'), fullPage: true });

  // What sub-tabs exist?
  const subtabs = await page.locator('[data-ptab]').allInnerTexts();
  console.log(`Progress sub-tabs: ${JSON.stringify(subtabs)}`);

  // Plan tab
  const planTab = page.locator('[data-ptab="plan"]').first();
  if (await planTab.count()) {
    await planTab.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '02-progress-plan.png'), fullPage: true });
    const planText = await page.locator('body').innerText();
    console.log('\nPLAN tab text excerpt:');
    console.log(planText.slice(0, 600));
  }

  // Trends tab
  const trendsTab = page.locator('[data-ptab="trends"]').first();
  if (await trendsTab.count()) {
    await trendsTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOTS, '03-progress-trends.png'), fullPage: true });
  }

  // Fitness sub-tab on Progress
  const fitnessTab = page.locator('[data-ptab="fitness"]').first();
  if (await fitnessTab.count()) {
    await fitnessTab.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '04-progress-fitness.png'), fullPage: true });
    const fitText = await page.locator('body').innerText();
    console.log('\nFITNESS tab text excerpt:');
    console.log(fitText.slice(0, 600));
  } else {
    console.log('NO fitness sub-tab on Progress');
  }

  // ── Today tab — navigate back to 4/14 to check fitness notes rendering ──
  console.log('\n[Today nav-back to 4/14]');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  // Find Fitness toggle button
  const fitToggle = page.locator('button:has-text("Fitness")').first();
  if (await fitToggle.count()) {
    await fitToggle.click({ force: true });
    await page.waitForTimeout(500);
  }
  // Navigate back ~26 days to reach 4/14
  for (let i = 0; i < 27; i++) {
    const prev = page.locator('#header-prev').first();
    if (!(await prev.isVisible().catch(()=>false))) break;
    await prev.click({ force: true });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '05-today-fitness-old.png'), fullPage: true });
  const oldText = await page.locator('body').innerText();
  const hasNotes = oldText.includes('ab roll') || oldText.includes('dead bugs') || oldText.includes('cable');
  console.log(`Today/Fitness on old day shows notes? ${hasNotes}`);

  console.log('\n=== Errors ===');
  if (errs.length) errs.slice(0, 10).forEach(e => console.log('  ' + e.slice(0, 200)));
  else console.log('  (none)');

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
