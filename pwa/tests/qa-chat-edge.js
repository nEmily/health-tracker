/**
 * Edge-case interactive tests: send-while-scrolled-up, empty chat,
 * narrow viewport, tab switching.
 */
const { chromium } = require('playwright');
const fs = require('fs');

async function setupPage(page, days, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  for (const date of days) {
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
  await page.waitForTimeout(1000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errs = [];
  for (const testCase of [
    { name: 'iPhone 14 Pro', viewport: { width: 390, height: 844 } },
    { name: 'iPhone SE 320px', viewport: { width: 320, height: 568 } },
  ]) {
    console.log(`\n========= ${testCase.name} (${testCase.viewport.width}x${testCase.viewport.height}) =========`);
    const ctx = await browser.newContext({
      viewport: testCase.viewport,
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`[${testCase.name}] PAGEERROR: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`[${testCase.name}] ${m.text()}`); });

    const days = ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10'];
    await setupPage(page, days, testCase.viewport);

    // Open Chat
    await page.locator('.nav-item[data-screen="coach"]').first().click();
    await page.waitForTimeout(1500);
    const initialState = await page.evaluate(() => {
      const m = document.getElementById('coach-messages');
      return {
        chatHeight: document.querySelector('.coach-chat')?.getBoundingClientRect().height,
        bottomNavTop: document.querySelector('.bottom-nav')?.getBoundingClientRect().top,
        chatBottom: document.querySelector('.coach-chat')?.getBoundingClientRect().bottom,
        windowH: window.innerHeight,
        inputBarVisible: !!document.getElementById('coach-input')?.checkVisibility?.() || (document.getElementById('coach-input')?.getBoundingClientRect().top < window.innerHeight),
        atBottom: m ? (m.scrollHeight - m.scrollTop - m.clientHeight) < 5 : null,
      };
    });
    console.log(`  chat box: height=${initialState.chatHeight}, bottom=${initialState.chatBottom}, bottomNav top=${initialState.bottomNavTop}, window=${initialState.windowH}`);
    console.log(`  input visible: ${initialState.inputBarVisible}, scroll at bottom: ${initialState.atBottom}`);
    if (initialState.chatBottom > initialState.bottomNavTop + 5) {
      console.log(`  WARN: chat extends BELOW bottom nav by ${initialState.chatBottom - initialState.bottomNavTop}px`);
    }
    await page.screenshot({ path: `pwa/tests/screenshots/qa-chat/edge-${testCase.viewport.width}-default.png`, fullPage: false });

    // Scroll up halfway, then send a message
    await page.evaluate(() => {
      const m = document.getElementById('coach-messages');
      if (m) m.scrollTop = m.scrollHeight / 2;
    });
    await page.waitForTimeout(400);
    const beforeSend = await page.evaluate(() => {
      const m = document.getElementById('coach-messages');
      return { scrollTop: m?.scrollTop, scrollHeight: m?.scrollHeight };
    });
    console.log(`  scrolled to middle: scrollTop=${beforeSend.scrollTop}/${beforeSend.scrollHeight}`);

    await page.locator('#coach-input').fill(`edge test ${testCase.viewport.width}`);
    await page.locator('#coach-send').click();
    await page.waitForTimeout(1500);
    const afterSend = await page.evaluate(() => {
      const m = document.getElementById('coach-messages');
      return {
        scrollTop: m?.scrollTop,
        scrollHeight: m?.scrollHeight,
        atBottom: m ? (m.scrollHeight - m.scrollTop - m.clientHeight) < 5 : null,
        lastUserBubbleText: Array.from(document.querySelectorAll('.chat-bubble.chat-user')).pop()?.innerText?.slice(0,40),
      };
    });
    console.log(`  after send: scrollTop=${afterSend.scrollTop} atBottom=${afterSend.atBottom}, last bubble: "${afterSend.lastUserBubbleText}"`);
    if (!afterSend.atBottom) {
      console.log(`  WARN: did NOT scroll to bottom after sending`);
    }
    await page.screenshot({ path: `pwa/tests/screenshots/qa-chat/edge-${testCase.viewport.width}-after-send.png`, fullPage: false });

    // Test horizontal overflow at 320px
    if (testCase.viewport.width === 320) {
      const overflow = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      }));
      console.log(`  horiz overflow: docW=${overflow.docW} winW=${overflow.winW} overflows=${overflow.docW > overflow.winW + 1}`);
    }

    await page.close();
    await ctx.close();
  }

  // Empty-chat test (no history)
  console.log('\n========= Empty chat (brand new user) =========');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  // Inject empty today only
  await page.evaluate(async () => {
    await DB.importAnalysis('2026-05-10', { date: '2026-05-10', entries: [], totals: {calories: 0}, coachResponses: [] });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1200);
  const empty = await page.evaluate(() => ({
    emptyStateVisible: !!document.querySelector('.coach-empty-state'),
    inputVisible: !!document.getElementById('coach-input'),
    bubbleCount: document.querySelectorAll('.chat-bubble').length,
    daySeps: document.querySelectorAll('.coach-day-sep').length,
  }));
  console.log(`  empty-state shown: ${empty.emptyStateVisible}, input visible: ${empty.inputVisible}, bubbles: ${empty.bubbleCount}, day-seps: ${empty.daySeps}`);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/edge-empty.png', fullPage: false });

  if (errs.length) {
    console.log('\nErrors:');
    errs.slice(0, 15).forEach(e => console.log('  ' + e.slice(0, 200)));
  } else {
    console.log('\nNo JS errors.');
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
