const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[ERR]', m.text()); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject a few days of data
  for (const d of ['2026-05-02','2026-05-03','2026-05-04']) {
    const a = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../coach/analysis/${d}.json`), 'utf-8'));
    await page.evaluate(async (a) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: [] });
    }, a);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, 'screenshots/qa-deep/06-progress.png'), fullPage: true });

  await page.locator('[data-ptab="trends"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.resolve(__dirname, 'screenshots/qa-deep/07-trends.png'), fullPage: true });

  const svgs = await page.locator('#progress-content svg, .progress-content svg, main svg').count();
  console.log(`SVGs in trends: ${svgs}`);

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
