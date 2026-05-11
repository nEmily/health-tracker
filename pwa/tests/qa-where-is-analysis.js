/**
 * Investigate: where did the per-day calorie/analysis cards go?
 * Reproduce by injecting a real analysis JSON and clicking through
 * Chat -> Progress (all 5 tabs) to see what surfaces and what doesn't.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  // Inject the most recent analysis files so the UI has data
  const dates = ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10'];
  for (const date of dates) {
    const ap = `coach/analysis/${date}.json`;
    if (!fs.existsSync(ap)) continue;
    const a = JSON.parse(fs.readFileSync(ap, 'utf-8'));
    await page.evaluate(async (a) => {
      await DB.importAnalysis(a.date, a);
      await DB.updateDailySummary(a.date, { date: a.date, entries: a.entries || [] });
    }, a);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const screenshotDir = 'pwa/tests/screenshots/qa-where-is-analysis';
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  // 1. Today screen — current state
  console.log('\n══ 1. Today screen ══');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(800);
  const todayState = await page.evaluate(() => ({
    hasScore: !!document.querySelector('#today-score .score-ring'),
    hasMacros: !!document.querySelector('.stat-card, .day-macros, [data-stat-action]'),
    hasAnalysisCard: !!document.querySelector('.analysis-card, [class*="analysis"]'),
    hasHighlights: document.body.innerText.toLowerCase().includes('highlight'),
    hasConcerns: document.body.innerText.toLowerCase().includes('concern'),
  }));
  console.log('  today:', JSON.stringify(todayState));
  await page.screenshot({ path: path.join(screenshotDir, '01-today.png'), fullPage: true });

  // 2. Chat tab
  console.log('\n══ 2. Chat tab ══');
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(800);
  const chatState = await page.evaluate(() => ({
    hasAnalysisSection: !!document.getElementById('coach-analysis')?.innerHTML?.trim(),
    bodyTextHasHighlights: document.body.innerText.toLowerCase().includes('highlight'),
    bodyTextHasConcerns: document.body.innerText.toLowerCase().includes('concern'),
  }));
  console.log('  chat:', JSON.stringify(chatState));
  await page.screenshot({ path: path.join(screenshotDir, '02-chat.png'), fullPage: true });

  // 3. Progress tab — each segment
  console.log('\n══ 3. Progress tab — each segment ══');
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(800);
  for (const seg of ['insights', 'plan', 'trends', 'challenges', 'fitness']) {
    await page.evaluate(async (s) => {
      ProgressView._tab = s;
      await ProgressView.init();
    }, seg);
    await page.waitForTimeout(900);
    const segState = await page.evaluate(() => ({
      bodyChars: document.getElementById('progress-container')?.innerText?.length || 0,
      hasHighlights: document.body.innerText.toLowerCase().includes('highlight'),
      hasConcerns: document.body.innerText.toLowerCase().includes('concern'),
      hasCalories: /\b\d{3,4}\s*cal/i.test(document.body.innerText),
      hasMacros: /\bprotein\b/i.test(document.body.innerText) || /\b\d+g\s*P\b/.test(document.body.innerText),
      sample: (document.getElementById('progress-container')?.innerText || '').slice(0, 200).replace(/\n/g,' | '),
    }));
    console.log(`  [${seg}] chars=${segState.bodyChars} highlights=${segState.hasHighlights} concerns=${segState.hasConcerns} cal=${segState.hasCalories} macros=${segState.hasMacros}`);
    console.log(`    sample: "${segState.sample}"`);
    await page.screenshot({ path: path.join(screenshotDir, `03-progress-${seg}.png`), fullPage: true });
  }

  // 4. Specific: does the Fitness segment have any data?
  console.log('\n══ 4. Fitness segment data audit ══');
  await page.evaluate(async () => { ProgressView._tab = 'fitness'; await ProgressView.init(); });
  await page.waitForTimeout(800);
  const fit = await page.evaluate(() => {
    const exercises = document.querySelectorAll('.fh-exercise-card').length;
    const stripDays = document.querySelectorAll('.fh-strip-day').length;
    const stripWithStrength = document.querySelectorAll('.fh-strip-day.has-strength').length;
    const stripWithCardio = document.querySelectorAll('.fh-strip-day.has-cardio').length;
    return { exercises, stripDays, stripWithStrength, stripWithCardio };
  });
  console.log('  fitness counts:', JSON.stringify(fit));

  if (errs.length) {
    console.log('\nJS errors:');
    errs.slice(0, 8).forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo JS errors.');
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
