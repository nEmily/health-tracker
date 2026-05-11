/**
 * Deep dogfood: interactions, flows, edge cases, empty states.
 * Targets stuff the surface-scan didn't catch — modals, forms,
 * edit, delete, sync, date nav, error states, fresh user.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = '.claude/test-screenshots/dogfood-flows';
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) fs.unlinkSync(path.join(SHOTS, f));

let n = 0;
const shot = async (page, label) => {
  n++;
  const name = `${String(n).padStart(2,'0')}-${label}.png`;
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  return name;
};

async function injectRichData(page) {
  const regimen = JSON.parse(fs.readFileSync('coach/profile/regimen.json', 'utf-8'));
  await page.evaluate(async (r) => {
    const db = await DB.openDB();
    const tx = db.transaction('profile', 'readwrite');
    tx.objectStore('profile').put({ key: 'regimen', value: r });
    await new Promise(res => tx.oncomplete = res);
  }, regimen);
  for (const date of ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10']) {
    const aP = `coach/analysis/${date}.json`;
    if (!fs.existsSync(aP)) continue;
    const a = JSON.parse(fs.readFileSync(aP, 'utf-8'));
    await page.evaluate(async (a) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [] });
    }, a);
  }
}

const errs = [];

async function freshUserPass(browser) {
  console.log('\n══════ FRESH USER (no data, no onboarding) ══════');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`[FRESH] PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(`[FRESH] ${m.text().slice(0,180)}`); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  console.log('  initial: ' + await shot(page, 'fresh-initial'));

  const onboardingState = await page.evaluate(() => ({
    onboardedFlag: localStorage.getItem('coach-onboarded'),
    welcomeVisible: !!document.querySelector('.welcome, [class*="onboard"], [class*="setup"]'),
    bodyTextFirst200: document.body.innerText.slice(0, 200),
  }));
  console.log(`  onboarded flag: ${onboardingState.onboardedFlag}`);
  console.log(`  body text starts: "${onboardingState.bodyTextFirst200.replace(/\n/g,' | ').slice(0,140)}"`);

  await page.close();
  await ctx.close();
}

async function emptyOnboardedPass(browser) {
  console.log('\n══════ ONBOARDED BUT NO DATA YET ══════');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`[EMPTY] PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(`[EMPTY] ${m.text().slice(0,180)}`); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  for (const screen of ['today','coach','progress','settings']) {
    await page.locator(`.nav-item[data-screen="${screen}"]`).first().click();
    await page.waitForTimeout(700);
    console.log(`  empty-${screen}: ` + await shot(page, `empty-${screen}`));
  }
  // Empty insights specifically
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(400);
  console.log(`  empty-progress-insights: ` + await shot(page, `empty-progress-insights`));

  await page.close();
  await ctx.close();
}

async function interactionPass(browser) {
  console.log('\n══════ INTERACTIONS (rich data, click everything) ══════');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`[INTER] PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(`[INTER] ${m.text().slice(0,180)}`); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  await injectRichData(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── Today: water quick action ─────────────────────────
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  const waterBtn = page.locator('#quick-water-btn').first();
  if (await waterBtn.isVisible().catch(() => false)) {
    await waterBtn.click();
    await page.waitForTimeout(600);
    console.log(`  water modal: ` + await shot(page, 'water-modal'));
    // Close
    const close = page.locator('.modal-close, .modal-backdrop, [aria-label="Close"]').first();
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await page.waitForTimeout(400);
    } else {
      // ESC fallback
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    console.log(`  after-water-close: ` + await shot(page, 'water-modal-closed'));
  }

  // ── Today: date navigation (prev day arrow) ──────────
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(400);
  const prevArrow = page.locator('.header-prev, .date-prev, [aria-label*="prev"], button:has-text("‹")').first();
  if (await prevArrow.isVisible().catch(() => false)) {
    await prevArrow.click();
    await page.waitForTimeout(500);
    console.log(`  prev-day: ` + await shot(page, 'prev-day'));
  } else {
    console.log(`  prev-day arrow: NOT FOUND`);
  }

  // ── Tap an entry to edit ──────────────────────────────
  await page.evaluate(async () => {
    App.selectedDate = '2026-05-10';
    if (App.updateHeaderDate) App.updateHeaderDate();
    await App.loadDayView();
  });
  await page.waitForTimeout(700);
  const firstEntry = page.locator('.entry-card, [data-entry-id], .entry-item').first();
  if (await firstEntry.isVisible().catch(() => false)) {
    await firstEntry.click();
    await page.waitForTimeout(700);
    console.log(`  entry-tapped: ` + await shot(page, 'entry-tapped'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else {
    console.log(`  entry-tap: NO entries visible`);
  }

  // ── Settings: tap Edit on Daily Targets ──────────────
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(500);
  console.log(`  settings-top: ` + await shot(page, 'settings-top'));
  const editGoalsBtn = page.locator('button:has-text("Edit")').first();
  if (await editGoalsBtn.isVisible().catch(() => false)) {
    await editGoalsBtn.click();
    await page.waitForTimeout(700);
    console.log(`  goal-setup-open: ` + await shot(page, 'goal-setup-open'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // ── Settings: tap Manage Dailies ─────────────────────
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(400);
  const dailiesBtn = page.locator('button:has-text("Manage")').first();
  if (await dailiesBtn.isVisible().catch(() => false)) {
    await dailiesBtn.click();
    await page.waitForTimeout(700);
    console.log(`  dailies-modal: ` + await shot(page, 'dailies-modal'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // ── Settings: Cloud Sync Setup ───────────────────────
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(400);
  const syncSetup = page.locator('button:has-text("Setup")').first();
  if (await syncSetup.isVisible().catch(() => false)) {
    await syncSetup.click();
    await page.waitForTimeout(700);
    console.log(`  sync-setup-modal: ` + await shot(page, 'sync-setup-modal'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // ── Chat: send a message ─────────────────────────────
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(1000);
  const chatInput = page.locator('#coach-input').first();
  if (await chatInput.isVisible().catch(() => false)) {
    await chatInput.fill('test message from dogfood');
    await page.waitForTimeout(200);
    console.log(`  chat-typed: ` + await shot(page, 'chat-typed'));
    await page.locator('#coach-send').first().click();
    await page.waitForTimeout(1200);
    console.log(`  chat-after-send: ` + await shot(page, 'chat-after-send'));
  }

  // ── Today: Fitness panel — exercise info button ──────
  await page.evaluate(async () => {
    App.selectedDate = '2026-05-12';
    if (App.updateHeaderDate) App.updateHeaderDate();
    await App.loadDayView();
    App.switchPanel('fitness');
  });
  await page.waitForTimeout(800);
  console.log(`  today-fitness-tue: ` + await shot(page, 'today-fitness-tue'));
  // Click the first info button
  const infoBtn = page.locator('.fitness-info-btn').first();
  if (await infoBtn.isVisible().catch(() => false)) {
    await page.evaluate(() => {
      document.querySelector('.fitness-info-btn')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    await infoBtn.click({ force: true }).catch(e => console.log('    info click err: ' + e.message.slice(0,80)));
    await page.waitForTimeout(500);
    console.log(`  exercise-info-open: ` + await shot(page, 'exercise-info-open'));
  }

  // ── Today: check a set ───────────────────────────────
  const setCheck = page.locator('.fitness-set-check').first();
  if (await setCheck.isVisible().catch(() => false)) {
    await page.evaluate(() => {
      document.querySelector('.fitness-set-check')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    await setCheck.click({ force: true }).catch(e => console.log('    set-check err: ' + e.message.slice(0,80)));
    await page.waitForTimeout(500);
    console.log(`  set-checked: ` + await shot(page, 'set-checked'));
  }

  // ── Progress: sort by category on Fitness ────────────
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(400);
  await page.evaluate(async () => { ProgressView._tab = 'fitness'; await ProgressView.init(); });
  await page.waitForTimeout(700);
  const catBtn = page.locator('.fh-sort-btn:has-text("Category")').first();
  if (await catBtn.isVisible().catch(() => false)) {
    await catBtn.click();
    await page.waitForTimeout(600);
    console.log(`  fitness-by-category: ` + await shot(page, 'fitness-by-category'));
  }
  const byDayBtn = page.locator('.fh-sort-btn:has-text("By Day")').first();
  if (await byDayBtn.isVisible().catch(() => false)) {
    await byDayBtn.click();
    await page.waitForTimeout(600);
    console.log(`  fitness-by-day: ` + await shot(page, 'fitness-by-day'));
  }

  // ── Progress > Challenges: tap Start a Challenge ─────
  await page.evaluate(async () => { ProgressView._tab = 'challenges'; await ProgressView.init(); });
  await page.waitForTimeout(700);
  console.log(`  challenges-empty: ` + await shot(page, 'challenges-empty'));
  const startChalBtn = page.locator('button:has-text("Start a Challenge")').first();
  if (await startChalBtn.isVisible().catch(() => false)) {
    await startChalBtn.click();
    await page.waitForTimeout(600);
    console.log(`  challenges-picker: ` + await shot(page, 'challenges-picker'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  await page.close();
  await ctx.close();
}

async function chaosPass(browser) {
  console.log('\n══════ CHAOS (boundary conditions) ══════');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`[CHAOS] PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(`[CHAOS] ${m.text().slice(0,180)}`); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  // Inject analysis with weird/edge data
  await page.evaluate(async () => {
    // 1. Analysis with null totals
    await DB.importAnalysis('2026-05-01', {
      date: '2026-05-01', entries: [],
      totals: {}, // empty totals
      highlights: [], concerns: [],
      goals: {}, streaks: {},
    });
    // 2. Analysis with EXTREMELY long highlight
    await DB.importAnalysis('2026-05-02', {
      date: '2026-05-02', entries: [],
      totals: { calories: 950, protein: 95, fat: 50, fiber: 20, carbs: 100 },
      highlights: ['This is a really really really long highlight that goes on and on and might wrap multiple times and we want to see how it renders inside the analysis card without breaking layout or causing horizontal overflow at 320px or any other width frankly'],
      concerns: ['Short concern.'],
      goals: { calories: { daily: 1100 }, macros: { protein: { grams: 85 }}, fiber: { daily_g: 25 }, water_oz: 100 },
      streaks: { tracking: 1, calories: 100, protein: 999 }, // huge streak
    });
    // 3. Analysis with zero everything
    await DB.importAnalysis('2026-05-03', {
      date: '2026-05-03', entries: [],
      totals: { calories: 0, protein: 0, fat: 0, fiber: 0, carbs: 0, water_oz: 0 },
      highlights: [], concerns: [],
      goals: {}, streaks: {},
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Navigate to each weird day on Insights
  for (const date of ['2026-05-01', '2026-05-02', '2026-05-03']) {
    await page.evaluate(async (d) => {
      App.selectedDate = d;
      if (App.updateHeaderDate) App.updateHeaderDate();
      ProgressView._tab = 'insights';
      await ProgressView.init();
    }, date);
    await page.locator('.nav-item[data-screen="progress"]').first().click();
    await page.waitForTimeout(600);
    console.log(`  chaos-${date}: ` + await shot(page, `chaos-${date}`));
  }

  await page.close();
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await freshUserPass(browser);
  await emptyOnboardedPass(browser);
  await interactionPass(browser);
  await chaosPass(browser);
  await browser.close();

  console.log(`\n══════ TOTAL: ${n} screenshots ══════`);
  if (errs.length) {
    console.log(`\n⚠ ${errs.length} JS errors:`);
    errs.slice(0, 15).forEach(e => console.log('  ' + e));
  } else {
    console.log('\n✓ Zero JS errors.');
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
