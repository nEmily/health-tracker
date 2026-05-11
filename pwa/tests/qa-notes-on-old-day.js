const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  // Bust any SW cache
  await page.context().clearCookies();
  await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
  // Unregister SW + clear caches
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  });
  await page.evaluate(() => {
    localStorage.setItem('coach-onboarded', '1');
    localStorage.setItem('coach-sync-key', 'qa');
    localStorage.setItem('cloudRelay_backup', JSON.stringify({fake:true}));
  });

  // Inject 4/14 dailySummary with fitness_notes
  await page.evaluate(async () => {
    const log = {
      date: '2026-04-14',
      entries: [],
      fitness_notes: '1x20 ab rolls, 1x10 deeper/lower ab roll\n3x10 dead bugs (alternated legs and arms)\nplank hold 60s',
      coachChat: null,
    };
    await DB.importAnalysis('2026-04-14', { date: '2026-04-14', entries: [], totals: {calories: 0} });
    await DB.updateDailySummary('2026-04-14', log);
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Navigate to 4/14 specifically
  await page.evaluate(() => {
    if (window.App) { App.selectedDate = '2026-04-14'; App.loadDayView(); }
  });
  await page.waitForTimeout(800);

  // Click the Diet/Fitness segment toggle specifically — there are
  // multiple "Fitness" texts on screen (nav etc.)
  const fitBtn = page.locator('.today-seg-btn[data-panel="fitness"]').first();
  if (await fitBtn.count()) {
    await fitBtn.click({ force: true });
    console.log('clicked Fitness segment');
  } else {
    console.log('NO Fitness segment button found');
  }
  await page.waitForTimeout(1000);

  // Re-trigger loadDayView so the workout area renders for the selected date
  await page.evaluate(() => { if (window.App) App.loadDayView(); });
  await page.waitForTimeout(1000);

  // Check what app.js loaded — does it contain my new code?
  const codeCheck = await page.evaluate(async () => {
    const r = await fetch('/scripts/app.js');
    const t = await r.text();
    return {
      has_new_code: t.includes('No regimen for this date'),
      has_fitness_notes_logic: t.includes('summary2?.fitness_notes'),
    };
  });
  console.log('CODE CHECK:', codeCheck);

  // Diagnostic — what does the data look like?
  const diag = await page.evaluate(async () => {
    const summary = await DB.getDailySummary('2026-04-14');
    const entries = await DB.getEntriesByDate('2026-04-14');
    const workoutEl = document.getElementById('today-workout');
    return {
      summary_notes_len: summary?.fitness_notes?.length || 0,
      summary_notes_preview: summary?.fitness_notes?.slice(0, 60) || '',
      entries_count: entries.length,
      workoutEl_html_preview: workoutEl?.innerHTML?.slice(0, 200) || '',
      App_selectedDate: window.App?.selectedDate,
    };
  });
  console.log('DIAG:', JSON.stringify(diag, null, 2));

  // Inject DEBUG override directly into the relevant code
  await page.evaluate(async () => {
    const date = '2026-04-14';
    App.selectedDate = date;
    App.currentScreen = 'today';
    // Wait for stable + re-load
    await App.loadDayView();
  });
  await page.waitForTimeout(1500);

  // Directly replicate the render logic to see what html WOULD be produced
  const directRender = await page.evaluate(async () => {
    const date = '2026-04-14';
    const regimen = await DB.getRegimen().catch(() => null);
    const summary = await DB.getDailySummary(date);
    const entries = await DB.getEntriesByDate(date);
    const hasSchedule = regimen && (Fitness._normalizeSchedule
      ? Fitness._normalizeSchedule(regimen).length > 0
      : !!regimen.weeklySchedule);
    return {
      regimen_keys: regimen ? Object.keys(regimen) : 'null',
      hasSchedule,
      summary_has_notes: !!summary?.fitness_notes,
      entries_count: entries?.length || 0,
    };
  });
  console.log('DIRECT RENDER STATE:', directRender);

  // Take a full-page screenshot
  await page.screenshot({ path: 'pwa/tests/screenshots/qa-progress/notes-test.png', fullPage: true });

  // Get the page text from the workout area
  const allText = await page.locator('body').innerText();
  const hasAbRolls = allText.includes('ab rolls');
  const hasDeadBugs = allText.includes('dead bugs');
  const hasNotesLabel = allText.includes('Notes') || allText.includes('NOTES');
  console.log(`hasAbRolls: ${hasAbRolls}`);
  console.log(`hasDeadBugs: ${hasDeadBugs}`);
  console.log(`hasNotesLabel: ${hasNotesLabel}`);

  // Look at the notes textarea value specifically
  const notesEl = await page.locator('#fitness-notes').first();
  if (await notesEl.count()) {
    const v = await notesEl.inputValue();
    console.log(`#fitness-notes value: "${v.slice(0, 100)}"`);
  } else {
    console.log('NO #fitness-notes element found on page');
  }

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
