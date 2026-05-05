/**
 * Debug-focused test: why does Coach tab show 0 bubbles after injection?
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', m => console.log(`[CONS ${m.type()}]`, m.text().slice(0,300)));
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'test-uuid-qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject the analysis
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../coach/analysis/2026-05-04.json'), 'utf-8'));
  const r = await page.evaluate(async (data) => {
    if (!window.DB) return 'no DB';
    await DB.importAnalysis(data.date, data);
    const back = await DB.getAnalysis(data.date);
    return {
      injected_count: (data.coachResponses || []).length,
      stored_count: (back?.coachResponses || []).length,
      stored_keys: back ? Object.keys(back).slice(0,15) : null,
      first_response: back?.coachResponses?.[0],
    };
  }, data);
  console.log('\n[INJECTION]', JSON.stringify(r, null, 2));

  // Now click Coach tab and check what render produces
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1000);

  const renderInfo = await page.evaluate(async () => {
    if (!window.CoachChat) return 'no CoachChat';
    const today = window.UI?.today() || new Date().toISOString().slice(0,10);
    const summary = await DB.getDailySummary(today);
    const analysis = await DB.getAnalysis(today);
    return {
      today,
      summary_keys: summary ? Object.keys(summary) : null,
      summary_coachChat: summary?.coachChat?.length || 0,
      analysis_exists: !!analysis,
      analysis_coachResponses: analysis?.coachResponses?.length || 0,
      first_response: analysis?.coachResponses?.[0],
    };
  });
  console.log('\n[RENDER STATE]', JSON.stringify(renderInfo, null, 2));

  // Check what's in DOM
  const dom = await page.evaluate(() => {
    const c = document.querySelector('#coach-messages, .coach-messages, .coach-chat');
    return c ? { html: c.innerHTML.slice(0,800), bubbles: document.querySelectorAll('.chat-bubble').length } : 'no coach container';
  });
  console.log('\n[DOM]', JSON.stringify(dom, null, 2));

  await page.screenshot({ path: path.join(__dirname, 'screenshots/qa/debug-coach.png'), fullPage: true });

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
