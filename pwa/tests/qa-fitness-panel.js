/**
 * Fitness PANEL probe — Today screen has 3 swipeable panels (Diet/Fitness/Skin).
 * Test the Fitness panel specifically. Find:
 *   - optionalBonus[] rendering (currently MISSING from UI)
 *   - panel height bugs (container minHeight is set from inner panel, can desync)
 *   - scroll behavior when fitness panel is taller than diet panel
 *   - whether set check / weight input works on every set
 *   - whether optional bonus exercises are accessible
 */
const { chromium } = require('playwright');
const fs = require('fs');

async function setup(page) {
  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  const regimen = JSON.parse(fs.readFileSync('coach/profile/regimen.json', 'utf-8'));
  await page.evaluate(async (r) => {
    const db = await DB.openDB();
    const tx = db.transaction('profile', 'readwrite');
    tx.objectStore('profile').put({ key: 'regimen', value: r });
    await new Promise(res => tx.oncomplete = res);
  }, regimen);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

async function gotoFitnessOnDate(page, date) {
  await page.evaluate(async (d) => {
    App.selectedDate = d;
    if (App.updateHeaderDate) App.updateHeaderDate();
    await App.loadDayView();
    App.switchPanel('fitness');
  }, date);
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await setup(page);

  // ── BUG A: optionalBonus[] never rendered ────────────────────────────
  console.log('\n══ A. optionalBonus exercises rendered on a strength day? ══');
  await gotoFitnessOnDate(page, '2026-05-12'); // Monday = Day A
  const panelState = await page.evaluate(() => {
    const p = document.getElementById('panel-fitness');
    return {
      visible: p && getComputedStyle(p).display !== 'none',
      innerText: p?.innerText?.toLowerCase() || '',
      exercises: Array.from(p?.querySelectorAll('.fitness-exercise') || []).map(e => e.querySelector('.fitness-exercise-name')?.innerText),
    };
  });
  console.log(`  fitness panel visible: ${panelState.visible}`);
  console.log(`  exercises rendered (${panelState.exercises.length}):`);
  for (const n of panelState.exercises) console.log(`    - ${n}`);
  const expectedOptional = ['cable woodchopper', 'hip abduction'];
  const hasOptional = expectedOptional.every(o => panelState.innerText.includes(o));
  console.log(`  optional rendered: ${hasOptional}`);
  if (!hasOptional) console.log(`  ⚠ optionalBonus[] is in regimen but NOT in the UI — invisible to user`);

  // ── BUG B: panel height syncs when switching panels ─────────────────
  console.log('\n══ B. Panel height syncing across panel switches ══');
  const heights = await page.evaluate(() => {
    const container = document.getElementById('today-panels');
    const diet = document.getElementById('panel-diet');
    const fitness = document.getElementById('panel-fitness');
    const skin = document.getElementById('panel-skin');
    return {
      container: container?.getBoundingClientRect().height,
      containerMinH: container?.style.minHeight,
      diet: diet?.scrollHeight,
      fitness: fitness?.scrollHeight,
      skin: skin?.scrollHeight,
    };
  });
  console.log(`  container=${heights.container}px (minHeight=${heights.containerMinH})`);
  console.log(`  diet=${heights.diet}px  fitness=${heights.fitness}px  skin=${heights.skin}px`);
  // Switch to diet, then back to fitness, then to skin — does height update?
  await page.evaluate(() => App.switchPanel('diet'));
  await page.waitForTimeout(300);
  const afterDiet = await page.evaluate(() => ({
    container: document.getElementById('today-panels')?.getBoundingClientRect().height,
  }));
  console.log(`  after switching to Diet: container=${afterDiet.container}px (should match diet=${heights.diet})`);
  await page.evaluate(() => App.switchPanel('skin'));
  await page.waitForTimeout(300);
  const afterSkin = await page.evaluate(() => ({
    container: document.getElementById('today-panels')?.getBoundingClientRect().height,
  }));
  console.log(`  after switching to Skin: container=${afterSkin.container}px (should match skin=${heights.skin})`);
  if (afterSkin.container > heights.skin + 50) {
    console.log(`  ⚠ container is ${afterSkin.container - heights.skin}px TALLER than skin needs — empty space below`);
  }

  // ── BUG C: scroll into view on a tall fitness panel ─────────────────
  console.log('\n══ C. Can user reach the last exercise on a tall fitness panel? ══');
  await page.evaluate(() => App.switchPanel('fitness'));
  await page.waitForTimeout(400);
  const reachState = await page.evaluate(() => {
    const lastEx = Array.from(document.querySelectorAll('#panel-fitness .fitness-exercise')).pop();
    if (!lastEx) return { error: 'no exercises' };
    const r = lastEx.getBoundingClientRect();
    const screen = document.getElementById('screen-today');
    return {
      lastBottom: r.bottom,
      lastName: lastEx.querySelector('.fitness-exercise-name')?.innerText,
      screenScrollTop: screen?.scrollTop,
      screenScrollHeight: screen?.scrollHeight,
      screenClientHeight: screen?.clientHeight,
      winH: window.innerHeight,
      navTop: document.querySelector('.bottom-nav')?.getBoundingClientRect().top,
    };
  });
  console.log(`  screen: scroll=${reachState.screenScrollTop}/${reachState.screenScrollHeight} client=${reachState.screenClientHeight}`);
  console.log(`  last exercise ("${reachState.lastName}") bottom=${reachState.lastBottom}, nav top=${reachState.navTop}`);
  if (reachState.lastBottom > reachState.navTop) {
    console.log(`  last exercise is below the visible area — user must scroll to reach it`);
  }
  // Try to scroll the screen
  await page.evaluate(() => {
    const s = document.getElementById('screen-today');
    s.scrollTo({ top: s.scrollHeight, behavior: 'instant' });
  });
  await page.waitForTimeout(300);
  const afterScroll = await page.evaluate(() => {
    const lastEx = Array.from(document.querySelectorAll('#panel-fitness .fitness-exercise')).pop();
    const r = lastEx?.getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    return { lastBottom: r?.bottom, navTop: nav?.top };
  });
  console.log(`  after scroll-to-bottom: last bottom=${afterScroll.lastBottom}, nav top=${afterScroll.navTop}`);
  if (afterScroll.lastBottom > afterScroll.navTop) {
    console.log(`  ⚠ even after scroll, last exercise is OBSCURED by bottom nav`);
  }

  // ── BUG D: set check / weight on an actual exercise ─────────────────
  console.log('\n══ D. Check individual sets — does state save? ══');
  await page.evaluate(() => {
    const s = document.getElementById('screen-today');
    s.scrollTo({ top: 0, behavior: 'instant' });
  });
  // Scroll the first set row into view in the screen scroller
  await page.evaluate(() => {
    const row = document.querySelector('#panel-fitness .fitness-set-row[data-set="0"]');
    row?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(300);
  const firstRow = await page.evaluate(() => {
    const r = document.querySelector('#panel-fitness .fitness-set-row[data-set="0"]');
    return { rect: r?.getBoundingClientRect(), exName: r?.dataset.exercise };
  });
  console.log(`  first set row: ${firstRow.exName}, rect bottom=${firstRow.rect?.bottom}`);
  // Use dispatchEvent click since Playwright .click() complains about viewport
  const clickResult = await page.evaluate(async () => {
    const row = document.querySelector('#panel-fitness .fitness-set-row[data-set="0"]');
    const w = row.querySelector('.fitness-set-weight');
    const reps = row.querySelector('.fitness-set-reps');
    const check = row.querySelector('.fitness-set-check');
    w.value = '15';
    w.dispatchEvent(new Event('change', { bubbles: true }));
    w.dispatchEvent(new Event('blur', { bubbles: true }));
    reps.value = '8';
    reps.dispatchEvent(new Event('change', { bubbles: true }));
    reps.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    check.click();
    await new Promise(r => setTimeout(r, 300));
    return { done: row.classList.contains('set-done') };
  });
  console.log(`  set 0 marked done: ${clickResult.done}`);

  // ── BUG E: header overlap / day-header vs sticky nav ────────────────
  console.log('\n══ E. fitness-day-header position / visibility ══');
  const headerState = await page.evaluate(() => {
    const h = document.querySelector('#panel-fitness .fitness-day-header');
    return { exists: !!h, rect: h?.getBoundingClientRect(), text: h?.innerText };
  });
  console.log(`  day header: "${headerState.text}", rect: ${JSON.stringify(headerState.rect && { t: Math.round(headerState.rect.top), b: Math.round(headerState.rect.bottom) })}`);

  // ── BUG F: rest day rendering ───────────────────────────────────────
  console.log('\n══ F. Rest day (Sunday/Wed/Sat) rendering ══');
  await gotoFitnessOnDate(page, '2026-05-13'); // Wednesday = rest in new plan
  const restState = await page.evaluate(() => {
    const p = document.getElementById('panel-fitness');
    return {
      visible: !!p,
      innerText: p?.innerText?.slice(0, 200),
      hasExercises: !!p?.querySelector('.fitness-exercise'),
    };
  });
  console.log(`  rest-day text: "${restState.innerText}"`);
  console.log(`  exercise cards rendered on rest day: ${restState.hasExercises}`);

  await page.screenshot({ path: 'pwa/tests/screenshots/qa-fitness-panel-monday.png', fullPage: false });
  await gotoFitnessOnDate(page, '2026-05-12');
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-fitness-panel-monday-full.png', fullPage: true });

  if (errs.length) {
    console.log('\nJS errors:');
    errs.slice(0, 12).forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo JS errors.');
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
