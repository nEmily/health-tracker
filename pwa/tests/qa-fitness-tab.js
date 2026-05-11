/**
 * Fitness tab interactive probe — find what's "not working well".
 * Tests: render, info expand, check exercise, check individual sets,
 *        enter reps/weights, save persistence on reload, last-session hint,
 *        narrow viewport overflow, rest-day rendering.
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
  // Inject regimen profile
  const regimen = JSON.parse(fs.readFileSync('coach/profile/regimen.json', 'utf-8'));
  await page.evaluate(async (r) => {
    // Stash regimen directly into the IDB profile store
    const db = await DB.openDB();
    const tx = db.transaction('profile', 'readwrite');
    tx.objectStore('profile').put({ key: 'regimen', value: r });
    await new Promise(res => tx.oncomplete = res);
  }, regimen);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
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
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,200)); });

  await setup(page);

  // We're already on Today. Look for the fitness section.
  console.log('\n══ 1. Fitness section renders today (Sunday — rest day) ══');
  // Today is 2026-05-10 = Sunday. With the new regimen that's a rest day.
  const sundayState = await page.evaluate(() => {
    const wo = document.getElementById('today-workout');
    return {
      exists: !!wo,
      html: wo?.innerHTML?.slice(0, 300) || '(empty)',
      hasRestCard: !!wo?.querySelector?.('.card'),
      cardText: wo?.querySelector?.('.card')?.innerText?.slice(0, 200) || '',
    };
  });
  console.log(`  workout container exists: ${sundayState.exists}`);
  console.log(`  card text: "${sundayState.cardText}"`);

  // Override date to a strength day (Monday) and re-render
  console.log('\n══ 2. Force Monday — Day A strength rendering ══');
  await page.evaluate(async () => {
    // Force App.selectedDate to a Monday and re-render today
    const mondayDate = '2026-05-11'; // Monday
    App.selectedDate = mondayDate;
    await App.loadDayView();
  });
  await page.waitForTimeout(800);
  const monState = await page.evaluate(() => {
    const wo = document.getElementById('today-workout');
    const exercises = Array.from(wo?.querySelectorAll('.fitness-exercise') || []);
    return {
      exists: !!wo,
      exerciseCount: exercises.length,
      exerciseNames: exercises.map(e => e.querySelector('.fitness-exercise-name')?.innerText),
      setRowCount: wo?.querySelectorAll('.fitness-set-row').length,
      infoButtonCount: wo?.querySelectorAll('.fitness-info-btn').length,
      hasDayHeader: !!wo?.querySelector('.fitness-day-header'),
      dayHeader: wo?.querySelector('.fitness-day-header')?.innerText?.slice(0, 80),
    };
  });
  console.log(`  exercises: ${monState.exerciseCount}`);
  for (const n of monState.exerciseNames) console.log(`    - ${n}`);
  console.log(`  total set rows: ${monState.setRowCount}`);
  console.log(`  info (?) buttons: ${monState.infoButtonCount}`);
  console.log(`  day header: "${monState.dayHeader}"`);

  // Issue check: does the page show optional bonus exercises?
  const hasOptional = await page.evaluate(() => {
    const wo = document.getElementById('today-workout');
    return wo?.innerText?.toLowerCase().includes('woodchopper') || wo?.innerText?.toLowerCase().includes('hip abduction');
  });
  console.log(`  optional bonus exercises rendered: ${hasOptional}`);
  if (!hasOptional) console.log(`  ⚠ optionalBonus[] array is in regimen but NOT rendered to UI`);

  // Try expanding info on first exercise
  console.log('\n══ 3. Info (?) button expands details ══');
  const infoBefore = await page.evaluate(() => {
    const detail = document.querySelector('#fitness-detail-0');
    return { display: detail?.style.display, hasContent: !!detail?.innerText?.trim() };
  });
  console.log(`  before click: display=${infoBefore.display} hasContent=${infoBefore.hasContent}`);
  await page.locator('.fitness-info-btn').first().click().catch(e => console.log('  click failed:', e.message));
  await page.waitForTimeout(400);
  const infoAfter = await page.evaluate(() => {
    const detail = document.querySelector('#fitness-detail-0');
    return { display: detail?.style.display, text: detail?.innerText?.slice(0, 200) };
  });
  console.log(`  after click: display=${infoAfter.display}, text starts: "${infoAfter.text?.slice(0,100)}"`);

  // Check a single set
  console.log('\n══ 4. Check a single set + enter weight + reps ══');
  const setStateBefore = await page.evaluate(() => {
    const set = document.querySelector('.fitness-set-row[data-set="0"]');
    if (!set) return null;
    return {
      exName: set.dataset.exercise,
      done: set.classList.contains('set-done'),
      weight: set.querySelector('.fitness-set-weight')?.value,
      reps: set.querySelector('.fitness-set-reps')?.value,
    };
  });
  console.log(`  before: ${JSON.stringify(setStateBefore)}`);
  // Enter weight + reps, click check
  await page.locator('.fitness-set-row[data-set="0"] .fitness-set-weight').first().fill('15');
  await page.locator('.fitness-set-row[data-set="0"] .fitness-set-reps').first().fill('8');
  await page.locator('.fitness-set-row[data-set="0"] .fitness-set-check').first().click();
  await page.waitForTimeout(400);
  const setStateAfter = await page.evaluate(() => {
    const set = document.querySelector('.fitness-set-row[data-set="0"]');
    return {
      done: set?.classList.contains('set-done'),
      weight: set?.querySelector('.fitness-set-weight')?.value,
      reps: set?.querySelector('.fitness-set-reps')?.value,
    };
  });
  console.log(`  after: ${JSON.stringify(setStateAfter)}`);

  // Reload — does it persist?
  console.log('\n══ 5. Reload — does saved state come back? ══');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Re-set the date
  await page.evaluate(async () => {
    App.selectedDate = '2026-05-11';
    await App.loadDayView();
  });
  await page.waitForTimeout(800);
  const afterReload = await page.evaluate(() => {
    const set = document.querySelector('.fitness-set-row[data-set="0"]');
    return {
      done: set?.classList.contains('set-done'),
      weight: set?.querySelector('.fitness-set-weight')?.value,
      reps: set?.querySelector('.fitness-set-reps')?.value,
      checkButton: set?.querySelector('.fitness-set-check')?.classList.contains('checked'),
    };
  });
  console.log(`  after reload: ${JSON.stringify(afterReload)}`);
  if (!afterReload.done || afterReload.weight !== '15' || afterReload.reps !== '8') {
    console.log(`  ⚠ STATE NOT PERSISTED across reload`);
  }

  // Check at 320px — overflow?
  console.log('\n══ 6. 320px viewport — input row overflow / wrap? ══');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(async () => { await App.refreshScreen('today'); });
  await page.waitForTimeout(400);
  const narrowState = await page.evaluate(() => {
    const set = document.querySelector('.fitness-set-row');
    if (!set) return { error: 'no set row' };
    const cs = getComputedStyle(set);
    const r = set.getBoundingClientRect();
    return {
      flexDirection: cs.flexDirection,
      flexWrap: cs.flexWrap,
      width: r.width,
      height: r.height,
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    };
  });
  console.log(`  set row: width=${narrowState.width} height=${narrowState.height} flex=${narrowState.flexDirection}/${narrowState.flexWrap}`);
  console.log(`  doc width vs window: ${narrowState.docW} vs ${narrowState.winW} ${narrowState.docW > narrowState.winW ? '⚠ HORIZONTAL OVERFLOW' : 'ok'}`);
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-fitness-tab-320.png', fullPage: true });

  // Switch to "last session" hint test
  console.log('\n══ 7. Last session hint surfaces on a future session ══');
  await page.setViewportSize({ width: 390, height: 844 });
  // Jump to next Monday (a week from May 11) — should see "1 week ago" hint for cable side bend
  await page.evaluate(async () => {
    App.selectedDate = '2026-05-18';
    await App.loadDayView();
  });
  await page.waitForTimeout(800);
  const hint = await page.evaluate(() => {
    const lh = document.querySelector('.fitness-last-hint');
    return lh ? lh.innerText : null;
  });
  console.log(`  hint visible: "${hint || '(none)'}"`);

  await page.screenshot({ path: 'pwa/tests/screenshots/qa-fitness-tab-390.png', fullPage: true });

  if (errs.length) {
    console.log('\nJS errors:');
    errs.slice(0, 15).forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo JS errors.');
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
