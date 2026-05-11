/**
 * Phase-2 scroll chaos: real "feels weird" scenarios.
 * - Scroll position preservation across tab switches
 * - Overscroll behavior (iOS rubber-band)
 * - Header sticky during scroll
 * - fadeIn animation during scroll
 * - Scroll-up wheel (the previous test only tested down)
 * - Rapid tab switching during scroll
 */
const { chromium } = require('playwright');
const fs = require('fs');

async function inject(page) {
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  for (const date of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const aP = `coach/analysis/${date}.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    await page.evaluate(async ({a}) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [], coachChat: [] });
    }, { a });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,150)); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await inject(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  console.log('\n══ TEST 1: overscroll-behavior on every scroll surface ══');
  const overscroll = await page.evaluate(() => {
    const out = [];
    const check = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el);
      out.push({ sel, overscrollY: cs.overscrollBehaviorY, overscrollX: cs.overscrollBehaviorX });
    };
    check('html');
    check('body');
    check('#app');
    check('.screen.active');
    check('#coach-messages');
    return out;
  });
  for (const o of overscroll) {
    const flag = (o.overscrollY === 'auto') ? ' ⚠ AUTO (causes iOS rubber-band chain)' : '';
    console.log(`  ${o.sel}: overscroll-behavior-y=${o.overscrollY}${flag}`);
  }

  console.log('\n══ TEST 2: scroll position preserved across tab switches? ══');
  // Scroll today halfway
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = document.querySelector('.screen.active');
    s.scrollTop = 400;
  });
  await page.waitForTimeout(200);
  const todayBefore = await page.evaluate(() => document.getElementById('screen-today').scrollTop);
  console.log(`  today scrolled to: ${todayBefore}`);
  // Switch to progress
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = document.querySelector('.screen.active');
    s.scrollTop = 600;
  });
  await page.waitForTimeout(200);
  const progBefore = await page.evaluate(() => document.getElementById('screen-progress').scrollTop);
  console.log(`  progress scrolled to: ${progBefore}`);
  // Switch back to today
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  const todayAfter = await page.evaluate(() => document.getElementById('screen-today').scrollTop);
  console.log(`  today scrollTop after return: ${todayAfter} (was ${todayBefore})`);
  if (todayAfter !== todayBefore) console.log(`  ⚠ scroll position LOST on tab switch`);
  // Back to progress
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  const progAfter = await page.evaluate(() => document.getElementById('screen-progress').scrollTop);
  console.log(`  progress scrollTop after return: ${progAfter} (was ${progBefore})`);
  if (progAfter !== progBefore) console.log(`  ⚠ scroll position LOST on tab switch`);

  console.log('\n══ TEST 3: header sticky behavior during scroll ══');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  const headerBefore = await page.evaluate(() => document.querySelector('.app-header')?.getBoundingClientRect());
  await page.evaluate(() => { document.querySelector('.screen.active').scrollTop = 400; });
  await page.waitForTimeout(200);
  const headerAfter = await page.evaluate(() => document.querySelector('.app-header')?.getBoundingClientRect());
  console.log(`  header before: top=${headerBefore.top}, after scroll: top=${headerAfter.top}`);
  if (Math.abs(headerBefore.top - headerAfter.top) > 1) {
    console.log(`  ⚠ header MOVED — sticky not working`);
  }

  console.log('\n══ TEST 4: scroll-up wheel (previous test only +200, now -200) ══');
  // Reset coach tab so it's at bottom, then try wheel UP to scroll back through history
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1000);
  const coachInitial = await page.evaluate(() => {
    const m = document.getElementById('coach-messages');
    return { scrollTop: m?.scrollTop, scrollHeight: m?.scrollHeight, clientHeight: m?.clientHeight };
  });
  console.log(`  coach-messages initial: scrollTop=${coachInitial.scrollTop} / ${coachInitial.scrollHeight} (client=${coachInitial.clientHeight})`);
  // Try wheel UP
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  const coachAfterUp = await page.evaluate(() => document.getElementById('coach-messages')?.scrollTop);
  console.log(`  after wheel -200: scrollTop=${coachAfterUp}`);
  if (coachAfterUp === coachInitial.scrollTop) {
    console.log(`  ⚠ wheel UP did not scroll — POSSIBLE BUG`);
  }

  console.log('\n══ TEST 5: rapid tab switch while scroll-momentum active ══');
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = document.querySelector('.screen.active');
    s.scrollTo({ top: 800, behavior: 'smooth' });
  });
  // Switch tab while smooth-scroll is mid-flight
  await page.waitForTimeout(80);
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  const today = await page.evaluate(() => document.getElementById('screen-today').scrollTop);
  console.log(`  today scrollTop after mid-flight tab switch: ${today}`);
  const errsAfter = errs.length;

  console.log('\n══ TEST 6: fadeIn animation runs on every screen activation? ══');
  // The .screen has animation: fadeIn — does this run every switch?
  const anim = await page.evaluate(() => {
    const s = document.querySelector('.screen.active');
    return getComputedStyle(s).animationName;
  });
  console.log(`  active screen animation: ${anim}`);
  if (anim === 'fadeIn') console.log(`  ⚠ fadeIn re-runs on every tab switch — could feel like content "jumps" before settling`);

  console.log('\n══ TEST 7: pull-to-refresh / drag-to-close gestures ══');
  // Touch drag from top of the screen downward — does it scroll or rubber-band?
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(400);
  // Use touch-drag via dispatching touchstart/touchmove
  const dragResult = await page.evaluate(async () => {
    const before = window.scrollY;
    const screen = document.querySelector('.screen.active');
    const beforeScroll = screen.scrollTop;
    // Simulate a top-of-screen downward touch drag
    const evt = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: screen, clientX: x, clientY: y });
      const e = new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], bubbles: true, cancelable: true });
      screen.dispatchEvent(e);
    };
    evt('touchstart', 195, 60);
    for (let dy = 0; dy <= 200; dy += 20) {
      evt('touchmove', 195, 60 + dy);
      await new Promise(r => setTimeout(r, 10));
    }
    evt('touchend', 195, 260);
    return { winYBefore: before, winYAfter: window.scrollY, screenScrollBefore: beforeScroll, screenScrollAfter: screen.scrollTop };
  });
  console.log(`  top-drag down: winY ${dragResult.winYBefore}→${dragResult.winYAfter}, screen ${dragResult.screenScrollBefore}→${dragResult.screenScrollAfter}`);

  await page.screenshot({ path: 'pwa/tests/screenshots/qa-scroll-chaos/phase2.png' });

  if (errs.length) {
    console.log('\nJS errors:');
    errs.slice(0, 10).forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo JS errors.');
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
