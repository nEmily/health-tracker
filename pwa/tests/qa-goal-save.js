const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[ERR]', m.text()); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Open settings -> Edit goals
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Edit")').first().click();
  await page.waitForTimeout(500);

  // Read first calorie input value
  const calInput = page.locator('input[type="number"]').first();
  const before = await calInput.inputValue();
  console.log('Cal goal BEFORE:', before);

  // Change to 1000
  await calInput.fill('1000');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.resolve(__dirname, 'screenshots/qa-interactive/06-changed-1000.png'), fullPage: true });

  // Save
  const save = page.locator('button:has-text("Save Goals")').first();
  await save.click();
  await page.waitForTimeout(2500); // wait for save + modal close + toast fade

  // Force-close any lingering modal
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.remove()));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.resolve(__dirname, 'screenshots/qa-interactive/07-after-save.png'), fullPage: true });

  // Re-open editor and verify
  await page.locator('button:has-text("Edit")').first().click({ force: true });
  await page.waitForTimeout(800);
  const calAfter = await page.locator('input[type="number"]').first().inputValue();
  console.log('Cal goal AFTER save:', calAfter);

  // Read raw goals object from IDB
  const stored = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals');
    return JSON.stringify(goals, null, 2).slice(0, 800);
  });
  console.log('IDB goals:', stored);

  if (calAfter === '1000') console.log('PASS: cal goal saved as 1000');
  else console.log(`FAIL: cal goal showing ${calAfter} after save`);

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
