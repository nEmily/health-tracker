const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  for (const d of ['2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const a = JSON.parse(fs.readFileSync(`coach/analysis/${d}.json`, 'utf-8'));
    await page.evaluate(async (a) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [] });
    }, a);
  }
  const goals = JSON.parse(fs.readFileSync('coach/profile/goals.json', 'utf-8'));
  await page.evaluate(async (g) => { await DB.setProfile('goals', g); }, goals);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  for (const date of ['2026-05-10','2026-05-09','2026-05-08','2026-05-07']) {
    await page.evaluate(async (d) => {
      App.selectedDate = d; App.currentScreen = 'coach';
      window.location.hash = 'coach';
    }, date);
    await page.waitForTimeout(1500);

    const data = await page.evaluate(async () => {
      const analysis = await DB.getAnalysis(App.selectedDate);
      // Find the Analysis card text
      const inboxEl = document.getElementById('coach-inbox');
      const text = inboxEl?.innerText || '';
      // Extract numbers near "remaining" / "left"
      const matches = {};
      const calMatch = text.match(/(\d+)\s*(remaining|eaten|over)\b/i);
      const protMatch = text.match(/Protein\s+(.+?)(?=\n|$)/i);
      const fibMatch = text.match(/Fiber\s+(.+?)(?=\n|$)/i);
      return {
        analysis_totals: analysis?.totals,
        calMatch: calMatch?.[0],
        protein_line: protMatch?.[0],
        fiber_line: fibMatch?.[0],
        analysis_text_excerpt: text.slice(0, 500),
      };
    });
    console.log(`\n=== ${date} ===`);
    console.log(`  analysis totals: cal=${data.analysis_totals?.calories} prot=${data.analysis_totals?.protein} fib=${data.analysis_totals?.fiber}`);
    console.log(`  on screen cal: "${data.calMatch}"`);
    console.log(`  protein line: "${data.protein_line}"`);
    console.log(`  fiber line: "${data.fiber_line}"`);
  }

  await page.screenshot({ path: 'pwa/tests/screenshots/qa-progress/coach-remaining.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
