/**
 * Interactive scroll testing for the new Chat tab.
 * Drives: open tab, observe scroll position, scroll up, load older,
 * scroll back, send message, switch tabs + return.
 */
const { chromium } = require('playwright');
const fs = require('fs');

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

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  // Inject 14 days
  for (let d = 27; d <= 30; d++) {
    const date = `2026-04-${String(d).padStart(2,'0')}`;
    const aP = `coach/analysis/${date}.json`;
    const lP = `coach/incoming/extracted/daily/${date}/log.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: null };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));
    await page.evaluate(async ({a, userMsgs}) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: userMsgs });
    }, { a, userMsgs });
  }
  for (let d = 1; d <= 10; d++) {
    const date = `2026-05-${String(d).padStart(2,'0')}`;
    const aP = `coach/analysis/${date}.json`;
    const lP = `coach/incoming/extracted/daily/${date}/log.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    const log = fs.existsSync(lP) ? JSON.parse(fs.readFileSync(lP, 'utf-8')) : { entries: [], coachChat: null };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({ id: m.id, role: 'user', text: m.text, timestamp: m.timestamp }));
    await page.evaluate(async ({a, userMsgs}) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: userMsgs });
    }, { a, userMsgs });
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Click Chat tab
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1500);

  // Test 1: initial scroll position
  let state = await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    return {
      scrollTop: m?.scrollTop,
      scrollHeight: m?.scrollHeight,
      clientHeight: m?.clientHeight,
      atBottom: m ? (m.scrollHeight - m.scrollTop - m.clientHeight) < 5 : null,
      bodyScrollY: window.scrollY,
      bodyScrollHeight: document.body.scrollHeight,
      windowInnerHeight: window.innerHeight,
    };
  });
  console.log('\n[1] On Chat tab open:');
  console.log(`  coach-messages: scrollTop=${state.scrollTop} scrollHeight=${state.scrollHeight} clientHeight=${state.clientHeight} atBottom=${state.atBottom}`);
  console.log(`  body: scrollY=${state.bodyScrollY} bodyHeight=${state.bodyScrollHeight} window=${state.windowInnerHeight}`);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/scroll-01-open.png', fullPage: false });
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/scroll-01-open-FULL.png', fullPage: true });

  // Test 2: scroll up inside coach-messages
  await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    if (m) m.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  state = await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    return {
      scrollTop: m?.scrollTop,
      scrollHeight: m?.scrollHeight,
      clientHeight: m?.clientHeight,
      bodyScrollY: window.scrollY,
    };
  });
  console.log('\n[2] After scrolling to top of messages:');
  console.log(`  scrollTop=${state.scrollTop}, body scrollY=${state.bodyScrollY}`);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/scroll-02-at-top.png', fullPage: false });

  // Test 3: Load older
  await page.locator('#coach-load-older').click();
  await page.waitForTimeout(1500);
  state = await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    return {
      scrollTop: m?.scrollTop,
      scrollHeight: m?.scrollHeight,
      clientHeight: m?.clientHeight,
      bubbles: document.querySelectorAll('.chat-bubble').length,
    };
  });
  console.log('\n[3] After Load older click:');
  console.log(`  scrollTop=${state.scrollTop} (should NOT be 0 — should be at the previous position)`);
  console.log(`  scrollHeight=${state.scrollHeight} bubbles=${state.bubbles}`);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/scroll-03-after-load.png', fullPage: false });

  // Test 4: scroll back to bottom + verify
  await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    if (m) m.scrollTop = m.scrollHeight;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/scroll-04-at-bottom.png', fullPage: false });

  // Test 5: Switch to Today + back to Chat — does scroll reset?
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(800);
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1500);
  state = await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    return {
      scrollTop: m?.scrollTop,
      scrollHeight: m?.scrollHeight,
      atBottom: m ? (m.scrollHeight - m.scrollTop - m.clientHeight) < 5 : null,
    };
  });
  console.log('\n[5] After switching Today<->Chat:');
  console.log(`  scrollTop=${state.scrollTop} atBottom=${state.atBottom}`);

  // Test 6: Body overflow — does the page scroll separately from the messages?
  const overflow = await page.evaluate(() => {
    const docH = document.documentElement.scrollHeight;
    const winH = window.innerHeight;
    return {
      docScrollHeight: docH,
      windowInnerHeight: winH,
      bodyOverflows: docH > winH + 5,
    };
  });
  console.log('\n[6] Document overflow check:');
  console.log(`  docScrollHeight=${overflow.docScrollHeight} windowInnerHeight=${overflow.windowInnerHeight} bodyOverflows=${overflow.bodyOverflows}`);

  if (errs.length) {
    console.log('\nErrors:');
    errs.forEach(e => console.log('  ' + e.slice(0, 200)));
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
