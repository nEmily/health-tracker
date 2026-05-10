/**
 * Deep mobile QA — load real production data, screenshot every important
 * view, capture bugs.
 *
 * Renders what the actual user sees on her phone. Captures console errors
 * across every interaction.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-mobile');
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
function bug(sev, area, detail) { findings.push({ sev, area, detail }); console.log(`  [${sev}] ${area}: ${detail}`); }
function ok(area) { console.log(`  PASS ${area}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
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
    localStorage.setItem('coach-sync-key', 'qa-test');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject 7 days of real data
  console.log('\n[1] Inject 5/4-5/10 analyses + log entries + chat msgs');
  const dates = ['2026-05-04','2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10'];
  let injected = 0;
  for (const d of dates) {
    const aPath = path.resolve(__dirname, `../../coach/analysis/${d}.json`);
    const lPath = path.resolve(__dirname, `../../coach/incoming/extracted/daily/${d}/log.json`);
    if (!fs.existsSync(aPath)) continue;
    const analysis = JSON.parse(fs.readFileSync(aPath, 'utf-8'));
    const log = fs.existsSync(lPath) ? JSON.parse(fs.readFileSync(lPath, 'utf-8')) : { entries: [], coachChat: [] };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({
      id: m.id, role: 'user', text: m.text, timestamp: m.timestamp,
    }));
    const status = await page.evaluate(async ({ analysis, entries, userMsgs }) => {
      try {
        await DB.importAnalysis(analysis.date, analysis);
        for (const e of entries) {
          try { await DB.addEntry(e); } catch {}
        }
        await DB.updateDailySummary(analysis.date, {
          date: analysis.date, entries: analysis.entries || [], coachChat: userMsgs,
        });
        return 'ok';
      } catch (e) { return 'err: ' + e.message; }
    }, { analysis, entries: log.entries || [], userMsgs });
    if (status === 'ok') injected++;
    else bug('HIGH', `inject-${d}`, status);
  }
  console.log(`  injected ${injected}/${dates.length}`);

  // Set selectedDate to today (5/10) so Today tab shows it
  await page.evaluate(() => {
    if (window.App) App.selectedDate = '2026-05-10';
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── 2. Today tab ──
  console.log('\n[2] Today tab');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '01-today.png'), fullPage: true });

  const todayEntries = await page.locator('.entry-item, .entry-card').count();
  console.log(`  visible entries: ${todayEntries}`);

  // Score
  const scoreText = await page.locator('body').innerText();
  const scoreMatch = scoreText.match(/score[:\s]+(\d+)/i) || scoreText.match(/(\d+)\s*\n[\s\S]*great|good|crush/i);
  if (scoreMatch) console.log(`  score visible: ${scoreMatch[0].slice(0,50)}`);

  // Goal display
  const calMatch = scoreText.match(/(\d+)\s*OF\s*(\d+)\s*CAL/i);
  if (calMatch) console.log(`  cal display: ${calMatch[1]}/${calMatch[2]}`);

  // ── 3. Coach tab — render full chat history ──
  console.log('\n[3] Coach tab');
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.chat-bubble').length > 0 || document.querySelector('.coach-empty-state'),
    { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '02-coach-today.png'), fullPage: true });
  const todayBubbles = await page.locator('.chat-bubble').count();
  console.log(`  today coach bubbles: ${todayBubbles}`);

  // Walk back through the week — does each day's chat render?
  for (const d of ['2026-05-09','2026-05-08','2026-05-07','2026-05-06','2026-05-05']) {
    const prevBtn = page.locator('#header-prev').first();
    if (!(await prevBtn.isVisible().catch(()=>false))) {
      bug('MEDIUM', 'coach-day-nav', `prev button not visible on day before ${d}`);
      break;
    }
    await prevBtn.click();
    await page.waitForTimeout(700);
    const bubbles = await page.locator('.chat-bubble').count();
    const empty = await page.locator('.coach-empty-state').count();
    console.log(`  ${d}: ${bubbles} bubbles, empty-state=${empty>0}`);
    if (bubbles === 0 && empty === 0) {
      bug('MEDIUM', `coach-${d}`, 'no bubbles AND no empty-state — render glitch?');
    }
  }
  await page.screenshot({ path: path.join(SHOTS, '03-coach-back-5days.png'), fullPage: true });

  // ── 4. Today tab — historical days (yesterday, 2 days ago) ──
  console.log('\n[4] Today tab — yesterday');
  // Reset to 5/10 first
  await page.evaluate(() => { if (window.App) App.selectedDate = '2026-05-10'; });
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  const prev = page.locator('#header-prev').first();
  await prev.click().catch(()=>{});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '04-today-yesterday.png'), fullPage: true });

  // ── 5. Progress tab ──
  console.log('\n[5] Progress tab');
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '05-progress-insights.png'), fullPage: true });

  const trendsTab = page.locator('[data-ptab="trends"]').first();
  if (await trendsTab.count()) {
    await trendsTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOTS, '06-progress-trends.png'), fullPage: true });
  }
  const planTab = page.locator('[data-ptab="plan"]').first();
  if (await planTab.count()) {
    await planTab.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '07-progress-plan.png'), fullPage: true });
  }

  // ── 6. Settings ──
  console.log('\n[6] Settings tab');
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '08-settings.png'), fullPage: true });

  // ── 7. Errors ──
  console.log('\n[7] Errors');
  if (errs.length === 0) ok('no JS errors over the full flow');
  else errs.slice(0,15).forEach(e => bug('HIGH', 'js', e.slice(0, 200)));

  console.log('\n=== SUMMARY ===');
  const sev = findings.reduce((a,f) => { a[f.sev]=(a[f.sev]||0)+1; return a; }, {});
  console.log(`Findings: ${JSON.stringify(sev)} | total=${findings.length}`);
  fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify(findings, null, 2));

  await browser.close();
  process.exit(findings.some(f=>f.sev==='CRITICAL')?2:(findings.length?1:0));
})().catch(e => { console.error('FATAL:', e); process.exit(3); });
