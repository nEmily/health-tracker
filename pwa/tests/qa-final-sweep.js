/**
 * Final sweep — load real production data for several days, screenshot
 * every tab and important sub-flow, look for visual/data issues.
 */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

const BASE = 'http://localhost:8083';
const SHOTS = path.resolve(__dirname, 'screenshots/qa-final');
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
function bug(s, area, detail) { findings.push({ s, area, detail }); console.log(`  [${s}] ${area}: ${detail}`); }
function ok(area) { console.log(`  PASS ${area}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ERR: ' + m.text()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Inject 7 days of analysis + log entries + user messages
  const dates = ['2026-04-28','2026-04-29','2026-04-30','2026-05-01','2026-05-02','2026-05-03','2026-05-04'];
  for (const d of dates) {
    const a_path = path.resolve(__dirname, `../../coach/analysis/${d}.json`);
    const log_path = path.resolve(__dirname, `../../coach/incoming/extracted/daily/${d}/log.json`);
    if (!fs.existsSync(a_path)) continue;
    const analysis = JSON.parse(fs.readFileSync(a_path, 'utf-8'));
    const log = fs.existsSync(log_path) ? JSON.parse(fs.readFileSync(log_path, 'utf-8')) : { entries: analysis.entries || [], coachChat: [] };
    const userMsgs = (log.coachChat || []).filter(m => m).map(m => ({
      id: m.id, role: 'user', text: m.text, timestamp: m.timestamp,
    }));
    await page.evaluate(async ({ analysis, entries, userMsgs }) => {
      await DB.importAnalysis(analysis.date, analysis);
      for (const e of entries) {
        try { await DB.addEntry(e); } catch {}
      }
      await DB.updateDailySummary(analysis.date, {
        date: analysis.date, entries: analysis.entries || [], coachChat: userMsgs,
      });
    }, { analysis, entries: log.entries || [], userMsgs });
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 1. Today (current day, today)
  console.log('\n[1] Today — current');
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '01-today.png'), fullPage: true });
  const todayText = await page.locator('body').innerText();
  const calMatch = todayText.match(/(\d+)\s*OF\s*(\d+)\s*CAL/i);
  if (calMatch) console.log(`  cal display: ${calMatch[1]}/${calMatch[2]}`);

  // 2. Today — yesterday
  console.log('\n[2] Today — yesterday (prev day nav)');
  await page.locator('#header-prev').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '02-today-yesterday.png'), fullPage: true });
  // Back to today
  await page.locator('#header-next').first().click().catch(() => {});
  await page.waitForTimeout(300);

  // 3. Coach
  console.log('\n[3] Coach');
  await page.locator('.nav-item[data-screen="coach"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '03-coach.png'), fullPage: true });
  const bubbles = await page.locator('.chat-bubble').count();
  console.log(`  chat bubbles: ${bubbles}`);
  const userBubbles = await page.locator('.chat-user').count();
  const coachBubbles = await page.locator('.chat-coach').count();
  console.log(`  user=${userBubbles} coach=${coachBubbles}`);

  // 4. Coach — yesterday (history view)
  console.log('\n[4] Coach yesterday');
  await page.locator('#header-prev').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '04-coach-yesterday.png'), fullPage: true });

  // 5. Progress — Insights
  console.log('\n[5] Progress > Insights');
  // Reset to today first
  await page.locator('.nav-item[data-screen="today"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.nav-item[data-screen="progress"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '05-progress-insights.png'), fullPage: true });

  // 6. Progress > Trends
  console.log('\n[6] Progress > Trends');
  const trends = page.locator('[data-ptab="trends"]').first();
  if (await trends.count()) {
    await trends.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '06-progress-trends.png'), fullPage: true });
  }

  // 7. Progress > Plan
  console.log('\n[7] Progress > Plan');
  const planTab = page.locator('[data-ptab="plan"]').first();
  if (await planTab.count()) {
    await planTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, '07-progress-plan.png'), fullPage: true });
    const planContent = await page.locator('body').innerText();
    if (!/breakfast|lunch|dinner|snack/i.test(planContent)) {
      bug('MEDIUM', 'plan-empty', 'Plan tab shows no meal content despite mealPlan in analysis');
    } else {
      ok('plan-renders');
    }
  }

  // 8. Settings
  console.log('\n[8] Settings');
  await page.locator('.nav-item[data-screen="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '08-settings.png'), fullPage: true });

  // 9. Errors
  console.log('\n[9] Errors check');
  if (errs.length) errs.slice(0, 8).forEach(e => bug('HIGH', 'js', e.slice(0, 200)));
  else ok('no JS errors');

  console.log('\n=== SUMMARY ===');
  const bySev = findings.reduce((a, f) => { a[f.s] = (a[f.s] || 0) + 1; return a; }, {});
  console.log(`Findings: ${JSON.stringify(bySev)}  Total: ${findings.length}`);
  fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify(findings, null, 2));

  await browser.close();
  process.exit(findings.some(f => f.s === 'CRITICAL') ? 2 : (findings.length ? 1 : 0));
})().catch(e => { console.error('FATAL:', e); process.exit(3); });
