/**
 * Multi-photo upload — actually exercise the flow and capture every state.
 * Drives the meal log form, attempts library pick of 3 photos, observes
 * what actually happens.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-multiphoto');
fs.mkdirSync(SHOTS, { recursive: true });

// Create 3 fake jpg files to upload
const TEST_JPGS = ['/tmp/test1.jpg', '/tmp/test2.jpg', '/tmp/test3.jpg'].map(p => {
  // 1x1 px valid JPG bytes
  const jpgBytes = Buffer.from([
    0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
    0x00,0x01,0x00,0x00,0xff,0xdb,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
    0x07,0x07,0x07,0x09,0x09,0x08,0x0a,0x0c,0x14,0x0d,0x0c,0x0b,0x0b,0x0c,0x19,0x12,
    0x13,0x0f,0x14,0x1d,0x1a,0x1f,0x1e,0x1d,0x1a,0x1c,0x1c,0x20,0x24,0x2e,0x27,0x20,
    0x22,0x2c,0x23,0x1c,0x1c,0x28,0x37,0x29,0x2c,0x30,0x31,0x34,0x34,0x34,0x1f,0x27,
    0x39,0x3d,0x38,0x32,0x3c,0x2e,0x33,0x34,0x32,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,
    0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xc4,0x00,0x1f,0x00,0x00,0x01,0x05,0x01,0x01,
    0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,
    0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0xff,0xc4,0x00,0xb5,0x10,0x00,0x02,0x01,0x03,
    0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7d,0x01,0x02,0x03,0x00,
    0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,
    0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,
    0x82,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,3,0x00,0x37,0xff,0xd9,
  ]);
  fs.writeFileSync(p, jpgBytes);
  return p;
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
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
  // Inject any analysis so the welcome card is bypassed (welcome shows
  // only if no entries AND no analysis AND no cloudRelay_backup).
  await page.evaluate(async () => {
    await DB.importAnalysis('2026-05-10', {
      date: '2026-05-10',
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
      coachResponses: [], highlights: [], concerns: [],
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '00-start.png'), fullPage: true });

  // Try to find "Add Meal" or food log path
  console.log('\n[1] Find log-food path');
  // Force navigate to Today via hash
  await page.evaluate(() => { window.location.hash = ''; });
  await page.waitForTimeout(500);
  // Verify screen-today is the active one
  const active = await page.evaluate(() => document.querySelector('.screen.active')?.id);
  console.log(`active screen: ${active}`);
  await page.screenshot({ path: path.join(SHOTS, '01-today.png'), fullPage: true });

  // Look for + or Food button
  const buttons = await page.locator('button').allInnerTexts();
  console.log('Buttons visible:', buttons.slice(0, 20));

  // The "Food" button (#quick-photo-btn) does instant single-photo save.
  // To get to the form with library picker, use "More" button.
  console.log('Clicking More...');
  const moreBtn = page.locator('button:has-text("More")').first();
  if (await moreBtn.count()) {
    await moreBtn.click({ force: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '02-more-pressed.png'), fullPage: true });
    const sub = await page.locator('button').allInnerTexts();
    console.log('After More press:', sub.filter(t => t.length < 60).slice(0, 30));
  } else {
    console.log('NO More button found');
  }

  // Click "Log Food" (full form path with photo options)
  const logFoodBtn = page.locator('button').filter({ hasText: /Log Food/i }).first();
  if (await logFoodBtn.count()) {
    await logFoodBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '03-log-food-form.png'), fullPage: true });
  }

  // Look for Add Photos / Take Photo / Choose from Library buttons
  const photoBtns = await page.locator('button').filter({ hasText: /Photo|Library/i }).allInnerTexts();
  console.log('Photo buttons in form:', photoBtns);

  // Try to use the "Add Photos" / library button
  const addPhotosBtn = page.locator('#log-photo-pick, button:has-text("Add Photos"), button:has-text("Choose from Library")').first();
  if (await addPhotosBtn.count()) {
    console.log('Found library button, inspecting handler');
    const html = await addPhotosBtn.innerHTML();
    console.log('  innerHTML:', html);
  } else {
    console.log('NO library button visible');
  }

  // Try to inspect the input that gets created by Camera.pickMultiple
  // Intercept the file picker by setting input.files programmatically
  await page.evaluate(() => { window._fileInputs = []; });
  await page.exposeFunction('reportInput', (info) => console.log('[INPUT]', info));
  await page.evaluate(() => {
    const origCreate = document.createElement.bind(document);
    document.createElement = function(tag, ...rest) {
      const el = origCreate(tag, ...rest);
      if (tag === 'input') {
        setTimeout(() => {
          if (el.type === 'file') {
            window.reportInput({ multiple: el.multiple, accept: el.accept, capture: el.capture });
          }
        }, 100);
      }
      return el;
    };
  });

  if (await addPhotosBtn.count()) {
    // chromium handles file inputs differently — listen for filechooser
    const filechooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await addPhotosBtn.click();
    const fc = await filechooserPromise;
    if (fc) {
      console.log('File chooser opened. multiple=' + fc.isMultiple());
      if (fc.isMultiple()) {
        await fc.setFiles(TEST_JPGS);
        console.log('Set 3 files');
      } else {
        // Single-photo path — only first file sent
        await fc.setFiles([TEST_JPGS[0]]);
        console.log('Single mode — only first file');
      }
    } else {
      console.log('No file chooser fired (button may not have triggered file input)');
    }
  }

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '04-after-photo-pick.png'), fullPage: true });

  // Count preview tiles
  const previews = await page.locator('.ql-photo-preview, .photo-preview, .multi-photo-grid img, #log-photo-preview-area img').count();
  console.log(`Photo previews in form: ${previews}`);
  const pendingArr = await page.evaluate(() => Log.pendingPhotos ? Log.pendingPhotos.length : -1);
  console.log(`Log.pendingPhotos.length: ${pendingArr}`);

  // Try the "Take Photo" button (single capture) to confirm behavior
  const takeBtn = page.locator('#log-photo-capture, button:has-text("Take Photo")').first();
  if (await takeBtn.count()) {
    console.log('\n[2] Take Photo button — simulate adding another');
    const fc2 = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await takeBtn.click();
    const fc = await fc2;
    if (fc) {
      console.log(`  Take Photo multiple=${fc.isMultiple()}, capture=${fc.element ? 'has-element' : '?'}`);
      try {
        await fc.setFiles([TEST_JPGS[2]]);
      } catch (e) { console.log('  setFiles failed:', e.message); }
    } else {
      console.log('  No file chooser fired');
    }
    await page.waitForTimeout(500);
    const previews2 = await page.locator('.ql-photo-preview, .photo-preview, #log-photo-preview-area img').count();
    const pending2 = await page.evaluate(() => Log.pendingPhotos ? Log.pendingPhotos.length : -1);
    console.log(`After Take Photo: previews=${previews2}, pendingPhotos=${pending2}`);
  }

  await page.screenshot({ path: path.join(SHOTS, '05-after-take-photo.png'), fullPage: true });

  // Save the entry
  console.log('\n[3] Save entry');
  const saveBtn = page.locator('button:has-text("Save"), button:has-text("Log Meal")').first();
  if (await saveBtn.count()) {
    await saveBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, '06-after-save.png'), fullPage: true });
    // Check how many entries + how many photos in DB
    const dbState = await page.evaluate(async () => {
      const entries = await DB.getAllEntries();
      const meals = entries.filter(e => e.type === 'meal');
      const lastMeal = meals[meals.length - 1];
      let photos = [];
      if (lastMeal) {
        photos = await DB.getPhotos(lastMeal.id);
      }
      return {
        n_meals: meals.length,
        last_meal_id: lastMeal?.id,
        photos_for_last_meal: photos.length,
        photo_ids: photos.map(p => p.id),
      };
    });
    console.log('DB state after save:', dbState);
  }

  console.log('\n=== Errors ===');
  errs.forEach(e => console.log('  ' + e.slice(0, 200)));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
