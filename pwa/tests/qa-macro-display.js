/**
 * Compare on-screen macros vs stored data, for today + a few past days.
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ERR: ' + m.text()); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  // Inject 5/4-5/10 + goals + production analyses
  for (const d of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const a = JSON.parse(fs.readFileSync(`coach/analysis/${d}.json`, 'utf-8'));
    const lP = `coach/incoming/extracted/daily/${d}/log.json`;
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: null };
    await page.evaluate(async ({ a, log }) => {
      await DB.importAnalysis(a.date, a);
      for (const e of (log.entries || [])) { try { await DB.addEntry(e); } catch {} }
      await DB.updateDailySummary(a.date, {
        date: a.date, entries: a.entries || [], coachChat: log.coachChat,
        fitness_notes: log.fitness_notes, fitness_sets: log.fitness_sets,
      });
    }, { a, log });
  }

  // Inject goals
  const goals = JSON.parse(fs.readFileSync('coach/profile/goals.json', 'utf-8'));
  await page.evaluate(async (g) => { await DB.setProfile('goals', g); }, goals);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // For each day, compare what UI shows vs analysis.totals
  for (const date of ['2026-05-10','2026-05-09','2026-05-08','2026-05-07']) {
    await page.evaluate(async (d) => {
      App.selectedDate = d;
      App.currentScreen = 'today';
      await App.loadDayView();
    }, date);
    await page.waitForTimeout(1500);

    const data = await page.evaluate(async () => {
      const summary = await DB.getDailySummary(App.selectedDate);
      const analysis = await DB.getAnalysis(App.selectedDate);
      // Read on-screen values
      const calText = document.querySelector('.calorie-ring-card')?.innerText || '';
      const allText = document.body.innerText;
      return {
        analysis_totals: analysis?.totals,
        on_screen_calorie_card: calText.replace(/\s+/g, ' ').slice(0, 100),
        protein_visible: /\d+g.*protein|protein.*\d+g/i.exec(allText)?.[0]?.slice(0,40),
        fiber_visible: /\d+g.*fiber|fiber.*\d+g/i.exec(allText)?.[0]?.slice(0,40),
      };
    });
    console.log(`\n=== ${date} ===`);
    console.log(`  analysis.totals: ${JSON.stringify(data.analysis_totals)}`);
    console.log(`  on-screen cal card: "${data.on_screen_calorie_card}"`);
    console.log(`  protein on screen: "${data.protein_visible}"`);
    console.log(`  fiber on screen: "${data.fiber_visible}"`);
  }

  await page.screenshot({ path: 'pwa/tests/screenshots/qa-progress/macro-display.png', fullPage: true });
  if (errs.length) {
    console.log('\nErrors:');
    errs.forEach(e => console.log('  ' + e.slice(0, 200)));
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
