/**
 * Visual confirmation: chat renders in back-and-forth conversation order.
 *
 * Injects real user messages from log.json + coach responses from analysis,
 * navigates to coach tab, screenshots, prints the rendered order.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'test-uuid-qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const date = '2026-05-04';
  const log = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../coach/incoming/extracted/daily/${date}/log.json`), 'utf-8'));
  const analysis = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../coach/analysis/${date}.json`), 'utf-8'));

  // Build summary with user messages
  const userMsgs = (log.coachChat || []).map(m => ({
    id: m.id, role: 'user', text: m.text, timestamp: m.timestamp,
  }));

  await page.evaluate(async ({ analysis, userMsgs, date }) => {
    await DB.importAnalysis(date, analysis);
    await DB.updateDailySummary(date, {
      date, entries: analysis.entries || [], coachChat: userMsgs,
    });
  }, { analysis, userMsgs, date });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Navigate to coach tab
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.chat-bubble').length > 0,
    { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(400);

  // Print rendered order
  const rendered = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.chat-bubble')).map(b => ({
      role: b.classList.contains('chat-user') ? 'user' : 'coach',
      text: (b.querySelector('.chat-text')?.innerText || '').slice(0, 60),
    }));
  });
  console.log('\nRendered order:');
  rendered.forEach((r, i) => console.log(`  ${i+1}. [${r.role}] ${r.text}`));

  // Verify back-and-forth: every user msg should be followed by coach reply
  let backAndForth = true;
  for (let i = 0; i < rendered.length - 1; i++) {
    if (rendered[i].role === rendered[i+1].role && rendered[i].role === 'user') {
      // Two user msgs in a row — only OK if no coach has answered the first yet
      // (which means there's no coach reply with respondsTo to that user msg)
    }
  }
  // Simpler check: in this fixture, expected pattern is user, coach, user, coach
  const expected = ['user', 'coach', 'user', 'coach'];
  const actual = rendered.map(r => r.role);
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log('\n✓ back-and-forth flow confirmed');
  } else {
    console.log(`\n✗ expected ${expected.join(',')} got ${actual.join(',')}`);
    process.exitCode = 1;
  }

  await page.screenshot({ path: path.join(SHOTS, '08-chat-flow.png'), fullPage: true });
  console.log(`Screenshot: ${SHOTS}/08-chat-flow.png`);

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
