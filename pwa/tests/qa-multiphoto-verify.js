/**
 * Verify multi-photo Log Food flow works after the fix.
 * Uses a real JPG (the existing 5/4 meal photo).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-multiphoto');
fs.mkdirSync(SHOTS, { recursive: true });

const REAL_JPGS = [
  path.resolve(__dirname, '../../coach/incoming/extracted/daily/2026-05-04/photos/meal_1777921378880_xe9k.jpg'),
  path.resolve(__dirname, '../../coach/incoming/extracted/daily/2026-05-04/photos/meal_1777942467788_5d4a.jpg'),
  path.resolve(__dirname, '../../coach/incoming/extracted/daily/2026-05-04/photos/meal_1777942532072_8qj9.jpg'),
];

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

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });
  await page.evaluate(async () => {
    await DB.importAnalysis('2026-05-10', { date: '2026-05-10', entries: [], totals: {calories: 0}, coachResponses: [], highlights: [], concerns: [] });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // More button (#quick-more-btn) opens the action sheet
  await page.locator('#quick-more-btn').click({ force: true });
  await page.waitForTimeout(500);

  // Tap "Log Food"
  await page.locator('button').filter({ hasText: 'Log Food' }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'v1-form-opened.png'), fullPage: true });

  // Tap Library — should be multi-select now
  const fcPromise = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.locator('#fn-library').click();
  const fc = await fcPromise;
  console.log(`Library button — multiple=${fc.isMultiple()}`);
  if (!fc.isMultiple()) {
    console.log('FAIL — Library is still single-select');
    await browser.close();
    process.exit(1);
  }
  await fc.setFiles(REAL_JPGS);
  console.log(`Set 3 real JPG files via Library`);
  await page.waitForTimeout(2000); // wait for compress
  await page.screenshot({ path: path.join(SHOTS, 'v2-after-3-photos.png'), fullPage: true });

  // Check pendingPhotos count
  const photoState = await page.evaluate(() => {
    const previews = document.querySelectorAll('#fn-photo-area .photo-preview, #fn-photo-area > div').length;
    return { previews };
  });
  console.log(`Thumbs visible: ${photoState.previews}`);

  // Fill notes and save
  await page.locator('#fn-notes').fill('test multi-photo meal: dish + label + receipt');
  await page.locator('#fn-save').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'v3-after-save.png'), fullPage: true });

  // Verify DB state
  const dbState = await page.evaluate(async () => {
    const entries = await DB.getAllEntries();
    const meals = entries.filter(e => e.type === 'meal' && e.notes?.includes('multi-photo meal'));
    const lastMeal = meals[meals.length - 1];
    let photos = [];
    if (lastMeal) photos = await DB.getPhotos(lastMeal.id);
    return {
      n_test_meals: meals.length,
      last_meal_id: lastMeal?.id,
      photos_attached: photos.length,
      photo_ids: photos.map(p => p.id),
    };
  });
  console.log('\nDB state after save:');
  console.log(JSON.stringify(dbState, null, 2));

  const ok = dbState.n_test_meals === 1 && dbState.photos_attached === 3;
  console.log(ok ? '\nPASS: 1 entry, 3 photos attached' : '\nFAIL: expected 1 entry with 3 photos');

  console.log('\n=== Console errors ===');
  errs.forEach(e => console.log('  ' + e.slice(0, 200)));

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
