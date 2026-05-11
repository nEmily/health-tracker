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

  // Inject last 14 days so we can test "Load older"
  const days = [];
  for (let d = 27; d <= 30; d++) days.push(`2026-04-${String(d).padStart(2,'0')}`);
  for (let d = 1; d <= 10; d++) days.push(`2026-05-${String(d).padStart(2,'0')}`);
  for (const date of days) {
    const aP = `coach/analysis/${date}.json`;
    const lP = `coach/incoming/extracted/daily/${date}/log.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: null };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));
    await page.evaluate(async ({ a, userMsgs }) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: userMsgs });
    }, { a, userMsgs });
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Tap Chat tab (data-screen="coach")
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/01-chat-default.png', fullPage: false });

  const initial = await page.evaluate(() => {
    return {
      tabLabel: document.querySelector('.nav-item[data-screen="coach"] span')?.innerText,
      headerNavVisible: document.querySelector('.header-nav')?.style.display !== 'none',
      bubbles: document.querySelectorAll('.chat-bubble').length,
      daySeps: document.querySelectorAll('.coach-day-sep').length,
      daySepLabels: Array.from(document.querySelectorAll('.coach-day-sep span')).map(s => s.innerText),
      loadOlderVisible: !!document.getElementById('coach-load-older'),
      inputPresent: !!document.getElementById('coach-input'),
    };
  });
  console.log('Initial state:', JSON.stringify(initial, null, 2));

  // Click "Load older"
  await page.locator('#coach-load-older').click();
  await page.waitForTimeout(1500);
  const afterLoad = await page.evaluate(() => ({
    bubbles: document.querySelectorAll('.chat-bubble').length,
    daySeps: document.querySelectorAll('.coach-day-sep').length,
    daySepLabels: Array.from(document.querySelectorAll('.coach-day-sep span')).map(s => s.innerText),
  }));
  console.log('After Load older:', JSON.stringify(afterLoad, null, 2));
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/02-chat-after-load.png', fullPage: false });

  // Send a test message
  const input = page.locator('#coach-input');
  if (await input.count()) {
    await input.fill('test from QA');
    await page.locator('#coach-send').click();
    await page.waitForTimeout(1000);
    const sent = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('.chat-bubble.chat-user')).map(b => b.innerText);
      return bubbles.some(t => t.includes('test from QA'));
    });
    console.log('Sent message visible:', sent);
  }
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/03-chat-after-send.png', fullPage: false });

  if (errs.length) {
    console.log('\nErrors:');
    errs.forEach(e => console.log('  ' + e.slice(0, 200)));
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
