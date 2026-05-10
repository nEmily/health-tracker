const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject 5/4 and 5/5 (and recents)
  for (const d of ['2026-05-03','2026-05-04','2026-05-05']) {
    const a = JSON.parse(fs.readFileSync(`coach/analysis/${d}.json`, 'utf-8'));
    const lP = `coach/incoming/extracted/daily/${d}/log.json`;
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: [] };
    const userMsgs = (log.coachChat || []).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));
    await page.evaluate(async ({ a, entries, userMsgs }) => {
      await DB.importAnalysis(a.date, a);
      for (const e of entries) { try { await DB.addEntry(e); } catch {} }
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: userMsgs });
    }, { a, entries: log.entries || [], userMsgs });
  }

  // Set selected date to 5/5 BEFORE reload so the app loads it
  await page.evaluate(() => { localStorage.setItem('coach-selected-date', '2026-05-05'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Force-set selectedDate via App
  await page.evaluate(() => {
    if (window.App) {
      App.selectedDate = '2026-05-05';
      App.loadDayView && App.loadDayView();
    }
  });
  await page.waitForTimeout(500);

  // Debug: check what data is loaded
  const debug = await page.evaluate(async () => {
    const summary = await DB.getDailySummary('2026-05-05');
    const analysis = await DB.getAnalysis('2026-05-05');
    return {
      summary_keys: summary ? Object.keys(summary) : null,
      summary_chat_count: summary?.coachChat?.length || 0,
      analysis_responses: analysis?.coachResponses?.length || 0,
      first_user_msg: summary?.coachChat?.[0],
      first_coach_resp: analysis?.coachResponses?.[0],
    };
  });
  console.log('DEBUG:', JSON.stringify(debug, null, 2));

  // Click Coach tab first (so coach loadCoachView triggers on today)
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(800);

  // Now navigate back 5 days using prev button (5/10 -> 5/5)
  for (let i = 0; i < 5; i++) {
    const prev = page.locator('#header-prev').first();
    if (!(await prev.isVisible().catch(()=>false))) break;
    await prev.click();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-interactive/08-coach-5-5-real.png', fullPage: true });
  const bubbles = await page.locator('.chat-bubble').count();
  const texts = await page.locator('.chat-bubble .chat-text').allInnerTexts();
  console.log(`bubbles: ${bubbles}`);
  texts.forEach((t,i) => console.log(`  ${i}: ${t.slice(0,80)}`));
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
