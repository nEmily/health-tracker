/**
 * Test: what happens when user scrolls OUTSIDE the chat box but still on
 * the Chat tab? (e.g. scrolling on the margin/padding area)
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
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  // Inject several days
  for (const date of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
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
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1500);

  // Initial layout — what's the screen-coach element?
  const layout = await page.evaluate(() => {
    const screen = document.getElementById('screen-coach');
    const inbox = document.getElementById('coach-inbox');
    const chat = document.querySelector('.coach-chat');
    const main = screen?.closest('main');
    return {
      screen: { rect: screen?.getBoundingClientRect(), scrollHeight: screen?.scrollHeight, clientHeight: screen?.clientHeight, overflowY: getComputedStyle(screen).overflowY },
      inbox: { rect: inbox?.getBoundingClientRect(), overflowY: getComputedStyle(inbox).overflowY },
      chat: { rect: chat?.getBoundingClientRect() },
      body: { scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight, scrollY: window.scrollY },
      docEl: { scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight },
      windowH: window.innerHeight,
    };
  });
  console.log('LAYOUT:');
  console.log(`  screen-coach: rect=(${layout.screen.rect.top.toFixed(0)},${layout.screen.rect.bottom.toFixed(0)}) scrollH=${layout.screen.scrollHeight} clientH=${layout.screen.clientHeight} overflowY=${layout.screen.overflowY}`);
  console.log(`  inbox: rect=(${layout.inbox.rect.top.toFixed(0)},${layout.inbox.rect.bottom.toFixed(0)}) overflowY=${layout.inbox.overflowY}`);
  console.log(`  chat: rect=(${layout.chat.rect.top.toFixed(0)},${layout.chat.rect.bottom.toFixed(0)})`);
  console.log(`  body: scrollH=${layout.body.scrollHeight} clientH=${layout.body.clientHeight} scrollY=${layout.body.scrollY}`);
  console.log(`  docEl: scrollH=${layout.docEl.scrollHeight} clientH=${layout.docEl.clientHeight}`);
  console.log(`  window innerH=${layout.windowH}`);

  // Test scrolling on screen-coach (outside the chat box)
  console.log('\n[1] Scroll on screen-coach element (above chat box):');
  await page.evaluate(() => {
    const screen = document.getElementById('screen-coach');
    screen.scrollTop = 200;
    document.documentElement.scrollTop = 200;
    document.body.scrollTop = 200;
    window.scrollTo(0, 200);
  });
  await page.waitForTimeout(400);
  const afterScroll = await page.evaluate(() => ({
    bodyScrollY: window.scrollY,
    screenScrollTop: document.getElementById('screen-coach')?.scrollTop,
    bodyScrollTop: document.body.scrollTop,
    docElScrollTop: document.documentElement.scrollTop,
  }));
  console.log(`  bodyScrollY=${afterScroll.bodyScrollY} screen scrollTop=${afterScroll.screenScrollTop} body scrollTop=${afterScroll.bodyScrollTop} docEl scrollTop=${afterScroll.docElScrollTop}`);

  // Simulate touch/wheel events on the outside area
  console.log('\n[2] Wheel event on element ABOVE the chat box (top padding):');
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(200);
  // Wheel event at coordinate ABOVE the chat box top
  await page.mouse.move(195, 50);  // top of viewport
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  const after2 = await page.evaluate(() => ({
    bodyScrollY: window.scrollY,
    chatScrollTop: document.getElementById('coach-messages')?.scrollTop,
  }));
  console.log(`  bodyScrollY=${after2.bodyScrollY} chatMessages scrollTop=${after2.chatScrollTop}`);

  // Take a screenshot of the screen-coach DOM tree visualized
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-chat/outside-scroll-1.png', fullPage: false });

  // Try simulating a drag on the body area (gesture)
  console.log('\n[3] Touch drag from BOTTOM PADDING area:');
  // Find the bottom area (between chat box and bottom-nav)
  const chatBottom = await page.evaluate(() => document.querySelector('.coach-chat')?.getBoundingClientRect().bottom);
  const navTop = await page.evaluate(() => document.querySelector('.bottom-nav')?.getBoundingClientRect().top);
  console.log(`  chat bottom=${chatBottom}, nav top=${navTop}, gap=${navTop - chatBottom}px`);
  // Drag in that gap area downward
  if (navTop - chatBottom > 10) {
    const midY = (chatBottom + navTop) / 2;
    await page.touchscreen.tap(195, midY);
    await page.waitForTimeout(200);
    // Try a drag from there upward
    try {
      const handle = await page.evaluateHandle(() => document.body);
      await page.evaluate(async ({y}) => {
        // Simulate a swipe
        const evt = (type, x, y) => new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y })],
          bubbles: true,
        });
        document.body.dispatchEvent(evt('touchstart', 195, y));
        document.body.dispatchEvent(evt('touchmove', 195, y - 100));
        document.body.dispatchEvent(evt('touchend', 195, y - 100));
      }, { y: midY });
    } catch (e) {
      console.log(`  drag failed: ${e.message}`);
    }
  }

  if (errs.length) errs.forEach(e => console.log('ERR: ' + e.slice(0, 200)));
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
