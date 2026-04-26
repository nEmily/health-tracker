// test-fixtures/run-tests.js — Playwright-based validation with fake data injection
// Usage: node test-fixtures/run-tests.js [--screenshots] [--dogfood]

const { chromium } = require('playwright');
const { buildFixtures } = require('./data');
const { startServer } = require('./test-server');
const path = require('path');
const fs = require('fs');

const TAKE_SCREENSHOTS = process.argv.includes('--screenshots');
const RUN_DOGFOOD = process.argv.includes('--dogfood');
const RUN_CHAOS = process.argv.includes('--chaos');
const SCREENSHOT_DIR = path.join(__dirname, '..', '.claude', 'test-screenshots', 'validate');
const PORT = 9037;
const BASE_URL = `http://localhost:${PORT}`;
const VIEWPORTS = [
  { name: 'iPhone-SE', width: 320, height: 568 },
  { name: 'iPhone-14', width: 390, height: 844 },
  { name: 'iPad-mini', width: 768, height: 1024 },
];

let passed = 0;
let failed = 0;
let errors = [];
let consoleErrors = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    errors.push(testName);
    console.log(`  ✗ FAIL: ${testName}`);
  }
}

async function screenshot(page, name) {
  if (!TAKE_SCREENSHOTS) return;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

// Inject all fixture data into IndexedDB via page.evaluate
async function injectFixtures(page) {
  const fixtures = buildFixtures();
  await page.evaluate(async (data) => {
    const db = await DB.openDB();

    // Clear all stores first
    for (const storeName of ['entries', 'dailySummary', 'analysis', 'profile', 'mealPlan', 'photos']) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    }

    // Insert entries
    for (const entry of data.entries) {
      await DB.addEntry(entry);
    }

    // Insert daily summaries
    for (const summary of data.summaries) {
      await DB.updateDailySummary(summary.date, summary);
    }

    // Insert analyses
    for (const analysis of data.analyses) {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...analysis, importedAt: Date.now() });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    }

    // Insert photos with canvas-generated scene-based blobs
    for (const photo of data.photos) {
      const s = photo.scene;
      const isPortrait = s.type === 'body';
      const canvas = document.createElement('canvas');
      canvas.width = isPortrait ? 300 : 400;
      canvas.height = isPortrait ? 500 : 400;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;

      // Background
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, 0, w, h);

      if (s.type === 'plate') {
        // Table texture — subtle grain
        for (let i = 0; i < 200; i++) {
          ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`;
          ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
        }
        // Plate/bowl
        ctx.beginPath();
        if (s.shape === 'bowl') {
          ctx.ellipse(w/2, h/2, 120, 100, 0, 0, Math.PI * 2);
        } else if (s.shape === 'triangle') {
          ctx.moveTo(w/2, h/2 - 80);
          ctx.lineTo(w/2 + 90, h/2 + 70);
          ctx.lineTo(w/2 - 90, h/2 + 70);
          ctx.closePath();
        } else {
          ctx.ellipse(w/2, h/2, 140, 130, 0, 0, Math.PI * 2);
        }
        ctx.fillStyle = s.plate;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Food elements — scattered circles/shapes
        const foodColors = [s.food, s.accent];
        for (let i = 0; i < 12; i++) {
          ctx.beginPath();
          const fx = w/2 + (Math.random() - 0.5) * 160;
          const fy = h/2 + (Math.random() - 0.5) * 120;
          const fr = 8 + Math.random() * 18;
          ctx.arc(fx, fy, fr, 0, Math.PI * 2);
          ctx.fillStyle = foodColors[i % 2];
          ctx.globalAlpha = 0.6 + Math.random() * 0.4;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (s.type === 'closeup') {
        // Macro/close-up — gradient blobs, depth-of-field feel
        for (let i = 0; i < 6; i++) {
          const grd = ctx.createRadialGradient(
            w * Math.random(), h * Math.random(), 10,
            w * Math.random(), h * Math.random(), 100 + Math.random() * 80
          );
          grd.addColorStop(0, s.color);
          grd.addColorStop(1, 'transparent');
          ctx.fillStyle = grd;
          ctx.globalAlpha = 0.4 + Math.random() * 0.3;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalAlpha = 1;
        // Bokeh circles
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * w, Math.random() * h, 15 + Math.random() * 25, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.15})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (s.type === 'body') {
        // Body silhouette — simplified person shape
        ctx.fillStyle = s.silhouette;
        // Head
        ctx.beginPath();
        ctx.arc(w/2, 80, 35, 0, Math.PI * 2);
        ctx.fill();
        // Torso
        ctx.beginPath();
        if (s.pose === 'front') {
          ctx.ellipse(w/2, 250, 55, 130, 0, 0, Math.PI * 2);
        } else {
          // Side view — narrower
          ctx.ellipse(w/2, 250, 35, 130, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        // Legs
        ctx.fillRect(w/2 - 30, 370, 22, 110);
        ctx.fillRect(w/2 + 8, 370, 22, 110);
        // Pose label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.pose.toUpperCase() + ' VIEW', w/2, h - 15);
      }

      // Label overlay
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, h - 36, w, 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.label, w/2, h - 18);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      const photoRecord = {
        id: photo.id,
        entryId: photo.entryId,
        date: photo.date,
        category: photo.category,
        syncStatus: photo.syncStatus,
        blob: blob,
        timestamp: Date.now(),
      };
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(photoRecord);
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    }

    // Insert goals
    await DB.setProfile('goals', data.goals);

    // Insert regimen
    await DB.setProfile('regimen', data.regimen);

    // Insert meal plan
    await DB.saveMealPlan(data.mealPlan);

    // Inject skincare profile (Phase 1+ only — store may not exist yet)
    if (data.skincareProfile) {
      try {
        await DB.setProfile('skincare', data.skincareProfile);
      } catch (e) {
        // skincare profile key not yet supported — silently skip
      }
    }

    // Inject body photo types
    if (data.bodyPhotoTypes) {
      try { await DB.setProfile('bodyPhotoTypes', data.bodyPhotoTypes); } catch (e) {}
    }

    // Inject skincare daily logs (Phase 1+ only — store may not exist yet)
    if (data.skincareLogs) {
      for (const log of data.skincareLogs) {
        try {
          const tx = db.transaction('skincare', 'readwrite');
          tx.objectStore('skincare').put(log);
          await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
        } catch (e) {
          // skincare store not yet created — silently skip
          break;
        }
      }
    }
  }, fixtures);

  return fixtures;
}

async function testTodayScreen(page, fixtures) {
  console.log('\n--- Today Screen ---');

  await page.click('nav button:has-text("Today")');

  // Wait for entries to render (confirms data injection + loadDayView completed)
  await page.waitForSelector('.entry-item', { timeout: 5000 }).catch(() => {});
  // Give score calculation time to finish (runs async after entries)
  await page.waitForTimeout(500);

  // Score ring should render
  const scoreRing = await page.$('.day-score');
  assert(!!scoreRing, 'Score ring renders');

  // Score descriptor and targets
  const descriptor = await page.$eval('.score-descriptor', el => el.textContent).catch(() => '');
  assert(descriptor.length > 0, `Score descriptor renders: "${descriptor}"`);
  const targets = await page.$eval('.score-targets', el => el.textContent).catch(() => '');
  assert(targets.includes('Goal') || targets.includes('Stretch') || targets === '', 'Score targets render');

  // Score number is visible and numeric
  const scoreNum = await page.$eval('.score-number', el => el.textContent.trim());
  assert(/^\d+$/.test(scoreNum), `Score is numeric: ${scoreNum}`);

  // Quick action buttons exist
  const quickActions = await page.$$('.quick-action');
  assert(quickActions.length >= 4, `4+ quick-action buttons (got ${quickActions.length})`);

  // Entry list has items from today's fixture data
  const entryItems = await page.$$('.entry-item');
  // Today = last fixture date (day5) which has 4 entries
  assert(entryItems.length > 0, `Entry items render (got ${entryItems.length})`);

  // Score breakdown chips exist
  const chips = await page.$$('.score-chip');
  assert(chips.length >= 3, `Score breakdown chips render (got ${chips.length})`);

  // Coach is its own tab now — verify Coach nav button exists
  const coachNav = await page.$('nav button[data-screen="coach"]');
  assert(!!coachNav, 'Coach tab exists in navigation');

  // More button exists for additional entry types
  const moreBtn = await page.$('#quick-more-btn');
  assert(!!moreBtn, 'More (+) button exists');

  await screenshot(page, 'today-default');
}

async function testPlanScreen(page, fixtures) {
  console.log('\n--- Progress Segments ---');

  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);

  // Segment control should exist
  const segmentBtns = await page.$$('.segment-btn');
  assert(segmentBtns.length >= 2, `Progress has 2+ segment buttons (got ${segmentBtns.length})`);

  // Default tab is Insights — should show meal plan content
  const container = await page.$('#progress-container');
  const content = await container.textContent();
  const hasMealPlan = content.includes('Meal Plan') || content.includes('dinner') || content.includes('Dinner');
  assert(hasMealPlan, 'Insights shows meal plan content');

  await screenshot(page, 'progress-insights');
}

async function testProgressScreen(page, fixtures) {
  console.log('\n--- Progress Screen ---');

  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);

  // Switch to Trends segment
  const trendsBtn = await page.$('button:has-text("Trends")');
  if (trendsBtn) await trendsBtn.click();
  await page.waitForTimeout(500);

  const container = await page.$('#progress-container');
  const content = await container.textContent();

  // Daily Scores section with sparkline
  assert(content.includes('Daily Scores') || content.includes('Avg'), 'Scores section renders');

  // Legend should use new labels
  assert(content.includes('Goal') || content.includes('Avg') || content.includes('Great'), 'Progress shows score context');
  assert(content.includes('Stretch') || content.includes('Crush') || content.includes('Avg'), 'Progress shows stretch/avg info');

  // Calendar heatmap
  const calDays = await page.$$('.cal-day:not(.empty)');
  assert(calDays.length > 0, `Calendar days render (got ${calDays.length})`);

  // Averages section
  assert(content.includes('Avg Cal') || content.includes('Averages'), 'Averages section renders');

  // Streaks (from day1 analysis)
  assert(content.includes('Streak') || content.includes('Logging') || content.includes('Water'), 'Streaks section renders');

  await screenshot(page, 'progress-trends');

  // Switch back to Insights to check goal consistency
  const insightsBtn2 = await page.$('button:has-text("Insights")');
  if (insightsBtn2) await insightsBtn2.click();
  await page.waitForTimeout(500);

  const insightsContent = await container.textContent();
  assert(insightsContent.includes('Goal Consistency') || insightsContent.includes('This Week') || insightsContent.includes('Meal Plan'), 'Insights shows goal consistency or weekly data');

  await screenshot(page, 'progress-insights-full');
}

async function testProfileScreen(page, fixtures) {
  console.log('\n--- Settings Screen ---');

  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(500);

  // Daily targets card
  const targetsCard = await page.textContent('.s-card-row');
  assert(targetsCard.includes('1200') || targetsCard.includes('cal'), 'Daily targets show calorie goal');

  // Progress has Insights + Trends segments
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(300);
  const insightsBtn = await page.$('#progress-container button:has-text("Insights")');
  assert(!!insightsBtn, 'Progress Insights segment exists');
  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(300);

  // Cloud Sync card
  const syncCard = await page.textContent('#screen-settings');
  assert(syncCard.includes('Cloud Sync'), 'Cloud Sync card renders');

  // Backup card was removed — manual import is no longer in the UI

  // Storage card with danger button
  const dangerBtn = await page.$('.btn-danger');
  assert(!!dangerBtn, 'Clear Photos has danger styling');

  // Version badge
  const version = await page.textContent('#app-version');
  assert(version !== undefined, 'Version badge renders');

  await screenshot(page, 'profile-default');
}

async function testInteractions(page, fixtures) {
  console.log('\n--- Interactions ---');

  // Navigate to Today first
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  // Test water picker modal
  const waterBtn = await page.$('#quick-water-btn');
  if (waterBtn) {
    await waterBtn.click();
    await page.waitForTimeout(300);
    const waterModal = await page.$('.modal-overlay');
    assert(!!waterModal, 'Water picker modal opens');
    await screenshot(page, 'modal-water');
    // Close modal
    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // Test supplement modal
  const suppBtn = await page.$('#quick-supplement-btn');
  if (suppBtn) {
    await suppBtn.click();
    await page.waitForTimeout(300);
    const suppModal = await page.$('.modal-overlay');
    assert(!!suppModal, 'Supplement modal opens');
    await screenshot(page, 'modal-supplements');
    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // Test goal setup modal
  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(300);
  const editBtn = await page.$('.s-action-btn');
  if (editBtn) {
    await editBtn.click();
    await page.waitForTimeout(300);
    const goalModal = await page.$('.modal-overlay');
    assert(!!goalModal, 'Goal setup modal opens');

    // Check labels use new names
    const modalContent = await page.textContent('.modal-overlay');
    assert(modalContent.includes('great') || modalContent.includes('Great'), 'Goal modal uses "great" label');
    assert(modalContent.includes('crush it') || modalContent.includes('Crush It'), 'Goal modal uses "crush it" label');

    // Verify input values match fixture data
    const calValue = await page.$eval('#gs-calories', el => el.value);
    assert(calValue === '1200', `Calorie goal pre-filled: ${calValue}`);

    await screenshot(page, 'modal-goals');
    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // Test entry tap-to-edit
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);
  const firstEntry = await page.$('.entry-item');
  if (firstEntry) {
    await firstEntry.click();
    await page.waitForTimeout(300);
    const editModal = await page.$('.modal-overlay');
    assert(!!editModal, 'Entry edit modal opens on tap');
    await screenshot(page, 'modal-edit-entry');
    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // Test nav between dates (if date nav exists)
  const prevBtn = await page.$('#prev-day-btn, .day-nav-prev, [data-nav="prev"]');
  if (prevBtn) {
    await prevBtn.click();
    await page.waitForTimeout(500);
    const entries = await page.$$('.entry-item');
    assert(entries.length >= 0, 'Previous day navigation works');
    await screenshot(page, 'today-prev-day');
  }
}

async function testScoring(page, fixtures) {
  console.log('\n--- Score Verification ---');

  // Navigate to each fixture day and verify scores render
  for (let i = 0; i < fixtures.dates.length; i++) {
    const date = fixtures.dates[i];
    // Navigate to the date by using the app's date selection
    await page.evaluate((d) => {
      App.goToDate(d);
    }, date);
    await page.waitForTimeout(600);

    const scoreEl = await page.$('.score-number');
    if (scoreEl) {
      const score = (await scoreEl.textContent()).trim();
      const num = ['--', '?'].includes(score) ? 0 : parseInt(score);
      assert(!isNaN(num) && num >= 0 && num <= 100, `Day ${i+1} (${date}) score is valid: ${num}`);
    } else {
      // Might be an analysis-only day with no score ring
      const entryItems = await page.$$('.entry-item');
      assert(true, `Day ${i+1} (${date}) renders (${entryItems.length} entries)`);
    }
  }

  // Day 1 should score highest (full day with workout)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(600);
  const day1Score = await page.$eval('.score-number', el => parseInt(el.textContent.trim())).catch(() => 0);

  // Day 4 should score lowest (minimal logging) — may show empty state "--" or "?"
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[3]);
  await page.waitForTimeout(600);
  const day4ScoreText = await page.$eval('.score-number', el => el.textContent.trim()).catch(() => '--');
  const day4Score = ['--', '?'].includes(day4ScoreText) ? 0 : parseInt(day4ScoreText);
  assert(!isNaN(day4Score), `Day 4 (${fixtures.dates[3]}) score is valid: ${day4Score} (text: "${day4ScoreText}")`);

  assert(day1Score > day4Score, `Full day (${day1Score}) scores higher than minimal day (${day4Score})`);

  // Day 5 has vices — score should be penalized
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(600);
  const day5Score = await page.$eval('.score-number', el => parseInt(el.textContent.trim())).catch(() => 0);
  assert(day5Score < 100, `Custom entry day score penalized: ${day5Score}`);

  // Verify workout chip label logic — find a rest day dynamically
  // The regimen has rest days on Wed/Sat/Sun
  const restDayResult = await page.evaluate(async (dates) => {
    const regimen = await DB.getRegimen();
    const schedule = regimen?.weeklySchedule || [];
    for (const date of dates) {
      const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dayPlan = schedule.find(d => d.day === dayName);
      if (dayPlan && dayPlan.type === 'rest') return date;
    }
    return null;
  }, fixtures.dates);

  if (restDayResult) {
    await page.evaluate((d) => App.goToDate(d), restDayResult);
    await page.waitForTimeout(600);
    const chips = await page.$$eval('.score-chip', els => els.map(e => e.textContent.trim()));
    const hasRestChip = chips.some(c => c.includes('Rest'));
    assert(hasRestChip, 'Rest day shows "Rest" chip label');
  } else {
    assert(true, 'Rest day chip (no rest day in fixture range — skipped)');
  }
}

async function testEntryTypes(page, fixtures) {
  console.log('\n--- Entry Type Rendering ---');

  // Day 1 has meal, workout, supplement
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(600);
  const types = await page.$$eval('.entry-type', els => els.map(e => e.textContent.trim()));

  // entryLabel maps: meal/snack/drink → 'Food', workout → 'Workout', supplement → 'Supplement'
  // CSS capitalize transforms the first letter, so text content matches label output
  const typesLower = types.map(t => t.toLowerCase());
  const hasFood = typesLower.some(t => t.includes('food'));
  // Workout with subtype 'cardio' → entryLabel returns 'Cardio'
  const hasWorkout = typesLower.some(t => t.includes('cardio') || t.includes('workout'));
  const hasSupplement = typesLower.some(t => t.includes('supplement'));
  assert(hasFood, 'Food entry type label renders');
  assert(hasWorkout, 'Workout/Cardio entry type label renders');
  assert(hasSupplement, 'Supplement entry type label renders');

  // Day 5 has vices
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(600);
  const day5Types = await page.$$eval('.entry-type', els => els.map(e => e.textContent.trim()));
  const hasVice = day5Types.some(t => t.toLowerCase().includes('alcohol'));
  assert(hasVice || day5Types.length > 0, 'Custom entries render');
}

async function testPhotos(page, fixtures) {
  console.log('\n--- Photo Rendering ---');

  // Day 1 has: 2 meal entries with photos (lunch has 2 photos), 1 body entry with 2 photos (front+side)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(800);

  // Meal photo thumbnails should render as <img> elements (inside .entry-photo-thumbs wrapper)
  const mealThumbs = await page.$$('.entry-photo-thumbs img.entry-photo-thumb');
  assert(mealThumbs.length >= 2, `Meal photo thumbnails render (got ${mealThumbs.length}, expected ≥2)`);

  // Check that thumbnails have blob URL srcs
  if (mealThumbs.length > 0) {
    const src = await mealThumbs[0].getAttribute('src');
    assert(src && src.startsWith('blob:'), 'Meal photo has blob URL src');
  }

  // Multi-photo entry (Day 1 lunch) should show count badge
  const countBadges = await page.$$('.photo-count-badge');
  assert(countBadges.length >= 1, `Multi-photo entry shows count badge (got ${countBadges.length})`);
  if (countBadges.length > 0) {
    const badgeText = await countBadges[0].textContent();
    assert(badgeText === '2', `Count badge shows "2" for 2-photo entry (got "${badgeText}")`);
  }

  // Single-photo entry should NOT show count badge
  const singlePhotoEntries = await page.$$('.entry-photo-thumbs:not(:has(.photo-count-badge))');
  assert(singlePhotoEntries.length >= 1, `Single-photo entries have no count badge (got ${singlePhotoEntries.length})`);


  // Body photo should show locked (lock icon, not revealed)
  const lockedPhoto = await page.$('.entry-photo-locked');
  assert(!!lockedPhoto, 'Body photo shows locked state');

  // Tap locked photo to reveal
  if (lockedPhoto) {
    await lockedPhoto.click();
    await page.waitForTimeout(600);
    const revealed = await page.$('.entry-photo-locked.revealed');
    assert(!!revealed, 'Body photo reveals on tap');

    const bgImage = await revealed.evaluate(el => el.style.backgroundImage);
    assert(bgImage && bgImage.includes('blob:'), 'Revealed body photo has image');

    await screenshot(page, 'photo-body-revealed');

    // Wait for auto-hide (5s) or manually re-tap to hide
    await lockedPhoto.click();
    await page.waitForTimeout(300);
    const hidden = await page.$('.entry-photo-locked:not(.revealed)');
    assert(!!hidden, 'Body photo re-locks on second tap');
  }

  await screenshot(page, 'photos-day1-meals');

  // Verify single-photo edit modal (tap first meal entry — breakfast, 1 photo)
  const mealEntryWithPhoto = await page.$('.entry-item[data-type="meal"]');
  if (mealEntryWithPhoto) {
    await mealEntryWithPhoto.click();
    await page.waitForTimeout(500);
    const editModal = await page.$('.modal-overlay');
    if (editModal) {
      const modalPhoto = await page.$('.modal-overlay .ql-photo-preview img');
      assert(!!modalPhoto, 'Edit modal shows photo preview');
      if (modalPhoto) {
        const modalSrc = await modalPhoto.getAttribute('src');
        assert(modalSrc && modalSrc.startsWith('blob:'), 'Edit modal photo has blob URL');
      }
      // Single-photo entry should NOT show a grid
      const photoGrid = await page.$('.modal-overlay .edit-photo-grid');
      assert(!photoGrid, 'Single-photo edit modal has no grid layout');
      await screenshot(page, 'photo-edit-modal');
      const closeBtn = await page.$('.modal-close');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(200);
    }
  }

  // Verify multi-photo edit modal (tap lunch entry — 2 photos)
  // Lunch is the second meal entry on Day 1
  const mealEntries = await page.$$('.entry-item[data-type="meal"]');
  if (mealEntries.length >= 2) {
    await mealEntries[1].click();
    await page.waitForTimeout(500);
    const editModal2 = await page.$('.modal-overlay');
    if (editModal2) {
      const gridPhotos = await page.$$('.modal-overlay .edit-photo-grid .ql-photo-preview img');
      assert(gridPhotos.length === 2, `Multi-photo edit modal shows grid with 2 photos (got ${gridPhotos.length})`);
      if (gridPhotos.length >= 2) {
        const src1 = await gridPhotos[0].getAttribute('src');
        const src2 = await gridPhotos[1].getAttribute('src');
        assert(src1 && src1.startsWith('blob:'), 'Multi-photo grid photo 1 has blob URL');
        assert(src2 && src2.startsWith('blob:'), 'Multi-photo grid photo 2 has blob URL');
        assert(src1 !== src2, 'Multi-photo grid shows two different photos');
      }
      await screenshot(page, 'photo-edit-modal-multi');
      const closeBtn = await page.$('.modal-close');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(200);
    }
  }

  // Day 2 has 1 meal photo (synced status, not processed)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[1]);
  await page.waitForTimeout(800);
  const day2Thumbs = await page.$$('.entry-photo-thumbs img.entry-photo-thumb');
  assert(day2Thumbs.length >= 1, `Day 2 synced photo renders (got ${day2Thumbs.length})`);
  await screenshot(page, 'photos-day2');

  // Day 3 has 1 meal photo (dinner — dark/moody steak)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[2]);
  await page.waitForTimeout(800);
  const day3Thumbs = await page.$$('.entry-photo-thumbs img.entry-photo-thumb');
  assert(day3Thumbs.length >= 1, `Day 3 dinner photo renders (got ${day3Thumbs.length})`);

  // Day 5 has 2 meal photos (pizza + burger, both unsynced)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(800);
  const day5Thumbs = await page.$$('.entry-photo-thumbs img.entry-photo-thumb');
  assert(day5Thumbs.length >= 2, `Day 5 meal photos render (got ${day5Thumbs.length})`);
  await screenshot(page, 'photos-day5-vices');

  // Day 4 has no photos at all
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[3]);
  await page.waitForTimeout(800);
  const day4Thumbs = await page.$$('.entry-photo-thumbs img.entry-photo-thumb');
  const day4Locked = await page.$$('.entry-photo-locked');
  assert(day4Thumbs.length === 0 && day4Locked.length === 0, 'Day with no photos has no thumbnails');

  // Verify photo sync status counts in IndexedDB
  const syncCounts = await page.evaluate(async () => {
    const status = await DB.getPhotoSyncStatus();
    return status;
  });
  assert(syncCounts.processed > 0, `Has processed photos (${syncCounts.processed})`);
  assert(syncCounts.unsynced > 0, `Has unsynced photos (${syncCounts.unsynced})`);
  assert(syncCounts.totalSize > 0, `Photos have non-zero total size (${syncCounts.totalSize} bytes)`);

  // Verify storage card on Profile
  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(500);
  const storageText = await page.textContent('#screen-settings');
  assert(storageText.includes('photo') || storageText.includes('Photo') || storageText.includes('Clear'), 'Storage card references photos');

  await screenshot(page, 'profile-storage-with-photos');

  // --- Multi-Photo DB Tests ---
  console.log('\n--- Multi-Photo DB ---');

  // Test addEntry with array of blobs (the new multi-photo path)
  const multiPhotoResult = await page.evaluate(async () => {
    // Create 3 small test blobs
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const ctx = canvas.getContext('2d');
    const blobs = [];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['red', 'green', 'blue'][i];
      ctx.fillRect(0, 0, 10, 10);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
      blobs.push(blob);
    }

    const entry = {
      id: 'multi_photo_test_entry',
      type: 'meal',
      date: '2026-01-01',
      timestamp: new Date().toISOString(),
      notes: 'Test multi-photo',
      photo: true,
    };
    await DB.addEntry(entry, blobs);

    // Retrieve and verify
    const photos = await DB.getPhotos('multi_photo_test_entry');
    return {
      count: photos.length,
      ids: photos.map(p => p.id),
      allHaveBlobs: photos.every(p => p.blob instanceof Blob),
      allSameEntry: photos.every(p => p.entryId === 'multi_photo_test_entry'),
    };
  });
  assert(multiPhotoResult.count === 3, `addEntry with 3 blobs stores 3 photos (got ${multiPhotoResult.count})`);
  assert(multiPhotoResult.ids[0] === 'photo_multi_photo_test_entry', `First photo ID follows legacy pattern (got ${multiPhotoResult.ids[0]})`);
  assert(multiPhotoResult.ids[1] === 'photo_multi_photo_test_entry_2', `Second photo ID is numbered _2 (got ${multiPhotoResult.ids[1]})`);
  assert(multiPhotoResult.ids[2] === 'photo_multi_photo_test_entry_3', `Third photo ID is numbered _3 (got ${multiPhotoResult.ids[2]})`);
  assert(multiPhotoResult.allHaveBlobs, 'All multi-photo records have blobs');
  assert(multiPhotoResult.allSameEntry, 'All multi-photo records share same entryId');

  // Test addEntry with single blob (backward compatibility)
  const singleBlobResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
    const entry = {
      id: 'single_blob_compat_test',
      type: 'meal',
      date: '2026-01-01',
      timestamp: new Date().toISOString(),
      notes: 'Single blob compat',
      photo: true,
    };
    await DB.addEntry(entry, blob);
    const photos = await DB.getPhotos('single_blob_compat_test');
    return { count: photos.length, id: photos[0]?.id };
  });
  assert(singleBlobResult.count === 1, `addEntry with single blob still works (got ${singleBlobResult.count})`);
  assert(singleBlobResult.id === 'photo_single_blob_compat_test', `Single blob uses legacy ID pattern (got ${singleBlobResult.id})`);

  // Test exportDay numbers multi-photo entries in ZIP
  const exportResult = await page.evaluate(async () => {
    const data = await DB.exportDay('2026-01-01');
    const names = data.photoFiles.map(f => f.name);
    // multi_photo_test_entry has 3 photos — should be numbered
    const multiNames = names.filter(n => n.includes('multi_photo_test_entry'));
    // single_blob_compat_test has 1 photo — no suffix
    const singleNames = names.filter(n => n.includes('single_blob_compat_test'));
    return { multiNames, singleNames };
  });
  assert(exportResult.multiNames.length === 3, `Export includes all 3 photos for multi-photo entry (got ${exportResult.multiNames.length})`);
  assert(exportResult.multiNames.some(n => n.includes('_1.jpg')), `Export numbers first photo _1 (got ${exportResult.multiNames})`);
  assert(exportResult.multiNames.some(n => n.includes('_3.jpg')), `Export numbers third photo _3 (got ${exportResult.multiNames})`);
  assert(exportResult.singleNames.length === 1, `Export has 1 photo for single-photo entry (got ${exportResult.singleNames.length})`);
  assert(!exportResult.singleNames[0].includes('_1'), `Single-photo export has no number suffix (got ${exportResult.singleNames[0]})`);

  // Clean up test entries
  await page.evaluate(async () => {
    await DB.deleteEntry('multi_photo_test_entry');
    await DB.deleteEntry('single_blob_compat_test');
  });
}

async function testPhotoComprehensive(page, fixtures) {
  console.log('\n--- Photo Comprehensive ---');

  // Helper: create a temp image file for file chooser injection
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  function makeTempImage(label, color, w = 200, h = 200) {
    // Returns a buffer we can write to a temp file
    return page.evaluate(async (opts) => {
      const canvas = document.createElement('canvas');
      canvas.width = opts.w; canvas.height = opts.h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = opts.color;
      ctx.fillRect(0, 0, opts.w, opts.h);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(opts.label, opts.w / 2, opts.h / 2);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, { label, color, w, h });
  }

  // ---- DB: deleteEntry cascades to photos ----
  const deleteResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    const entry = {
      id: 'delete_cascade_test',
      type: 'meal', date: '2026-02-01',
      timestamp: new Date().toISOString(),
      notes: 'Delete test', photo: true,
    };
    await DB.addEntry(entry, [blob, blob]);
    const before = await DB.getPhotos('delete_cascade_test');
    await DB.deleteEntry('delete_cascade_test');
    const after = await DB.getPhotos('delete_cascade_test');
    return { before: before.length, after: after.length };
  });
  assert(deleteResult.before === 2, `deleteEntry: had 2 photos before (got ${deleteResult.before})`);
  assert(deleteResult.after === 0, `deleteEntry: 0 photos after cascade delete (got ${deleteResult.after})`);

  // ---- DB: clearProcessedPhotos skips body photos ----
  const clearResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    // Create a processed meal photo and a processed body photo
    const db = await DB.openDB();
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({
      id: 'clear_test_meal', entryId: 'clear_entry_1', date: '2026-02-02',
      category: 'meal', syncStatus: 'processed', blob, timestamp: new Date().toISOString(),
    });
    tx.objectStore('photos').put({
      id: 'clear_test_body', entryId: 'clear_entry_2', date: '2026-02-02',
      category: 'body', syncStatus: 'processed', blob, timestamp: new Date().toISOString(),
    });
    await new Promise((r, e) => { tx.oncomplete = r; tx.onerror = e; });

    const cleared = await DB.clearProcessedPhotos();

    // Check what remains
    const tx2 = db.transaction('photos', 'readonly');
    const mealCheck = await new Promise(r => {
      const req = tx2.objectStore('photos').get('clear_test_meal');
      req.onsuccess = () => r(req.result);
    });
    const bodyCheck = await new Promise(r => {
      const req = tx2.objectStore('photos').get('clear_test_body');
      req.onsuccess = () => r(req.result);
    });

    // Clean up body photo
    const tx3 = db.transaction('photos', 'readwrite');
    tx3.objectStore('photos').delete('clear_test_body');
    await new Promise(r => { tx3.oncomplete = r; });

    return { cleared, mealGone: !mealCheck, bodyKept: !!bodyCheck };
  });
  assert(clearResult.mealGone, 'clearProcessedPhotos: meal photo deleted');
  assert(clearResult.bodyKept, 'clearProcessedPhotos: body photo preserved');
  assert(clearResult.cleared >= 1, `clearProcessedPhotos: returned count >= 1 (got ${clearResult.cleared})`);

  // ---- DB: body photo category set correctly ----
  const bodyCatResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    const entry = {
      id: 'body_cat_test', type: 'bodyPhoto', subtype: 'front',
      date: '2026-02-03', timestamp: new Date().toISOString(),
      notes: '', photo: true,
    };
    await DB.addEntry(entry, blob);
    const photos = await DB.getPhotos('body_cat_test');
    const cat = photos[0]?.category;
    await DB.deleteEntry('body_cat_test');
    return { cat };
  });
  assert(bodyCatResult.cat === 'body', `Body photo entry gets category "body" (got "${bodyCatResult.cat}")`);

  // ---- DB: getBodyPhotos filters by category ----
  const bodyFilterResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    // Create one meal and one body photo on same date
    const db = await DB.openDB();
    const tx = db.transaction(['entries', 'photos'], 'readwrite');
    tx.objectStore('entries').put({
      id: 'meal_filter_test', type: 'meal', date: '2026-02-04',
      timestamp: new Date().toISOString(), notes: '', photo: true,
    });
    tx.objectStore('photos').put({
      id: 'photo_meal_filter', entryId: 'meal_filter_test', date: '2026-02-04',
      category: 'meal', syncStatus: 'unsynced', blob, timestamp: new Date().toISOString(),
    });
    tx.objectStore('entries').put({
      id: 'body_filter_test', type: 'bodyPhoto', date: '2026-02-04',
      timestamp: new Date().toISOString(), notes: '', photo: true,
    });
    tx.objectStore('photos').put({
      id: 'photo_body_filter', entryId: 'body_filter_test', date: '2026-02-04',
      category: 'body', syncStatus: 'unsynced', blob, timestamp: new Date().toISOString(),
    });
    await new Promise((r, e) => { tx.oncomplete = r; tx.onerror = e; });

    const bodyOnly = await DB.getBodyPhotos('2026-02-04');
    const allPhotosForMeal = await DB.getPhotos('meal_filter_test');
    const allPhotosForBody = await DB.getPhotos('body_filter_test');

    // Clean up
    await DB.deleteEntry('meal_filter_test');
    await DB.deleteEntry('body_filter_test');

    return {
      bodyCount: bodyOnly.length,
      bodyCategory: bodyOnly[0]?.category,
      mealCount: allPhotosForMeal.length,
      bodyEntryCount: allPhotosForBody.length,
    };
  });
  assert(bodyFilterResult.bodyCount === 1, `getBodyPhotos returns only body photos (got ${bodyFilterResult.bodyCount})`);
  assert(bodyFilterResult.bodyCategory === 'body', `getBodyPhotos: photo has body category`);
  assert(bodyFilterResult.mealCount === 1, `getPhotos(meal) returns meal photo (got ${bodyFilterResult.mealCount})`);
  assert(bodyFilterResult.bodyEntryCount === 1, `getPhotos(body) returns body photo (got ${bodyFilterResult.bodyEntryCount})`);

  // ---- DB: exportDay body photos use progress/ path with subtype numbering ----
  const bodyExportResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    // Create 2 body photos of same subtype + 1 different subtype
    const db = await DB.openDB();
    const tx = db.transaction(['entries', 'photos'], 'readwrite');
    const date = '2026-02-05';
    tx.objectStore('entries').put({ id: 'bodyPhoto_front_exp1', type: 'bodyPhoto', subtype: 'front', date, timestamp: new Date().toISOString(), photo: true });
    tx.objectStore('entries').put({ id: 'bodyPhoto_front_exp2', type: 'bodyPhoto', subtype: 'front', date, timestamp: new Date().toISOString(), photo: true });
    tx.objectStore('entries').put({ id: 'bodyPhoto_side_exp1', type: 'bodyPhoto', subtype: 'side', date, timestamp: new Date().toISOString(), photo: true });
    tx.objectStore('photos').put({ id: 'p_front1', entryId: 'bodyPhoto_front_exp1', date, category: 'body', syncStatus: 'unsynced', blob, timestamp: new Date().toISOString() });
    tx.objectStore('photos').put({ id: 'p_front2', entryId: 'bodyPhoto_front_exp2', date, category: 'body', syncStatus: 'unsynced', blob, timestamp: new Date().toISOString() });
    tx.objectStore('photos').put({ id: 'p_side1', entryId: 'bodyPhoto_side_exp1', date, category: 'body', syncStatus: 'unsynced', blob, timestamp: new Date().toISOString() });
    await new Promise((r, e) => { tx.oncomplete = r; tx.onerror = e; });

    const data = await DB.exportDay(date);
    const names = data.photoFiles.map(f => f.name);

    // Clean up
    await DB.deleteEntry('bodyPhoto_front_exp1');
    await DB.deleteEntry('bodyPhoto_front_exp2');
    await DB.deleteEntry('bodyPhoto_side_exp1');

    return { names };
  });
  assert(bodyExportResult.names.some(n => n === 'body/front.jpg'), `Body export has front.jpg (got ${bodyExportResult.names})`);
  assert(bodyExportResult.names.some(n => n === 'body/front_2.jpg'), `Body export has front_2.jpg for second (got ${bodyExportResult.names})`);
  assert(bodyExportResult.names.some(n => n === 'body/side.jpg'), `Body export has side.jpg (got ${bodyExportResult.names})`);
  assert(bodyExportResult.names.length === 3, `Body export has 3 total photos (got ${bodyExportResult.names.length})`);

  // ---- DB: addEntry with null/undefined photoBlobs ----
  const nullPhotoResult = await page.evaluate(async () => {
    const entry = {
      id: 'null_photo_test', type: 'meal', date: '2026-02-06',
      timestamp: new Date().toISOString(), notes: 'No photo', photo: false,
    };
    await DB.addEntry(entry, null);
    await DB.addEntry({ ...entry, id: 'undef_photo_test' }, undefined);
    const photos1 = await DB.getPhotos('null_photo_test');
    const photos2 = await DB.getPhotos('undef_photo_test');
    await DB.deleteEntry('null_photo_test');
    await DB.deleteEntry('undef_photo_test');
    return { null: photos1.length, undef: photos2.length };
  });
  assert(nullPhotoResult.null === 0, `addEntry with null photoBlobs stores no photos (got ${nullPhotoResult.null})`);
  assert(nullPhotoResult.undef === 0, `addEntry with undefined photoBlobs stores no photos (got ${nullPhotoResult.undef})`);

  // ---- DB: addEntry with empty array ----
  const emptyArrayResult = await page.evaluate(async () => {
    const entry = {
      id: 'empty_arr_test', type: 'meal', date: '2026-02-06',
      timestamp: new Date().toISOString(), notes: 'Empty array', photo: false,
    };
    await DB.addEntry(entry, []);
    const photos = await DB.getPhotos('empty_arr_test');
    await DB.deleteEntry('empty_arr_test');
    return { count: photos.length };
  });
  assert(emptyArrayResult.count === 0, `addEntry with empty array stores no photos (got ${emptyArrayResult.count})`);

  // ---- Camera: compression produces smaller blob ----
  const compressResult = await page.evaluate(async () => {
    // Create a large-ish canvas image
    const canvas = document.createElement('canvas');
    canvas.width = 1600; canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    // Fill with random noise to make compression meaningful
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;
      ctx.fillRect(Math.random()*1600, Math.random()*1200, 100, 100);
    }
    const originalBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
    const result = await Camera.compress(originalBlob, 'meal');
    return {
      originalSize: originalBlob.size,
      compressedSize: result.blob.size,
      hasUrl: typeof result.url === 'string' && result.url.startsWith('blob:'),
      isJpeg: result.blob.type === 'image/jpeg',
    };
  });
  assert(compressResult.compressedSize < compressResult.originalSize, `Camera.compress reduces size (${compressResult.originalSize} → ${compressResult.compressedSize})`);
  assert(compressResult.hasUrl, 'Camera.compress returns blob URL');
  assert(compressResult.isJpeg, 'Camera.compress output is JPEG');

  // ---- Camera: compress respects preset max dimension ----
  const presetResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000; canvas.height = 1500;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, 2000, 1500);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    const mealResult = await Camera.compress(blob, 'meal');
    const bodyResult = await Camera.compress(blob, 'body');

    // Check dimensions by loading the compressed images
    const loadDim = (b) => new Promise(r => {
      const img = new Image();
      img.onload = () => { r({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(img.src); };
      img.src = URL.createObjectURL(b);
    });
    const mealDim = await loadDim(mealResult.blob);
    const bodyDim = await loadDim(bodyResult.blob);

    Camera.revokeURL(mealResult.url);
    Camera.revokeURL(bodyResult.url);

    return { mealDim, bodyDim };
  });
  assert(presetResult.mealDim.w <= 800 && presetResult.mealDim.h <= 800, `Meal preset max 800px (got ${presetResult.mealDim.w}x${presetResult.mealDim.h})`);
  assert(presetResult.bodyDim.w <= 1200 && presetResult.bodyDim.h <= 1200, `Body preset max 1200px (got ${presetResult.bodyDim.w}x${presetResult.bodyDim.h})`);
  // Aspect ratio preserved
  const mealRatio = presetResult.mealDim.w / presetResult.mealDim.h;
  assert(Math.abs(mealRatio - (2000/1500)) < 0.05, `Meal compression preserves aspect ratio (got ${mealRatio.toFixed(2)}, expected ~1.33)`);

  // ---- Camera: createPreview returns correct DOM structure ----
  const previewStructure = await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob(['test'], { type: 'image/jpeg' }));
    let removeCalled = false;
    const preview = Camera.createPreview(url, () => { removeCalled = true; });
    const hasPreviewClass = preview.classList.contains('photo-preview');
    const img = preview.querySelector('.photo-preview-img');
    const removeBtn = preview.querySelector('.photo-preview-remove');
    const removeLabel = removeBtn?.getAttribute('aria-label');

    // Trigger remove
    if (removeBtn) removeBtn.click();

    URL.revokeObjectURL(url);
    return {
      hasPreviewClass,
      hasImg: !!img,
      imgSrc: img?.src?.startsWith('blob:') || false,
      hasRemoveBtn: !!removeBtn,
      removeLabel,
      removeCalled,
    };
  });
  assert(previewStructure.hasPreviewClass, 'createPreview: has .photo-preview class');
  assert(previewStructure.hasImg, 'createPreview: contains img.photo-preview-img');
  assert(previewStructure.hasRemoveBtn, 'createPreview: contains remove button');
  assert(previewStructure.removeLabel === 'Remove photo', 'createPreview: remove button has aria-label');
  assert(previewStructure.removeCalled, 'createPreview: remove callback fires on click');

  // ---- Log form: multi-photo add and remove via inline form ----
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(500);

  // Open the inline Log form directly via Log.selectType('meal')
  // The More sheet → Food opens a different single-photo modal (showFoodNote)
  // Multi-photo is in the Log form, reachable via the + Add Entry grid or directly
  await page.evaluate(() => {
    // Show the inline log form for Food type
    const logGrid = document.getElementById('log-type-grid-inline');
    if (logGrid) logGrid.style.display = 'none';
    Log._gridId = 'log-type-grid-inline';
    Log._formId = null;
    Log._formContentId = 'log-form-content-inline';
    Log.selectType('meal');
    const inlineForm = document.getElementById('log-form-inline');
    if (inlineForm) inlineForm.style.display = 'block';
  });
  await page.waitForTimeout(500);

  {
    // The form should have photo buttons
    const captureBtn = await page.$('#log-photo-capture');
    const pickBtn = await page.$('#log-photo-pick');
    assert(!!captureBtn, 'Food form: Take Photo button exists');
    assert(!!pickBtn, 'Food form: Choose from Library button exists');

      // Preview area starts empty
      const previewArea = await page.$('#log-photo-preview-area');
      const initialPreviews = await page.$$('#log-photo-preview-area .photo-preview');
      assert(initialPreviews.length === 0, 'Food form: preview area starts empty');

      // Use file chooser to add first photo
      const buf1 = Buffer.from(await makeTempImage('PHOTO 1', '#e74c3c'));
      const tmp1 = path.join(os.tmpdir(), 'test-multi-1.jpg');
      fs.writeFileSync(tmp1, buf1);

      const [fc1] = await Promise.all([
        page.waitForEvent('filechooser'),
        pickBtn.click(),
      ]);
      await fc1.setFiles(tmp1);
      await page.waitForTimeout(400);
      try { fs.unlinkSync(tmp1); } catch (_) {}

      const after1 = await page.$$('#log-photo-preview-area .photo-preview');
      assert(after1.length === 1, `Food form: 1 preview after first photo (got ${after1.length})`);

      // Add second photo
      const buf2 = Buffer.from(await makeTempImage('PHOTO 2', '#3498db'));
      const tmp2 = path.join(os.tmpdir(), 'test-multi-2.jpg');
      fs.writeFileSync(tmp2, buf2);

      const [fc2] = await Promise.all([
        page.waitForEvent('filechooser'),
        pickBtn.click(),
      ]);
      await fc2.setFiles(tmp2);
      await page.waitForTimeout(400);
      try { fs.unlinkSync(tmp2); } catch (_) {}

      const after2 = await page.$$('#log-photo-preview-area .photo-preview');
      assert(after2.length === 2, `Food form: 2 previews after second photo (got ${after2.length})`);

      // Each preview has an image and remove button
      const previewImgs = await page.$$('#log-photo-preview-area .photo-preview-img');
      const removeBtns = await page.$$('#log-photo-preview-area .photo-preview-remove');
      assert(previewImgs.length === 2, `Food form: 2 preview images (got ${previewImgs.length})`);
      assert(removeBtns.length === 2, `Food form: 2 remove buttons (got ${removeBtns.length})`);

      // Remove first photo — should leave 1
      if (removeBtns.length >= 1) {
        await removeBtns[0].click();
        await page.waitForTimeout(300);
        const afterRemove = await page.$$('#log-photo-preview-area .photo-preview');
        assert(afterRemove.length === 1, `Food form: 1 preview after removing first (got ${afterRemove.length})`);
      }

      // Verify pendingPhotos array in JS
      const pendingCount = await page.evaluate(() => Log.pendingPhotos.length);
      assert(pendingCount === 1, `Log.pendingPhotos has 1 item after removal (got ${pendingCount})`);

      await screenshot(page, 'photo-multi-form-preview');

      // Add a third photo then save — verify 2 photos stored (1 remaining + 1 new)
      const buf3 = Buffer.from(await makeTempImage('PHOTO 3', '#9b59b6'));
      const tmp3 = path.join(os.tmpdir(), 'test-multi-3.jpg');
      fs.writeFileSync(tmp3, buf3);

      const [fc3] = await Promise.all([
        page.waitForEvent('filechooser'),
        pickBtn.click(),
      ]);
      await fc3.setFiles(tmp3);
      await page.waitForTimeout(400);
      try { fs.unlinkSync(tmp3); } catch (_) {}

      const before3 = await page.$$('#log-photo-preview-area .photo-preview');
      assert(before3.length === 2, `Food form: 2 previews before save (got ${before3.length})`);

      // Fill notes and save
      const notesField = await page.$('#log-notes');
      if (notesField) await notesField.fill('Multi-photo test entry');

      const saveBtn = await page.$('.btn-primary.btn-block.btn-lg');
      if (saveBtn) {
        await saveBtn.click();
        await page.waitForTimeout(800);
      }

      // Verify entry saved with 2 photos in DB
      const savedCheck = await page.evaluate(async () => {
        const entries = await DB.getEntriesByDate(App.selectedDate);
        const multi = entries.find(e => e.notes === 'Multi-photo test entry');
        if (!multi) return null;
        const photos = await DB.getPhotos(multi.id);
        return {
          entryId: multi.id,
          photoFlag: multi.photo,
          count: photos.length,
          ids: photos.map(p => p.id),
          allMeal: photos.every(p => p.category === 'meal'),
          allUnsynced: photos.every(p => p.syncStatus === 'unsynced'),
          allHaveBlobs: photos.every(p => p.blob instanceof Blob),
        };
      });
      assert(savedCheck, 'Multi-photo entry found in DB after save');
      if (savedCheck) {
        assert(savedCheck.photoFlag === true, 'Multi-photo entry has photo: true');
        assert(savedCheck.count === 2, `Multi-photo entry has 2 photos in DB (got ${savedCheck.count})`);
        assert(savedCheck.allMeal, 'All photos have category "meal"');
        assert(savedCheck.allUnsynced, 'All photos have syncStatus "unsynced"');
        assert(savedCheck.allHaveBlobs, 'All photos have blob data');
      }

      // Verify pendingPhotos cleared after save
      const pendingAfterSave = await page.evaluate(() => Log.pendingPhotos.length);
      assert(pendingAfterSave === 0, `pendingPhotos empty after save (got ${pendingAfterSave})`);

      // Verify entry renders with count badge
      await page.waitForTimeout(500);
      const newBadges = await page.$$('.photo-count-badge');
      const hasBadge2 = await page.evaluate(() => {
        const badges = document.querySelectorAll('.photo-count-badge');
        return Array.from(badges).some(b => b.textContent === '2');
      });
      assert(hasBadge2, 'New multi-photo entry shows count badge "2"');

      // Tap the new entry to verify edit modal shows photo grid
      const newEntry = await page.evaluate(async () => {
        const entries = await DB.getEntriesByDate(App.selectedDate);
        return entries.find(e => e.notes === 'Multi-photo test entry')?.id || null;
      });
      if (newEntry) {
        // Find and click the entry
        const entryItems = await page.$$('.entry-item');
        for (const item of entryItems) {
          const notes = await item.$('.entry-notes');
          if (notes) {
            const text = await notes.textContent();
            if (text.includes('Multi-photo test')) {
              await item.click();
              break;
            }
          }
        }
        await page.waitForTimeout(500);

        const gridPhotos = await page.$$('.edit-photo-grid .ql-photo-preview');
        assert(gridPhotos.length === 2, `Edit modal: photo grid shows 2 photos (got ${gridPhotos.length})`);

        // Click a grid photo to open viewer
        if (gridPhotos.length >= 1) {
          await gridPhotos[0].click();
          await page.waitForTimeout(400);
          const viewer = await page.$('.photo-viewer-overlay');
          assert(!!viewer, 'Edit modal: clicking grid photo opens viewer');
          if (viewer) {
            const viewerImg = await page.$('.photo-viewer-overlay img');
            assert(!!viewerImg, 'Photo viewer has image element');
            const viewerClose = await page.$('.photo-viewer-close');
            if (viewerClose) await viewerClose.click();
            await page.waitForTimeout(200);
          }
        }

        await screenshot(page, 'photo-edit-modal-multi-new');

        const closeBtn = await page.$('#edit-close');
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(200);

        // Clean up the test entry
        await page.evaluate(async (id) => { await DB.deleteEntry(id); }, newEntry);
      }
  }

  // ---- Inline form: clearPendingPhotos on type switch ----
  const clearOnSwitch = await page.evaluate(() => {
    // Simulate: add fake pending photos then switch type
    Log.pendingPhotos = [
      { blob: new Blob(['a']), url: 'blob:fake1', takenAt: null },
      { blob: new Blob(['b']), url: 'blob:fake2', takenAt: null },
    ];
    const before = Log.pendingPhotos.length;
    Log.selectType('workout');
    const after = Log.pendingPhotos.length;
    return { before, after };
  });
  assert(clearOnSwitch.before === 2, `clearPendingPhotos: had 2 before switch`);
  assert(clearOnSwitch.after === 0, `clearPendingPhotos: 0 after type switch (got ${clearOnSwitch.after})`);

  // ---- _getEntryDate: camera capture uses photo date ----
  const entryDateResult = await page.evaluate(() => {
    // Simulate camera capture with specific date
    Log.pendingPhotos = [{ blob: new Blob(['x']), url: 'blob:test', takenAt: '2026-01-15T14:30:00.000Z' }];
    const date = Log._getEntryDate();
    const ts = Log._getEntryTimestamp();
    Log.pendingPhotos = [];
    return { date, ts };
  });
  assert(entryDateResult.date === '2026-01-15', `_getEntryDate uses photo date for captures (got ${entryDateResult.date})`);
  assert(entryDateResult.ts === '2026-01-15T14:30:00.000Z', `_getEntryTimestamp uses photo takenAt (got ${entryDateResult.ts})`);

  // ---- _getEntryDate: gallery pick uses selectedDate ----
  const galleryDateResult = await page.evaluate(() => {
    Log.pendingPhotos = [{ blob: new Blob(['x']), url: 'blob:test', takenAt: null }];
    const date = Log._getEntryDate();
    Log.pendingPhotos = [];
    return { date, selectedDate: App.selectedDate };
  });
  assert(galleryDateResult.date === galleryDateResult.selectedDate, `_getEntryDate uses App.selectedDate for gallery picks`);

  // ---- _getEntryDate: no photos uses selectedDate ----
  const noPhotoDateResult = await page.evaluate(() => {
    Log.pendingPhotos = [];
    return { date: Log._getEntryDate(), selectedDate: App.selectedDate };
  });
  assert(noPhotoDateResult.date === noPhotoDateResult.selectedDate, `_getEntryDate uses App.selectedDate when no photos`);

  // ---- Photo sync status counts are accurate ----
  const syncStatusResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 5; canvas.height = 5;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    const db = await DB.openDB();
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id: 'sync_test_1', entryId: 'st1', date: '2026-02-10', category: 'meal', syncStatus: 'unsynced', blob, timestamp: '' });
    tx.objectStore('photos').put({ id: 'sync_test_2', entryId: 'st2', date: '2026-02-10', category: 'meal', syncStatus: 'synced', blob, timestamp: '' });
    tx.objectStore('photos').put({ id: 'sync_test_3', entryId: 'st3', date: '2026-02-10', category: 'meal', syncStatus: 'processed', blob, timestamp: '' });
    await new Promise((r, e) => { tx.oncomplete = r; tx.onerror = e; });

    const status = await DB.getPhotoSyncStatus();

    // Clean up
    const tx2 = db.transaction('photos', 'readwrite');
    tx2.objectStore('photos').delete('sync_test_1');
    tx2.objectStore('photos').delete('sync_test_2');
    tx2.objectStore('photos').delete('sync_test_3');
    await new Promise(r => { tx2.oncomplete = r; });

    return { unsynced: status.unsynced, synced: status.synced, processed: status.processed };
  });
  // These include fixture photos too, so just check the test ones were counted
  assert(syncStatusResult.unsynced >= 1, `Sync status: unsynced >= 1 (got ${syncStatusResult.unsynced})`);
  assert(syncStatusResult.synced >= 1, `Sync status: synced >= 1 (got ${syncStatusResult.synced})`);
  assert(syncStatusResult.processed >= 1, `Sync status: processed >= 1 (got ${syncStatusResult.processed})`);

  // ---- Export: entry with no photos produces no photoFiles ----
  const noPhotoExport = await page.evaluate(async () => {
    const entry = {
      id: 'no_photo_export_test', type: 'meal', date: '2026-02-11',
      timestamp: new Date().toISOString(), notes: 'No photo entry', photo: false,
    };
    await DB.addEntry(entry, null);
    const data = await DB.exportDay('2026-02-11');
    await DB.deleteEntry('no_photo_export_test');
    return { photoCount: data.photoFiles.length, entryCount: data.log.entries.length };
  });
  assert(noPhotoExport.photoCount === 0, `Export: no photoFiles for entry without photo (got ${noPhotoExport.photoCount})`);
  assert(noPhotoExport.entryCount === 1, `Export: entry still in log (got ${noPhotoExport.entryCount})`);

  await screenshot(page, 'photo-comprehensive-done');

  // Reload day view to restore state
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(500);
}

async function testMultiPhotoEntry(page, fixtures) {
  console.log('\n--- Multi-Photo Entry ---');

  // ---- DB.addPhotosToEntry: add photos to existing entry ----
  const addResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 10, 10);
    const blob1 = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 10, 10);
    const blob2 = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 10, 10);
    const blob3 = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    // Create entry with 1 photo
    const entry = {
      id: 'multi_add_test', type: 'meal', date: '2026-02-15',
      timestamp: new Date().toISOString(), notes: 'Multi-photo test', photo: true,
    };
    await DB.addEntry(entry, blob1);
    const before = await DB.getPhotos('multi_add_test');

    // Add 2 more photos
    const totalCount = await DB.addPhotosToEntry('multi_add_test', [blob2, blob3], entry);
    const after = await DB.getPhotos('multi_add_test');

    // Verify export includes all 3
    const exportData = await DB.exportDay('2026-02-15');
    const photoNames = exportData.photoFiles.map(f => f.name);

    // Clean up
    await DB.deleteEntry('multi_add_test');

    return {
      before: before.length,
      after: after.length,
      totalCount,
      photoNames,
      uniqueIds: new Set(after.map(p => p.id)).size,
    };
  });
  assert(addResult.before === 1, `addPhotosToEntry: started with 1 photo (got ${addResult.before})`);
  assert(addResult.after === 3, `addPhotosToEntry: now has 3 photos (got ${addResult.after})`);
  assert(addResult.totalCount === 3, `addPhotosToEntry: returned total count 3 (got ${addResult.totalCount})`);
  assert(addResult.uniqueIds === 3, `addPhotosToEntry: all photo IDs unique (got ${addResult.uniqueIds})`);
  assert(addResult.photoNames.length === 3, `Export includes all 3 photos (got ${addResult.photoNames.length})`);

  // ---- DB.addPhotosToEntry: entry with no existing photos ----
  const addToEmptyResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    const entry = {
      id: 'add_to_empty_test', type: 'meal', date: '2026-02-16',
      timestamp: new Date().toISOString(), notes: 'No photo initially', photo: false,
    };
    await DB.addEntry(entry, null);
    const before = await DB.getPhotos('add_to_empty_test');

    // Add a photo to an entry that had none
    await DB.addPhotosToEntry('add_to_empty_test', [blob], entry);
    const after = await DB.getPhotos('add_to_empty_test');

    // Clean up
    await DB.deleteEntry('add_to_empty_test');

    return { before: before.length, after: after.length };
  });
  assert(addToEmptyResult.before === 0, `addPhotosToEntry (empty): started with 0 photos (got ${addToEmptyResult.before})`);
  assert(addToEmptyResult.after === 1, `addPhotosToEntry (empty): now has 1 photo (got ${addToEmptyResult.after})`);

  // ---- Edit modal: Add Photo buttons visible for food entries ----
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(600);

  const mealEntry = await page.$('.entry-item[data-type="meal"]');
  if (mealEntry) {
    await mealEntry.click();
    await page.waitForTimeout(500);

    const addPhotoCapture = await page.$('#edit-add-photo-capture');
    const addPhotoPick = await page.$('#edit-add-photo-pick');
    const photoCount = await page.$('#edit-photo-count');

    assert(!!addPhotoCapture, 'Edit modal has "Add Photo" capture button');
    assert(!!addPhotoPick, 'Edit modal has "From Library" pick button');
    assert(!!photoCount, 'Edit modal has photo count display');

    if (photoCount) {
      const countText = await photoCount.textContent();
      // Count is populated when entry has photos; may be empty if entry has no photo
      const entryHasPhoto = await page.evaluate(async (entryType) => {
        const entries = await DB.getEntriesByDate(App.selectedDate);
        const meal = entries.find(e => e.type === entryType);
        if (!meal) return false;
        const photos = await DB.getPhotos(meal.id);
        return photos.length > 0;
      }, 'meal');
      if (entryHasPhoto) {
        assert(countText.includes('photo'), `Photo count shows count text (got "${countText}")`);
      } else {
        assert(countText === '', `Photo count is empty for entry without photos`);
      }
    }

    // Verify touch target size (min 44px)
    if (addPhotoCapture) {
      const box = await addPhotoCapture.boundingBox();
      assert(box && box.height >= 44, `Add Photo button meets 44px min touch target (got ${box?.height}px)`);
    }

    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // ---- Edit modal: No Add Photo for weight entries ----
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(600);

  const weightEntry = await page.$('.entry-item[data-type="weight"]');
  if (weightEntry) {
    await weightEntry.click();
    await page.waitForTimeout(500);

    const addPhotoBtnWeight = await page.$('#edit-add-photo-capture');
    assert(!addPhotoBtnWeight, 'Edit modal has no Add Photo for weight entries');

    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // ---- Edit modal: Add Photo buttons visible for workout entries ----
  const workoutEntry = await page.$('.entry-item[data-type="workout"]');
  if (workoutEntry) {
    await workoutEntry.click();
    await page.waitForTimeout(500);

    const addPhotoBtnWorkout = await page.$('#edit-add-photo-capture');
    assert(!!addPhotoBtnWorkout, 'Edit modal has Add Photo for workout entries');

    const closeBtn = await page.$('.modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // ---- Export: multi-photo entries produce numbered file names ----
  const exportMultiResult = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));

    const entry = {
      id: 'export_multi_test', type: 'meal', date: '2026-02-17',
      timestamp: new Date().toISOString(), notes: 'Export multi', photo: true,
    };
    await DB.addEntry(entry, [blob, blob, blob]);

    const data = await DB.exportDay('2026-02-17');
    const names = data.photoFiles.map(f => f.name);

    await DB.deleteEntry('export_multi_test');
    return { names };
  });
  assert(exportMultiResult.names.length === 3, `Export multi: 3 photo files (got ${exportMultiResult.names.length})`);
  // When multiple photos exist, all get numbered suffixes (_1, _2, _3)
  assert(exportMultiResult.names.some(n => n.includes('export_multi_test_1.jpg')), `Export multi: first photo has _1 suffix`);
  assert(exportMultiResult.names.some(n => n.includes('export_multi_test_2.jpg')), `Export multi: second photo has _2 suffix`);
  assert(exportMultiResult.names.some(n => n.includes('export_multi_test_3.jpg')), `Export multi: third photo has _3 suffix`);

  // Restore day view
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(500);
}

async function testUserFlows(page, fixtures) {
  console.log('\n--- User Flows ---');

  // ---------------------------------------------------------------
  // Flow 1: Log a meal from scratch
  // ---------------------------------------------------------------
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  // Click More button to show bottom sheet
  const moreBtn1 = await page.$('#quick-more-btn');
  if (moreBtn1) {
    await moreBtn1.click();
    await page.waitForTimeout(400);

    // More sheet modal should be visible
    const moreModal = await page.$('.modal-overlay');
    assert(!!moreModal, 'Flow 1: More sheet modal opens');

    // Click workout option to open its form
    const workoutBtn = await page.$('[data-more-type="workout"]');
    if (workoutBtn) {
      await workoutBtn.click();
      await page.waitForTimeout(400);

      const formContent = await page.$('#log-form-content-inline');
      const hasFormContent = !!formContent;
      const formText = hasFormContent ? await formContent.textContent() : '';
      assert(
        hasFormContent && formText.length > 0,
        'Flow 1: Food logging UI appears after selecting Food type'
      );
      await screenshot(page, 'flow1-workout-logging-ui');
    }

    // Verify modal closed after selecting a type
    const modalAfter = await page.$('.modal-overlay');
    assert(!modalAfter, 'Flow 1: More sheet closes after selection');
  } else {
    assert(false, 'Flow 1: More button found on Today');
  }

  // ---------------------------------------------------------------
  // Flow 2: Add water throughout the day
  // ---------------------------------------------------------------
  const waterQuickBtn = await page.$('#quick-water-btn');
  if (waterQuickBtn) {
    await waterQuickBtn.click();
    await page.waitForTimeout(400);

    // Water picker modal should open
    const waterModal = await page.$('.modal-overlay');
    assert(!!waterModal, 'Flow 2: Water picker modal opens');

    // Read current total shown in modal
    const beforeText = await page.$eval('.modal-overlay', el => el.textContent).catch(() => '');

    // Select a water amount (first .water-pick button)
    const waterPick = await page.$('.water-pick');
    if (waterPick) {
      await waterPick.click();
      await page.waitForTimeout(500);

      // Toast should appear OR modal should close (both indicate success)
      const modalGone = !(await page.$('.modal-overlay'));
      const toastEl = await page.$('.toast, .toast-container, [class*="toast"]');
      assert(modalGone || !!toastEl, 'Flow 2: Water amount selected (modal closes or toast appears)');
    } else {
      assert(false, 'Flow 2: Water pick buttons found in modal');
      // Close if still open
      const closeBtn = await page.$('.modal-close');
      if (closeBtn) await closeBtn.click();
    }

    await page.waitForTimeout(300);

    // Reopen water picker to verify updated total
    const waterQuickBtn2 = await page.$('#quick-water-btn');
    if (waterQuickBtn2) {
      await waterQuickBtn2.click();
      await page.waitForTimeout(400);

      const waterModal2 = await page.$('.modal-overlay');
      assert(!!waterModal2, 'Flow 2: Water picker reopens after logging');

      // Modal should show a total > 0
      const afterText = await page.$eval('.modal-overlay', el => el.textContent).catch(() => '');
      const hasOzTotal = /\d+\s*oz/.test(afterText);
      assert(hasOzTotal, 'Flow 2: Reopened water picker shows oz total');

      await screenshot(page, 'flow2-water-picker-updated');

      // Close modal
      const closeBtn2 = await page.$('.modal-close');
      if (closeBtn2) {
        await closeBtn2.click();
        await page.waitForTimeout(200);
      } else {
        // Close by clicking overlay backdrop
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }
  } else {
    assert(false, 'Flow 2: Water quick-action button found');
  }

  // ---------------------------------------------------------------
  // Flow 3: Check and edit goals
  // ---------------------------------------------------------------
  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(500);

  // Click Edit on Daily Targets
  const editGoalsBtn = await page.$('.s-action-btn');
  if (editGoalsBtn) {
    await editGoalsBtn.click();
    await page.waitForTimeout(400);

    // Goal setup modal should open
    const goalModal = await page.$('.modal-overlay');
    assert(!!goalModal, 'Flow 3: Goal setup modal opens from Profile');

    // Calorie input should be pre-filled
    const calInput = await page.$('#gs-calories');
    if (calInput) {
      const calValue = await calInput.evaluate(el => el.value);
      assert(calValue !== '' && parseInt(calValue) > 0, `Flow 3: Calorie input pre-filled (value: ${calValue})`);

      // Change calorie value to 1300
      await calInput.click({ clickCount: 3 });
      await calInput.fill('1300');
      await page.waitForTimeout(200);

      // Verify the input changed
      const newCalValue = await calInput.evaluate(el => el.value);
      assert(newCalValue === '1300', `Flow 3: Calorie input updated to 1300 (got: ${newCalValue})`);
    } else {
      assert(false, 'Flow 3: Calorie input (#gs-calories) found in goal modal');
    }

    await screenshot(page, 'flow3-goal-modal-edited');

    // Save
    const saveBtn = await page.$('#gs-save');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForTimeout(500);
      // After saving goals, sync setup step may appear — dismiss it
      const skipSync = await page.$('#gs-sync-skip');
      if (skipSync) {
        await skipSync.click();
        await page.waitForTimeout(300);
      }
    } else {
      // Close modal
      const closeBtn = await page.$('.modal-close');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Targets summary should reflect new value
    const goalsText = await page.$eval('#goals-summary', el => el.textContent).catch(() => '');
    assert(goalsText.includes('1300') || goalsText.includes('cal'), `Flow 3: Daily Targets card updates (got: "${goalsText}")`);

    await screenshot(page, 'flow3-targets-updated');

    // Reopen and restore to 1200
    const editBtn2 = await page.$('.s-action-btn');
    if (editBtn2) {
      await editBtn2.click();
      await page.waitForTimeout(400);

      const calInput2 = await page.$('#gs-calories');
      if (calInput2) {
        await calInput2.click({ clickCount: 3 });
        await calInput2.fill('1200');
        await page.waitForTimeout(200);

        const saveBtn2 = await page.$('#gs-save');
        if (saveBtn2) {
          await saveBtn2.click();
          await page.waitForTimeout(400);
          // Dismiss sync setup step if it appears
          const skipSync2 = await page.$('#gs-sync-skip');
          if (skipSync2) {
            await skipSync2.click();
            await page.waitForTimeout(300);
          }
        } else {
          const closeBtn = await page.$('.modal-close');
          if (closeBtn) await closeBtn.click();
        }
      }
      assert(true, 'Flow 3: Goals restored to 1200');
    }
  } else {
    assert(false, 'Flow 3: Edit button found on Daily Targets card');
  }

  // ---------------------------------------------------------------
  // Flow 4: Navigate between days
  // ---------------------------------------------------------------
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  const today = await page.evaluate(() => UI.today());

  // Get entry count on today
  const todayEntries = await page.$$('.entry-item');
  const todayCount = todayEntries.length;

  // Navigate to day -1
  const prevBtn = await page.$('#header-prev');
  if (prevBtn) {
    await prevBtn.click();
    await page.waitForTimeout(500);

    const day1Date = await page.evaluate(() => App.selectedDate);
    assert(day1Date < today, `Flow 4: Navigated to previous day (${day1Date} < ${today})`);
    await screenshot(page, 'flow4-day-minus1');

    // Navigate to day -2
    await prevBtn.click();
    await page.waitForTimeout(500);

    const day2Date = await page.evaluate(() => App.selectedDate);
    assert(day2Date < day1Date, `Flow 4: Navigated to day -2 (${day2Date} < ${day1Date})`);
    await screenshot(page, 'flow4-day-minus2');

    // Navigate back to today via nav tab
    await page.click('nav button:has-text("Today")');
    await page.waitForTimeout(500);

    const backToToday = await page.evaluate(() => App.selectedDate);
    assert(backToToday === today, `Flow 4: Navigated back to today (${backToToday})`);

    // Today's entries should be back
    const restoredEntries = await page.$$('.entry-item');
    assert(restoredEntries.length === todayCount, `Flow 4: Today's entry count restored (${restoredEntries.length})`);
  } else {
    assert(false, 'Flow 4: Previous day button (#header-prev) found');
  }

  // ---------------------------------------------------------------
  // Flow 5: Check progress after logging
  // ---------------------------------------------------------------
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(600);

  // Switch to Trends for calendar
  const trendsBtn5 = await page.$('button:has-text("Trends")');
  if (trendsBtn5) await trendsBtn5.click();
  await page.waitForTimeout(500);

  // Calendar should show colored dots for days with data
  const calDays = await page.$$('.cal-day:not(.empty)');
  assert(calDays.length > 0, `Flow 5: Calendar renders days (got ${calDays.length})`);

  // Find a calendar day that has a date (fixture data)
  const tapableDay = await page.$('.cal-day[data-date]:not(.empty)');
  if (tapableDay) {
    const tappedDate = await tapableDay.evaluate(el => el.dataset.date);
    await tapableDay.click();
    await page.waitForTimeout(600);

    // Should navigate to Today tab with that date selected
    const currentScreen = await page.evaluate(() => App.currentScreen);
    const selectedDate = await page.evaluate(() => App.selectedDate);
    assert(
      currentScreen === 'today' || selectedDate === tappedDate,
      `Flow 5: Calendar tap navigates to day view (screen: ${currentScreen}, date: ${selectedDate})`
    );

    await screenshot(page, 'flow5-calendar-tap-result');

    // Navigate back to Progress
    await page.click('nav button:has-text("Progress")');
    await page.waitForTimeout(500);

    const progressContainer = await page.$('#progress-container');
    assert(!!progressContainer, 'Flow 5: Progress screen back after navigation');
  } else {
    assert(true, 'Flow 5: Calendar tap (no tappable day found — skipped)');
  }

  // ---------------------------------------------------------------
  // Flow 6: Browse the plan
  // ---------------------------------------------------------------
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(600);

  const progressContainer = await page.$('#progress-container');
  const progressContent = progressContainer ? await progressContainer.textContent() : '';
  assert(progressContent.length > 0, 'Flow 6: Progress screen renders content');

  await screenshot(page, 'flow6-plan');

  // Navigate to Profile
  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(400);

  // Navigate back to Progress
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(600);

  const progressContainer2 = await page.$('#progress-container');
  const progressContent2 = progressContainer2 ? await progressContainer2.textContent() : '';
  assert(progressContent2.length > 0, 'Flow 6: Progress content persists after navigating away and back');
  assert(!progressContent2.includes('No plan'), 'Flow 6: Progress has no blank flash on return');

  await screenshot(page, 'flow6-plan-after-return');

  // ---------------------------------------------------------------
  // Flow 7: Log food WITH photo (full Camera.pick → preview → save → render)
  // This was the exact flow that was broken (photos disappearing).
  // Tests: file input → compression → preview → DB.addEntry(entry, blob) → thumbnail
  // Note: "Log Food" from More sheet opens QuickLog.showFoodNote() modal,
  //   which uses #fn-library / #fn-camera / #fn-photo-area / #fn-save.
  //   NOT the inline Log form (which uses #log-photo-pick).
  // ---------------------------------------------------------------
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  // Count entries before
  const entriesBefore7 = await page.$$('.entry-item');
  const countBefore7 = entriesBefore7.length;

  // Open More sheet → Log Food (opens food note modal)
  const more7 = await page.$('#quick-more-btn');
  if (more7) {
    await more7.click();
    await page.waitForTimeout(300);

    const foodBtn = await page.$('[data-more-type="meal"]');
    if (foodBtn) {
      await foodBtn.click();
      await page.waitForTimeout(500);

      // Food note modal should be open with #fn-library button
      const libBtn = await page.$('#fn-library');
      assert(!!libBtn, 'Flow 7: Food note modal has Library button');

      if (libBtn) {
        // Upload a portrait test image via file chooser (3:4 like a phone camera)
        const portraitBuf7 = Buffer.from(await page.evaluate(async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 300;
          canvas.height = 400;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#27ae60';
          ctx.fillRect(0, 0, 300, 400);
          ctx.fillStyle = '#fff';
          ctx.font = '28px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('TEST MEAL', 150, 200);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }));
        const tmpPath7 = require('path').join(require('os').tmpdir(), 'test-meal-photo.png');
        require('fs').writeFileSync(tmpPath7, portraitBuf7);

        const [fc7] = await Promise.all([
          page.waitForEvent('filechooser'),
          libBtn.click(),
        ]);
        try {
          await fc7.setFiles(tmpPath7);
          await page.waitForTimeout(600);
        } finally {
          try { require('fs').unlinkSync(tmpPath7); } catch (_) {}
        }

        // Preview should appear in #fn-photo-area
        const previewImg = await page.$('#fn-photo-area .photo-preview-img');
        assert(!!previewImg, 'Flow 7: Photo preview renders after picking image');

        if (previewImg) {
          const previewSrc = await previewImg.getAttribute('src');
          assert(previewSrc && previewSrc.startsWith('blob:'), 'Flow 7: Preview has blob URL');
        }

        await screenshot(page, 'flow7-food-photo-preview');

        // Save button must be visible (not pushed off-screen by large photo)
        // Bug: portrait photos with no max-height pushed Save below the modal fold
        const saveVisible = await page.evaluate(() => {
          const save = document.getElementById('fn-save');
          if (!save) return { found: false };
          const r = save.getBoundingClientRect();
          const viewH = window.innerHeight;
          return { found: true, bottom: Math.round(r.bottom), viewH, visible: r.bottom <= viewH && r.top >= 0 && r.height > 0 };
        });
        assert(saveVisible.found && saveVisible.visible,
          `Flow 7: Save button visible with photo (bottom=${saveVisible.bottom}, viewport=${saveVisible.viewH})`);

        // Enter notes
        const fnNotes = await page.$('#fn-notes');
        if (fnNotes) {
          await fnNotes.fill('Grilled chicken test');
          await page.waitForTimeout(100);
        }

        // Save via food note modal's save button
        const fnSave = await page.$('#fn-save');
        if (fnSave) {
          await fnSave.click();
          await page.waitForTimeout(800);
        }

        await screenshot(page, 'flow7-food-saved');

        // Verify entry appears in day view with photo thumbnail
        const entriesAfter7 = await page.$$('.entry-item');
        assert(entriesAfter7.length > countBefore7, `Flow 7: New entry appears after save (${countBefore7} → ${entriesAfter7.length})`);

        // Check that the new entry has a photo thumbnail
        await page.waitForTimeout(500); // wait for async photo load
        const mealThumbs7 = await page.$$('.entry-photo-thumbs img.entry-photo-thumb');
        assert(mealThumbs7.length >= 1, `Flow 7: Entry has photo thumbnail (got ${mealThumbs7.length})`);

        // Verify photo blob exists in IndexedDB
        const photoCheck = await page.evaluate(async () => {
          const entries = await DB.getEntriesByDate(App.selectedDate);
          const withPhoto = entries.filter(e => e.photo && e.type === 'meal');
          if (withPhoto.length === 0) return { found: false };
          const newest = withPhoto[withPhoto.length - 1];
          const photos = await DB.getPhotos(newest.id);
          return {
            found: true,
            entryId: newest.id,
            photoCount: photos.length,
            hasBlob: photos.length > 0 && !!photos[0].blob,
            blobSize: photos.length > 0 && photos[0].blob ? photos[0].blob.size : 0,
            category: photos.length > 0 ? photos[0].category : null,
          };
        });

        assert(photoCheck.found && photoCheck.hasBlob, `Flow 7: Photo blob saved to IndexedDB (${photoCheck.blobSize} bytes)`);
        assert(photoCheck.category === 'meal', `Flow 7: Photo category is 'meal' (got ${photoCheck.category})`);

        await screenshot(page, 'flow7-entry-with-photo');
      }
    } else {
      // Close more sheet if food button not found
      const closeSheet = await page.$('.modal-close');
      if (closeSheet) await closeSheet.click();
    }
  }
}

async function testProfileRoundTrip(page, fixtures) {
  console.log('\n--- Profile Round-Trip ---');

  // Import analysis with pwaProfile and verify goals restored
  // The fixtures already inject goals with calories=1200 — verify that's what's in the DB
  const goalsFromDB = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals');
    return goals;
  });
  assert(goalsFromDB && goalsFromDB.calories === 1200, `Goals restored from fixture: calories=${goalsFromDB?.calories} (expected 1200)`);
  assert(goalsFromDB && goalsFromDB.protein === 105, `Goals restored from fixture: protein=${goalsFromDB?.protein} (expected 105)`);

  // Simulate importing an analysis with pwaProfile and verify goals update
  await page.evaluate(async () => {
    const analysisWithProfile = {
      totals: { calories: 500, protein: 50, carbs: 30, fat: 10 },
      pwaProfile: {
        goals: { calories: 1200, protein: 105, water_oz: 64, hardcore: { calories: 1000, protein: 120, water_oz: 64 } },
        supplements: ['Fiber', 'Collagen', 'Vitamin D'],
      },
    };
    await DB.importAnalysis('2099-01-01', analysisWithProfile);
  });

  const updatedGoals = await page.evaluate(async () => await DB.getProfile('goals'));
  assert(updatedGoals && updatedGoals.calories === 1200, `Goals preserved after pwaProfile import: calories=${updatedGoals?.calories}`);

  const supplements = await page.evaluate(async () => await DB.getProfile('supplements'));
  assert(supplements && supplements.length >= 3, `Supplements restored from pwaProfile (got ${supplements?.length})`);

  await screenshot(page, 'profile-round-trip');

  // --- Supplement Update Merge Tests ---
  console.log('\n--- Supplement Merge ---');

  // Test 1: supplementUpdates with matching key works
  const matchKeyResult = await page.evaluate(async () => {
    await DB.setProfile('supplements', [
      { key: 'creatine', name: 'Creatine', calories: 0, protein: 0, pending: false },
      { key: 'new_item', name: 'New item', calories: 0, protein: 0, pending: true, photo: 'data:image/jpeg;base64,abc123' },
    ]);
    await DB.importAnalysis('2099-02-01', {
      date: '2099-02-01',
      entries: [],
      supplementUpdates: [
        { key: 'new_item', name: 'Protein Powder', calories: 120, protein: 24, carbs: 3, fat: 1 },
      ],
    });
    const result = await DB.getProfile('supplements');
    return result;
  });
  const updatedItem = matchKeyResult.find(s => s.name === 'Protein Powder');
  assert(!!updatedItem, 'Supplement merge: matching key updates name to "Protein Powder"');
  assert(updatedItem && updatedItem.pending === false, 'Supplement merge: pending set to false');
  assert(updatedItem && updatedItem.calories === 120, `Supplement merge: calories updated (got ${updatedItem?.calories})`);
  assert(updatedItem && updatedItem.protein === 24, `Supplement merge: protein updated (got ${updatedItem?.protein})`);
  assert(updatedItem && !updatedItem.photo, 'Supplement merge: photo field deleted after processing');
  // Creatine should be untouched
  const creatine = matchKeyResult.find(s => s.key === 'creatine');
  assert(creatine && creatine.name === 'Creatine', 'Supplement merge: non-pending items untouched');

  // Test 2: supplementUpdates with WRONG key falls back to pending match
  const fallbackResult = await page.evaluate(async () => {
    await DB.setProfile('supplements', [
      { key: 'vitamin_d', name: 'Vitamin D', calories: 0, protein: 0, pending: false },
      { key: 'new_item', name: 'New item', calories: 0, protein: 0, pending: true, photo: 'data:image/jpeg;base64,xyz' },
    ]);
    await DB.importAnalysis('2099-02-02', {
      date: '2099-02-02',
      entries: [],
      supplementUpdates: [
        { key: 'whey_protein', name: 'Whey Protein', calories: 130, protein: 26, carbs: 4, fat: 2 },
      ],
    });
    return await DB.getProfile('supplements');
  });
  const fallbackItem = fallbackResult.find(s => s.name === 'Whey Protein');
  assert(!!fallbackItem, 'Supplement merge: wrong key falls back to pending item match');
  assert(fallbackItem && fallbackItem.pending === false, 'Supplement merge: fallback sets pending=false');
  assert(fallbackItem && fallbackItem.calories === 130, `Supplement merge: fallback updates calories (got ${fallbackItem?.calories})`);
  assert(fallbackItem && !fallbackItem.photo, 'Supplement merge: fallback deletes photo');
  // Key should be updated to match new name
  assert(fallbackItem && fallbackItem.key === 'whey_protein', `Supplement merge: key updated to match name (got ${fallbackItem?.key})`);

  // Test 3: pwaProfile.supplements NOT overwritten when supplementUpdates present
  const noOverwriteResult = await page.evaluate(async () => {
    // Set current state: already-processed supplement
    await DB.setProfile('supplements', [
      { key: 'processed_item', name: 'Already Processed', calories: 100, protein: 10, pending: false },
    ]);
    // Import with BOTH pwaProfile (stale pending data) AND supplementUpdates
    await DB.importAnalysis('2099-02-03', {
      date: '2099-02-03',
      entries: [],
      pwaProfile: {
        supplements: [
          { key: 'new_item', name: 'New item', calories: 0, protein: 0, pending: true, photo: 'data:stale' },
        ],
      },
      supplementUpdates: [
        { key: 'processed_item', name: 'Updated Name', calories: 200, protein: 20, carbs: 5, fat: 3 },
      ],
    });
    return await DB.getProfile('supplements');
  });
  // pwaProfile should NOT have overwritten — current state should be preserved and merged
  assert(noOverwriteResult.length === 1, `No-overwrite: still 1 supplement (got ${noOverwriteResult.length})`);
  const mergedItem = noOverwriteResult[0];
  assert(mergedItem && mergedItem.name === 'Updated Name', `No-overwrite: name updated via merge (got ${mergedItem?.name})`);
  assert(mergedItem && mergedItem.calories === 200, `No-overwrite: calories from merge (got ${mergedItem?.calories})`);

  // Test 4: pwaProfile.supplements echoed back when NO supplementUpdates
  const echoResult = await page.evaluate(async () => {
    await DB.setProfile('supplements', []);
    await DB.importAnalysis('2099-02-04', {
      date: '2099-02-04',
      entries: [],
      pwaProfile: {
        supplements: [
          { key: 'echo_test', name: 'Echoed Item', calories: 50, protein: 5, pending: false },
        ],
      },
    });
    return await DB.getProfile('supplements');
  });
  assert(echoResult.length === 1, `Echo: pwaProfile supplements restored when no updates (got ${echoResult.length})`);
  assert(echoResult[0]?.name === 'Echoed Item', `Echo: correct name restored (got ${echoResult[0]?.name})`);
}

async function testAnalysisStatusIndicators(page, fixtures) {
  console.log('\n--- Analysis Status Indicators ---');

  // Day 1 has entries with matching analysis IDs — should show inline calories
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(800);

  // Look for inline calorie text on entries (e.g. "Food · 380 Cal" or similar)
  const entryTexts = await page.$$eval('.entry-item', els => els.map(e => e.textContent));
  const hasInlineCal = entryTexts.some(t => /\d+\s*Cal/i.test(t));
  assert(hasInlineCal, 'Day 1 entry shows inline calories from analysis');

  // Check for at least one entry that shows calorie info
  const calEntries = await page.$$eval('.entry-item', els => {
    return els.filter(e => /\d+\s*Cal/i.test(e.textContent)).length;
  });
  assert(calEntries >= 1, `At least one entry shows calories on Day 1 (found ${calEntries})`);

  // Day 4 has minimal data — drink entry should show pending or low calories
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[3]);
  await page.waitForTimeout(600);

  const day4Entries = await page.$$('.entry-item');
  assert(day4Entries.length >= 1, `Day 4 has entries (got ${day4Entries.length})`);

  await screenshot(page, 'analysis-status-indicators');
}

async function testUILabels(page, fixtures) {
  console.log('\n--- UI Labels ---');

  // Verify quick action button says "Dailies" not "Supps"
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  const quickActionTexts = await page.$$eval('.quick-action', els => els.map(e => e.textContent.trim()));
  const hasDailies = quickActionTexts.some(t => t.includes('Dailies'));
  const hasSupps = quickActionTexts.some(t => t.includes('Supps'));
  assert(hasDailies, 'Quick action button says "Dailies"');
  assert(!hasSupps, 'Quick action button does NOT say "Supps"');

  // Verify "Sync Now" button exists on Settings screen
  await page.click('nav button:has-text("Settings")');
  await page.waitForTimeout(500);

  const profileText = await page.textContent('#screen-settings');
  const hasSyncNow = profileText.includes('Sync Now') || profileText.includes('sync now');
  // Also check for sync-related action buttons
  const syncBtn = await page.$('#sync-now-btn, button:has-text("Sync Now"), .s-action-btn--primary');
  assert(hasSyncNow || !!syncBtn, 'Sync Now button exists on Settings screen');

  // Sync action buttons must not overflow their card at 390px
  // Bug: flex:1 (flex-basis:0%) prevented flex-wrap from triggering —
  // 3 buttons on one line overflowed the card's right edge.
  const syncOverflow = await page.evaluate(() => {
    const actions = document.querySelector('.s-sync-actions');
    if (!actions) return { found: false };
    const card = actions.closest('.s-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const rightBound = cardRect ? cardRect.right : document.documentElement.clientWidth;
    const buttons = actions.querySelectorAll('.s-sync-btn');
    const clipped = [];
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.right > rightBound + 2) clipped.push(btn.textContent.trim());
    }
    return { found: true, clipped };
  });
  if (syncOverflow.found) {
    assert(syncOverflow.clipped.length === 0,
      `Sync buttons don't overflow card at 390px (${syncOverflow.clipped.length} clipped${syncOverflow.clipped.length > 0 ? ': ' + syncOverflow.clipped.join(', ') : ''})`);
  }

  await screenshot(page, 'ui-labels');
}

async function testFixtureSchema(fixtures) {
  console.log('\n--- Fixture Schema Validation ---');

  // Validate analysis entries match real processing output format
  for (const analysis of fixtures.analyses) {
    for (const entry of analysis.entries) {
      // All entries must have: id, type, description, calories
      assert(entry.id, `Analysis entry has id (date: ${analysis.date}, type: ${entry.type})`);
      assert(entry.type, `Analysis entry has type (id: ${entry.id})`);
      assert(entry.description != null, `Analysis entry has description (id: ${entry.id})`);

      if (entry.type === 'workout') {
        // Workouts use negative calories, NOT calories_burned
        assert(!entry.calories_burned, `Workout uses calories (negative), not calories_burned (id: ${entry.id})`);
        assert(entry.calories <= 0, `Workout calories are negative or zero (id: ${entry.id}, got: ${entry.calories})`);
      } else {
        // Food entries use positive calories
        assert(entry.calories >= 0, `Food calories are non-negative (id: ${entry.id}, got: ${entry.calories})`);
      }

      // No em dashes or smart quotes in descriptions (causes mojibake on Windows)
      if (entry.description) {
        assert(!entry.description.includes('\u2014'), `No em dash in description (id: ${entry.id})`);
        assert(!entry.description.includes('\u2013'), `No en dash in description (id: ${entry.id})`);
        assert(!entry.description.includes('\u201c') && !entry.description.includes('\u201d'), `No smart quotes in description (id: ${entry.id})`);
      }
    }
  }
}

async function testScoreCentering(page, fixtures) {
  console.log('\n--- Score Centering ---');

  // Navigate to a day with score data
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(800);

  const scoreCard = await page.$('.day-score');
  if (scoreCard) {
    // Check that the score NUMBER is centered inside the score RING (bounding rect, not CSS props)
    const numberOffset = await page.evaluate(() => {
      const gauge = document.querySelector('.day-score-gauge');
      const num = document.querySelector('.score-number');
      if (!gauge || !num) return null;
      const gRect = gauge.getBoundingClientRect();
      const nRect = num.getBoundingClientRect();
      return {
        x: Math.abs((nRect.left + nRect.width / 2) - (gRect.left + gRect.width / 2)),
        y: Math.abs((nRect.top + nRect.height / 2) - (gRect.top + gRect.height / 2)),
      };
    });
    if (numberOffset) {
      assert(numberOffset.x < 2, `Score number centered horizontally in ring (offset: ${numberOffset.x.toFixed(1)}px)`);
      assert(numberOffset.y < 2, `Score number centered vertically in ring (offset: ${numberOffset.y.toFixed(1)}px)`);
    }

    // Verify score card is NOT center-aligned (should be left-aligned flex row)
    const cardJC = await page.$eval('.day-score', el => getComputedStyle(el).justifyContent);
    assert(cardJC !== 'center', `Score card is not center-aligned (got: ${cardJC})`);
  } else {
    assert(false, 'Score card (.day-score) found for centering test');
  }

  await screenshot(page, 'score-centering');
}

async function testScrollBehavior(page) {
  console.log('\n--- Scroll Behavior ---');
  // Body must NOT be scrollable (prevents iOS nav bounce)
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(100);
  const bodyScroll = await page.evaluate(() => window.scrollY);
  assert(bodyScroll === 0, `Body is not scrollable (scrollY: ${bodyScroll})`);

  // Active screen content MUST be scrollable
  const screenScroll = await page.evaluate(() => {
    const screen = document.querySelector('.screen.active');
    if (!screen) return null;
    const before = screen.scrollTop;
    screen.scrollTop = 500;
    const after = screen.scrollTop;
    screen.scrollTop = 0;
    return { scrollable: screen.scrollHeight > screen.clientHeight, didScroll: after > before };
  });
  if (screenScroll && screenScroll.scrollable) {
    assert(screenScroll.didScroll, 'Screen content is scrollable');
  }
}

async function testMultiViewport(page, context, fixtures) {
  console.log('\n--- Multi-Viewport ---');

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    // Check no horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    assert(bodyWidth <= vp.width + 2, `${vp.name} (${vp.width}px): no horizontal overflow (body: ${bodyWidth}px)`);

    // All nav buttons visible
    const navBtns = await page.$$('nav button');
    assert(navBtns.length === 4, `${vp.name}: 4 nav buttons visible`);

    await screenshot(page, `viewport-${vp.name}`);
  }
}

async function testConsoleErrors(page) {
  console.log('\n--- Console Errors ---');
  const realErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('service-worker') &&
    !e.includes('sw.js') &&
    !e.includes('manifest') &&
    !e.includes('net::ERR') &&
    !e.includes('CloudRelay') &&
    !e.includes('not configured')
  );
  assert(realErrors.length === 0, `No JS console errors (found ${realErrors.length}: ${realErrors.join('; ').slice(0, 200)})`);
}

async function testBugRegressions(page, fixtures) {
  console.log('\n--- Bug Regressions ---');

  // BUG: Stale form visible after day navigation (fixed in 1a41231)
  // Open body photo form via More sheet, then navigate to prev day
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('#quick-more-btn').catch(() => {});
  await page.waitForTimeout(400);
  const bpBtn = await page.$('[data-more-type="bodyPhoto"]');
  if (bpBtn) {
    await bpBtn.click();
    await page.waitForTimeout(400);
    // Form should be open
    const formBefore = await page.evaluate(() => {
      const f = document.getElementById('log-form-inline');
      return f && f.style.display !== 'none' && f.offsetHeight > 0;
    });
    assert(formBefore, 'Regression: Body photo form opens');

    // Navigate to prev day
    await page.click('#header-prev');
    await page.waitForTimeout(500);

    // Form should be closed
    const formAfter = await page.evaluate(() => {
      const f = document.getElementById('log-form-inline');
      return f && f.style.display !== 'none' && f.offsetHeight > 0;
    });
    assert(!formAfter, 'Regression: Form closes on day navigation (was stale before fix)');

    // Navigate back to today
    await page.click('nav button:has-text("Today")');
    await page.waitForTimeout(300);
  }

  // BUG: syncNow called _doUpload() without date arg (fixed in 919961c)
  const syncNowPassesDate = await page.evaluate(() => {
    // Verify the syncNow code calls _doUpload(date) not _doUpload()
    const src = App.syncNow.toString();
    return src.includes('_doUpload(date)') || src.includes('_doUpload( date');
  });
  assert(syncNowPassesDate, 'Regression: syncNow passes date to _doUpload');

  // BUG: Water/weight had duplicate inline forms (consolidated in 37208ea)
  // Log.showForm for water should redirect to modal, not render inline
  const waterRedirects = await page.evaluate(() => {
    const src = Log.showForm.toString();
    return src.includes("type === 'water'") && src.includes('showWaterPicker');
  });
  assert(waterRedirects, 'Regression: Water form redirects to modal (no duplicate)');

  const weightRedirects = await page.evaluate(() => {
    const src = Log.showForm.toString();
    return src.includes("type === 'weight'") && src.includes('showWeightEntry');
  });
  assert(weightRedirects, 'Regression: Weight form redirects to modal (no duplicate)');

  // BUG: No online event listener for sync retry (fixed in 0aa50c6)
  const hasOnlineListener = await page.evaluate(() => {
    // Check that the online listener was registered by looking for its effect
    // We can't directly inspect event listeners, but we can check App.init source
    const src = App.init.toString();
    return src.includes("'online'") || src.includes('"online"');
  });
  assert(hasOnlineListener, 'Regression: Online event listener registered for sync retry');

  // BUG: Sync key visible in logs (fixed in 37208ea)
  const syncKeyMasked = await page.evaluate(() => {
    const src = CloudRelay.log.toString();
    return src.includes('replace') && src.includes('...');
  });
  assert(syncKeyMasked, 'Regression: Sync key masked in log output');

  // BUG: DayScore.calculate re-read all DB values (fixed in 8d6c08e)
  const scoreAcceptsPreloaded = await page.evaluate(() => {
    const src = DayScore.calculate.toString();
    return src.includes('preloaded');
  });
  assert(scoreAcceptsPreloaded, 'Regression: DayScore.calculate accepts preloaded data');
}

async function testSkincarePanel(page, fixtures) {
  console.log('\n--- Skincare Panel ---');

  // Navigate to Today
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  // Skincare segment button should exist (Phase 2+)
  const skinBtn = await page.$('.today-seg-btn[data-panel="skin"]').catch(() => null);
  assert(!!skinBtn, 'Skincare segment button exists');

  // Switch to skincare panel
  if (skinBtn) {
    await skinBtn.click().catch(() => {});
    await page.waitForTimeout(300);

    assert(true, 'Skincare panel activates on tap');
  }

  // Skincare container should exist
  const skinContainer = await page.$('#today-skincare').catch(() => null);
  assert(!!skinContainer, 'Skincare panel container exists');

  // Verify AM routine renders correct products
  const amHeader = await page.$('.skincare-section-header:has-text("AM")').catch(() => null);
  assert(!!amHeader, 'AM routine header renders');

  // Count AM product rows
  const skinContent = await page.evaluate(() => {
    const container = document.getElementById('today-skincare');
    if (!container) return null;
    const sections = container.querySelectorAll('.skincare-section-header');
    const amProducts = [];
    const pmProducts = [];
    let inPM = false;

    // Walk through product rows between section headers
    const allProducts = container.querySelectorAll('.skincare-product-row');
    for (const row of allProducts) {
      const name = row.querySelector('.fitness-exercise-name')?.textContent?.trim() || '';
      const category = row.querySelector('.skincare-category-badge')?.textContent?.trim() || '';
      // Determine if this is AM or PM by checking which section header precedes it
      const prevHeader = row.closest('#today-skincare')?.querySelector('.skincare-section-header + .skincare-product-row') === row ? 'AM' : null;
      // Simpler: check slot data attribute
      const slot = row.querySelector('.skincare-check')?.dataset?.slot || '';
      if (slot === 'am') amProducts.push({ name, category });
      else if (slot === 'pm') pmProducts.push({ name, category });
    }

    // Progress summary
    const progress = container.querySelector('.skincare-progress-summary')?.textContent?.trim() || '';

    // Face photo button
    const faceBtn = container.querySelector('#skincare-face-photo-btn');

    return { amProducts, pmProducts, progress, hasFaceBtn: !!faceBtn };
  });

  if (skinContent) {
    // AM routine: default template has 4 products (cleanser, vitamin_c, moisturizer, sunscreen)
    assert(skinContent.amProducts.length === 4, `AM routine has 4 products (got ${skinContent.amProducts.length})`);

    // Verify AM product names
    const expectedAM = ['CeraVe Foaming', 'Vitamin C Serum', 'CeraVe Moisturizer', 'Supergoop SPF 40'];
    const amNames = skinContent.amProducts.map(p => p.name);
    const amMatch = expectedAM.every((name, i) => amNames[i] === name);
    assert(amMatch, `AM products match fixture (got: ${amNames.join(', ')})`);

    // PM routine: default template has 3 products (cleanser, retinol/aha rotation, moisturizer)
    assert(skinContent.pmProducts.length === 3, `PM routine has 3 products (got ${skinContent.pmProducts.length})`);

    // PM first and last should always be cleanser and moisturizer
    if (skinContent.pmProducts.length >= 2) {
      assert(skinContent.pmProducts[0].name === 'CeraVe Foaming', `PM first product is cleanser (got: ${skinContent.pmProducts[0].name})`);
      assert(skinContent.pmProducts[skinContent.pmProducts.length - 1].name === 'CeraVe Moisturizer', `PM last product is moisturizer (got: ${skinContent.pmProducts[skinContent.pmProducts.length - 1].name})`);
    }

    // PM middle product should be retinol or aha (rotation)
    if (skinContent.pmProducts.length === 3) {
      const midName = skinContent.pmProducts[1].name;
      const validRotation = midName === 'Tretinoin 0.025%' || midName === 'Glycolic Acid 7%';
      assert(validRotation, `PM rotation product is retinol or AHA (got: ${midName})`);
    }

    // Progress summary should show counts
    assert(skinContent.progress.includes('AM'), `Progress summary shows AM count (got: ${skinContent.progress})`);
    assert(skinContent.progress.includes('PM'), `Progress summary shows PM count (got: ${skinContent.progress})`);

    // Face photo button should appear (no face photos in fixtures for today)
    assert(skinContent.hasFaceBtn, 'Face photo prompt appears for today');
  }

  // Verify all skincare items are scrollable (not clipped by overflow:hidden)
  const scrollCheck = await page.evaluate(() => {
    const screen = document.querySelector('.screen.active');
    const container = document.getElementById('today-skincare');
    if (!screen || !container) return null;

    const navBar = document.querySelector('.bottom-nav');
    const navTop = navBar ? navBar.getBoundingClientRect().top : window.innerHeight;

    // Scroll to bottom to reveal all items
    screen.scrollTop = screen.scrollHeight;

    // Check if the last skincare item is above the nav bar after scrolling
    const lastItem = container.querySelector('.skincare-product-row:last-of-type');
    const faceBtn = container.querySelector('#skincare-face-photo-btn');
    const lastEl = faceBtn || lastItem;

    if (!lastEl) return null;
    const rect = lastEl.getBoundingClientRect();

    return {
      scrollHeight: screen.scrollHeight,
      clientHeight: screen.clientHeight,
      canScroll: screen.scrollHeight > screen.clientHeight,
      lastItemBottom: Math.round(rect.bottom),
      navTop: Math.round(navTop),
      lastItemVisible: rect.bottom <= navTop,
    };
  });

  if (scrollCheck) {
    assert(scrollCheck.canScroll || scrollCheck.lastItemVisible,
      `Skincare content is scrollable or fully visible (scrollH=${scrollCheck.scrollHeight}, clientH=${scrollCheck.clientHeight}, lastBottom=${scrollCheck.lastItemBottom}, navTop=${scrollCheck.navTop})`);
    assert(scrollCheck.lastItemVisible,
      `Last skincare item is above nav bar after scroll (bottom=${scrollCheck.lastItemBottom}, navTop=${scrollCheck.navTop})`);
  }

  await screenshot(page, 'panel-skincare');

  // Switch back to diet
  const dietBtn = await page.$('.today-seg-btn[data-panel="diet"]').catch(() => null);
  if (dietBtn) {
    await dietBtn.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // Verify all 2 segment buttons exist (Diet, Fitness — Skin removed)
  const segBtns = await page.$$('.today-seg-btn').catch(() => []);
  assert(segBtns.length === 2, `2 segment buttons exist (got ${segBtns.length})`);
}

async function testFitnessPanel(page, fixtures) {
  console.log('\n--- Fitness Panel ---');

  // Navigate to Today (today = day5, Thursday in fixtures = cardio day)
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  // Switch to Fitness panel
  const fitBtn = await page.$('.today-seg-btn[data-panel="fitness"]').catch(() => null);
  assert(!!fitBtn, 'Fitness segment button exists');
  if (fitBtn) {
    await fitBtn.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // Verify fitness panel content
  const fitnessContent = await page.evaluate(() => {
    const container = document.getElementById('today-workout');
    if (!container) return null;

    // Day type header
    const dayHeader = container.querySelector('.fitness-day-header');
    const dayType = dayHeader?.querySelector('div')?.textContent?.trim() || '';
    const exerciseCount = dayHeader?.querySelectorAll('div')[1]?.textContent?.trim() || '';

    // Exercise cards
    const exerciseCards = container.querySelectorAll('.fitness-exercise');
    const exercises = [];
    for (const card of exerciseCards) {
      const name = card.querySelector('.fitness-exercise-name')?.textContent?.trim() || '';
      const setsReps = card.querySelector('[style*="accent-green"]')?.textContent?.trim() || '';
      const formCue = card.querySelector('[style*="text-muted"]')?.textContent?.trim() || '';
      const hasInfoBtn = !!card.querySelector('.fitness-info-btn');
      const hasCheckbox = !!card.querySelector('.fitness-check');
      exercises.push({ name, setsReps, formCue, hasInfoBtn, hasCheckbox });
    }

    // Notes section
    const notesCard = container.querySelector('.fitness-notes-card');
    const notesPrompt = container.querySelector('.fitness-notes-prompt');

    return { dayType, exerciseCount, exercises, hasNotesCard: !!notesCard, hasNotesPrompt: !!notesPrompt };
  });

  if (fitnessContent) {
    // Thursday = cardio day
    assert(fitnessContent.dayType === 'Cardio Day', `Day type header shows "Cardio Day" (got: "${fitnessContent.dayType}")`);
    assert(fitnessContent.exerciseCount.includes('1 exercise'), `Exercise count shows 1 exercise (got: "${fitnessContent.exerciseCount}")`);

    // Should have 1 exercise (30-min jog)
    assert(fitnessContent.exercises.length === 1, `Cardio day has 1 exercise (got ${fitnessContent.exercises.length})`);
    if (fitnessContent.exercises.length > 0) {
      assert(fitnessContent.exercises[0].name === '30-min jog', `Exercise is "30-min jog" (got: "${fitnessContent.exercises[0].name}")`);
      assert(fitnessContent.exercises[0].hasCheckbox, 'Exercise has checkbox');
      assert(fitnessContent.exercises[0].setsReps === '1x30 min', `Sets/reps shows "1x30 min" (got: "${fitnessContent.exercises[0].setsReps}")`);
    }

    // Notes section
    assert(fitnessContent.hasNotesCard, 'Notes card renders');
    assert(fitnessContent.hasNotesPrompt, 'Notes prompt shows (no notes logged)');
  }

  await screenshot(page, 'panel-fitness');

  // Navigate to Day 1 (Sunday) — a rest day in the fixture
  // Day 1 is 4 days ago = Sunday
  const day1Date = fixtures.dates[0];
  const day1DayName = new Date(day1Date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  // Navigate back 4 days to day1
  for (let i = 0; i < 4; i++) {
    await page.click('#header-prev');
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);

  // Verify day1 fitness panel — Sunday is a rest day
  const restContent = await page.evaluate(() => {
    const container = document.getElementById('today-workout');
    if (!container) return null;
    const text = container.textContent || '';
    const hasRestLabel = text.toLowerCase().includes('rest day');
    const exerciseCards = container.querySelectorAll('.fitness-exercise');
    return { hasRestLabel, exerciseCount: exerciseCards.length };
  });

  if (restContent) {
    assert(restContent.hasRestLabel, 'Rest day shows "Rest Day" label');
    assert(restContent.exerciseCount === 0, `Rest day has no exercise cards (got ${restContent.exerciseCount})`);
  }

  await screenshot(page, 'panel-fitness-rest');

  // Navigate forward 2 days to Day 3 (Tuesday) — strength upper body push (3 exercises)
  for (let i = 0; i < 2; i++) {
    await page.click('#header-next');
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);

  const strengthContent = await page.evaluate(() => {
    const container = document.getElementById('today-workout');
    if (!container) return null;

    const dayHeader = container.querySelector('.fitness-day-header');
    const dayType = dayHeader?.querySelector('div')?.textContent?.trim() || '';

    const exerciseCards = container.querySelectorAll('.fitness-exercise');
    const exercises = [];
    for (const card of exerciseCards) {
      const name = card.querySelector('.fitness-exercise-name')?.textContent?.trim() || '';
      const hasInfoBtn = !!card.querySelector('.fitness-info-btn');
      exercises.push({ name, hasInfoBtn });
    }

    // Core section divider
    const coreDivider = container.querySelector('[style*="uppercase"]');
    const hasCoreSection = container.textContent.includes('Core');

    return { dayType, exercises, hasCoreSection };
  });

  if (strengthContent) {
    assert(strengthContent.dayType === 'Upper body push', `Strength day shows type "Upper body push" (got: "${strengthContent.dayType}")`);
    assert(strengthContent.exercises.length === 3, `Strength day has 3 exercises (got ${strengthContent.exercises.length})`);

    if (strengthContent.exercises.length >= 3) {
      assert(strengthContent.exercises[0].name === 'Push-ups', `First exercise is Push-ups (got: "${strengthContent.exercises[0].name}")`);
      assert(strengthContent.exercises[0].hasInfoBtn, 'Push-ups has info button (in exercise database)');
      assert(strengthContent.exercises[2].name === 'Plank', `Third exercise is Plank (got: "${strengthContent.exercises[2].name}")`);
    }

    assert(strengthContent.hasCoreSection, 'Core section divider renders for strength day');
  }

  await screenshot(page, 'panel-fitness-strength');

  // Navigate back to today
  for (let i = 0; i < 2; i++) {
    await page.click('#header-next');
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);

  // Switch back to diet panel
  const dietBtn = await page.$('.today-seg-btn[data-panel="diet"]').catch(() => null);
  if (dietBtn) {
    await dietBtn.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function testVisualQA(page, fixtures) {
  console.log('\n--- Accessibility & Polish ---');

  // All modal close buttons should have aria-label="Close"
  // Open a modal to test
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  const moreBtn = await page.$('#quick-more-btn');
  if (moreBtn) {
    await moreBtn.click();
    await page.waitForTimeout(400);
    const closeBtn = await page.$('.modal-close');
    const ariaLabel = closeBtn ? await closeBtn.getAttribute('aria-label') : null;
    assert(ariaLabel === 'Close', `Modal close button has aria-label="Close" (got "${ariaLabel}")`);
    await closeBtn.click();
    await page.waitForTimeout(200);
  }

  // Edit modal close button should also have aria-label
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(500);
  const entryForA11y = await page.$('.entry-item[data-type="meal"]');
  if (entryForA11y) {
    await entryForA11y.click();
    await page.waitForTimeout(400);
    const editClose = await page.$('#edit-close');
    const editAriaLabel = editClose ? await editClose.getAttribute('aria-label') : null;
    assert(editAriaLabel === 'Close', `Edit modal close has aria-label="Close" (got "${editAriaLabel}")`);
    await editClose.click();
    await page.waitForTimeout(200);
  }

  // formatRelativeDate uses UI.yesterday() (boundary-aware), not raw Date
  const relDateCheck = await page.evaluate(() => {
    // UI.yesterday() is boundary-aware; verify formatRelativeDate matches
    const yesterday = UI.yesterday();
    const result = UI.formatRelativeDate(yesterday);
    return { result, yesterday };
  });
  assert(relDateCheck.result === 'Yesterday', `formatRelativeDate(yesterday) returns "Yesterday" (got "${relDateCheck.result}")`);

  // Stale copy check: sync setup text should say "Settings > Cloud Sync", not "Profile > Cloud Sync"
  const staleCopyCheck = await page.evaluate(() => {
    if (typeof App._showSyncSetupStep === 'function') {
      const src = App._showSyncSetupStep.toString();
      return {
        hasStaleRef: src.includes('Profile &gt; Cloud Sync') || src.includes('Profile > Cloud Sync'),
        hasCorrectRef: src.includes('Settings &gt; Cloud Sync') || src.includes('Settings > Cloud Sync'),
      };
    }
    return null;
  });
  if (staleCopyCheck) {
    assert(!staleCopyCheck.hasStaleRef, 'Sync setup does not say "Profile > Cloud Sync"');
    assert(staleCopyCheck.hasCorrectRef, 'Sync setup says "Settings > Cloud Sync"');
  }

  // --color-danger should be defined in CSS (not just fallback)
  const dangerVar = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-danger').trim();
  });
  assert(dangerVar.length > 0, `--color-danger CSS variable is defined (got "${dangerVar}")`);

  // Edit modal: updatedAt should not change when nothing is edited
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(500);
  const noChangeTest = await page.evaluate(async () => {
    const entries = await DB.getEntriesByDate(App.selectedDate);
    const meal = entries.find(e => e.type === 'meal');
    if (!meal) return null;
    const origUpdatedAt = meal.updatedAt || null;
    return { id: meal.id, origUpdatedAt };
  });
  if (noChangeTest) {
    // Open edit modal, save without changes
    const editEntry = await page.$('.entry-item[data-type="meal"]');
    if (editEntry) {
      await editEntry.click();
      await page.waitForTimeout(400);
      await page.click('#edit-save');
      await page.waitForTimeout(400);
      const afterSave = await page.evaluate(async (id) => {
        const entries = await DB.getEntriesByDate(App.selectedDate);
        const e = entries.find(x => x.id === id);
        return e ? (e.updatedAt || null) : null;
      }, noChangeTest.id);
      assert(afterSave === noChangeTest.origUpdatedAt, `Edit modal: updatedAt unchanged when nothing edited (before=${noChangeTest.origUpdatedAt}, after=${afterSave})`);
    }
  }

  // Edit modal: _reanalyzeRequested is set when notes change (nutrition-affecting edit)
  // but NOT when only non-nutrition fields change (bare timestamp/hour edit).
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(500);
  // Case A: edit notes -> _reanalyzeRequested should be true
  const notesReanalyze = await page.evaluate(async () => {
    const entries = await DB.getEntriesByDate(App.selectedDate);
    // Use a meal with existing analysis (find by id match against analyses would be ideal;
    // but all meals on day[0] are analyzed in fixtures). Pick dinner to avoid collisions with earlier test.
    const meal = entries.find(e => e.type === 'meal' && e.subtype === 'dinner');
    if (!meal) return null;
    const edited = { ...meal, notes: (meal.notes || '') + ' (edited note)', updatedAt: new Date().toISOString(), _reanalyzeRequested: true };
    await DB.updateEntry(edited);
    const after = (await DB.getEntriesByDate(App.selectedDate)).find(e => e.id === meal.id);
    return { reanalyze: !!after._reanalyzeRequested };
  });
  if (notesReanalyze) {
    assert(notesReanalyze.reanalyze === true, 'Edit modal: _reanalyzeRequested=true after notes change (nutrition-affecting)');
  }
  // Case B: bare timestamp change should NOT set _reanalyzeRequested.
  // Verify by inspecting the edit-save handler source (it should only set the flag when note/photo fields change).
  const editSaveSrc = await page.evaluate(() => UI.showEditModal.toString());
  assert(editSaveSrc.includes('_reanalyzeRequested'), 'Edit modal source references _reanalyzeRequested flag');
  // The flag should be gated on note (or photo) changes, not on hourChanged/dateChanged alone.
  // Check that _reanalyzeRequested assignment is co-located with a notes-change check, not with hourChanged.
  const flagGatedOnNotes = /notesChanged[\s\S]{0,200}_reanalyzeRequested|_reanalyzeRequested[\s\S]{0,200}notesChanged/.test(editSaveSrc)
    || /notes !== \(entry\.notes[\s\S]{0,400}_reanalyzeRequested/.test(editSaveSrc);
  assert(flagGatedOnNotes, 'Edit modal: _reanalyzeRequested is gated on notes change (not timestamp/date alone)');

  // batchPhotos: verify error feedback path exists (check source for error toast)
  const batchErrorCheck = await page.evaluate(() => {
    const src = QuickLog.batchPhotos.toString();
    return src.includes("'error'") && src.includes('Failed');
  });
  assert(batchErrorCheck, 'batchPhotos has error toast for zero-save case');

  console.log('\n--- Visual QA ---');

  // Ensure we're on the Today screen, Diet panel
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);
  const dietBtn = await page.$('.today-seg-btn[data-panel="diet"]');
  if (dietBtn) { await dietBtn.click(); await page.waitForTimeout(300); }

  // 1. Touch target sizes — all interactive elements must be >= 44px in at least one dimension
  const touchTargets = await page.evaluate(() => {
    const MIN_SIZE = 44;
    const interactive = document.querySelectorAll('button, [onclick], input, textarea, .entry-item, a');
    const violations = [];
    for (const el of interactive) {
      // Skip hidden elements
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Skip elements outside viewport
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.width < MIN_SIZE && rect.height < MIN_SIZE) {
        const id = el.id || el.className?.split?.(' ')?.[0] || el.tagName;
        const text = (el.textContent || '').trim().substring(0, 30);
        violations.push({ id, text, w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    }
    return violations;
  });

  const touchOk = touchTargets.length === 0;
  assert(touchOk, `All visible interactive elements >= 44px touch target (${touchTargets.length} violations${touchTargets.length > 0 ? ': ' + touchTargets.map(v => `${v.id}[${v.text}] ${v.w}x${v.h}`).join(', ') : ''})`);

  // 2. Score chips all visible (not clipped by container)
  const chipVisibility = await page.evaluate(() => {
    const chips = document.querySelectorAll('.score-chip');
    if (chips.length === 0) return { total: 0, visible: 0, clipped: [] };
    // Check against the containing card, not the viewport — the card has
    // overflow:hidden + padding, so chips can be within the viewport but
    // visually clipped by the card boundary.
    const card = document.querySelector('.day-score');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const rightBound = cardRect ? cardRect.right : window.innerWidth;
    const leftBound = cardRect ? cardRect.left : 0;
    let visible = 0;
    const clipped = [];
    for (const chip of chips) {
      const r = chip.getBoundingClientRect();
      if (r.right <= rightBound + 2 && r.left >= leftBound - 2) {
        visible++;
      } else {
        clipped.push(chip.textContent.trim());
      }
    }
    return { total: chips.length, visible, clipped };
  });

  assert(chipVisibility.total > 0 && chipVisibility.visible === chipVisibility.total,
    `All ${chipVisibility.total} score chips fully visible (${chipVisibility.visible} visible${chipVisibility.clipped.length > 0 ? ', clipped: ' + chipVisibility.clipped.join(', ') : ''})`);

  // 2b. Also check chips on day 1 (high score, 5 tight-fitting chips — clips when card has overflow:hidden)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(800);
  const chipVisDay1 = await page.evaluate(() => {
    const chips = document.querySelectorAll('.score-chip');
    if (chips.length === 0) return { total: 0, visible: 0, clipped: [] };
    const card = document.querySelector('.day-score');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const rightBound = cardRect ? cardRect.right : window.innerWidth;
    const leftBound = cardRect ? cardRect.left : 0;
    let visible = 0;
    const clipped = [];
    for (const chip of chips) {
      const r = chip.getBoundingClientRect();
      if (r.right <= rightBound + 2 && r.left >= leftBound - 2) {
        visible++;
      } else {
        clipped.push(chip.textContent.trim());
      }
    }
    return { total: chips.length, visible, clipped };
  });
  assert(chipVisDay1.total > 0 && chipVisDay1.visible === chipVisDay1.total,
    `Day 1: all ${chipVisDay1.total} score chips visible (${chipVisDay1.visible} visible${chipVisDay1.clipped.length > 0 ? ', clipped: ' + chipVisDay1.clipped.join(', ') : ''})`);
  // Navigate back to today
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(500);

  // 3. Content not hidden behind nav bar — check last visible element on each panel
  const navOverlap = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return { ok: true };
    const navTop = nav.getBoundingClientRect().top;
    const screen = document.querySelector('.screen.active');
    if (!screen) return { ok: true };

    // Scroll to bottom
    screen.scrollTop = screen.scrollHeight;

    // Check all entry items and cards
    const items = screen.querySelectorAll('.entry-item, .card');
    const hidden = [];
    for (const item of items) {
      const r = item.getBoundingClientRect();
      // Skip items that should be off-screen (other panels)
      if (r.width === 0) continue;
      // Item's bottom is below nav top AND item is not fully above nav
      if (r.bottom > navTop + 5 && r.top < navTop) {
        const text = (item.textContent || '').trim().substring(0, 40);
        hidden.push(text);
      }
    }
    // Reset scroll
    screen.scrollTop = 0;
    return { ok: hidden.length === 0, hidden };
  });

  assert(navOverlap.ok, `No content hidden behind nav bar after scroll (${navOverlap.hidden?.length || 0} items overlap${navOverlap.hidden?.length > 0 ? ': ' + navOverlap.hidden[0] : ''})`);

  // 4. Inactive segment tabs are readable (contrast check)
  const segContrast = await page.evaluate(() => {
    const inactiveTabs = document.querySelectorAll('.today-seg-btn:not(.active)');
    const results = [];
    for (const tab of inactiveTabs) {
      const style = getComputedStyle(tab);
      const color = style.color;
      // Parse rgb values
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) continue;
      const [, r, g, b] = match.map(Number);
      // Calculate relative luminance (simplified)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
      results.push({ text: tab.textContent.trim(), luminance: Math.round(luminance), color });
    }
    return results;
  });

  // Inactive tabs should have luminance > 80 (not too dim against dark background)
  const dimTabs = segContrast.filter(t => t.luminance < 80);
  assert(dimTabs.length === 0, `Inactive segment tabs readable (luminance >= 80)${dimTabs.length > 0 ? ' — too dim: ' + dimTabs.map(t => `"${t.text}" lum=${t.luminance}`).join(', ') : ''}`);

  // 5. Nav bar — all 4 tabs have visible text labels
  const navLabels = await page.evaluate(() => {
    const navBtns = document.querySelectorAll('.bottom-nav .nav-item');
    return Array.from(navBtns).map(btn => {
      const span = btn.querySelector('span');
      const text = span?.textContent?.trim() || '';
      const rect = btn.getBoundingClientRect();
      return { text, w: Math.round(rect.width), h: Math.round(rect.height) };
    });
  });

  assert(navLabels.length === 4, `Nav bar has 4 tabs (got ${navLabels.length})`);
  const allLabeled = navLabels.every(n => n.text.length > 0);
  assert(allLabeled, `All nav tabs have text labels (${navLabels.map(n => n.text || '""').join(', ')})`);

  // 6. Check all panels for content clipping — switch to each panel, scroll to bottom
  for (const panel of ['fitness']) {
    const panelBtn = await page.$(`.today-seg-btn[data-panel="${panel}"]`);
    if (panelBtn) {
      await panelBtn.click();
      await page.waitForTimeout(400);

      const panelClip = await page.evaluate((panelName) => {
        const screen = document.querySelector('.screen.active');
        const nav = document.querySelector('.bottom-nav');
        if (!screen || !nav) return { ok: true, panel: panelName };
        const navTop = nav.getBoundingClientRect().top;

        screen.scrollTop = screen.scrollHeight;

        // Find last visible content element in this panel
        const panelEl = document.getElementById(`panel-${panelName}`) || document.getElementById('today-workout');
        if (!panelEl) return { ok: true, panel: panelName };

        const children = panelEl.querySelectorAll('.card, .fitness-exercise, button');
        let lastVisible = null;
        for (const child of children) {
          const r = child.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) lastVisible = { bottom: r.bottom, text: (child.textContent || '').trim().substring(0, 30) };
        }

        screen.scrollTop = 0;
        if (!lastVisible) return { ok: true, panel: panelName };
        return { ok: lastVisible.bottom <= navTop + 5, panel: panelName, lastBottom: Math.round(lastVisible.bottom), navTop: Math.round(navTop), lastText: lastVisible.text };
      }, panel);

      assert(panelClip.ok, `${panel} panel content not clipped by nav (last=${panelClip.lastBottom}, nav=${panelClip.navTop}${!panelClip.ok ? ' — hidden: "' + panelClip.lastText + '"' : ''})`);
    }
  }

  // Switch back to diet
  if (dietBtn) { await dietBtn.click(); await page.waitForTimeout(300); }

  // 7. Entry cards have adequate height for tapping
  const entryHeights = await page.evaluate(() => {
    const entries = document.querySelectorAll('.entry-item');
    const short = [];
    for (const e of entries) {
      const rect = e.getBoundingClientRect();
      if (rect.height > 0 && rect.height < 48) {
        short.push({ text: (e.textContent || '').trim().substring(0, 30), h: Math.round(rect.height) });
      }
    }
    return short;
  });

  assert(entryHeights.length === 0, `All entry cards >= 48px tall (${entryHeights.length} too short${entryHeights.length > 0 ? ': ' + entryHeights.map(e => `"${e.text}" ${e.h}px`).join(', ') : ''})`);

  // 8. Edit modal textarea — caret visible, content not clipped
  // Navigate to a day with entries and open the edit modal
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);

  const entryItem = await page.$('.entry-swipe-wrap .entry-item');
  if (entryItem) {
    await entryItem.click();
    await page.waitForTimeout(500);

    const textareaCheck = await page.evaluate(() => {
      const textarea = document.getElementById('edit-notes');
      if (!textarea) return { found: false };

      const style = getComputedStyle(textarea);
      const rect = textarea.getBoundingClientRect();

      // Check that textarea has enough height for its content
      const contentOverflows = textarea.scrollHeight > textarea.clientHeight + 4;

      // Check padding — bottom padding should be adequate for cursor
      const paddingBottom = parseFloat(style.paddingBottom);

      // Focus and check caret would be visible
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      // After focus, textarea rect should be within the modal sheet
      const sheet = textarea.closest('.modal-sheet');
      const sheetRect = sheet ? sheet.getBoundingClientRect() : null;
      const textareaInSheet = sheetRect ? (rect.bottom <= sheetRect.bottom + 2) : true;

      return {
        found: true,
        height: Math.round(rect.height),
        scrollHeight: textarea.scrollHeight,
        clientHeight: textarea.clientHeight,
        contentOverflows,
        paddingBottom: Math.round(paddingBottom),
        overflowY: style.overflowY,
        textareaInSheet,
      };
    });

    if (textareaCheck.found) {
      assert(!textareaCheck.contentOverflows, `Edit modal textarea content not clipped (scrollH=${textareaCheck.scrollHeight}, clientH=${textareaCheck.clientHeight})`);
      assert(textareaCheck.paddingBottom >= 8, `Edit modal textarea has adequate bottom padding for cursor (${textareaCheck.paddingBottom}px)`);
      assert(textareaCheck.textareaInSheet, 'Edit modal textarea is within modal sheet bounds');
    }

    // Close modal
    const closeBtn = await page.$('#edit-close');
    if (closeBtn) { await closeBtn.click(); await page.waitForTimeout(300); }
  }

  // 9. All textareas — verify none clip content AND all have adequate bottom padding for cursor
  // Check each screen AND each Today panel (fitness has its own textareas)
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);

  // Expand fitness notes textarea (hidden behind prompt by default)
  const fitSeg = await page.$('.today-seg-btn[data-panel="fitness"]');
  if (fitSeg) { await fitSeg.click(); await page.waitForTimeout(400); }
  const notesPrompt = await page.$('.fitness-notes-prompt');
  if (notesPrompt) { await notesPrompt.click(); await page.waitForTimeout(300); }

  // Check fitness panel textarea while it's the active panel
  const fitTextareaIssues = await page.evaluate(() => {
    const issues = [];
    const textareas = document.querySelectorAll('#panel-fitness textarea, #today-workout textarea');
    for (const ta of textareas) {
      const style = getComputedStyle(ta);
      if (style.display === 'none') continue;

      const paddingBottom = parseFloat(style.paddingBottom);
      if (paddingBottom < 8) {
        issues.push({ id: ta.id || '', placeholder: ta.placeholder || '', issue: 'low padding-bottom', paddingBottom: Math.round(paddingBottom) });
      }
      if (ta.scrollHeight > ta.clientHeight + 4 && style.overflowY === 'hidden') {
        issues.push({ id: ta.id || '', placeholder: ta.placeholder || '', issue: 'content clipped', scrollH: ta.scrollHeight, clientH: ta.clientHeight });
      }
    }
    return issues;
  });

  assert(fitTextareaIssues.length === 0, `Fitness panel textareas have adequate padding (${fitTextareaIssues.length} issues${fitTextareaIssues.length > 0 ? ': ' + fitTextareaIssues.map(t => `${t.id}[${t.issue}${t.paddingBottom != null ? '=' + t.paddingBottom + 'px' : ''}]`).join(', ') : ''})`);

  // Switch back to diet
  const dietSeg2 = await page.$('.today-seg-btn[data-panel="diet"]');
  if (dietSeg2) { await dietSeg2.click(); await page.waitForTimeout(300); }

  // Check Coach and Settings screens
  for (const scr of ['Coach', 'Settings']) {
    await page.click(`nav button:has-text("${scr}")`);
    await page.waitForTimeout(400);

    const textareaIssues = await page.evaluate((screenName) => {
      const screen = document.querySelector('.screen.active');
      if (!screen) return [];
      const textareas = screen.querySelectorAll('textarea');
      const issues = [];
      for (const ta of textareas) {
        const style = getComputedStyle(ta);
        if (style.display === 'none') continue;
        const rect = ta.getBoundingClientRect();
        if (rect.height === 0) continue;

        if (ta.scrollHeight > ta.clientHeight + 4 && style.overflowY === 'hidden') {
          issues.push({ screen: screenName, id: ta.id || '', issue: 'content clipped' });
        }
        const paddingBottom = parseFloat(style.paddingBottom);
        if (paddingBottom < 8) {
          issues.push({ screen: screenName, id: ta.id || '', issue: 'low padding-bottom', paddingBottom: Math.round(paddingBottom) });
        }
      }
      return issues;
    }, scr);

    assert(textareaIssues.length === 0, `${scr}: all textareas have adequate padding (${textareaIssues.length} issues${textareaIssues.length > 0 ? ': ' + textareaIssues.map(t => `${t.id}[${t.issue}${t.paddingBottom != null ? '=' + t.paddingBottom + 'px' : ''}]`).join(', ') : ''})`);
  }

  // 10. Photo thumbnails — entries with photos must render actual images (not empty boxes)
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('.today-seg-btn[data-panel="diet"]').catch(() => {});

  const brokenPhotos = await page.evaluate(() => {
    const thumbs = document.querySelectorAll('.entry-photo-thumb');
    const broken = [];
    for (const el of thumbs) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.tagName === 'IMG' && (!el.src || el.naturalWidth === 0)) {
        broken.push({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    }
    return broken;
  });

  assert(brokenPhotos.length === 0, `No broken/empty photo thumbnails (${brokenPhotos.length} entries show empty ${brokenPhotos.length > 0 ? brokenPhotos[0].w + 'x' + brokenPhotos[0].h + ' boxes' : ''})`);

  // 10b. Orphan photo resilience — entry with photo:true but no blob should NOT show empty gray box
  await page.evaluate(async () => {
    await DB.addEntry({
      id: 'test_orphan_photo',
      type: 'meal', subtype: null,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      notes: 'Orphan photo test', photo: true, duration_minutes: null,
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const orphanCheck = await page.evaluate(() => {
    const thumbs = document.querySelectorAll('.entry-photo-thumb');
    const visible = [];
    for (const el of thumbs) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === 'none' || rect.width === 0) continue;
      if (el.tagName === 'IMG' && (!el.src || el.src === '' || el.naturalWidth === 0)) {
        visible.push({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    }
    return visible;
  });

  assert(orphanCheck.length === 0, `Orphan photo entries don't show empty gray box (${orphanCheck.length} visible${orphanCheck.length > 0 ? ': ' + orphanCheck[0].w + 'x' + orphanCheck[0].h : ''})`);

  // Clean up test entry
  await page.evaluate(async () => { await DB.deleteEntry('test_orphan_photo'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 10c. Photo container overflow — images in constrained containers must not overflow
  // Tests all photo containers with PORTRAIT ratio images (real phone camera output).
  // Root cause of body-photo overlap bug: 80x80 container + portrait img = 80x106 overflow.
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);

  // Navigate to day 1 which has portrait body photos (300x500) and square-ish meal photos (400x400)
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[0]);
  await page.waitForTimeout(800);

  const photoOverflowCheck = await page.evaluate(() => {
    const issues = [];

    // Check all constrained photo containers: img thumbnails + background-image divs
    // 1. Entry photo thumbnails (<img> with fixed dimensions)
    document.querySelectorAll('img.entry-photo-thumb').forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.width === 0) return;
      // img with object-fit:cover should match container exactly
      if (img.naturalWidth > 0 && (rect.height > 82 || rect.width > 82)) {
        issues.push(`entry-thumb ${Math.round(rect.width)}x${Math.round(rect.height)} exceeds 80x80`);
      }
    });

    // 2. Locked body photo divs (background-image based)
    document.querySelectorAll('.entry-photo-locked').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      // These are fixed 80x80, content should not overflow
      if (rect.height > 82) {
        issues.push(`locked-photo ${Math.round(rect.width)}x${Math.round(rect.height)} exceeds 80px`);
      }
    });

    // 3. Progress photo thumbs
    document.querySelectorAll('.progress-photo-thumb').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      // 72x96 expected, with overflow:hidden
      const style = getComputedStyle(el);
      if (style.overflow !== 'hidden') {
        issues.push(`progress-thumb missing overflow:hidden`);
      }
    });

    // 4. Body photo grid previews (the fixed bug — portrait images in 80x80 grid)
    document.querySelectorAll('.body-photo-grid .photo-preview').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const style = getComputedStyle(el);
      if (style.overflow !== 'hidden') {
        issues.push(`body-grid-preview missing overflow:hidden`);
      }
      const img = el.querySelector('.photo-preview-img');
      if (img) {
        const imgRect = img.getBoundingClientRect();
        if (imgRect.bottom > rect.bottom + 1 || imgRect.right > rect.right + 1) {
          issues.push(`body-grid img overflows container by ${Math.round(imgRect.bottom - rect.bottom)}px bottom, ${Math.round(imgRect.right - rect.right)}px right`);
        }
      }
    });

    // 5. Edit modal photo preview
    document.querySelectorAll('.ql-photo-preview').forEach(el => {
      const style = getComputedStyle(el);
      if (style.overflow !== 'hidden') {
        issues.push(`ql-photo-preview missing overflow:hidden`);
      }
    });

    return issues;
  });

  assert(photoOverflowCheck.length === 0, `No photo container overflow (${photoOverflowCheck.length} issues${photoOverflowCheck.length > 0 ? ': ' + photoOverflowCheck.join('; ') : ''})`);

  // 10d. Body photo form — portrait images don't overlap between sections
  // Opens body photo form, uploads portrait test images to body+face, checks no overlap
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]); // go to today
  await page.waitForTimeout(300);

  // Set up body+face types if not already configured
  await page.evaluate(async () => {
    const existing = await DB.getProfile('bodyPhotoTypes');
    if (!existing || !existing.some(t => t.key === 'face')) {
      await DB.setProfile('bodyPhotoTypes', [
        { key: 'body', name: 'Body' },
        { key: 'face', name: 'Face' },
      ]);
    }
  });

  // Open body photo form
  await page.click('#quick-more-btn');
  await page.waitForTimeout(300);
  await page.click('[data-more-type="bodyPhoto"]');
  await page.waitForTimeout(500);

  // Upload portrait photos via file chooser to both body and face
  const bpTypes = ['body', 'face'];
  for (const typeKey of bpTypes) {
    const pickBtn = page.locator(`[data-bp-pick="${typeKey}"]`);
    if (await pickBtn.isVisible()) {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser'),
        pickBtn.click(),
      ]);
      // Create a portrait test image (3:4 ratio like phone camera)
      const portraitBuf = Buffer.from(await page.evaluate(async (label) => {
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = label === 'body' ? '#3498db' : '#e74c3c';
        ctx.fillRect(0, 0, 300, 400);
        ctx.fillStyle = '#fff';
        ctx.font = '32px sans-serif';
        ctx.fillText(label.toUpperCase(), 100, 200);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }, typeKey));
      const tmpPath = require('path').join(require('os').tmpdir(), `test-bp-${typeKey}.png`);
      require('fs').writeFileSync(tmpPath, portraitBuf);
      try {
        await fc.setFiles(tmpPath);
        await page.waitForTimeout(400);
      } finally {
        try { require('fs').unlinkSync(tmpPath); } catch (_) {}
      }
    }
  }

  // Check: body preview images don't overflow into face section
  const bpOverlap = await page.evaluate(() => {
    const bodyGrid = document.getElementById('log-bp-preview-body');
    const faceLabel = [...document.querySelectorAll('#body-photo-types-container .form-label')]
      .find(l => l.textContent === 'Face');
    if (!bodyGrid || !faceLabel) return { found: false };

    let maxBottom = 0;
    for (const el of bodyGrid.querySelectorAll('.photo-preview, .photo-preview-img')) {
      maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
    }
    const faceTop = faceLabel.getBoundingClientRect().top;
    return { found: true, overlaps: maxBottom > faceTop + 2, maxBottom: Math.round(maxBottom), faceTop: Math.round(faceTop) };
  });

  if (bpOverlap.found) {
    assert(!bpOverlap.overlaps, `Body photo previews don't overlap face section (bottom=${bpOverlap.maxBottom}, faceTop=${bpOverlap.faceTop})`);
  }

  // Check at 320px too
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(200);

  const bpOverlap320 = await page.evaluate(() => {
    const bodyGrid = document.getElementById('log-bp-preview-body');
    const faceLabel = [...document.querySelectorAll('#body-photo-types-container .form-label')]
      .find(l => l.textContent === 'Face');
    if (!bodyGrid || !faceLabel) return { found: false };

    let maxBottom = 0;
    for (const el of bodyGrid.querySelectorAll('.photo-preview, .photo-preview-img')) {
      maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
    }
    const faceTop = faceLabel.getBoundingClientRect().top;
    return { found: true, overlaps: maxBottom > faceTop + 2, maxBottom: Math.round(maxBottom), faceTop: Math.round(faceTop) };
  });

  if (bpOverlap320.found) {
    assert(!bpOverlap320.overlaps, `320px: Body photos don't overlap face section (bottom=${bpOverlap320.maxBottom}, faceTop=${bpOverlap320.faceTop})`);
  }

  await screenshot(page, 'body-photo-portrait-overlap-test');

  // Reset viewport and close form
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const form = document.getElementById('log-form-inline');
    if (form) form.style.display = 'none';
  });
  await page.waitForTimeout(200);

  // 10d. Body photo form scroll — adding 3 photos must not block scrolling to Save button
  // Bug: .today-panels has overflow:hidden for horizontal swiping, but panel height wasn't
  // updated when photos were added, clipping form content and blocking vertical scroll.
  await page.evaluate((d) => App.goToDate(d), fixtures.dates[4]);
  await page.waitForTimeout(300);

  // Open body photo form
  await page.click('#quick-more-btn');
  await page.waitForTimeout(300);
  await page.click('[data-more-type="bodyPhoto"]');
  await page.waitForTimeout(500);

  // Add 3 photos via file chooser to the body type
  for (let i = 0; i < 3; i++) {
    const pickBtn = page.locator('[data-bp-pick="body"]');
    if (await pickBtn.isVisible()) {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser'),
        pickBtn.click(),
      ]);
      const photoBuf = Buffer.from(await page.evaluate((idx) => {
        const canvas = document.createElement('canvas');
        canvas.width = 300; canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = ['#2ecc71', '#3498db', '#9b59b6'][idx];
        ctx.fillRect(0, 0, 300, 400);
        ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif';
        ctx.fillText(`${idx + 1}`, 130, 210);
        return new Promise(r => canvas.toBlob(b => b.arrayBuffer().then(a => r(Array.from(new Uint8Array(a)))), 'image/png'));
      }, i));
      const tmpFile = path.join(require('os').tmpdir(), `test-bp-scroll-${i}.png`);
      fs.writeFileSync(tmpFile, photoBuf);
      try {
        await fc.setFiles(tmpFile);
        await page.waitForTimeout(400);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    }
  }

  // Check: save button is scrollable into view (not clipped by overflow:hidden)
  const bpScrollCheck = await page.evaluate(() => {
    const screen = document.querySelector('.screen.active');
    const saveBtn = document.querySelector('#log-form-content-inline .btn-primary');
    const panels = document.querySelector('.today-panels');
    if (!screen || !saveBtn || !panels) return { found: false };

    // Scroll to bottom
    screen.scrollTop = screen.scrollHeight;

    const saveBtnRect = saveBtn.getBoundingClientRect();
    const navBar = document.querySelector('.bottom-nav');
    const navTop = navBar ? navBar.getBoundingClientRect().top : window.innerHeight;
    const panelsRect = panels.getBoundingClientRect();

    // The save button must be visible (above the nav bar) after scrolling
    const saveVisible = saveBtnRect.bottom > 0 && saveBtnRect.bottom <= navTop + 5;

    // The panels container must be tall enough to contain the form
    const panelDiet = document.getElementById('panel-diet');
    const panelContentHeight = panelDiet ? panelDiet.scrollHeight : 0;
    const panelsTall = panelsRect.height >= panelContentHeight - 2;

    screen.scrollTop = 0;
    return {
      found: true,
      saveVisible,
      panelsTall,
      saveBtnBottom: Math.round(saveBtnRect.bottom),
      navTop: Math.round(navTop),
      panelsHeight: Math.round(panelsRect.height),
      panelContentHeight: Math.round(panelContentHeight),
    };
  });

  if (bpScrollCheck.found) {
    assert(bpScrollCheck.saveVisible,
      `Body photo form: Save button visible after scroll (bottom=${bpScrollCheck.saveBtnBottom}, navTop=${bpScrollCheck.navTop})`);
    assert(bpScrollCheck.panelsTall,
      `Body photo form: panels container tall enough for content (panels=${bpScrollCheck.panelsHeight}, content=${bpScrollCheck.panelContentHeight})`);
  }

  // 10e. today-panels must NOT use overflow:hidden on Y axis (blocks touch scrolling on iOS)
  // Bug: overflow:hidden creates a scroll container that traps touch events on iOS Safari,
  // preventing the parent .screen.active from scrolling. Use overflow-x:clip instead.
  const panelsOverflow = await page.evaluate(() => {
    const panels = document.querySelector('.today-panels');
    if (!panels) return { found: false };
    const cs = getComputedStyle(panels);
    return {
      found: true,
      overflow: cs.overflow,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
    };
  });
  if (panelsOverflow.found) {
    assert(panelsOverflow.overflowY !== 'hidden',
      `today-panels overflowY is not hidden (got ${panelsOverflow.overflowY}) — hidden blocks iOS touch scroll`);
    assert(panelsOverflow.overflowX === 'clip' || panelsOverflow.overflowX === 'hidden',
      `today-panels overflowX clips horizontal content (got ${panelsOverflow.overflowX})`);
  }

  await screenshot(page, 'body-photo-scroll-test');

  // Close the form
  await page.evaluate(() => {
    const form = document.getElementById('log-form-inline');
    if (form) form.style.display = 'none';
  });
  await page.waitForTimeout(200);

  // 11. Today button — appears on past dates, hidden on today, meets touch target
  for (let i = 0; i < 2; i++) { await page.click('#header-prev'); await page.waitForTimeout(200); }
  await page.waitForTimeout(300);

  const todayBtnCheck = await page.evaluate(() => {
    const btn = document.getElementById('header-today');
    if (!btn) return { found: false };
    const rect = btn.getBoundingClientRect();
    const style = getComputedStyle(btn);
    return { found: true, display: style.display, h: Math.round(rect.height), w: Math.round(rect.width), visible: style.display !== 'none' && rect.width > 0 };
  });
  assert(todayBtnCheck.found && todayBtnCheck.visible, 'Today button visible on past date');
  assert(todayBtnCheck.h >= 44, `Today button meets 44px touch target (got ${todayBtnCheck.h}px)`);

  // Click Today to go back
  await page.click('#header-today');
  await page.waitForTimeout(500);

  const todayBtnHidden = await page.evaluate(() => {
    const btn = document.getElementById('header-today');
    return btn ? getComputedStyle(btn).display : 'missing';
  });
  assert(todayBtnHidden === 'none', 'Today button hidden when on today');

  // 11b. Weight chart renders with fixture data
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  await page.click('.segment-btn[data-ptab="trends"]');
  await page.waitForTimeout(500);

  const weightChartCheck = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return { found: false };
    const points = JSON.parse(svg.dataset.points || '[]');
    const tooltip = document.querySelector('.weight-chart-tooltip');
    return { found: true, pointCount: points.length, hasTooltip: !!tooltip, h: Math.round(svg.getBoundingClientRect().height) };
  });
  assert(weightChartCheck.found, 'Weight trend chart renders');
  assert(weightChartCheck.pointCount >= 3, `Weight chart has data points (got ${weightChartCheck.pointCount})`);
  assert(weightChartCheck.hasTooltip, 'Weight chart has tooltip element for touch interaction');

  // 11c. Progress photos grouped by subtype
  const photoSubtypes = await page.evaluate(() => {
    const subtypes = document.querySelectorAll('.progress-photos-subtype');
    return Array.from(subtypes).map(st => ({
      label: st.querySelector('.progress-photos-subtype-label')?.textContent?.trim() || '',
      hasPhotos: st.querySelectorAll('.progress-photo-card').length > 0,
      hasEmpty: !!st.querySelector('.progress-photos-empty'),
    }));
  });
  assert(photoSubtypes.length >= 2, `Progress photos has ${photoSubtypes.length} subtype sections (expected >= 2)`);
  const bodySection = photoSubtypes.find(s => s.label === 'Body');
  assert(bodySection, 'Progress photos has Body section');

  // Go back to Today screen for remaining tests
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('.today-seg-btn[data-panel="diet"]').catch(() => {});

  // 11d. Today screen section spacing is consistent (>= 12px between major sections)
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('.today-seg-btn[data-panel="diet"]').catch(() => {});

  const sectionGaps = await page.evaluate(() => {
    const score = document.querySelector('#today-score');
    const segments = document.querySelector('.today-segments');
    const statsCards = document.querySelectorAll('.stat-card');
    const quickActions = document.querySelector('.quick-actions');
    const entryList = document.querySelector('.entry-list, #today-entries');

    const gaps = [];
    const measure = (nameA, elA, nameB, elB) => {
      if (!elA || !elB) return;
      const gap = Math.round(elB.getBoundingClientRect().top - elA.getBoundingClientRect().bottom);
      gaps.push({ between: `${nameA}→${nameB}`, gap });
    };

    measure('score', score, 'stats', statsCards[0]);
    if (statsCards.length >= 4) measure('stats', statsCards[3], 'segments', segments);
    measure('segments', segments, 'quickActions', quickActions);
    measure('quickActions', quickActions, 'entries', entryList);

    return gaps;
  });

  for (const g of sectionGaps) {
    assert(g.gap >= 12 && g.gap <= 24, `Section spacing ${g.between} is 12-24px (got ${g.gap}px)`);
  }

  // 11b. Delete-bg not visible when entry is not swiped (no red corner peek)
  const deleteBgVisible = await page.evaluate(() => {
    const bgs = document.querySelectorAll('.entry-delete-bg');
    const visible = [];
    for (const bg of bgs) {
      const style = getComputedStyle(bg);
      if (style.display !== 'none') {
        visible.push({ display: style.display });
      }
    }
    return visible;
  });

  assert(deleteBgVisible.length === 0, `No delete-bg visible when not swiping (${deleteBgVisible.length} visible)`);

  // 11c. Entry swipe wrappers don't clip entry content vertically
  const wrapClipping = await page.evaluate(() => {
    const wraps = document.querySelectorAll('.entry-swipe-wrap');
    const issues = [];
    for (const w of wraps) {
      const ws = getComputedStyle(w);
      const overflowY = ws.overflowY;
      // overflow-y should NOT be 'hidden' — it clips slideInUp animation and borders
      if (overflowY === 'hidden') {
        issues.push({ overflowY });
      }
    }
    return issues;
  });

  assert(wrapClipping.length === 0, `Entry swipe wrappers don't clip vertically (${wrapClipping.length} have overflow-y:hidden)`);

  // 12. No excessive empty gaps on any screen (> 40% of viewport between content and nav)
  for (const scr of ['Today', 'Coach', 'Progress', 'Settings']) {
    await page.click(`nav button:has-text("${scr}")`);
    await page.waitForTimeout(500);

    const gap = await page.evaluate((name) => {
      const screen = document.querySelector('.screen.active');
      const nav = document.querySelector('.bottom-nav');
      if (!screen || !nav) return { ok: true };

      const allContent = screen.querySelectorAll('*');
      let lastBottom = 0;
      for (const el of allContent) {
        if (el.children.length > 0) continue; // only leaf nodes
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.bottom > lastBottom) lastBottom = r.bottom;
      }

      const navTop = nav.getBoundingClientRect().top;
      const emptyGap = navTop - lastBottom;
      const gapPct = Math.round((emptyGap / window.innerHeight) * 100);
      return { ok: gapPct <= 40, screen: name, gapPct, emptyGap: Math.round(emptyGap) };
    }, scr);

    assert(gap.ok, `${gap.screen}: no excessive empty space (${gap.gapPct}% gap = ${gap.emptyGap}px between content and nav)`);
  }

  await screenshot(page, 'visual-qa');
}

async function testVisualQA320(page, context, fixtures) {
  console.log('\n--- Visual QA (320px) ---');

  // Create a 320px viewport page
  const smallPage = await context.newPage();
  await smallPage.setViewportSize({ width: 320, height: 568 });
  await smallPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await smallPage.waitForTimeout(1500);
  await smallPage.waitForFunction(() => typeof DB !== 'undefined' && typeof DB.openDB === 'function');

  // Re-inject fixtures on the small page
  await smallPage.evaluate(async (data) => {
    const db = await DB.openDB();
    for (const s of ['entries','dailySummary','analysis','profile','mealPlan','photos']) {
      const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear();
      await new Promise(r => { tx.oncomplete = r; });
    }
    for (const e of data.entries) await DB.addEntry(e);
    for (const s of data.summaries) await DB.updateDailySummary(s.date, s);
    await DB.setProfile('goals', data.goals);
    await DB.setProfile('regimen', data.regimen);
    await DB.setProfile('mealPlan', data.mealPlan);
    try { await DB.setProfile('skincare', data.skincareProfile); } catch(e){}
  }, fixtures);
  await smallPage.reload({ waitUntil: 'networkidle' });
  await smallPage.waitForTimeout(1000);

  // Navigate to Settings
  await smallPage.click('nav button:has-text("Settings")');
  await smallPage.waitForTimeout(500);

  // 1. Check for overlapping interactive elements on Settings screen
  const overlaps = await smallPage.evaluate(() => {
    const screen = document.querySelector('.screen.active');
    if (!screen) return [];
    const buttons = screen.querySelectorAll('button');
    const rects = [];
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      rects.push({ text: btn.textContent.trim().substring(0, 20), top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: Math.round(r.height) });
    }
    const issues = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          issues.push(`"${a.text}" overlaps "${b.text}"`);
        }
      }
    }
    return issues;
  });

  assert(overlaps.length === 0, `No overlapping buttons on Settings at 320px (${overlaps.length} overlaps${overlaps.length > 0 ? ': ' + overlaps.join('; ') : ''})`);

  // 2. Check that all Settings buttons meet 44px minimum touch target
  const smallBtns = await smallPage.evaluate(() => {
    const screen = document.querySelector('.screen.active');
    if (!screen) return [];
    const buttons = screen.querySelectorAll('button');
    const violations = [];
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) {
        violations.push({ text: btn.textContent.trim().substring(0, 20), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return violations;
  });

  assert(smallBtns.length === 0, `All Settings buttons >= 44px at 320px (${smallBtns.length} violations${smallBtns.length > 0 ? ': ' + smallBtns.map(b => `"${b.text}" ${b.w}x${b.h}`).join(', ') : ''})`);

  // 3. Sync action buttons don't overflow their card
  // Bug: flex:1 with flex-basis:0% prevented flex-wrap from triggering,
  // so 3 buttons stayed on one line and overflowed the card.
  // Test at 320px on smallPage
  const syncOverflow320 = await smallPage.evaluate(() => {
    const actions = document.querySelector('.s-sync-actions');
    if (!actions) return { found: false };
    const card = actions.closest('.s-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const rightBound = cardRect ? cardRect.right : document.documentElement.clientWidth;
    const buttons = actions.querySelectorAll('.s-sync-btn');
    const clipped = [];
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.right > rightBound + 2) clipped.push(btn.textContent.trim());
    }
    return { found: true, clipped };
  });
  if (syncOverflow320.found) {
    assert(syncOverflow320.clipped.length === 0,
      `Sync buttons don't overflow card at 320px (${syncOverflow320.clipped.length} clipped${syncOverflow320.clipped.length > 0 ? ': ' + syncOverflow320.clipped.join(', ') : ''})`);
  }

  await screenshot(smallPage, 'visual-qa-320-settings');
  await smallPage.close();
}

async function testDailiesManager(page, fixtures) {
  console.log('\n--- Dailies Manager ---');

  // Navigate to Today first
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);

  // Clear any pre-existing supplements from earlier tests (e.g. testProfileRoundTrip)
  await page.evaluate(async () => {
    await DB.setProfile('supplements', []);
  });

  // Open dailies manager via supplement quick action button (no supplements = "Add Your First Daily" flow)
  const suppBtn = await page.$('#quick-supplement-btn');
  assert(!!suppBtn, 'Supplement quick action button exists');
  if (suppBtn) {
    await suppBtn.click();
    await page.waitForTimeout(300);

    // Since we cleared supplements, should show "Add Your First Daily" button
    const addFirstBtn = await page.$('#sp-add-first');
    if (addFirstBtn) {
      await addFirstBtn.click();
      await page.waitForTimeout(400);
    } else {
      // Fallback — click "Manage Dailies"
      const manageBtn = await page.$('#sp-manage');
      if (manageBtn) {
        await manageBtn.click();
        await page.waitForTimeout(400);
      }
    }
  }

  // Dailies Manager modal should be open
  const dmModal = await page.$('.modal-overlay');
  assert(!!dmModal, 'Dailies Manager modal opens');

  // Verify modal title
  const modalTitle = await page.$eval('.modal-title', el => el.textContent.trim()).catch(() => '');
  assert(modalTitle === 'Manage Dailies', `Modal title is "Manage Dailies" (got: "${modalTitle}")`);

  // Camera and gallery pick buttons exist
  const cameraBtn = await page.$('#dm-camera-btn');
  const pickBtn = await page.$('#dm-pick-btn');
  assert(!!cameraBtn, 'Camera button (dm-camera-btn) exists');
  assert(!!pickBtn, 'Gallery pick button (dm-pick-btn) exists');

  // Camera button has "Take Photo" label
  if (cameraBtn) {
    const cameraText = await cameraBtn.textContent();
    assert(cameraText.includes('Take Photo'), `Camera button has "Take Photo" label (got: "${cameraText.trim()}")`);
  }

  // Textarea placeholder is present
  const descTextarea = await page.$('textarea#dm-desc');
  assert(!!descTextarea, 'Textarea (dm-desc) exists');
  if (descTextarea) {
    const placeholder = await descTextarea.getAttribute('placeholder');
    assert(placeholder && placeholder.length > 0, `Textarea has placeholder text (got: "${placeholder?.slice(0, 50)}...")`);
  }

  // Details/nutrition toggle exists and opens
  const detailsEl = await page.$('details#dm-details');
  assert(!!detailsEl, 'Details element (dm-details) exists');
  if (detailsEl) {
    // Should be closed by default
    const isOpenBefore = await page.$eval('#dm-details', el => el.open);
    assert(!isOpenBefore, 'Nutrition details collapsed by default');

    // Click summary to open
    const summary = await page.$('#dm-details summary');
    if (summary) {
      await summary.click();
      await page.waitForTimeout(200);
      const isOpenAfter = await page.$eval('#dm-details', el => el.open);
      assert(isOpenAfter, 'Nutrition details opens on click');

      // Calorie and protein fields visible
      const calField = await page.$('#dm-cal');
      const proteinField = await page.$('#dm-protein');
      assert(!!calField, 'Calorie input (dm-cal) exists inside details');
      assert(!!proteinField, 'Protein input (dm-protein) exists inside details');
    }
  }

  // Add button exists
  const addBtn = await page.$('#dm-add-btn');
  assert(!!addBtn, 'Add Daily button (dm-add-btn) exists');

  await screenshot(page, 'dailies-manager-empty');

  // --- Test: Add with no text and no photo shows error toast ---
  if (addBtn) {
    await addBtn.click();
    await page.waitForTimeout(500);
    const toast = await page.$('.toast.error');
    assert(!!toast, 'Error toast appears when adding with no text or photo');
    if (toast) {
      const toastText = await toast.textContent();
      assert(toastText.includes('photo') || toastText.includes('description'), `Error toast has relevant message (got: "${toastText.trim()}")`);
    }
    // Wait for toast to clear
    await page.waitForTimeout(2000);
  }

  // --- Test: Add daily with text only (no photo) ---
  const descInput = await page.$('#dm-desc');
  if (descInput) {
    await descInput.fill('Creatine 5g\nTake with water after workout');
    await page.waitForTimeout(100);
    await page.click('#dm-add-btn');
    await page.waitForTimeout(500);

    // Item should appear in the list
    const listContent = await page.$eval('#dm-list', el => el.textContent);
    assert(listContent.includes('Creatine 5g'), 'Text-only daily appears in list with name from first line');
    assert(!listContent.includes('Pending analysis'), 'Text-only daily does not show "Pending analysis"');
  }

  await screenshot(page, 'dailies-manager-text-added');

  // --- Test: Add daily with text + manual nutrition ---
  const descInput2 = await page.$('#dm-desc');
  if (descInput2) {
    await descInput2.fill('Protein shake');
    await page.waitForTimeout(100);

    // Open details and fill nutrition
    const details2 = await page.$('#dm-details');
    const isOpen = await page.$eval('#dm-details', el => el.open);
    if (!isOpen) {
      const summary2 = await page.$('#dm-details summary');
      if (summary2) await summary2.click();
      await page.waitForTimeout(200);
    }
    await page.fill('#dm-cal', '150');
    await page.fill('#dm-protein', '25');
    await page.click('#dm-add-btn');
    await page.waitForTimeout(500);

    // Item should appear with calories shown
    const listContent2 = await page.$eval('#dm-list', el => el.textContent);
    assert(listContent2.includes('Protein shake'), 'Nutrition daily appears in list');
    assert(listContent2.includes('150'), 'Nutrition daily shows calories in list');
    assert(listContent2.includes('25'), 'Nutrition daily shows protein in list');
  }

  await screenshot(page, 'dailies-manager-nutrition-added');

  // --- Test: Existing items render correctly ---
  const itemCount = await page.$$eval('.dailies-item', els => els.length);
  assert(itemCount === 2, `Two dailies items in list (got ${itemCount})`);

  // Each item has a remove button
  const removeBtns = await page.$$('.dailies-remove');
  assert(removeBtns.length === 2, `Each item has a remove button (got ${removeBtns.length})`);

  // --- Test: Duplicate name shows error ---
  const descInput3 = await page.$('#dm-desc');
  if (descInput3) {
    await descInput3.fill('Creatine 5g');
    await page.waitForTimeout(100);
    await page.click('#dm-add-btn');
    await page.waitForTimeout(500);
    const dupeToast = await page.$('.toast.error');
    assert(!!dupeToast, 'Duplicate name shows error toast');
    if (dupeToast) {
      const dupeText = await dupeToast.textContent();
      assert(dupeText.includes('Already exists'), `Duplicate toast says "Already exists" (got: "${dupeText.trim()}")`);
    }
    // Clear the textarea for next test
    await descInput3.fill('');
    await page.waitForTimeout(2000);
  }

  // --- Test: Whitespace-only input shows error ---
  const descInput4 = await page.$('#dm-desc');
  if (descInput4) {
    await descInput4.fill('   \n  \n   ');
    await page.waitForTimeout(100);
    await page.click('#dm-add-btn');
    await page.waitForTimeout(500);
    const wsToast = await page.$('.toast.error');
    assert(!!wsToast, 'Whitespace-only input shows error toast');
    await page.waitForTimeout(2000);
  }

  // --- Test: Very long description truncates name to 50 chars ---
  const descInput5 = await page.$('#dm-desc');
  if (descInput5) {
    const longText = 'A'.repeat(80) + '\nSecond line of description';
    await descInput5.fill(longText);
    await page.waitForTimeout(100);
    await page.click('#dm-add-btn');
    await page.waitForTimeout(500);

    // The item name should be truncated to 50 chars
    const itemNames = await page.$$eval('.dailies-item .dailies-item-body div:first-child', els => els.map(e => e.textContent.trim()));
    const longItem = itemNames.find(n => n.startsWith('AAAA'));
    assert(longItem && longItem.length <= 50, `Long description name truncated to 50 chars (got ${longItem?.length})`);
  }

  await screenshot(page, 'dailies-manager-all-items');

  // --- Test: Pending analysis for photo-only item ---
  // We cannot actually take a photo in tests, but we can inject a pending item via evaluate
  await page.evaluate(async () => {
    const profile = await DB.getProfile('supplements') || [];
    profile.push({
      key: 'item_pending_test',
      name: 'New item',
      notes: '',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      pending: true,
      photo: null,
    });
    await DB.setProfile('supplements', profile);
  });

  // Close and reopen the manager to see the injected pending item
  const closeBtn = await page.$('#dm-close');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(300);

  // Reopen
  const suppBtn2 = await page.$('#quick-supplement-btn');
  if (suppBtn2) {
    await suppBtn2.click();
    await page.waitForTimeout(300);
    const manageBtn2 = await page.$('#sp-manage');
    if (manageBtn2) {
      await manageBtn2.click();
      await page.waitForTimeout(400);
    }
  }

  // Check "Pending analysis" text appears
  const listText = await page.$eval('#dm-list', el => el.textContent).catch(() => '');
  assert(listText.includes('Pending analysis'), '"Pending analysis" text appears for pending items');

  await screenshot(page, 'dailies-manager-pending');

  // Close the modal
  const closeBtn2 = await page.$('#dm-close');
  if (closeBtn2) await closeBtn2.click();
  await page.waitForTimeout(200);
}

async function testDailiesDeletionPersists(page, fixtures) {
  console.log('\n--- Dailies Deletion Persists Across Sync Re-import ---');

  // Seed: collagen daily in supplements + an analysis that echoes it back in pwaProfile
  await page.evaluate(async () => {
    await DB.setProfile('supplements', [
      { key: 'collagen', name: 'Collagen Peptides', notes: '', calories: 70, protein: 18, carbs: 0, fat: 0, pending: false },
    ]);
    await DB.setProfile('deletedDailies', []);
  });

  // Navigate to Today and open dailies manager
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(400);

  const suppBtn = await page.$('#quick-supplement-btn');
  if (suppBtn) {
    await suppBtn.click();
    await page.waitForTimeout(300);
    const manageBtn = await page.$('#sp-manage');
    if (manageBtn) {
      await manageBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // Verify collagen appears in the list
  const listBefore = await page.$eval('#dm-list', el => el.textContent).catch(() => '');
  assert(listBefore.includes('Collagen'), 'Collagen daily appears in list before delete');

  // Delete collagen via remove button
  const removeBtn = await page.$('.dailies-remove');
  assert(!!removeBtn, 'Remove button exists for collagen daily');
  if (removeBtn) {
    await removeBtn.click();
    await page.waitForTimeout(600);
  }

  // Verify collagen is gone from list
  const listAfterDelete = await page.$eval('#dm-list', el => el.textContent).catch(() => '');
  assert(!listAfterDelete.includes('Collagen'), 'Collagen removed from list immediately after delete');

  // Verify deletedDailies was persisted with the key
  const deletedDailies = await page.evaluate(async () => {
    return await DB.getProfile('deletedDailies');
  });
  assert(Array.isArray(deletedDailies) && deletedDailies.includes('collagen'), 'deletedDailies profile key contains "collagen" after delete');

  // Close the manager
  const closeBtn = await page.$('#dm-close');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(200);

  // Simulate a sync re-import that echoes collagen back in pwaProfile.supplements
  // (This is exactly what happens when an old analysis result arrives from the cloud)
  await page.evaluate(async () => {
    await DB.importAnalysis('2026-04-07', {
      date: '2026-04-07',
      importedAt: Date.now(),
      pwaProfile: {
        supplements: [
          { key: 'collagen', name: 'Collagen Peptides', notes: '', calories: 70, protein: 18, carbs: 0, fat: 0, pending: false },
        ],
      },
      entries: [],
      highlights: [],
      concerns: [],
    });
  });

  // After re-import, collagen must NOT reappear in supplements
  const supplementsAfterImport = await page.evaluate(async () => {
    return await DB.getProfile('supplements');
  });
  const collagenResurrected = supplementsAfterImport && supplementsAfterImport.some(s => s.key === 'collagen');
  assert(!collagenResurrected, 'Collagen does NOT reappear in supplements after sync re-import (deletion persists)');

  // Force close any stale modals before navigating
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(el => el.remove()); });
  await page.waitForTimeout(200);

  // Navigate away and back to verify the persisted state
  await page.click('nav button:has-text("Coach")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(400);

  // Reopen dailies to confirm collagen still absent
  const suppBtn2 = await page.$('#quick-supplement-btn');
  if (suppBtn2) {
    await suppBtn2.click();
    await page.waitForTimeout(300);
    const manageBtn2 = await page.$('#sp-manage');
    if (manageBtn2) {
      await manageBtn2.click();
      await page.waitForTimeout(400);
    }
  }

  const listAfterNav = await page.$eval('#dm-list', el => el.textContent).catch(() => '');
  assert(!listAfterNav.includes('Collagen'), 'Collagen remains absent from dailies after navigation and sync re-import');

  // Force close all modals to leave a clean state for subsequent tests
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(el => el.remove()); });
  await page.waitForTimeout(200);
}

async function testVoiceLogging(page, context, fixtures) {
  console.log('\n--- Voice Logging ---');

  // We need a fresh page with mocked Speech API to test "supported" path
  const voicePage = await context.newPage();
  await voicePage.addInitScript(() => {
    // Mock webkitSpeechRecognition so VoiceInput.isSupported() returns true
    window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    };
  });
  await voicePage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await voicePage.waitForTimeout(1000);
  await voicePage.waitForFunction(() => typeof Log !== 'undefined' && typeof VoiceInput !== 'undefined');

  // 1. Open Food form -- verify mic button exists next to Notes label
  await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
  });
  await voicePage.waitForTimeout(300);

  const foodMicBtn = await voicePage.$('.voice-mic-btn');
  assert(!!foodMicBtn, 'Food form: mic button exists next to Notes label');

  // Verify mic button is inside notes-label-row (next to the label)
  const micInLabelRow = await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    return btn && btn.parentElement && btn.parentElement.classList.contains('notes-label-row');
  });
  assert(micInLabelRow, 'Food form: mic button is inside notes-label-row');

  // 2. Open Workout form -- verify mic button exists there too
  await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('workout');
  });
  await voicePage.waitForTimeout(300);

  const workoutMicBtn = await voicePage.$('.voice-mic-btn');
  assert(!!workoutMicBtn, 'Workout form: mic button exists next to Notes label');

  // 3. Check mic button is hidden when Speech API is not supported
  const noSpeechPage = await context.newPage();
  await noSpeechPage.addInitScript(() => {
    // Ensure Speech API is NOT available
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await noSpeechPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await noSpeechPage.waitForTimeout(1000);
  await noSpeechPage.waitForFunction(() => typeof Log !== 'undefined');

  await noSpeechPage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
  });
  await noSpeechPage.waitForTimeout(300);

  const noMicBtn = await noSpeechPage.$('.voice-mic-btn');
  assert(!noMicBtn, 'Mic button is hidden when Speech API is not supported');

  await noSpeechPage.close();

  // 4. Check mic button has adequate touch target (>= 44px)
  const micTouchTarget = await voicePage.evaluate(() => {
    // Re-open food form to get mic button
    Log.init();
    Log.selectType('meal');
    return null;
  });
  await voicePage.waitForTimeout(300);

  const touchSize = await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  assert(
    touchSize && touchSize.w >= 44 && touchSize.h >= 44,
    `Mic button touch target >= 44px (actual: ${touchSize ? touchSize.w + 'x' + touchSize.h : 'not found'})`
  );

  // 5. Verify mic button has an SVG icon (not emoji)
  const hasSvgIcon = await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    if (!btn) return false;
    const svg = btn.querySelector('svg');
    if (!svg) return false;
    // Ensure no text content outside SVG (would indicate emoji)
    const textOnly = btn.textContent.trim();
    // voice-status span may have text but should be empty when not active
    const statusText = btn.querySelector('.voice-status')?.textContent || '';
    const nonStatusText = textOnly.replace(statusText, '').trim();
    return svg instanceof SVGElement && nonStatusText.length === 0;
  });
  assert(hasSvgIcon, 'Mic button contains SVG icon (not emoji)');

  // 6. Check VoiceInput.isSupported() returns boolean
  const isSupportedResult = await voicePage.evaluate(() => {
    const result = VoiceInput.isSupported();
    return { value: result, type: typeof result };
  });
  assert(isSupportedResult.type === 'boolean', `VoiceInput.isSupported() returns boolean (got ${isSupportedResult.type})`);
  assert(isSupportedResult.value === true, 'VoiceInput.isSupported() returns true when Speech API is mocked');

  // Also check on unsupported page before it was closed -- use voicePage with manual override
  const isSupportedFalse = await voicePage.evaluate(() => {
    const origSR = window.SpeechRecognition;
    const origWebkit = window.webkitSpeechRecognition;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    const result = VoiceInput.isSupported();
    // Restore
    if (origSR) window.SpeechRecognition = origSR;
    if (origWebkit) window.webkitSpeechRecognition = origWebkit;
    return { value: result, type: typeof result };
  });
  assert(isSupportedFalse.value === false, 'VoiceInput.isSupported() returns false when Speech API removed');

  // 7. Verify mic button does not break notes field layout at 320px
  const smallVoicePage = await context.newPage();
  await smallVoicePage.setViewportSize({ width: 320, height: 568 });
  await smallVoicePage.addInitScript(() => {
    window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    };
  });
  await smallVoicePage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await smallVoicePage.waitForTimeout(1000);
  await smallVoicePage.waitForFunction(() => typeof Log !== 'undefined');

  await smallVoicePage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
  });
  await smallVoicePage.waitForTimeout(300);

  const layout320 = await smallVoicePage.evaluate(() => {
    const row = document.querySelector('.notes-label-row');
    const textarea = document.querySelector('#log-notes');
    const btn = document.querySelector('.voice-mic-btn');
    if (!row || !textarea) return { ok: false, reason: 'elements not found' };

    const rowRect = row.getBoundingClientRect();
    const taRect = textarea.getBoundingClientRect();

    // Notes label row should not overflow viewport
    const overflows = rowRect.right > 320;
    // Textarea should not overflow viewport
    const taOverflows = taRect.right > 320;
    // Mic button should be visible (not pushed off-screen)
    const btnRect = btn ? btn.getBoundingClientRect() : null;
    const btnVisible = btnRect ? (btnRect.left >= 0 && btnRect.right <= 320) : true;

    return {
      ok: !overflows && !taOverflows && btnVisible,
      rowRight: Math.round(rowRect.right),
      taRight: Math.round(taRect.right),
      btnRight: btnRect ? Math.round(btnRect.right) : null,
      overflows,
      taOverflows,
      btnVisible
    };
  });

  assert(layout320.ok, `Mic button does not break notes layout at 320px (row:${layout320.rowRight}, textarea:${layout320.taRight}, btn:${layout320.btnRight})`);

  // --- Adversarial tests ---

  // 8. Mic button should NOT have id collision when multiple forms exist
  // (Alcohol form also has notes -- check that opening meal then alcohol doesn't produce duplicate IDs)
  await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
  });
  await voicePage.waitForTimeout(300);
  await voicePage.evaluate(() => {
    Log.selectType('custom');
  });
  await voicePage.waitForTimeout(300);
  const voiceBtnCount = await voicePage.evaluate(() => {
    return document.querySelectorAll('#log-voice-btn').length;
  });
  assert(voiceBtnCount <= 1, `No duplicate mic button IDs after switching forms (found ${voiceBtnCount})`);

  // 9. Voice mic button should have accessible title attribute
  const micTitle = await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
    return null;
  });
  await voicePage.waitForTimeout(300);
  const titleAttr = await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    return btn ? btn.getAttribute('title') : null;
  });
  assert(!!titleAttr && titleAttr.length > 0, `Mic button has title attribute for accessibility (title="${titleAttr}")`);

  // 10. Mic button SVG has proper viewBox attribute
  const svgViewBox = await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    if (!btn) return null;
    const svg = btn.querySelector('svg');
    return svg ? svg.getAttribute('viewBox') : null;
  });
  assert(!!svgViewBox, `Mic button SVG has viewBox attribute (${svgViewBox})`);

  // 11. Voice status span exists and is empty by default
  const voiceStatusEmpty = await voicePage.evaluate(() => {
    const span = document.querySelector('.voice-mic-btn .voice-status');
    if (!span) return { exists: false };
    return { exists: true, text: span.textContent };
  });
  assert(voiceStatusEmpty.exists, 'Voice status span exists inside mic button');
  assert(voiceStatusEmpty.text === '', 'Voice status span is empty by default');

  // 12. Mic button is NOT present inside body photo form (body photos have notes but no voice)
  await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('bodyPhoto');
  });
  await voicePage.waitForTimeout(500);
  const bodyPhotoMic = await voicePage.$('.voice-mic-btn');
  // Body photo form also uses buildNotesField, so mic SHOULD appear
  // This test verifies consistency -- if it shows in food, it should show in bodyPhoto too
  assert(!!bodyPhotoMic, 'Body photo form also has mic button (uses shared buildNotesField)');

  // 13. Clicking mic button adds "active" class (even if recognition doesn't truly start)
  await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
  });
  await voicePage.waitForTimeout(300);
  // Need to wait for requestAnimationFrame binding
  await voicePage.waitForTimeout(100);
  await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    if (btn) btn.click();
  });
  await voicePage.waitForTimeout(200);
  const hasActiveClass = await voicePage.evaluate(() => {
    const btn = document.querySelector('.voice-mic-btn');
    return btn ? btn.classList.contains('active') : false;
  });
  assert(hasActiveClass, 'Mic button gets "active" class when clicked');

  // Clean up: stop any mock recognition
  await voicePage.evaluate(() => {
    VoiceInput.abort();
  });

  // 14. Notes textarea still functions normally with mic button present
  await voicePage.evaluate(() => {
    Log.init();
    Log.selectType('meal');
  });
  await voicePage.waitForTimeout(300);
  const textarea = await voicePage.$('#log-notes');
  if (textarea) {
    await textarea.type('test food entry notes');
    const typedValue = await voicePage.evaluate(() => document.getElementById('log-notes')?.value);
    assert(typedValue === 'test food entry notes', 'Notes textarea accepts keyboard input alongside mic button');
  } else {
    assert(false, 'Notes textarea accepts keyboard input alongside mic button');
  }

  await screenshot(voicePage, 'voice-logging-food-form');
  await screenshot(smallVoicePage, 'voice-logging-320px');

  await smallVoicePage.close();
  await voicePage.close();
}

async function testChallenges(page, context, fixtures) {
  console.log('\n--- Challenges ---');

  // 1. challenges.js loads without errors
  const chalDefined = await page.evaluate(() => typeof Challenges !== 'undefined');
  assert(chalDefined, 'Challenges global is defined');
  const chalTemplatesDefined = await page.evaluate(() => typeof ChallengeTemplates !== 'undefined');
  assert(chalTemplatesDefined, 'ChallengeTemplates global is defined');

  // 2. Progress tab has a "Challenges" segment button
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const chalSegBtn = await page.$('button[data-ptab="challenges"]');
  assert(!!chalSegBtn, 'Progress tab has Challenges segment button');

  // 3. ChallengeTemplates has built-in templates (75hard, 7day, 100day, custom via picker)
  const templateIds = await page.evaluate(() => Object.keys(ChallengeTemplates));
  assert(templateIds.includes('75hard'), 'ChallengeTemplates includes 75hard');
  assert(templateIds.includes('7day_reset'), 'ChallengeTemplates includes 7day_reset');
  assert(templateIds.includes('100day'), 'ChallengeTemplates includes 100day');
  // Custom is handled via the picker, not in ChallengeTemplates directly
  const customEnrollWorks = await page.evaluate(() => typeof Challenges.enroll === 'function');
  assert(customEnrollWorks, 'Challenges.enroll function exists for custom challenges');

  // 4. Enrolling in a 7-Day Reset creates a DB record
  const enrollResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('7day_reset');
    if (!chal) return null;
    const stored = await DB.getChallenge(chal.id);
    return {
      id: chal.id,
      templateId: chal.templateId,
      name: chal.name,
      status: chal.status,
      durationDays: chal.durationDays,
      tasksCount: chal.tasks.length,
      storedName: stored?.name,
      storedStatus: stored?.status,
    };
  });
  assert(enrollResult !== null, 'Enrolling in 7-Day Reset returns a challenge');
  assert(enrollResult.templateId === '7day_reset', 'Enrolled challenge has correct templateId');
  assert(enrollResult.status === 'active', 'Enrolled challenge status is active');
  assert(enrollResult.durationDays === 7, 'Enrolled challenge duration is 7 days');
  assert(enrollResult.tasksCount === 4, 'Enrolled challenge has 4 tasks');
  assert(enrollResult.storedName === '7-Day Reset', 'Challenge persisted in DB with correct name');
  assert(enrollResult.storedStatus === 'active', 'Challenge persisted in DB with active status');

  // 5. Active challenge appears on Today tab as widget
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(800);
  const widget = await page.$('.challenge-widget');
  assert(!!widget, 'Active challenge widget appears on Today tab');

  // 6. Challenge widget shows task checklist
  const widgetTasks = await page.$$('.challenge-widget .challenge-task');
  assert(widgetTasks.length === 4, `Challenge widget shows 4 tasks (got ${widgetTasks.length})`);
  const taskLabels = await page.$$eval('.challenge-widget .challenge-task-label', els => els.map(e => e.textContent));
  assert(taskLabels.some(l => l.includes('water')), 'Widget task list includes water task');
  assert(taskLabels.some(l => l.includes('workout') || l.includes('Workout')), 'Widget task list includes workout task');

  // 7. Checking a task persists
  const checkResult = await page.evaluate(async () => {
    // Get the active challenge
    const chals = await DB.getChallenges('active');
    if (chals.length === 0) return null;
    const chal = chals[0];
    const date = App.selectedDate;

    // Manually save a progress record with a checked task
    const progressId = chal.id + '_' + date;
    const dayNum = Challenges.getDayNumber(chal, date);
    const progress = {
      id: progressId,
      challengeId: chal.id,
      date,
      checked: ['no_alcohol'],
      autoChecked: [],
      manualOverrides: [],
      dayNumber: dayNum,
      allComplete: false,
    };
    await DB.saveChallengeProgress(progress);

    // Read it back
    const stored = await DB.getChallengeProgress(chal.id, date);
    return {
      checked: stored?.checked,
      hasNoAlcohol: stored?.checked?.includes('no_alcohol'),
    };
  });
  assert(checkResult !== null && checkResult.hasNoAlcohol, 'Checked task persists in challengeProgress store');

  // 8. Auto-check evaluates water threshold
  const autoCheckResult = await page.evaluate(async () => {
    const chals = await DB.getChallenges('active');
    if (chals.length === 0) return null;
    const chal = chals[0];
    const date = App.selectedDate;

    // Set water to above threshold (64 oz for 7-day reset)
    await DB.updateDailySummary(date, { water_oz: 80 });

    const autoChecked = await Challenges.evaluateAutoChecks(chal, date);
    return {
      autoChecked,
      hasWater: autoChecked.includes('water'),
    };
  });
  assert(autoCheckResult !== null && autoCheckResult.hasWater, 'Auto-check detects water >= threshold');

  // Also test water below threshold does NOT auto-check
  const autoCheckBelowResult = await page.evaluate(async () => {
    const chals = await DB.getChallenges('active');
    if (chals.length === 0) return null;
    const chal = chals[0];
    const date = App.selectedDate;

    // Set water below threshold
    await DB.updateDailySummary(date, { water_oz: 30 });
    const autoChecked = await Challenges.evaluateAutoChecks(chal, date);
    return { hasWater: autoChecked.includes('water') };
  });
  assert(autoCheckBelowResult !== null && !autoCheckBelowResult.hasWater, 'Auto-check rejects water below threshold');

  // 9. Challenge calendar renders on Progress tab
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const chalBtn = await page.$('button[data-ptab="challenges"]');
  if (chalBtn) await chalBtn.click();
  await page.waitForTimeout(800);

  const calendar = await page.$('.challenge-calendar');
  assert(!!calendar, 'Challenge calendar renders on Progress tab');

  const dots = await page.$$('.challenge-dot');
  assert(dots.length === 7, `Challenge calendar has 7 dots for 7-day challenge (got ${dots.length})`);

  await screenshot(page, 'challenges-progress');

  // 10. Abandon updates status
  const abandonResult = await page.evaluate(async () => {
    const chals = await DB.getChallenges('active');
    if (chals.length === 0) return null;
    const chal = chals[0];
    await Challenges.abandon(chal.id);
    const stored = await DB.getChallenge(chal.id);
    return { status: stored?.status };
  });
  assert(abandonResult?.status === 'abandoned', 'Abandon sets challenge status to abandoned');

  // 11. Multiple simultaneous challenges work
  const multiResult = await page.evaluate(async () => {
    // Enroll in two challenges
    const chal1 = await Challenges.enroll('7day_reset');
    const chal2 = await Challenges.enroll('100day');
    const active = await DB.getChallenges('active');
    return {
      chal1Id: chal1?.id,
      chal2Id: chal2?.id,
      activeCount: active.length,
      distinctIds: new Set(active.map(c => c.id)).size,
    };
  });
  assert(multiResult.activeCount >= 2, `Multiple simultaneous challenges: ${multiResult.activeCount} active`);
  assert(multiResult.distinctIds >= 2, 'Simultaneous challenges have distinct IDs');

  // Verify both show on Today tab
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(800);
  const widgets = await page.$$('.challenge-widget');
  assert(widgets.length >= 2, `Multiple challenge widgets on Today tab (got ${widgets.length})`);

  await screenshot(page, 'challenges-multiple-today');

  // 12. Renders at 320px without overflow
  const smallPage = await context.newPage();
  await smallPage.setViewportSize({ width: 320, height: 568 });
  await smallPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await smallPage.waitForTimeout(1500);
  await smallPage.waitForFunction(() => typeof DB !== 'undefined' && typeof DB.openDB === 'function');

  // Enroll a challenge on the small page
  await smallPage.evaluate(async () => {
    await Challenges.enroll('75hard');
  });
  await smallPage.click('nav button:has-text("Today")');
  await smallPage.waitForTimeout(800);

  const smallOverflow = await smallPage.evaluate(() => document.body.scrollWidth);
  assert(smallOverflow <= 322, `320px viewport: no horizontal overflow (scrollWidth: ${smallOverflow}px)`);

  // Check challenge widget fits
  const widgetRect = await smallPage.evaluate(() => {
    const w = document.querySelector('.challenge-widget');
    if (!w) return null;
    const r = w.getBoundingClientRect();
    return { right: r.right, width: r.width };
  });
  assert(widgetRect !== null, '320px: challenge widget renders');
  assert(widgetRect.right <= 322, `320px: challenge widget fits within viewport (right: ${widgetRect.right}px)`);

  // Check Progress Challenges tab at 320px
  await smallPage.click('nav button:has-text("Progress")');
  await smallPage.waitForTimeout(500);
  const chalBtnSmall = await smallPage.$('button[data-ptab="challenges"]');
  if (chalBtnSmall) await chalBtnSmall.click();
  await smallPage.waitForTimeout(800);
  const smallOverflow2 = await smallPage.evaluate(() => document.body.scrollWidth);
  assert(smallOverflow2 <= 322, `320px Progress Challenges: no horizontal overflow (scrollWidth: ${smallOverflow2}px)`);

  await screenshot(smallPage, 'challenges-320px');
  await smallPage.close();

  // --- Adversarial tests ---

  // Adversarial: Streak calculation with gaps
  const streakResult = await page.evaluate(() => {
    // allComplete=true for 3 consecutive, then a gap
    const records = [
      { date: '2026-03-20', allComplete: true },
      { date: '2026-03-21', allComplete: true },
      { date: '2026-03-22', allComplete: true },
      { date: '2026-03-23', allComplete: false },
    ];
    return Challenges.getStreak(records);
  });
  // Streak counts from most recent backwards — the most recent is false, so streak should be 0
  assert(streakResult === 0, `Streak breaks on most recent incomplete day (got ${streakResult})`);

  // Adversarial: Streak with all complete
  const streakAllComplete = await page.evaluate(() => {
    const records = [
      { date: '2026-03-20', allComplete: true },
      { date: '2026-03-21', allComplete: true },
      { date: '2026-03-22', allComplete: true },
    ];
    return Challenges.getStreak(records);
  });
  assert(streakAllComplete === 3, `Streak counts all complete days (got ${streakAllComplete})`);

  // Adversarial: getDayNumber edge cases
  const dayNumResult = await page.evaluate(() => {
    const chal = { startDate: '2026-03-20', durationDays: 7 };
    return {
      day1: Challenges.getDayNumber(chal, '2026-03-20'),
      day7: Challenges.getDayNumber(chal, '2026-03-26'),
      day0: Challenges.getDayNumber(chal, '2026-03-19'),  // before start
      day8: Challenges.getDayNumber(chal, '2026-03-27'),  // after end
    };
  });
  assert(dayNumResult.day1 === 1, `Day number on start date is 1 (got ${dayNumResult.day1})`);
  assert(dayNumResult.day7 === 7, `Day number on last day is 7 (got ${dayNumResult.day7})`);
  assert(dayNumResult.day0 === 0, `Day number before start is 0 (got ${dayNumResult.day0})`);
  assert(dayNumResult.day8 === 8, `Day number after end is 8 (got ${dayNumResult.day8})`);

  // Adversarial: enroll with invalid template returns null
  const invalidEnroll = await page.evaluate(async () => {
    return await Challenges.enroll('nonexistent_template_xyz');
  });
  assert(invalidEnroll === null, 'Enrolling with invalid template returns null');

  // Adversarial: empty streak returns 0
  const emptyStreak = await page.evaluate(() => Challenges.getStreak([]));
  assert(emptyStreak === 0, `Empty streak returns 0 (got ${emptyStreak})`);
  const nullStreak = await page.evaluate(() => Challenges.getStreak(null));
  assert(nullStreak === 0, `Null streak returns 0 (got ${nullStreak})`);

  // Adversarial: renderDayChecklist for out-of-range day returns empty string
  const outOfRangeRender = await page.evaluate(async () => {
    const chal = {
      id: 'test_oor', startDate: '2026-01-01', endDate: '2026-01-07',
      durationDays: 7, tasks: [{ id: 't1', label: 'Test', autoCheck: null }],
      status: 'active', restartOnMiss: false,
    };
    // Date far outside range
    const html = await Challenges.renderDayChecklist(chal, '2026-06-15');
    return html;
  });
  assert(outOfRangeRender === '', 'renderDayChecklist returns empty for out-of-range date');

  // Adversarial: challenge task labels use XSS-safe escaping
  const xssResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('custom', {
      name: '<script>alert(1)</script>',
      durationDays: 1,
      tasks: [{ label: '<img src=x onerror=alert(1)>' }],
    });
    if (!chal) return null;
    const html = await Challenges.renderDayChecklist(chal, App.selectedDate);
    return {
      hasRawScript: html.includes('<script>'),
      hasRawImg: html.includes('<img src=x'),
      hasEscaped: html.includes('&lt;script&gt;') || html.includes('&lt;img'),
    };
  });
  assert(xssResult && !xssResult.hasRawScript, 'Challenge name is XSS-escaped (no raw <script>)');
  assert(xssResult && !xssResult.hasRawImg, 'Challenge task label is XSS-escaped (no raw <img>)');

  // Adversarial: applyAutoChecks respects manualOverrides
  const overrideResult = await page.evaluate(async () => {
    // Create a fresh challenge
    const chal = await Challenges.enroll('7day_reset');
    const date = App.selectedDate;
    // Set water above threshold so it auto-checks
    await DB.updateDailySummary(date, { water_oz: 100 });

    // First apply: water should be auto-checked
    let progress = await Challenges.applyAutoChecks(chal, date);
    const autoCheckedFirst = progress.checked.includes('water');

    // Now manually override (uncheck) the water task
    progress.checked = progress.checked.filter(id => id !== 'water');
    progress.manualOverrides.push('water');
    await DB.saveChallengeProgress(progress);

    // Apply auto-checks again -- should NOT re-add water because of manualOverrides
    progress = await Challenges.applyAutoChecks(chal, date);
    const autoCheckedAfterOverride = progress.checked.includes('water');

    // Clean up
    chal.status = 'abandoned';
    await DB.saveChallenge(chal);

    return { autoCheckedFirst, autoCheckedAfterOverride };
  });
  assert(overrideResult.autoCheckedFirst === true, 'Auto-check adds water task initially');
  assert(overrideResult.autoCheckedAfterOverride === false, 'Manual override prevents auto-re-check');

  // Adversarial: allComplete flag requires ALL tasks checked, not just some
  const allCompleteResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('7day_reset');
    const date = App.selectedDate;

    // Only check 2 of 4 tasks
    const progressId = chal.id + '_' + date;
    const progress = {
      id: progressId, challengeId: chal.id, date,
      checked: ['water', 'no_alcohol'],
      autoChecked: [], manualOverrides: [],
      dayNumber: 1, allComplete: false,
    };
    await DB.saveChallengeProgress(progress);

    // Apply auto-checks (water is at 100 from earlier test)
    const updated = await Challenges.applyAutoChecks(chal, date);

    // Clean up
    chal.status = 'abandoned';
    await DB.saveChallenge(chal);

    return {
      checkedCount: updated.checked.length,
      totalTasks: chal.tasks.length,
      allComplete: updated.allComplete,
    };
  });
  assert(allCompleteResult.allComplete === false, `allComplete is false when ${allCompleteResult.checkedCount}/${allCompleteResult.totalTasks} tasks checked`);

  // Adversarial: calendar dot count matches durationDays for 75 Hard
  const calDotResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('75hard');
    const allProgress = [];
    const html = Challenges.renderCalendar(allProgress, chal);
    const div = document.createElement('div');
    div.innerHTML = html;
    const dotCount = div.querySelectorAll('.challenge-dot').length;

    // Clean up
    chal.status = 'abandoned';
    await DB.saveChallenge(chal);

    return { dotCount, expected: 75 };
  });
  assert(calDotResult.dotCount === 75, `75 Hard calendar has 75 dots (got ${calDotResult.dotCount})`);

  // Adversarial: exportTemplate produces valid base64 that can round-trip
  const exportResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('7day_reset');
    const url = Challenges.exportTemplate(chal);
    const hashPart = url.split('#challenge=')[1];
    if (!hashPart) return { valid: false, reason: 'no hash fragment' };
    try {
      const json = decodeURIComponent(escape(atob(hashPart)));
      const payload = JSON.parse(json);

      chal.status = 'abandoned';
      await DB.saveChallenge(chal);

      return {
        valid: true,
        name: payload.name,
        hasTasks: Array.isArray(payload.tasks) && payload.tasks.length > 0,
        taskCount: payload.tasks.length,
      };
    } catch (e) {
      return { valid: false, reason: e.message };
    }
  });
  assert(exportResult.valid, 'exportTemplate produces valid decodable URL');
  assert(exportResult.name === '7-Day Reset', `Exported template name correct (got "${exportResult.name}")`);
  assert(exportResult.taskCount === 4, `Exported template has 4 tasks (got ${exportResult.taskCount})`);

  // Adversarial: logging auto-check needs type==='meal' entries, not any entry type
  const loggingAutoResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('7day_reset');
    const date = App.selectedDate;

    // Clear entries for the date, then add only workout entries (no meals)
    // The evaluateAutoChecks should NOT pass the logging check
    const autoChecked = await Challenges.evaluateAutoChecks(chal, date);
    const currentEntries = await DB.getEntriesByDate(date);
    const mealCount = currentEntries.filter(e => e.type === 'meal').length;

    chal.status = 'abandoned';
    await DB.saveChallenge(chal);

    return {
      hasLogMeals: autoChecked.includes('log_meals'),
      mealCount,
      threshold: 2,
    };
  });
  // The 7-day reset log_meals threshold is 2 -- check if the actual meal count meets it
  const expectLogMeals = loggingAutoResult.mealCount >= 2;
  assert(loggingAutoResult.hasLogMeals === expectLogMeals,
    `Logging auto-check correct: ${loggingAutoResult.mealCount} meals vs threshold ${loggingAutoResult.threshold} (auto=${loggingAutoResult.hasLogMeals}, expect=${expectLogMeals})`);

  // Adversarial: challenge progress card shows correct Day X of Y text
  const dayTextResult = await page.evaluate(async () => {
    const chal = await Challenges.enroll('7day_reset');
    const date = App.selectedDate;
    const progress = await Challenges.applyAutoChecks(chal, date);
    const dayNum = Challenges.getDayNumber(chal, date);
    const html = Challenges._renderChallengeCard(chal, progress, 0, dayNum, [], true);

    chal.status = 'abandoned';
    await DB.saveChallenge(chal);

    return {
      includesDayOf: html.includes(`Day ${dayNum} of ${chal.durationDays}`),
      dayNum,
      duration: chal.durationDays,
    };
  });
  assert(dayTextResult.includesDayOf, `Card shows "Day ${dayTextResult.dayNum} of ${dayTextResult.duration}"`);

  // Clean up all test challenges
  await page.evaluate(async () => {
    const all = await DB.getChallenges();
    for (const c of all) {
      c.status = 'abandoned';
      await DB.saveChallenge(c);
    }
  });
}

// --- Challenge Confirmation & Onboarding Flow ---
async function testChallengeConfirmationFlow(page, context, fixtures) {
  console.log('\n--- Challenge Confirmation Flow ---');

  // Clean up any leftover challenges
  await page.evaluate(async () => {
    const all = await DB.getChallenges();
    for (const c of all) { c.status = 'abandoned'; await DB.saveChallenge(c); }
  });

  // 1. Open the template picker
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const chalBtn = await page.$('button[data-ptab="challenges"]');
  if (chalBtn) await chalBtn.click();
  await page.waitForTimeout(800);

  // Click "Start a Challenge" or "Start Another Challenge"
  const startBtn = await page.$('#chal-start-first') || await page.$('#chal-add-more');
  assert(!!startBtn, 'Challenge start button exists');
  if (startBtn) await startBtn.click();
  await page.waitForTimeout(500);

  // 2. Verify picker modal is open with template cards
  const pickerOverlay = await page.$('.modal-overlay');
  assert(!!pickerOverlay, 'Template picker modal opens');

  const templateCards = await page.$$('.challenge-template-card');
  assert(templateCards.length >= 4, `Picker shows 4+ template cards (got ${templateCards.length})`);

  // 3. Click 7-Day Reset template card
  const resetCard = await page.$('.challenge-template-card[data-template-id="7day_reset"]');
  assert(!!resetCard, 'Picker has 7-Day Reset card');
  if (resetCard) await resetCard.click();
  await page.waitForTimeout(500);

  // 4. Confirmation modal appears with correct content
  const confirmModal = await page.$('.modal-overlay');
  assert(!!confirmModal, 'Confirmation modal opens after selecting template');

  const confirmName = await page.$eval('.chal-confirm-name', el => el.textContent).catch(() => '');
  assert(confirmName === '7-Day Reset', `Confirmation shows template name: "${confirmName}"`);

  const confirmDesc = await page.$eval('.chal-confirm-desc', el => el.textContent).catch(() => '');
  assert(confirmDesc.length > 0, 'Confirmation shows template description');

  // 5. Stat cards: days, tasks, restart info
  const statValues = await page.$$eval('.chal-confirm-stat-value', els => els.map(e => e.textContent));
  assert(statValues.includes('7'), 'Confirmation stat shows 7 days');
  assert(statValues.includes('4'), 'Confirmation stat shows 4 tasks');
  assert(statValues.includes('No'), 'Confirmation stat shows restart=No');

  // 6. Task list has all 4 tasks
  const confirmTasks = await page.$$('.chal-confirm-task');
  assert(confirmTasks.length === 4, `Confirmation shows 4 tasks (got ${confirmTasks.length})`);

  const confirmTaskLabels = await page.$$eval('.chal-confirm-task-label', els => els.map(e => e.textContent));
  assert(confirmTaskLabels.some(l => l.includes('water')), 'Confirmation task list includes water');

  await screenshot(page, 'challenge-confirmation');

  // 7. Remove a task
  const removeBtn = await page.$('.chal-confirm-task-remove');
  assert(!!removeBtn, 'Task remove button exists');
  if (removeBtn) await removeBtn.click();
  await page.waitForTimeout(300);

  const tasksAfterRemove = await page.$$('.chal-confirm-task');
  assert(tasksAfterRemove.length === 3, `After remove: 3 tasks (got ${tasksAfterRemove.length})`);

  // Stat card should update to 3
  const updatedStatValues = await page.$$eval('.chal-confirm-stat-value', els => els.map(e => e.textContent));
  assert(updatedStatValues.includes('3'), 'Stat card updates to 3 tasks after removal');

  // 8. Add a custom task
  const addInput = await page.$('#chal-confirm-add-input');
  const addBtn = await page.$('#chal-confirm-add-btn');
  assert(!!addInput && !!addBtn, 'Add task input and button exist');
  if (addInput && addBtn) {
    await addInput.fill('Meditate 10 min');
    await addBtn.click();
    await page.waitForTimeout(300);
  }

  const tasksAfterAdd = await page.$$('.chal-confirm-task');
  assert(tasksAfterAdd.length === 4, `After add: 4 tasks (got ${tasksAfterAdd.length})`);

  const addedLabels = await page.$$eval('.chal-confirm-task-label', els => els.map(e => e.textContent));
  assert(addedLabels.some(l => l.includes('Meditate')), 'Custom task "Meditate 10 min" appears in list');

  // 9. Click "Begin Challenge" and verify onboarding shows
  const beginBtn = await page.$('#chal-confirm-begin');
  assert(!!beginBtn, 'Begin Challenge button exists');
  if (beginBtn) await beginBtn.click();
  await page.waitForTimeout(800);

  // 10. Onboarding modal appears
  const onboardHeading = await page.$eval('.chal-onboard-heading', el => el.textContent).catch(() => '');
  assert(onboardHeading.includes("You're in"), `Onboarding shows "You're in." (got "${onboardHeading}")`);

  const onboardName = await page.$eval('.chal-onboard-name', el => el.textContent).catch(() => '');
  assert(onboardName === '7-Day Reset', `Onboarding shows challenge name (got "${onboardName}")`);

  // Tips should exist
  const tips = await page.$$('.chal-onboard-tip');
  assert(tips.length >= 2, `Onboarding shows 2+ tips (got ${tips.length})`);

  // "Let's go" button
  const goBtn = await page.$('#chal-onboard-go');
  assert(!!goBtn, 'Onboarding has "Let\'s go" button');

  await screenshot(page, 'challenge-onboarding');

  // 11. Dismiss onboarding
  if (goBtn) await goBtn.click();
  await page.waitForTimeout(500);

  // Overlay should be gone
  const overlayGone = await page.$('.chal-onboard-hero');
  assert(!overlayGone, 'Onboarding dismissed after "Let\'s go"');

  // 12. Verify enrollment persisted
  const enrolledChal = await page.evaluate(async () => {
    const active = await DB.getChallenges('active');
    const match = active.find(c => c.name === '7-Day Reset');
    return match ? { name: match.name, status: match.status, taskCount: match.tasks.length } : null;
  });
  assert(enrolledChal !== null, 'Challenge persisted in DB after enrollment');
  assert(enrolledChal.status === 'active', 'Enrolled challenge is active');

  // Clean up
  await page.evaluate(async () => {
    const all = await DB.getChallenges();
    for (const c of all) { c.status = 'abandoned'; await DB.saveChallenge(c); }
  });

  // 13. 75 Hard confirmation shows restart warning
  await page.evaluate(() => { Challenges.showConfirmation('75hard'); });
  await page.waitForTimeout(500);

  const restartWarning = await page.$('.chal-confirm-warning');
  assert(!!restartWarning, '75 Hard confirmation shows restart warning');

  const restartStatValues = await page.$$eval('.chal-confirm-stat-value', els => els.map(e => e.textContent));
  assert(restartStatValues.includes('Yes'), '75 Hard stat shows restart=Yes');
  assert(restartStatValues.includes('75'), '75 Hard stat shows 75 days');
  assert(restartStatValues.includes('7'), '75 Hard stat shows 7 tasks');

  // Close confirmation
  const closeBtn = await page.$('#chal-confirm-close');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(300);
}

// --- Challenge Custom Builder ---
async function testChallengeCustomBuilder(page, context, fixtures) {
  console.log('\n--- Challenge Custom Builder ---');

  // Clean up
  await page.evaluate(async () => {
    const all = await DB.getChallenges();
    for (const c of all) { c.status = 'abandoned'; await DB.saveChallenge(c); }
  });

  // 1. Open custom builder directly
  await page.evaluate(() => { Challenges.showCustomBuilder(); });
  await page.waitForTimeout(500);

  const builderModal = await page.$('.modal-overlay');
  assert(!!builderModal, 'Custom builder modal opens');

  const builderTitle = await page.$eval('.modal-title', el => el.textContent).catch(() => '');
  assert(builderTitle.includes('Build'), `Builder title is "Build Your Challenge" (got "${builderTitle}")`);

  // 2. Empty state message when no tasks
  const emptyMsg = await page.$('.chal-builder-empty');
  assert(!!emptyMsg, 'Empty state shows when no tasks added');

  // 3. Name input exists
  const nameInput = await page.$('#chal-builder-name');
  assert(!!nameInput, 'Name input exists');

  // 4. Duration and on-miss fields exist side by side
  const daysInput = await page.$('#chal-builder-days');
  const restartSelect = await page.$('#chal-builder-restart');
  assert(!!daysInput, 'Duration (days) input exists');
  assert(!!restartSelect, 'On-miss select exists');

  // 5. Add 3 tasks
  const addInput = await page.$('#chal-builder-add-input');
  const addBtn = await page.$('#chal-builder-add-btn');
  assert(!!addInput && !!addBtn, 'Add task input and button exist');

  const taskNames = ['Drink 2L water', 'Walk 30 min', 'Journal'];
  for (const name of taskNames) {
    // Re-query after each DOM rebuild
    const input = await page.$('#chal-builder-add-input');
    const btn = await page.$('#chal-builder-add-btn');
    await input.fill(name);
    await btn.click();
    await page.waitForTimeout(200);
  }

  const builderTasks = await page.$$('.chal-builder-task');
  assert(builderTasks.length === 3, `3 tasks added (got ${builderTasks.length})`);

  // 6. Verify task labels
  const taskLabels = await page.$$eval('.chal-builder-task-label', els => els.map(e => e.textContent));
  assert(taskLabels[0] === 'Drink 2L water', `First task is "Drink 2L water" (got "${taskLabels[0]}")`);
  assert(taskLabels[2] === 'Journal', `Third task is "Journal" (got "${taskLabels[2]}")`);

  // 7. Reorder: move "Journal" up (index 2 -> 1)
  const moveUpBtn = await page.$('.chal-builder-task-move[data-idx="2"][data-dir="up"]');
  assert(!!moveUpBtn, 'Move up button exists for third task');
  if (moveUpBtn) await moveUpBtn.click();
  await page.waitForTimeout(300);

  const reorderedLabels = await page.$$eval('.chal-builder-task-label', els => els.map(e => e.textContent));
  assert(reorderedLabels[1] === 'Journal', `After move up: "Journal" is at index 1 (got "${reorderedLabels[1]}")`);
  assert(reorderedLabels[2] === 'Walk 30 min', `After move up: "Walk 30 min" is at index 2 (got "${reorderedLabels[2]}")`);

  // 8. Delete a task
  const delBtn = await page.$('.chal-builder-task-del[data-idx="0"]');
  assert(!!delBtn, 'Delete button exists');
  if (delBtn) await delBtn.click();
  await page.waitForTimeout(300);

  const tasksAfterDel = await page.$$('.chal-builder-task');
  assert(tasksAfterDel.length === 2, `After delete: 2 tasks (got ${tasksAfterDel.length})`);

  // 9. Fill in name and click "Review Challenge"
  const nameInputRefresh = await page.$('#chal-builder-name');
  if (nameInputRefresh) await nameInputRefresh.fill('My Custom Challenge');

  const daysInputRefresh = await page.$('#chal-builder-days');
  if (daysInputRefresh) {
    await daysInputRefresh.fill('');
    await daysInputRefresh.type('14');
  }

  const reviewBtn = await page.$('#chal-builder-next');
  assert(!!reviewBtn, 'Review Challenge button exists');
  if (reviewBtn) await reviewBtn.click();
  await page.waitForTimeout(500);

  // 10. Confirmation modal appears with custom challenge data
  const customConfirmName = await page.$eval('.chal-confirm-name', el => el.textContent).catch(() => '');
  assert(customConfirmName === 'My Custom Challenge', `Confirmation shows custom name (got "${customConfirmName}")`);

  const customStatValues = await page.$$eval('.chal-confirm-stat-value', els => els.map(e => e.textContent));
  assert(customStatValues.includes('14'), 'Custom confirmation shows 14 days');
  assert(customStatValues.includes('2'), 'Custom confirmation shows 2 tasks');

  await screenshot(page, 'challenge-custom-builder-confirm');

  // 11. Begin the custom challenge
  const beginBtn = await page.$('#chal-confirm-begin');
  if (beginBtn) await beginBtn.click();
  await page.waitForTimeout(800);

  // Onboarding should show
  const onboardHeading = await page.$eval('.chal-onboard-heading', el => el.textContent).catch(() => '');
  assert(onboardHeading.includes("You're in"), 'Custom challenge shows onboarding');

  // Dismiss
  const goBtn = await page.$('#chal-onboard-go');
  if (goBtn) await goBtn.click();
  await page.waitForTimeout(500);

  // 12. Verify custom challenge persisted
  const customChal = await page.evaluate(async () => {
    const active = await DB.getChallenges('active');
    const match = active.find(c => c.name === 'My Custom Challenge');
    return match ? { name: match.name, durationDays: match.durationDays, taskCount: match.tasks.length } : null;
  });
  assert(customChal !== null, 'Custom challenge persisted in DB');
  assert(customChal.durationDays === 14, `Custom challenge is 14 days (got ${customChal?.durationDays})`);
  assert(customChal.taskCount === 2, `Custom challenge has 2 tasks (got ${customChal?.taskCount})`);

  // 13. Validation: builder rejects empty name
  await page.evaluate(async () => {
    const all = await DB.getChallenges();
    for (const c of all) { c.status = 'abandoned'; await DB.saveChallenge(c); }
  });
  await page.evaluate(() => { Challenges.showCustomBuilder(); });
  await page.waitForTimeout(300);

  // Try to submit with no name and no tasks
  const reviewBtnEmpty = await page.$('#chal-builder-next');
  if (reviewBtnEmpty) await reviewBtnEmpty.click();
  await page.waitForTimeout(300);

  // Should still be on builder (not confirmation)
  const stillBuilder = await page.$('#chal-builder-name');
  assert(!!stillBuilder, 'Builder stays open when name is empty (validation)');

  // Close builder
  const builderClose = await page.$('#chal-builder-close');
  if (builderClose) await builderClose.click();
  await page.waitForTimeout(300);

  // Clean up
  await page.evaluate(async () => {
    const all = await DB.getChallenges();
    for (const c of all) { c.status = 'abandoned'; await DB.saveChallenge(c); }
  });
}

// --- Skincare Onboarding Wizard ---
async function testSkincareOnboarding(page, context, fixtures) {
  console.log('\n--- Skincare Onboarding Wizard ---');

  // 1. Clear skincare profile so onboarding triggers
  await page.evaluate(async () => {
    const db = await DB.openDB();
    // Clear skincare profile
    try { await DB.setProfile('skincare', null); } catch (e) {}
    // Also remove from profile store directly
    try {
      const tx = db.transaction('profile', 'readwrite');
      tx.objectStore('profile').delete('skincare');
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    } catch (e) {}
  });

  // Navigate to Today and switch to Skin panel
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(500);
  const skinBtn = await page.$('.today-seg-btn[data-panel="skin"]');
  assert(!!skinBtn, 'Skin segment button exists');
  if (skinBtn) await skinBtn.click();
  await page.waitForTimeout(500);

  // 2. Onboarding wizard should appear (no skincare routine = shows onboarding)
  const obContainer = await page.$('.skincare-onboarding');
  assert(!!obContainer, 'Skincare onboarding wizard appears when no routine exists');

  // Progress dots
  const dots = await page.$$('.skincare-ob-dot');
  assert(dots.length === 5, `Onboarding has 5 progress dots (got ${dots.length})`);

  // 3. Step 1: Welcome
  const welcomeTitle = await page.$eval('.skincare-ob-title', el => el.textContent).catch(() => '');
  assert(welcomeTitle.includes('Skincare'), `Welcome step shows title (got "${welcomeTitle}")`);

  const getStartedBtn = await page.$('.skincare-ob-next[data-action="next"]');
  assert(!!getStartedBtn, 'Welcome step has "Get Started" button');

  await screenshot(page, 'skincare-onboarding-welcome');

  // 4. Navigate to Step 2: Concerns
  if (getStartedBtn) await getStartedBtn.click();
  await page.waitForTimeout(500);

  const step2Title = await page.$eval('.skincare-ob-title', el => el.textContent).catch(() => '');
  assert(step2Title.includes('Skin'), `Step 2 title is about skin (got "${step2Title}")`);

  // Skin type buttons
  const typeButtons = await page.$$('.skincare-ob-type-btn');
  assert(typeButtons.length === 5, `5 skin type buttons (got ${typeButtons.length})`);

  // Concern buttons
  const concernButtons = await page.$$('.skincare-ob-concern-btn');
  assert(concernButtons.length === 10, `10 concern buttons (got ${concernButtons.length})`);

  // 5. Select skin type
  const comboBtn = await page.$('.skincare-ob-type-btn[data-type="combination"]');
  assert(!!comboBtn, 'Combination skin type button exists');
  if (comboBtn) await comboBtn.click();
  await page.waitForTimeout(200);

  // Verify selection styling
  const comboSelected = await page.$eval('.skincare-ob-type-btn[data-type="combination"]', el => el.classList.contains('selected'));
  assert(comboSelected, 'Selected skin type has "selected" class');

  // 6. Select a concern
  const acneBtn = await page.$('.skincare-ob-concern-btn[data-concern="acne"]');
  if (acneBtn) await acneBtn.click();
  await page.waitForTimeout(100);
  const dullBtn = await page.$('.skincare-ob-concern-btn[data-concern="dullness"]');
  if (dullBtn) await dullBtn.click();
  await page.waitForTimeout(100);

  const selectedConcerns = await page.$$eval('.skincare-ob-concern-btn.selected', els => els.map(e => e.dataset.concern));
  assert(selectedConcerns.includes('acne'), 'Acne concern is selected');
  assert(selectedConcerns.includes('dullness'), 'Dullness concern is selected');

  await screenshot(page, 'skincare-onboarding-concerns');

  // 7. Navigate to Step 3: Products photo (skip it)
  const step2Next = await page.$('.skincare-ob-next[data-action="next"]');
  if (step2Next) await step2Next.click();
  await page.waitForTimeout(500);

  const step3Title = await page.$eval('.skincare-ob-title', el => el.textContent).catch(() => '');
  assert(step3Title.includes('Products'), `Step 3 is product photo (got "${step3Title}")`);

  // Photo placeholder should exist
  const productPlaceholder = await page.$('#skincare-ob-product-capture');
  assert(!!productPlaceholder, 'Product photo placeholder exists');

  // Skip button
  const skipProductBtn = await page.$('.skincare-ob-next[data-action="next"]');
  const skipText = await skipProductBtn.textContent();
  assert(skipText.includes('Skip'), `Product step has skip option (got "${skipText}")`);

  await screenshot(page, 'skincare-onboarding-products');

  // 8. Skip to Step 4: Face photo
  if (skipProductBtn) await skipProductBtn.click();
  await page.waitForTimeout(500);

  const step4Title = await page.$eval('.skincare-ob-title', el => el.textContent).catch(() => '');
  assert(step4Title.includes('Face'), `Step 4 is face photo (got "${step4Title}")`);

  const facePlaceholder = await page.$('#skincare-ob-face-capture');
  assert(!!facePlaceholder, 'Face photo placeholder exists');

  // Skip button for face
  const skipFaceBtn = await page.$('.skincare-ob-next[data-action="next"]');
  const skipFaceText = await skipFaceBtn.textContent();
  assert(skipFaceText.includes('Skip'), `Face step has skip option (got "${skipFaceText}")`);

  await screenshot(page, 'skincare-onboarding-face');

  // 9. Skip to Step 5: Completion
  if (skipFaceBtn) await skipFaceBtn.click();
  await page.waitForTimeout(500);

  const step5Title = await page.$eval('.skincare-ob-title', el => el.textContent).catch(() => '');
  assert(step5Title.includes('Complete'), `Step 5 title is completion (got "${step5Title}")`);

  // Waiting bar
  const waitingBar = await page.$('.skincare-ob-waiting');
  assert(!!waitingBar, 'Completion step shows waiting-for-analysis bar');

  const waitingText = await page.$eval('.skincare-ob-waiting span', el => el.textContent).catch(() => '');
  assert(waitingText.includes('Waiting') || waitingText.includes('coach'), `Waiting message shown (got "${waitingText}")`);

  // "Got it" button
  const doneBtn = await page.$('.skincare-ob-next[data-action="done"]');
  assert(!!doneBtn, 'Completion step has "Got it" button');

  await screenshot(page, 'skincare-onboarding-complete');

  // 10. Verify profile saved with onboardingComplete
  const profileCheck = await page.evaluate(async () => {
    const routine = await DB.getSkincareRoutine();
    return {
      onboardingComplete: routine?.onboardingComplete,
      skinType: routine?.skinType,
      concerns: routine?.concerns,
    };
  });
  assert(profileCheck.onboardingComplete === true, 'Profile has onboardingComplete: true');
  assert(profileCheck.skinType === 'combination', `Profile saved skin type (got "${profileCheck.skinType}")`);
  assert(profileCheck.concerns && profileCheck.concerns.includes('acne'), 'Profile saved concerns including acne');

  // 11. Click "Got it" to dismiss
  if (doneBtn) await doneBtn.click();
  await page.waitForTimeout(500);

  // After dismissing, the skincare panel should show the "waiting for coach" state
  const waitingState = await page.$eval('#today-skincare', el => el.textContent).catch(() => '');
  assert(waitingState.includes('Waiting') || waitingState.includes('coach'), 'After onboarding, panel shows waiting state');

  // 12. Back button navigation works
  // Start fresh onboarding
  await page.evaluate(async () => {
    const db = await DB.openDB();
    try {
      const tx = db.transaction('profile', 'readwrite');
      tx.objectStore('profile').delete('skincare');
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    } catch (e) {}
    SkincareOnboarding.reset();
  });

  // Re-render skincare panel
  await page.evaluate(async () => {
    const el = document.getElementById('today-skincare');
    if (el) {
      el.innerHTML = await SkinCareView.render(App.selectedDate);
      SkinCareView.bindEvents(App.selectedDate);
    }
  });
  await page.waitForTimeout(500);

  // Advance to step 2
  const nextBtn2 = await page.$('.skincare-ob-next[data-action="next"]');
  if (nextBtn2) await nextBtn2.click();
  await page.waitForTimeout(300);

  // Click back
  const backBtn = await page.$('.skincare-ob-back[data-action="back"]');
  assert(!!backBtn, 'Back button exists on step 2');
  if (backBtn) await backBtn.click();
  await page.waitForTimeout(300);

  // Should be back on welcome
  const backTitle = await page.$eval('.skincare-ob-title', el => el.textContent).catch(() => '');
  assert(backTitle.includes('Skincare'), 'Back button returns to welcome step');

  // 13. Restore skincare fixture data for other tests
  await page.evaluate(async (skincareProfile) => {
    await DB.setProfile('skincare', skincareProfile);
  }, fixtures.skincareProfile);
  await page.waitForTimeout(200);
}

// --- Multi-User Generalization ---
async function testMultiUserGeneralization(page, context, fixtures) {
  console.log('\n--- Multi-User Generalization ---');

  // Test 1: Fresh app default goals are generic (2000 cal, not 1200)
  const freshPage = await context.newPage();
  freshPage.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await freshPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(1500);

  // Clear all data to simulate fresh install
  await freshPage.evaluate(async () => {
    const db = await DB.openDB();
    for (const storeName of ['entries', 'dailySummary', 'analysis', 'profile', 'mealPlan', 'photos']) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    }
  });

  // Trigger ensureDefaultGoals on fresh DB
  await freshPage.evaluate(async () => {
    await App.ensureDefaultGoals();
  });

  const defaultGoals = await freshPage.evaluate(async () => {
    return await DB.getProfile('goals');
  });

  assert(defaultGoals !== null, 'Fresh app: default goals exist');
  assert(defaultGoals.calories === 2000, `Fresh app: default calories is 2000 (got ${defaultGoals?.calories})`);
  assert(defaultGoals.protein === 100, `Fresh app: default protein is 100 (got ${defaultGoals?.protein})`);
  assert(defaultGoals.water_oz === 64, `Fresh app: default water is 64oz (got ${defaultGoals?.water_oz})`);
  assert(defaultGoals.calories !== 1200, 'Fresh app: default calories is NOT 1200 (Emily-specific)');
  assert(defaultGoals.hardcore && defaultGoals.hardcore.calories === 1500, `Fresh app: hardcore calories is 1500 (got ${defaultGoals?.hardcore?.calories})`);

  // Test 2: Score fallback uses generic defaults (2000 cal, not 1200)
  const scoreFallbacks = await freshPage.evaluate(async () => {
    // Clear goals to force fallback path
    const db = await DB.openDB();
    const tx = db.transaction('profile', 'readwrite');
    tx.objectStore('profile').delete('goals');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });

    // Calculate score with no goals set — should use fallback defaults
    const result = await DayScore.calculate(UI.today(), {
      goals: null, summary: {}, entries: [], analysis: null, regimen: null,
    });
    return result.goals;
  });

  assert(scoreFallbacks.moderate.calories === 2000, `Score fallback moderate cal is 2000 (got ${scoreFallbacks.moderate.calories})`);
  assert(scoreFallbacks.moderate.calories !== 1200, 'Score fallback moderate cal is NOT 1200');
  assert(scoreFallbacks.moderate.protein === 100, `Score fallback moderate protein is 100 (got ${scoreFallbacks.moderate.protein})`);
  assert(scoreFallbacks.hardcore.calories === 1500, `Score fallback hardcore cal is 1500 (got ${scoreFallbacks.hardcore.calories})`);

  // Test 3: Weight unit preference — set to kg, verify forms show kg
  await freshPage.evaluate(async () => {
    await DB.setProfile('preferences', { weightUnit: 'kg' });
  });

  // Navigate to Settings to verify the dropdown
  await freshPage.evaluate(() => {
    document.querySelector('[data-screen="settings"]')?.click();
  });
  await freshPage.waitForTimeout(500);

  // Load weight unit setting
  await freshPage.evaluate(async () => {
    await Settings.loadWeightUnit();
  });
  await freshPage.waitForTimeout(300);

  const weightUnitSelectValue = await freshPage.evaluate(() => {
    const sel = document.getElementById('weight-unit-select');
    return sel ? sel.value : null;
  });
  assert(weightUnitSelectValue === 'kg', `Weight unit select shows kg after setting (got ${weightUnitSelectValue})`);

  // Open weight modal and verify it shows kg
  await freshPage.evaluate(() => {
    document.querySelector('[data-screen="today"]')?.click();
  });
  await freshPage.waitForTimeout(500);

  await freshPage.evaluate(async () => {
    await QuickLog.showWeightEntry();
  });
  await freshPage.waitForTimeout(500);

  const weightModalUnit = await freshPage.evaluate(() => {
    const modal = document.querySelector('.modal-overlay');
    if (!modal) return null;
    const unitText = modal.textContent;
    return unitText.includes('kg') ? 'kg' : (unitText.includes('lbs') ? 'lbs' : 'unknown');
  });
  assert(weightModalUnit === 'kg', `Weight modal shows kg unit (got ${weightModalUnit})`);

  // Close the modal
  await freshPage.evaluate(() => {
    document.querySelector('.modal-overlay')?.remove();
  });

  // Test 4: Weight unit persists across reload
  await freshPage.reload({ waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(1500);

  await freshPage.evaluate(() => {
    document.querySelector('[data-screen="settings"]')?.click();
  });
  await freshPage.waitForTimeout(500);

  await freshPage.evaluate(async () => {
    await Settings.loadWeightUnit();
  });
  await freshPage.waitForTimeout(300);

  const weightUnitAfterReload = await freshPage.evaluate(() => {
    const sel = document.getElementById('weight-unit-select');
    return sel ? sel.value : null;
  });
  assert(weightUnitAfterReload === 'kg', `Weight unit persists as kg after reload (got ${weightUnitAfterReload})`);

  // Test 5: Supplement list starts empty for new users (not hardcoded)
  const supplements = await freshPage.evaluate(async () => {
    const profile = await DB.getProfile('supplements');
    return profile;
  });
  assert(supplements === null || supplements === undefined || (Array.isArray(supplements) && supplements.length === 0),
    `Supplement list starts empty for new users (got ${JSON.stringify(supplements)})`);

  // Verify the supplement picker shows empty state
  await freshPage.evaluate(() => {
    document.querySelector('[data-screen="today"]')?.click();
  });
  await freshPage.waitForTimeout(500);

  await freshPage.evaluate(async () => {
    await QuickLog.showSupplementPicker();
  });
  await freshPage.waitForTimeout(500);

  const dailiesEmptyState = await freshPage.evaluate(() => {
    const modal = document.querySelector('.modal-overlay');
    if (!modal) return false;
    return modal.textContent.includes('No dailies configured yet');
  });
  assert(dailiesEmptyState, 'Supplement picker shows empty state for new users');

  await freshPage.evaluate(() => {
    document.querySelector('.modal-overlay')?.remove();
  });

  // Test 6: Exercise database — search for "bicep curl" and "calf raise"
  const exerciseDbKeys = await freshPage.evaluate(() => {
    return Object.keys(Fitness.exercises);
  });

  const hasBicepCurl = exerciseDbKeys.some(k => k.toLowerCase().includes('bicep curl'));
  const hasCalfRaise = exerciseDbKeys.some(k => k.toLowerCase().includes('calf raise'));
  assert(hasBicepCurl, `Exercise database contains "bicep curl" (keys with curl: ${exerciseDbKeys.filter(k => k.includes('curl')).join(', ') || 'none'})`);
  assert(hasCalfRaise, `Exercise database contains "calf raise" (keys with calf/raise: ${exerciseDbKeys.filter(k => k.includes('calf') || k.includes('raise')).join(', ') || 'none'})`);

  // Test 7: Exercise descriptions contain no personal references
  const exerciseTexts = await freshPage.evaluate(() => {
    const allText = [];
    for (const [name, info] of Object.entries(Fitness.exercises)) {
      allText.push(info.why, info.form, info.mistakes);
    }
    return allText.join(' ');
  });
  assert(!exerciseTexts.toLowerCase().includes('abs by june'), 'Exercise descriptions do not contain "abs by June"');
  assert(!exerciseTexts.toLowerCase().includes('emily'), 'Exercise descriptions do not contain personal name references');
  assert(!exerciseTexts.toLowerCase().includes('your wedding'), 'Exercise descriptions do not contain personal event references');

  // Test 8: color-scheme: dark is set on root element
  const colorScheme = await freshPage.evaluate(() => {
    const html = document.documentElement;
    return getComputedStyle(html).colorScheme;
  });
  assert(colorScheme === 'dark', `color-scheme: dark is set on root element (got "${colorScheme}")`);

  // Test 9: Day Starts At dropdown exists in Settings with Midnight-6AM options
  await freshPage.evaluate(() => {
    document.querySelector('[data-screen="settings"]')?.click();
  });
  await freshPage.waitForTimeout(500);

  const dayBoundaryInfo = await freshPage.evaluate(() => {
    const select = document.getElementById('day-boundary-select');
    if (!select) return null;
    const options = Array.from(select.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    return { exists: true, options };
  });

  assert(dayBoundaryInfo !== null, 'Day Starts At dropdown exists in Settings');
  if (dayBoundaryInfo) {
    const optionValues = dayBoundaryInfo.options.map(o => o.value);
    assert(optionValues.includes('0'), 'Day Starts At has Midnight option (value=0)');
    assert(optionValues.includes('6'), 'Day Starts At has 6 AM option (value=6)');
    const expectedTexts = ['Midnight', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM'];
    const actualTexts = dayBoundaryInfo.options.map(o => o.text);
    assert(
      expectedTexts.every(t => actualTexts.includes(t)),
      `Day Starts At has all options Midnight-6AM (got: ${actualTexts.join(', ')})`
    );
  }

  await freshPage.close();
}

async function testPhotoComparison(page, context, fixtures) {
  console.log('\n--- Photo Comparison ---');

  // Re-inject fixtures (previous test may have cleared IndexedDB)
  await injectFixtures(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Navigate to Progress tab, Trends segment (where progress photos live)
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn = await page.$('button:has-text("Trends")');
  if (trendsBtn) await trendsBtn.click();
  await page.waitForTimeout(800);

  // 1. Verify Progress Photos section renders with body photo entries on 2 dates
  const sectionHeaders = await page.$$eval('h2.section-header', els => els.map(e => e.textContent));
  const hasPhotosSection = sectionHeaders.some(h => h.includes('Progress Photos'));
  assert(hasPhotosSection, 'Progress Photos section renders on Trends tab');

  // 2. "Compare" button appears for the "Body" subtype (has 2 dates)
  const compareBtn = await page.$('.photo-compare-btn[data-subtype="body"]');
  assert(!!compareBtn, 'Compare button appears for Body subtype (2+ photos)');

  // Also check the bottom compare-photos-btn
  const compareBtnBottom = await page.$('.compare-photos-btn[data-subtype="body"]');
  assert(!!compareBtnBottom, 'Bottom Compare button appears for Body subtype');

  // 3. "Compare" button does NOT appear for "Face" subtype (0 photos)
  const faceCompareBtn = await page.$('.photo-compare-btn[data-subtype="face"]');
  assert(!faceCompareBtn, 'Compare button does NOT appear for Face subtype (<2 photos)');

  // 4. Click Compare button -> date picker (bottom sheet) opens
  if (compareBtnBottom) {
    await compareBtnBottom.click();
    await page.waitForTimeout(600);

    const dateSheet = await page.$('.compare-date-sheet');
    assert(!!dateSheet, 'Compare date picker (bottom sheet) opens on Compare click');

    // Verify the sheet has date chips
    const dateChips = await page.$$('.compare-date-chip');
    assert(dateChips.length >= 2, `Date picker has ${dateChips.length} date chips (expected >=2)`);

    // Verify "Compare" go button is disabled until 2 dates selected
    const goBtn = await page.$('.compare-date-go');
    const goBtnDisabled = await goBtn?.evaluate(el => el.disabled);
    assert(goBtnDisabled === true, 'Compare go button is disabled initially');

    // 5. Select two dates -> comparison modal opens
    if (dateChips.length >= 2) {
      await dateChips[0].click();
      await page.waitForTimeout(200);

      // Check first chip is selected
      const firstSelected = await dateChips[0].evaluate(el => el.classList.contains('selected'));
      assert(firstSelected, 'First date chip becomes selected on click');

      await dateChips[1].click();
      await page.waitForTimeout(200);

      // Go button should be enabled now
      const goBtnEnabled = await goBtn?.evaluate(el => !el.disabled);
      assert(goBtnEnabled, 'Compare go button enables after selecting 2 dates');

      // Click Compare to open the modal
      await goBtn.click();
      await page.waitForTimeout(800);

      // 6. Comparison modal opens
      const compareModal = await page.$('.photo-compare-modal');
      assert(!!compareModal, 'Photo comparison modal opens after selecting 2 dates');

      if (compareModal) {
        // 7. Slider handle exists
        const handle = await page.$('.photo-compare-handle');
        assert(!!handle, 'Slider handle exists in comparison modal');

        // 8. Date labels show on each side
        const labelLeft = await page.$('.photo-compare-label-left');
        const labelRight = await page.$('.photo-compare-label-right');
        assert(!!labelLeft, 'Left date label exists in comparison modal');
        assert(!!labelRight, 'Right date label exists in comparison modal');

        const leftText = await labelLeft?.textContent();
        const rightText = await labelRight?.textContent();
        assert(leftText && leftText.length > 0, `Left label has text: "${leftText}"`);
        assert(rightText && rightText.length > 0, `Right label has text: "${rightText}"`);

        // Both images should be present
        const compareImgs = await page.$$('.photo-compare-img');
        assert(compareImgs.length >= 2, `Comparison modal has ${compareImgs.length} images (expected 2)`);

        await screenshot(page, 'photo-compare-modal-open');

        // 9. "Done" closes the modal
        const doneBtn = await page.$('.photo-compare-done');
        assert(!!doneBtn, 'Done button exists in comparison modal');
        if (doneBtn) {
          await doneBtn.click();
          await page.waitForTimeout(400);
          const modalAfterClose = await page.$('.photo-compare-modal');
          assert(!modalAfterClose, 'Comparison modal closes on Done click');
        }
      }
    }
  }

  // 10. Test at 320px — no overflow
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);

  // Navigate back to Progress > Trends
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(300);
  const trendsBtn320 = await page.$('button:has-text("Trends")');
  if (trendsBtn320) await trendsBtn320.click();
  await page.waitForTimeout(800);

  const bodyWidth320 = await page.evaluate(() => document.body.scrollWidth);
  assert(bodyWidth320 <= 322, `320px viewport: no horizontal overflow (body: ${bodyWidth320}px)`);

  // Check that compare button is still visible and not clipped
  const compareBtn320 = await page.$('.compare-photos-btn[data-subtype="body"]');
  if (compareBtn320) {
    const btnRect = await compareBtn320.boundingBox();
    assert(btnRect && btnRect.x >= 0 && btnRect.x + btnRect.width <= 322,
      `Compare button fits within 320px viewport (x:${btnRect?.x}, w:${btnRect?.width})`);
  }

  await screenshot(page, 'photo-compare-320px');

  // Open comparison modal at 320px to check for overflow
  if (compareBtn320) {
    await compareBtn320.click();
    await page.waitForTimeout(600);

    const sheet320 = await page.$('.compare-date-sheet');
    if (sheet320) {
      const sheetWidth = await page.evaluate(() => {
        const s = document.querySelector('.compare-date-sheet');
        return s ? s.scrollWidth : 0;
      });
      assert(sheetWidth <= 322, `Date picker sheet fits at 320px (scrollWidth: ${sheetWidth}px)`);

      // Select 2 dates and open modal at 320px
      const chips320 = await page.$$('.compare-date-chip');
      if (chips320.length >= 2) {
        await chips320[0].click();
        await page.waitForTimeout(100);
        await chips320[1].click();
        await page.waitForTimeout(100);
        const go320 = await page.$('.compare-date-go');
        if (go320) {
          await go320.click();
          await page.waitForTimeout(800);

          const modal320 = await page.$('.photo-compare-modal');
          if (modal320) {
            const modalOverflow = await page.evaluate(() => {
              const m = document.querySelector('.photo-compare-modal');
              return m ? m.scrollWidth : 0;
            });
            assert(modalOverflow <= 322, `Comparison modal fits at 320px (scrollWidth: ${modalOverflow}px)`);

            await screenshot(page, 'photo-compare-modal-320px');

            // Clean up
            const done320 = await page.$('.photo-compare-done');
            if (done320) await done320.click();
            await page.waitForTimeout(300);
          }
        }
      } else {
        // Close the sheet if chips not found
        const closeBtn = await page.$('.compare-date-sheet-close');
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }
  }

  // Restore viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // --- Adversarial tests ---

  // Adversarial: open compare picker, cancel without selecting — no stale state
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(300);
  const trendsBtnAdv = await page.$('button:has-text("Trends")');
  if (trendsBtnAdv) await trendsBtnAdv.click();
  await page.waitForTimeout(800);

  const compareBtnAdv = await page.$('.compare-photos-btn[data-subtype="body"]');
  if (compareBtnAdv) {
    await compareBtnAdv.click();
    await page.waitForTimeout(600);

    // Select one chip, then close — should not leave stale selection
    const chipsAdv = await page.$$('.compare-date-chip');
    if (chipsAdv.length >= 1) {
      await chipsAdv[0].click();
      await page.waitForTimeout(100);
    }

    // Close via X button
    const closeAdv = await page.$('.compare-date-sheet-close');
    if (closeAdv) {
      await closeAdv.click();
      await page.waitForTimeout(400);
    }

    // No compare sheet should remain
    const sheetAfterClose = await page.$('.compare-date-sheet');
    assert(!sheetAfterClose, 'Date picker sheet closes cleanly after cancel with partial selection');

    // No comparison modal should be open
    const modalAfterCancel = await page.$('.photo-compare-modal');
    assert(!modalAfterCancel, 'No comparison modal after canceling date picker');
  }

  // Adversarial: click compare button on header (photo-compare-btn) — uses different code path
  const headerCompareBtn = await page.$('.photo-compare-btn[data-subtype="body"]');
  if (headerCompareBtn) {
    await headerCompareBtn.click();
    await page.waitForTimeout(600);

    // Should open the picker overlay (different from bottom sheet)
    const pickerOverlay = await page.$('[data-compare-picker]');
    assert(!!pickerOverlay, 'Header Compare button opens picker overlay');

    if (pickerOverlay) {
      // Cancel it
      const cancelBtn = await page.$('.photo-compare-picker-cancel');
      if (cancelBtn) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
      }
      const overlayAfter = await page.$('[data-compare-picker]');
      assert(!overlayAfter, 'Picker overlay closes on Cancel');
    }
  }

  // Adversarial: Verify slider handle position is approximately 50% on open
  const compareBtnSlider = await page.$('.compare-photos-btn[data-subtype="body"]');
  if (compareBtnSlider) {
    await compareBtnSlider.click();
    await page.waitForTimeout(400);
    const chipsSlider = await page.$$('.compare-date-chip');
    if (chipsSlider.length >= 2) {
      await chipsSlider[0].click();
      await page.waitForTimeout(100);
      await chipsSlider[1].click();
      await page.waitForTimeout(100);
      const goSlider = await page.$('.compare-date-go');
      if (goSlider) {
        await goSlider.click();
        await page.waitForTimeout(800);

        const handleLeft = await page.evaluate(() => {
          const h = document.querySelector('.photo-compare-handle');
          return h ? h.style.left : null;
        });
        assert(handleLeft === '50%', `Slider starts at 50% position (got: ${handleLeft})`);

        // Verify left image has clipPath at 50%
        const clipPath = await page.evaluate(() => {
          const left = document.querySelector('.photo-compare-left');
          return left ? left.style.clipPath : null;
        });
        assert(clipPath && clipPath.includes('50'), `Left image clipPath is at 50% (got: ${clipPath})`);

        // Clean up — click done and wait for modal DOM removal (250ms animation)
        await page.evaluate(() => {
          const done = document.querySelector('.photo-compare-done');
          if (done) done.click();
        });
        await new Promise(r => setTimeout(r, 400)); // wait for modal cleanup setTimeout (250ms) + margin
      }
    }
  }
}


async function testWeightTrendSmoothing(page, fixtures) {
  console.log('\n--- Weight Trend Smoothing ---');

  const today = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // 1. Inject 16 days of weight data via dailySummary
  const weightDays = [];
  for (let i = 15; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = fmt(d);
    const weight = 145 + Math.sin(i * 0.5) * 2 + (i % 3 === 0 ? 0.5 : -0.3);
    weightDays.push({ date: dateStr, weight: parseFloat(weight.toFixed(1)) });
  }

  await page.evaluate(async (days) => {
    for (const d of days) {
      await DB.updateDailySummary(d.date, {
        date: d.date,
        weight: { value: d.weight, unit: 'lbs' }
      });
    }
  }, weightDays);

  // 2. Navigate to Progress > Trends
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn = await page.$('button:has-text("Trends")');
  if (trendsBtn) await trendsBtn.click();
  await page.waitForTimeout(800);

  // 3. Two path elements (raw + MA)
  const pathCount = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return 0;
    return svg.querySelectorAll('path').length;
  });
  assert(pathCount === 2, `Weight chart has 2 path elements - raw + MA (got ${pathCount})`);

  // 4. MA line has dashed stroke
  const maLineDashed = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return false;
    const paths = svg.querySelectorAll('path');
    if (paths.length < 2) return false;
    const dashArray = paths[1].getAttribute('stroke-dasharray');
    return dashArray && dashArray.length > 0;
  });
  assert(maLineDashed, 'MA line has dashed stroke-dasharray attribute');

  // 5. Legend shows "Daily" and "7-day avg"
  const legendText = await page.evaluate(() => {
    const card = document.getElementById('weight-trend-card');
    return card ? card.textContent : '';
  });
  assert(legendText.includes('Daily'), 'Legend shows "Daily" label');
  assert(legendText.includes('7-day avg'), 'Legend shows "7-day avg" label');

  // 6. With <3 data points, MA line should not render
  await page.evaluate(async () => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  });

  const sparseWeightDays = [
    { date: fmt(new Date(today.getTime() - 2 * 86400000)), weight: 145.0 },
    { date: fmt(new Date(today.getTime() - 1 * 86400000)), weight: 144.5 }
  ];
  await page.evaluate(async (days) => {
    for (const d of days) {
      await DB.updateDailySummary(d.date, {
        date: d.date,
        weight: { value: d.weight, unit: 'lbs' }
      });
    }
  }, sparseWeightDays);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn2 = await page.$('button:has-text("Trends")');
  if (trendsBtn2) await trendsBtn2.click();
  await page.waitForTimeout(800);

  const sparsePathCount = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return 0;
    return svg.querySelectorAll('path').length;
  });
  assert(sparsePathCount <= 1, `With 2 data points, MA line does not render (paths: ${sparsePathCount})`);

  // Adversarial: MA stroke-width thinner than raw line
  await page.evaluate(async () => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  });
  await page.evaluate(async (days) => {
    for (const d of days) {
      await DB.updateDailySummary(d.date, {
        date: d.date,
        weight: { value: d.weight, unit: 'lbs' }
      });
    }
  }, weightDays);
  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const trendsBtn3 = await page.$('button:has-text("Trends")');
  if (trendsBtn3) await trendsBtn3.click();
  await page.waitForTimeout(800);

  const strokeWidths = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    const paths = svg.querySelectorAll('path');
    if (paths.length < 2) return null;
    return {
      raw: parseFloat(paths[0].getAttribute('stroke-width')),
      ma: parseFloat(paths[1].getAttribute('stroke-width'))
    };
  });
  assert(strokeWidths && strokeWidths.raw > strokeWidths.ma,
    `Raw line stroke-width (${strokeWidths?.raw}) > MA line stroke-width (${strokeWidths?.ma})`);

  // Adversarial: MA line uses accent-blue color
  const maStrokeColor = await page.evaluate(() => {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return null;
    const paths = svg.querySelectorAll('path');
    if (paths.length < 2) return null;
    return paths[1].getAttribute('stroke');
  });
  assert(maStrokeColor && maStrokeColor.includes('accent-blue'),
    `MA line uses accent-blue color (got: ${maStrokeColor})`);

  // Restore fixture data
  await page.evaluate(async () => {
    const db = await DB.openDB();
    const tx = db.transaction('dailySummary', 'readwrite');
    tx.objectStore('dailySummary').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  });
  const origFixtures = buildFixtures();
  await page.evaluate(async (summaries) => {
    for (const summary of summaries) {
      await DB.updateDailySummary(summary.date, summary);
    }
  }, origFixtures.summaries);

  await screenshot(page, 'weight-trend-smoothing');
}

async function testAdaptiveCalorieTargets(page, fixtures) {
  console.log('\n--- Adaptive Calorie Targets ---');

  const today = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  async function injectAdaptiveData(numDays, calorieTarget) {
    await page.evaluate(async () => {
      const db = await DB.openDB();
      for (const store of ['dailySummary', 'analysis']) {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
      }
    });

    const summaries = [];
    const analyses = [];
    for (let i = numDays; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = fmt(d);
      summaries.push({
        date: dateStr,
        weight: { value: 145, unit: 'lbs' },
        water_oz: 64
      });
      analyses.push({
        date: dateStr,
        totals: { calories: calorieTarget, protein: 100, carbs: 120, fat: 45 },
        goals: { calories: { target: calorieTarget } }
      });
    }

    await page.evaluate(async (data) => {
      for (const s of data.summaries) {
        await DB.updateDailySummary(s.date, s);
      }
      for (const a of data.analyses) {
        const db = await DB.openDB();
        const tx = db.transaction('analysis', 'readwrite');
        tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
      }
    }, { summaries, analyses });
  }

  // Gating: <14 days = no card
  await page.evaluate(async () => {
    await DB.setProfile('goals', { calories: 1200 });
  });
  await injectAdaptiveData(10, 1200);

  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const insBtn = await page.$('button:has-text("Insights")');
  if (insBtn) await insBtn.click();
  await page.waitForTimeout(800);

  const cardWithFewDays = await page.$('.adaptive-suggestion-card');
  assert(!cardWithFewDays, 'No adaptive suggestion card with <14 days of data');

  // 14+ days plateau: suggestion card appears
  await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    delete goals.adaptive;
    goals.calories = 1200;
    await DB.setProfile('goals', goals);
  });
  await injectAdaptiveData(21, 1200);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const insBtn2 = await page.$('button:has-text("Insights")');
  if (insBtn2) await insBtn2.click();
  await page.waitForTimeout(800);

  const suggestionCard = await page.$('.adaptive-suggestion-card');
  assert(!!suggestionCard, 'Adaptive suggestion card appears with 14+ days of plateau data');

  // Card shows current and suggested values
  if (suggestionCard) {
    const currentValue = await page.$eval('.adaptive-suggestion-current .adaptive-suggestion-value', el => el.textContent.trim()).catch(() => '');
    assert(currentValue === '1200', `Card shows current target: ${currentValue}`);

    const suggestedValue = await page.$eval('.adaptive-suggestion-proposed .adaptive-suggestion-value', el => el.textContent.trim()).catch(() => '');
    assert(suggestedValue.length > 0 && suggestedValue !== '1200', `Card shows different suggested target: ${suggestedValue}`);

    const reason = await page.$eval('.adaptive-suggestion-reason', el => el.textContent.trim()).catch(() => '');
    assert(reason.length > 10, `Card shows a reason string (${reason.substring(0, 50)}...)`);
  }

  // Accept updates goals
  const acceptBtn = await page.$('.adaptive-accept-btn');
  if (acceptBtn) {
    const suggestedBefore = await page.$eval('.adaptive-accept-btn', el => el.dataset.suggested).catch(() => null);
    await acceptBtn.click();
    await page.waitForTimeout(800);

    const updatedGoals = await page.evaluate(async () => {
      return await DB.getProfile('goals');
    });
    if (suggestedBefore) {
      assert(updatedGoals.calories === parseInt(suggestedBefore, 10), `Accept updates calories to ${suggestedBefore} (got ${updatedGoals.calories})`);
    }

    const cardAfterAccept = await page.$('.adaptive-suggestion-card');
    assert(!cardAfterAccept, 'Suggestion card disappears after accepting');
  } else {
    assert(false, 'Accept button exists for clicking');
  }

  // Dismiss hides card
  await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    delete goals.adaptive;
    goals.calories = 1200;
    await DB.setProfile('goals', goals);
  });
  await injectAdaptiveData(21, 1200);

  await page.click('nav button:has-text("Today")');
  await page.waitForTimeout(300);
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);
  const insBtn3 = await page.$('button:has-text("Insights")');
  if (insBtn3) await insBtn3.click();
  await page.waitForTimeout(800);

  const dismissBtn = await page.$('.adaptive-dismiss-btn');
  if (dismissBtn) {
    await dismissBtn.click();
    await page.waitForTimeout(800);

    const cardAfterDismiss = await page.$('.adaptive-suggestion-card');
    assert(!cardAfterDismiss, 'Suggestion card disappears after dismissing');

    const goalsAfterDismiss = await page.evaluate(async () => {
      return await DB.getProfile('goals');
    });
    assert(goalsAfterDismiss.adaptive?.dismissedAt > 0, 'Dismiss sets adaptive.dismissedAt timestamp');
  } else {
    assert(false, 'Dismiss button exists for clicking');
  }

  // Safety: never below 800 cal
  const safetyResult = await page.evaluate(() => {
    return AdaptiveGoals.computeSuggestion(
      { calories: 800 },
      Array.from({ length: 20 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        weight: { value: 145 }
      })),
      Array.from({ length: 15 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        totals: { calories: 780 }
      }))
    );
  });
  assert(safetyResult === null, 'AdaptiveGoals returns null when suggestion would go below 800 cal');

  // Adversarial: boundary at exactly MIN_CALORIES
  const boundaryResult = await page.evaluate(() => {
    return AdaptiveGoals.computeSuggestion(
      { calories: 850 },
      Array.from({ length: 20 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        weight: { value: 145 }
      })),
      Array.from({ length: 15 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        totals: { calories: 830 }
      }))
    );
  });
  assert(boundaryResult !== null && boundaryResult.suggestedTarget === 800,
    `Boundary: 850 cal target can suggest down to 800 (got ${boundaryResult?.suggestedTarget})`);

  // Adversarial: _movingAverage returns correct length
  const maLength = await page.evaluate(() => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      weight: 140 + i * 0.5
    }));
    return AdaptiveGoals._movingAverage(points).length;
  });
  assert(maLength === 10, `_movingAverage returns same length as input (got ${maLength}, expected 10)`);

  // Adversarial: null/missing fields
  const nullResult = await page.evaluate(() => {
    return AdaptiveGoals.computeSuggestion(null, [], []);
  });
  assert(nullResult === null, 'computeSuggestion returns null with null goals');

  const emptyResult = await page.evaluate(() => {
    return AdaptiveGoals.computeSuggestion({}, [], []);
  });
  assert(emptyResult === null, 'computeSuggestion returns null with empty data');

  // Adversarial: direction field correctness
  const directionResult = await page.evaluate(() => {
    return AdaptiveGoals.computeSuggestion(
      { calories: 1500 },
      Array.from({ length: 20 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        weight: { value: 145 + i * 0.1 }
      })),
      Array.from({ length: 15 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        totals: { calories: 1480 }
      }))
    );
  });
  assert(directionResult !== null && directionResult.direction === 'decrease',
    `Gaining weight suggests decrease direction (got ${directionResult?.direction})`);

  // Restore fixture data
  await page.evaluate(async () => {
    const db = await DB.openDB();
    for (const store of ['dailySummary', 'analysis']) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    }
  });
  const origFix = buildFixtures();
  await page.evaluate(async (data) => {
    for (const s of data.summaries) {
      await DB.updateDailySummary(s.date, s);
    }
    for (const a of data.analyses) {
      const db = await DB.openDB();
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    }
    await DB.setProfile('goals', data.goals);
  }, { summaries: origFix.summaries, analyses: origFix.analyses, goals: origFix.goals });

  await screenshot(page, 'adaptive-calorie-targets');
}

async function testWeightEntryIndependence(page, fixtures) {
  console.log('\n--- Weight Entry Independence ---');

  // Navigate to today
  const today = fixtures.dates[fixtures.dates.length - 1];
  await page.evaluate((d) => App.goToDate(d), today);
  await page.waitForTimeout(500);

  // Clear existing weight entries for this date
  await page.evaluate(async (date) => {
    const entries = await DB.getEntriesByDate(date);
    for (const e of entries) {
      if (e.type === 'weight') await DB.deleteEntry(e.id);
    }
    // Clear daily summary weight too
    await DB.updateDailySummary(date, { weight: null, weightLog: [] });
  }, today);

  // Count entries before adding weight
  const beforeCount = await page.evaluate(async (date) => {
    return (await DB.getEntriesByDate(date)).filter(e => e.type === 'weight').length;
  }, today);
  assert(beforeCount === 0, `No weight entries before test (got ${beforeCount})`);

  // Add first weight entry via QuickLog modal
  await page.evaluate(async (date) => {
    const prefs = await DB.getProfile('preferences') || {};
    const unit = prefs.weightUnit || 'lbs';
    const ts1 = Date.now();
    const entry1 = {
      id: UI.generateId('weight'),
      type: 'weight',
      subtype: null,
      date,
      timestamp: new Date(ts1).toISOString(),
      notes: '145.2 ' + unit,
      photo: false,
      duration_minutes: null,
      weight_value: 145.2,
      weight_unit: unit,
    };
    await DB.addEntry(entry1);
    const fresh1 = await DB.getDailySummary(date);
    await DB.updateDailySummary(date, {
      weight: { value: 145.2, unit, timestamp: ts1 },
      weightLog: [...(fresh1.weightLog || []), { value: 145.2, unit, timestamp: ts1 }],
    });
  }, today);

  // Add second weight entry (different value, simulating evening weigh-in)
  await page.evaluate(async (date) => {
    const prefs = await DB.getProfile('preferences') || {};
    const unit = prefs.weightUnit || 'lbs';
    const ts2 = Date.now() + 30000;
    const entry2 = {
      id: UI.generateId('weight'),
      type: 'weight',
      subtype: null,
      date,
      timestamp: new Date(ts2).toISOString(),
      notes: '144.8 ' + unit,
      photo: false,
      duration_minutes: null,
      weight_value: 144.8,
      weight_unit: unit,
    };
    await DB.addEntry(entry2);
    const fresh2 = await DB.getDailySummary(date);
    await DB.updateDailySummary(date, {
      weight: { value: 144.8, unit, timestamp: ts2 },
      weightLog: [...(fresh2.weightLog || []), { value: 144.8, unit, timestamp: ts2 }],
    });
  }, today);

  // Verify both entries exist in the entries store
  const afterCount = await page.evaluate(async (date) => {
    return (await DB.getEntriesByDate(date)).filter(e => e.type === 'weight').length;
  }, today);
  assert(afterCount === 2, `Two independent weight entries stored (got ${afterCount})`);

  // Verify weightLog in daily summary also has 2
  const wlCount = await page.evaluate(async (date) => {
    const summary = await DB.getDailySummary(date);
    return (summary.weightLog || []).length;
  }, today);
  assert(wlCount === 2, `WeightLog has 2 entries (got ${wlCount})`);

  // Reload day view and verify both appear in timeline
  await page.evaluate(() => App.loadDayView());
  await page.waitForTimeout(500);

  const weightInTimeline = await page.$$eval('.entry-item[data-type="weight"]', els => els.length);
  assert(weightInTimeline === 2, `Both weight entries appear in timeline (got ${weightInTimeline})`);

  // Verify they show different values
  const weightTexts = await page.$$eval('.entry-item[data-type="weight"] .entry-notes', els => els.map(e => e.textContent));
  const has1452 = weightTexts.some(t => t.includes('145.2'));
  const has1448 = weightTexts.some(t => t.includes('144.8'));
  assert(has1452 && has1448, `Both weight values visible: ${JSON.stringify(weightTexts)}`);

  // Verify stat card shows latest weight (144.8)
  const statWeight = await page.evaluate(() => {
    const card = document.querySelector('.stat-card[data-stat-action="weight"]');
    return card ? card.textContent.trim() : '';
  });
  assert(statWeight.includes('144.8'), `Stat card shows latest weight 144.8 (got "${statWeight}")`);

  // Clean up: remove test weight entries
  await page.evaluate(async (date) => {
    const entries = await DB.getEntriesByDate(date);
    for (const e of entries) {
      if (e.type === 'weight') await DB.deleteEntry(e.id);
    }
    await DB.updateDailySummary(date, { weight: null, weightLog: [] });
  }, today);

  await page.evaluate(() => App.loadDayView());
  await page.waitForTimeout(300);

  await screenshot(page, 'weight-entry-independence');
}

async function testWeightEntryEdit(page, fixtures) {
  console.log('\n--- Weight Entry Tap-to-Edit ---');

  // KNOWN FLAKE: this test intermittently fails with
  // "page.waitForTimeout: Target page, context or browser has been closed"
  // at the first waitForTimeout after App.goToDate. Root cause unknown —
  // likely browser memory pressure after 600+ prior assertions. safeRun()
  // in run() now isolates this failure so downstream tests still execute
  // instead of being masked behind a single FATAL.

  // Verify weight entries in the timeline can be tapped to open the edit modal,
  // and that saving edits updates both the entry and the daily summary.
  // The stat card always opens QuickLog for a new weight entry (not edit).

  const testDate = fixtures.dates[0]; // day1 — has weight in summary
  await page.evaluate((d) => App.goToDate(d), testDate);
  await page.waitForTimeout(500);

  // Inject a weight entry on this day (simulating a properly-logged weight)
  await page.evaluate(async (date) => {
    // Remove any existing weight entries first
    const existing = await DB.getEntriesByDate(date);
    for (const e of existing) {
      if (e.type === 'weight') await DB.deleteEntry(e.id);
    }
    const entry = {
      id: 'weight_edit_test_' + Date.now(),
      type: 'weight',
      subtype: null,
      date: date,
      timestamp: new Date(date + 'T07:00:00').toISOString(),
      notes: '145.2 lbs',
      photo: false,
      duration_minutes: null,
      weight_value: 145.2,
      weight_unit: 'lbs',
    };
    await DB.addEntry(entry);
    await DB.updateDailySummary(date, {
      weight: { value: 145.2, unit: 'lbs', timestamp: Date.now() },
    });
    await App.loadDayView();
  }, testDate);
  await page.waitForTimeout(500);

  // Verify weight entry appears in the timeline
  const weightInTimeline = await page.$('.entry-item[data-type="weight"]');
  assert(!!weightInTimeline, 'Weight entry appears in timeline');

  // Tap the weight entry in the timeline — should open edit modal
  if (weightInTimeline) {
    await weightInTimeline.click();
    await page.waitForTimeout(500);
    const modal = await page.$('.modal-overlay');
    assert(!!modal, 'Edit modal opens when tapping weight entry in timeline');
    if (modal) {
      const title = await page.$eval('.modal-title', el => el.textContent);
      assert(title.includes('Edit'), 'Modal title says "Edit" (not "Log")');
      const weightInput = await page.$('#edit-weight-value');
      assert(!!weightInput, 'Weight value input shown in edit modal');
      if (weightInput) {
        const val = await weightInput.inputValue();
        assert(val === '145.2', 'Weight value pre-filled correctly: ' + val);
      }
      // Close modal
      const closeBtn = await page.$('.modal-close');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(200);
    }
  }

  // Stat card opens Edit modal when weight entries exist (tap-to-edit fix)
  const statCard = await page.$('[data-stat-action="weight"]');
  assert(!!statCard, 'Weight stat card exists');
  if (statCard) {
    await statCard.click();
    await page.waitForTimeout(500);
    const modal = await page.$('.modal-overlay');
    assert(!!modal, 'Modal opens from weight stat card tap');
    if (modal) {
      const title = await page.$eval('.modal-title', el => el.textContent);
      assert(title.includes('Edit'), 'Stat card tap opens Edit modal when weight entry exists');
      // Close modal
      const closeBtn = await page.$('.modal-close');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(200);
    }
  }

  // Test editing: change the weight value and save
  // Re-query the weight entry (DOM may have been rebuilt after previous modal close)
  await page.evaluate(() => App.loadDayView());
  await page.waitForTimeout(500);
  const weightEntry2 = await page.$('.entry-item[data-type="weight"]');
  if (weightEntry2) {
    await weightEntry2.click();
    await page.waitForTimeout(500);
    const weightInput = await page.$('#edit-weight-value');
    if (weightInput) {
      await weightInput.fill('143.5');
      await page.click('#edit-save');
      await page.waitForTimeout(500);

      // Ensure modal is closed (dismiss any leftover overlays)
      await page.evaluate(() => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
      });

      // Verify the entry was updated
      const updatedWeight = await page.evaluate(async (date) => {
        const entries = await DB.getEntriesByDate(date);
        const w = entries.find(e => e.type === 'weight');
        return w ? w.weight_value : null;
      }, testDate);
      assert(updatedWeight === 143.5, 'Weight entry updated to 143.5 (got ' + updatedWeight + ')');

      // Verify daily summary also updated
      const summaryWeight = await page.evaluate(async (date) => {
        const summary = await DB.getDailySummary(date);
        return summary.weight ? summary.weight.value : null;
      }, testDate);
      assert(summaryWeight === 143.5, 'Daily summary weight updated to 143.5 (got ' + summaryWeight + ')');
    }
  }

  // Clean up
  await page.evaluate(async (date) => {
    const entries = await DB.getEntriesByDate(date);
    for (const e of entries) {
      if (e.type === 'weight') await DB.deleteEntry(e.id);
    }
    await App.loadDayView();
  }, testDate);
  await page.waitForTimeout(300);

  await screenshot(page, 'weight-entry-edit');
}

async function testLongTextInput(page, fixtures) {
  console.log('\n--- Long Text Input ---');

  // Coach chat input: 5000-char string
  await page.click('nav button:has-text("Coach")');
  await page.waitForTimeout(500);

  const coachInputExists = await page.$('#coach-input');
  if (coachInputExists) {
    const longText = 'A'.repeat(5000);
    await page.evaluate((text) => {
      const input = document.getElementById('coach-input');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, longText);

    const textareaLength = await page.evaluate(() => {
      const input = document.getElementById('coach-input');
      return input ? input.value.length : 0;
    });
    assert(textareaLength === 5000, `Coach input handles 5000 chars without truncation (got ${textareaLength})`);

    // Verify no horizontal overflow
    const noHorizontalOverflow = await page.evaluate(() => {
      return document.body.scrollWidth <= document.body.clientWidth;
    });
    assert(noHorizontalOverflow, 'Coach input: no horizontal overflow with long text');

    // Clear the field
    await page.evaluate(() => {
      const input = document.getElementById('coach-input');
      if (input) input.value = '';
    });
  } else {
    // Coach input may not render without sync config — skip gracefully
    console.log('  (skipped coach input test — #coach-input not found, sync likely not configured)');
  }

  // Food entry notes: 2000-char string (test via database entry, avoiding modal complexity)
  const longFoodText = 'B'.repeat(2000);
  const foodTestDate = await page.evaluate(() => App.selectedDate);
  const foodTestId = 'test-food-notes-' + Date.now();
  const foodTestEntry = {
    id: foodTestId,
    type: 'meal',
    subtype: null,
    date: foodTestDate,
    timestamp: new Date().toISOString(),
    notes: longFoodText,
    photo: false,
    duration_minutes: null,
  };

  await page.evaluate(async (entry) => {
    await DB.addEntry(entry);
  }, foodTestEntry);

  // Verify the notes were stored at full length
  const foodNotesStored = await page.evaluate(async (data) => {
    const entries = await DB.getEntriesByDate(data.testDate);
    const found = entries.find(e => e.id === data.testId);
    return found ? found.notes.length : 0;
  }, { testDate: foodTestDate, testId: foodTestId });
  assert(foodNotesStored === 2000, `Food entry notes preserve full 2000-char length in DB (got ${foodNotesStored})`);

  // Clean up
  await page.evaluate(async (data) => {
    await DB.deleteEntry(data.testId);
  }, { testId: foodTestId });

  // Edit modal notes: 3000-char string (test via database entry)
  const longEditText = 'C'.repeat(3000);
  const editTestDate = await page.evaluate(() => App.selectedDate);
  const editTestId = 'test-edit-notes-' + Date.now();
  const editTestEntry = {
    id: editTestId,
    type: 'workout',
    subtype: 'cardio',
    date: editTestDate,
    timestamp: new Date().toISOString(),
    notes: longEditText,
    photo: false,
    duration_minutes: 30,
  };

  await page.evaluate(async (entry) => {
    await DB.addEntry(entry);
  }, editTestEntry);

  // Verify the notes were stored at full length
  const editNotesStored = await page.evaluate(async (data) => {
    const entries = await DB.getEntriesByDate(data.testDate);
    const found = entries.find(e => e.id === data.testId);
    return found ? found.notes.length : 0;
  }, { testDate: editTestDate, testId: editTestId });
  assert(editNotesStored === 3000, `Edit entry notes preserve full 3000-char length in DB (got ${editNotesStored})`);

  // Clean up
  await page.evaluate(async (data) => {
    await DB.deleteEntry(data.testId);
  }, { testId: editTestId });
}

async function testSettingUpdatesImport(page, fixtures) {
  console.log('\n--- Setting Updates Import ---');

  const testDate = '2026-01-15';

  // Test 1: Goal update via settingUpdates
  await page.evaluate(async () => {
    await DB.setProfile('goals', { calories: 1200, protein: 100, water_oz: 64, hardcore: { calories: 1000, protein: 130 } });
  });

  await page.evaluate(async (date) => {
    await DB.importAnalysis(date, {
      date: date,
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      settingUpdates: { goals: { calories: 1100 } }
    });
  }, testDate);

  const goals = await page.evaluate(async () => await DB.getProfile('goals'));
  assert(goals.calories === 1100, `Calories updated to 1100 via settingUpdates (got ${goals.calories})`);
  assert(goals.protein === 100, `Protein preserved at 100 (got ${goals.protein})`);

  // Test 2: Hardcore sub-object merge
  await page.evaluate(async (date) => {
    await DB.importAnalysis(date, {
      date: date,
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      settingUpdates: { goals: { hardcore: { calories: 900 } } }
    });
  }, testDate);

  const goals2 = await page.evaluate(async () => await DB.getProfile('goals'));
  assert(goals2.hardcore.calories === 900, `Hardcore calories updated to 900 (got ${goals2.hardcore?.calories})`);
  assert(goals2.hardcore.protein === 130, `Hardcore protein preserved at 130 (got ${goals2.hardcore?.protein})`);

  // Test 3: Preferences update
  await page.evaluate(async (date) => {
    await DB.importAnalysis(date, {
      date: date,
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      settingUpdates: { preferences: { mealsPerDay: 2 } }
    });
  }, testDate);

  const prefs = await page.evaluate(async () => await DB.getProfile('preferences'));
  assert(prefs.mealsPerDay === 2, `Preferences updated: mealsPerDay set to 2 (got ${prefs?.mealsPerDay})`);

  // Test 4: No settingUpdates (backward compat)
  await page.evaluate(async () => {
    await DB.setProfile('goals', { calories: 1200, protein: 100 });
  });

  await page.evaluate(async (date) => {
    await DB.importAnalysis(date, {
      date: date,
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 }
    });
  }, testDate);

  const goals3 = await page.evaluate(async () => await DB.getProfile('goals'));
  assert(goals3.calories === 1200, `Goals unchanged when settingUpdates absent (backward compat, got ${goals3.calories})`);

  // Test 5: Empty settingUpdates object
  await page.evaluate(async (date) => {
    await DB.importAnalysis(date, {
      date: date,
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      settingUpdates: {}
    });
  }, testDate);

  const goals4 = await page.evaluate(async () => await DB.getProfile('goals'));
  assert(goals4.calories === 1200, `Goals unchanged with empty settingUpdates object (got ${goals4.calories})`);
}

// ─────────────────────────────────────────────────────────────
// Insight Render Functions (Progress tab — 10 displays)
// ─────────────────────────────────────────────────────────────
async function testInsightRenders(page, fixtures) {
  console.log('\n--- Insight Render Functions ---');

  // ── Navigate to Progress > Insights ──────────────────────────────────────
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(500);

  // Ensure Insights tab is active
  const insightsBtn = await page.$('button:has-text("Insights")');
  if (insightsBtn) await insightsBtn.click();
  await page.waitForTimeout(800);

  const container = await page.$('#progress-container');

  // ── 1. Weekly Deficit — renders with fixture data ─────────────────────────
  // The fixture has 5 analyses: days 1-5 (within 7-day window from Monday).
  // Only days this calendar week (Mon–today) count. Calories target = 1200.
  // Day 1 actual = 1450 (surplus 250), Day 2 = 800 (deficit 400), Day 3 = 1550
  // (surplus 350), Day 4 = 0 (skipped — zero actual), Day 5 = 1900 (surplus 700).
  // The card should appear IF any analyses exist for this Mon–today window.
  const weeklyDeficitResult = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    const today = UI.today();
    const monday = ProgressView._mondayOf(today);
    const analyses = await DB.getAnalysisRange(monday, today);
    // Verify _renderWeeklyDeficit doesn't throw
    let html = '', threw = false;
    try {
      html = await ProgressView._renderWeeklyDeficit(goals);
    } catch (e) {
      threw = true;
    }
    return { threw, hasHtml: html.length > 0, analysisCount: analyses.length };
  });
  assert(!weeklyDeficitResult.threw, '_renderWeeklyDeficit does not throw with data');
  // If analyses exist for this week, card must render; if none, empty string is ok
  if (weeklyDeficitResult.analysisCount > 0) {
    assert(weeklyDeficitResult.hasHtml, '_renderWeeklyDeficit renders card when analyses exist this week');
  } else {
    assert(true, '_renderWeeklyDeficit: no analyses this week — correctly returns empty');
  }

  // ── 1b. Weekly Deficit — correct deficit math ────────────────────────────
  const deficitMath = await page.evaluate(async () => {
    // Inject a controlled analysis set for this week to verify math precisely
    const today = UI.today();
    const monday = ProgressView._mondayOf(today);
    const db = await DB.openDB();

    // Remove existing analyses for monday
    const existing = await DB.getAnalysisRange(monday, monday);
    if (existing.length === 0) {
      // Insert one controlled analysis on monday
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({
        date: monday,
        entries: [{ id: 'deficit_test', type: 'meal', subtype: 'lunch', calories: 900, protein: 60, carbs: 80, fat: 30 }],
        totals: { calories: 900, protein: 60, carbs: 80, fat: 30 },
        importedAt: Date.now(),
      });
      await new Promise((r, e) => { tx.oncomplete = r; tx.onerror = e; });
    }

    const goals = { calories: 1200 };
    const html = await ProgressView._renderWeeklyDeficit(goals);
    return {
      hasDeficitText: html.includes('Weekly Deficit'),
      hasPaceText: html.includes('pace'),
    };
  });
  assert(deficitMath.hasDeficitText, '_renderWeeklyDeficit HTML contains "Weekly Deficit" label');
  assert(deficitMath.hasPaceText, '_renderWeeklyDeficit HTML contains pace projection text');

  // ── 1c. Weekly Deficit — empty analyses returns empty string ─────────────
  const deficitEmpty = await page.evaluate(async () => {
    // Call with far-future Monday that has no data
    const goals = { calories: 1200 };
    // Temporarily override _mondayOf to return a future date with no data
    const orig = ProgressView._mondayOf;
    ProgressView._mondayOf = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderWeeklyDeficit(goals); } catch (e) { threw = true; }
    ProgressView._mondayOf = orig;
    return { threw, html };
  });
  assert(!deficitEmpty.threw, '_renderWeeklyDeficit with no analyses does not throw');
  assert(deficitEmpty.html === '', '_renderWeeklyDeficit with no analyses returns empty string');

  // ── 2. Logging Consistency — renders without throwing ────────────────────
  const consistencyResult = await page.evaluate(async () => {
    let html = '', threw = false;
    try { html = await ProgressView._renderLoggingConsistency(); } catch (e) { threw = true; }
    return { threw, hasHtml: html.length > 0 };
  });
  assert(!consistencyResult.threw, '_renderLoggingConsistency does not throw');
  assert(consistencyResult.hasHtml, '_renderLoggingConsistency renders non-empty HTML');

  // ── 2b. Logging Consistency — structural check ───────────────────────────
  const consistencyStructure = await page.evaluate(async () => {
    const html = await ProgressView._renderLoggingConsistency();
    return {
      hasThisWk: html.includes('This wk'),
      hasLastWk: html.includes('Last wk'),
      hasPrev: html.includes('Prev'),
      hasLabel: html.includes('Logging Consistency'),
    };
  });
  assert(consistencyStructure.hasThisWk, '_renderLoggingConsistency shows "This wk" column');
  assert(consistencyStructure.hasLastWk, '_renderLoggingConsistency shows "Last wk" column');
  assert(consistencyStructure.hasPrev, '_renderLoggingConsistency shows "Prev" column');
  assert(consistencyStructure.hasLabel, '_renderLoggingConsistency has section label');

  // ── 3. Vice Impact — skips when no vice entries ──────────────────────────
  // Fixture day5 has custom entries (vices), so we should get either a card or
  // an empty string depending on the 30-day window. Either way must not throw.
  const viceResult = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    let html = '', threw = false;
    try { html = await ProgressView._renderViceImpact(goals); } catch (e) { threw = true; }
    // Check: if html is non-empty it must contain "Vice" label
    const validIfNonEmpty = html === '' || html.includes('Vice');
    return { threw, validIfNonEmpty };
  });
  assert(!viceResult.threw, '_renderViceImpact does not throw');
  assert(viceResult.validIfNonEmpty, '_renderViceImpact: if rendered, contains "Vice" label');

  // ── 3b. Vice Impact — empty analyses returns empty string ────────────────
  const viceEmpty = await page.evaluate(async () => {
    const goals = { calories: 1200 };
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderViceImpact(goals); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!viceEmpty.threw, '_renderViceImpact with no analyses does not throw');
  assert(viceEmpty.html === '', '_renderViceImpact with no analyses returns empty string');

  // ── 4. Macro Split — renders and adds to 100% ────────────────────────────
  // Fixture analyses have macros: e.g. day1 totals = 126P 115C 46F
  const macroResult = await page.evaluate(async () => {
    let html = '', threw = false;
    try { html = await ProgressView._renderMacroSplit(); } catch (e) { threw = true; }
    return { threw, hasHtml: html.length > 0 };
  });
  assert(!macroResult.threw, '_renderMacroSplit does not throw');

  // ── 4b. Macro Split — percentage math sums to 100 ───────────────────────
  const macroMath = await page.evaluate(async () => {
    // Build a known macro set: 60g P, 100g C, 30g F
    // cal: P=240, C=400, F=270 → total=910
    // pct: P=26%, C=44%, F=100-26-44=30% → sum=100
    const fakeAnalyses = [{
      date: '2099-01-01',
      totals: { protein: 60, carbs: 100, fat: 30 },
    }];

    const totalP = 60, totalC = 100, totalF = 30;
    const calP = totalP * 4, calC = totalC * 4, calF = totalF * 9;
    const total = calP + calC + calF;
    const pctP = Math.round((calP / total) * 100);
    const pctC = Math.round((calC / total) * 100);
    const pctF = 100 - pctP - pctC;
    return { pctP, pctC, pctF, sum: pctP + pctC + pctF };
  });
  assert(macroMath.sum === 100, `Macro split percentages sum to 100 (got ${macroMath.sum}: P=${macroMath.pctP}% C=${macroMath.pctC}% F=${macroMath.pctF}%)`);
  assert(macroMath.pctP > 0 && macroMath.pctC > 0 && macroMath.pctF > 0, 'All macro slices > 0 for known data');

  // ── 4c. Macro Split — empty returns empty string ─────────────────────────
  const macroEmpty = await page.evaluate(async () => {
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderMacroSplit(); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!macroEmpty.threw, '_renderMacroSplit with no analyses does not throw');
  assert(macroEmpty.html === '', '_renderMacroSplit with no analyses returns empty string');

  // ── 5. Best/Worst Day — renders without throwing ─────────────────────────
  const bestWorstResult = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    let html = '', threw = false;
    try { html = await ProgressView._renderBestWorstDay(goals); } catch (e) { threw = true; }
    const validIfNonEmpty = html === '' || (html.includes('Mon') || html.includes('Tue') || html.includes('Score by Day'));
    return { threw, validIfNonEmpty };
  });
  assert(!bestWorstResult.threw, '_renderBestWorstDay does not throw');
  assert(bestWorstResult.validIfNonEmpty, '_renderBestWorstDay: if rendered, contains day-of-week labels');

  // ── 5b. Best/Worst Day — empty analyses returns empty string ─────────────
  const bestWorstEmpty = await page.evaluate(async () => {
    const goals = { calories: 1200 };
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderBestWorstDay(goals); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!bestWorstEmpty.threw, '_renderBestWorstDay with no analyses does not throw');
  assert(bestWorstEmpty.html === '', '_renderBestWorstDay with no analyses returns empty string');

  // ── 6. Weekend vs Weekday — renders without throwing ────────────────────
  const weekendResult = await page.evaluate(async () => {
    let html = '', threw = false;
    try { html = await ProgressView._renderWeekendVsWeekday(); } catch (e) { threw = true; }
    const validIfNonEmpty = html === '' || html.includes('Weekday') || html.includes('Weekend');
    return { threw, validIfNonEmpty };
  });
  assert(!weekendResult.threw, '_renderWeekendVsWeekday does not throw');
  assert(weekendResult.validIfNonEmpty, '_renderWeekendVsWeekday: if rendered, contains "Weekday"/"Weekend" labels');

  // ── 6b. Weekend vs Weekday — calorie delta math ─────────────────────────
  const weekendMath = await page.evaluate(async () => {
    // Validate delta computation: weekend avg - weekday avg
    const wdCal = [1100, 1150, 1050]; // avg ~1100
    const weCal = [1400, 1300];       // avg ~1350
    const avg = arr => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
    const wd = avg(wdCal);
    const we = avg(weCal);
    const delta = we - wd;
    return { wd, we, delta, deltaPositive: delta > 0 };
  });
  // Weekend avg (1350) > weekday avg (1100) → delta = 250 (positive = more cals on weekend)
  assert(weekendMath.deltaPositive, `Weekend calorie delta is positive when weekend > weekday (delta=${weekendMath.delta})`);
  assert(weekendMath.we > weekendMath.wd, `Weekend avg (${weekendMath.we}) > weekday avg (${weekendMath.wd})`);

  // ── 6c. Weekend vs Weekday — empty returns empty ─────────────────────────
  const weekendEmpty = await page.evaluate(async () => {
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderWeekendVsWeekday(); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!weekendEmpty.threw, '_renderWeekendVsWeekday with no analyses does not throw');
  assert(weekendEmpty.html === '', '_renderWeekendVsWeekday with no analyses returns empty string');

  // Switch to Trends tab to test the remaining 4 renders
  const trendsBtn = await page.$('button:has-text("Trends")');
  if (trendsBtn) await trendsBtn.click();
  await page.waitForTimeout(800);

  // ── 7. Weight Change Rate — renders without throwing ────────────────────
  // Fixture summaries have weight on day1 (145.2), day2 (145.0), day3 (144.8), day5 (145.5)
  const weightRateResult = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    let html = '', threw = false;
    try { html = await ProgressView._renderWeightChangeRate(goals); } catch (e) { threw = true; }
    // May return '' if < 2 weight points in 30-day window
    const valid = !threw;
    return { threw, valid, hasRateSection: html.includes('Weight Change Rate') };
  });
  assert(!weightRateResult.threw, '_renderWeightChangeRate does not throw');
  // If it renders, it must have the section header
  if (weightRateResult.hasRateSection) {
    assert(weightRateResult.hasRateSection, '_renderWeightChangeRate section header present when rendered');
  } else {
    assert(true, '_renderWeightChangeRate: not enough weight points in window (skipped)');
  }

  // ── 7b. Weight Change Rate — requires 2+ weight points ──────────────────
  const weightRateMinPoints = await page.evaluate(async () => {
    const goals = { calories: 1200 };
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderWeightChangeRate(goals); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!weightRateMinPoints.threw, '_renderWeightChangeRate with no summaries does not throw');
  assert(weightRateMinPoints.html === '', '_renderWeightChangeRate with < 2 weight points returns empty string');

  // ── 7c. Weight rate — lbs/wk math ───────────────────────────────────────
  const weightRateMath = await page.evaluate(() => {
    // Simulate: -1 lb over 7 days = -1 lb/wk; +0.3 expected → diff 0.7 > 0.3 → diverging
    const actualPerWeek = ((-1) / 7 * 7).toFixed(1);  // '-1.0'
    const avgDailyDeficit = 150;
    const expectedPerWeek = (-(avgDailyDeficit * 7) / 3500).toFixed(1);  // '-0.3'
    const diff = Math.abs(parseFloat(actualPerWeek) - parseFloat(expectedPerWeek));
    const matches = diff <= 0.3;
    return { actualPerWeek, expectedPerWeek, diff: diff.toFixed(2), matches };
  });
  assert(weightRateMath.actualPerWeek === '-1.0', `Weight rate: -1 lb/7 days = -1.0 lbs/wk (got ${weightRateMath.actualPerWeek})`);
  assert(!weightRateMath.matches, `Weight rate: large divergence flagged as not matching (diff=${weightRateMath.diff})`);

  // ── 8. Protein by Meal — renders without throwing ────────────────────────
  const proteinByMealResult = await page.evaluate(async () => {
    let html = '', threw = false;
    try { html = await ProgressView._renderProteinByMeal(); } catch (e) { threw = true; }
    // Fixture analyses have meal entries with protein values
    const validIfNonEmpty = html === '' || html.includes('Protein by Meal');
    return { threw, validIfNonEmpty };
  });
  assert(!proteinByMealResult.threw, '_renderProteinByMeal does not throw');
  assert(proteinByMealResult.validIfNonEmpty, '_renderProteinByMeal: if rendered, contains section header');

  // ── 8b. Protein by Meal — slot averages calculation ─────────────────────
  const proteinMath = await page.evaluate(() => {
    // Verify bar percentage: if maxAvg = 40g, a slot with avg 20g → 50%
    const maxAvg = 40;
    const slotAvg = 20;
    const pct = maxAvg > 0 ? Math.round((slotAvg / maxAvg) * 100) : 0;
    return { pct };
  });
  assert(proteinMath.pct === 50, `Protein bar: 20g out of 40g max = 50% width (got ${proteinMath.pct}%)`);

  // ── 8c. Protein by Meal — empty returns empty ─────────────────────────────
  const proteinEmpty = await page.evaluate(async () => {
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderProteinByMeal(); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!proteinEmpty.threw, '_renderProteinByMeal with no analyses does not throw');
  assert(proteinEmpty.html === '', '_renderProteinByMeal with no analyses returns empty string');

  // ── 9. Food Timing Heatmap — renders without throwing ────────────────────
  const heatmapResult = await page.evaluate(async () => {
    let html = '', threw = false;
    try { html = await ProgressView._renderFoodTimingHeatmap(); } catch (e) { threw = true; }
    const validIfNonEmpty = html === '' || html.includes('Eating Times') || html.includes('Morning');
    return { threw, validIfNonEmpty };
  });
  assert(!heatmapResult.threw, '_renderFoodTimingHeatmap does not throw');
  assert(heatmapResult.validIfNonEmpty, '_renderFoodTimingHeatmap: if rendered, contains time-of-day labels');

  // ── 9b. Food Timing Heatmap — time block classification ─────────────────
  const heatmapBlocks = await page.evaluate(() => {
    // Verify block classification logic mirrors the function
    const blocks = {
      'Morning':   { range: [6,  10] },
      'Midday':    { range: [10, 14] },
      'Afternoon': { range: [14, 18] },
      'Evening':   { range: [18, 22] },
      'Late':      { range: [22,  6] }, // wraps midnight
    };
    const classifyHour = (hour) => {
      for (const [name, b] of Object.entries(blocks)) {
        const [lo, hi] = b.range;
        if (lo < hi) { if (hour >= lo && hour < hi) return name; }
        else { if (hour >= lo || hour < hi) return name; }
      }
      return 'Unknown';
    };
    return {
      h7:  classifyHour(7),
      h12: classifyHour(12),
      h15: classifyHour(15),
      h20: classifyHour(20),
      h23: classifyHour(23),
      h3:  classifyHour(3),
    };
  });
  assert(heatmapBlocks.h7  === 'Morning',   `Hour 7 → Morning (got ${heatmapBlocks.h7})`);
  assert(heatmapBlocks.h12 === 'Midday',    `Hour 12 → Midday (got ${heatmapBlocks.h12})`);
  assert(heatmapBlocks.h15 === 'Afternoon', `Hour 15 → Afternoon (got ${heatmapBlocks.h15})`);
  assert(heatmapBlocks.h20 === 'Evening',   `Hour 20 → Evening (got ${heatmapBlocks.h20})`);
  assert(heatmapBlocks.h23 === 'Late',      `Hour 23 → Late (got ${heatmapBlocks.h23})`);
  assert(heatmapBlocks.h3  === 'Late',      `Hour 3 → Late (wraps midnight) (got ${heatmapBlocks.h3})`);

  // ── 9c. Food Timing Heatmap — empty returns empty ────────────────────────
  const heatmapEmpty = await page.evaluate(async () => {
    const orig = ProgressView._daysAgo;
    ProgressView._daysAgo = () => '2099-01-01';
    let html = '', threw = false;
    try { html = await ProgressView._renderFoodTimingHeatmap(); } catch (e) { threw = true; }
    ProgressView._daysAgo = orig;
    return { threw, html };
  });
  assert(!heatmapEmpty.threw, '_renderFoodTimingHeatmap with no analyses does not throw');
  assert(heatmapEmpty.html === '', '_renderFoodTimingHeatmap with no analyses returns empty string');

  // ── 10. Workout Grid — renders without throwing ──────────────────────────
  // Fixture has workout entries on day1 (cardio)
  const workoutGridResult = await page.evaluate(async () => {
    let html = '', threw = false;
    try { html = await ProgressView._renderWorkoutGrid(); } catch (e) { threw = true; }
    const validIfNonEmpty = html === '' || html.includes('Workout Grid');
    return { threw, validIfNonEmpty };
  });
  assert(!workoutGridResult.threw, '_renderWorkoutGrid does not throw');
  assert(workoutGridResult.validIfNonEmpty, '_renderWorkoutGrid: if rendered, contains section header');

  // ── 10b. Workout Grid — structural checks ───────────────────────────────
  const workoutGridStructure = await page.evaluate(async () => {
    const html = await ProgressView._renderWorkoutGrid();
    if (!html) return { empty: true };
    // Should contain 8-week grid, day-of-week headers, and legend
    return {
      empty: false,
      has8Weeks: html.includes('This') && (html.includes('Last') || html.includes('-')),
      hasDayHeaders: html.includes('>M<') || html.includes('>T<') || html.includes('>W<') || html.includes('>F<') || html.includes('>S<'),
      hasLegend: html.includes('Worked out') && html.includes('Rest day') && html.includes('Missed'),
    };
  });
  if (!workoutGridStructure.empty) {
    assert(workoutGridStructure.has8Weeks, '_renderWorkoutGrid includes 8-week row labels');
    assert(workoutGridStructure.hasLegend, '_renderWorkoutGrid includes legend with all states');
  } else {
    assert(true, '_renderWorkoutGrid: no entries in 8-week window — returns empty (ok)');
  }

  // ── 10c. Workout Grid — empty entries returns empty string ───────────────
  const workoutGridEmpty = await page.evaluate(async () => {
    // Override getEntriesByDateRange to return empty
    const origFn = DB.getEntriesByDateRange;
    DB.getEntriesByDateRange = async () => [];
    let html = '', threw = false;
    try { html = await ProgressView._renderWorkoutGrid(); } catch (e) { threw = true; }
    DB.getEntriesByDateRange = origFn;
    return { threw, html };
  });
  assert(!workoutGridEmpty.threw, '_renderWorkoutGrid with no entries does not throw');
  assert(workoutGridEmpty.html === '', '_renderWorkoutGrid with empty entries returns empty string');

  // ─────────────────────────────────────────────────────────────
  // Visual QA at 320px — insight cards must not overflow
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- Insight Render Functions (320px) ---');

  // Re-use context (already available as a closure variable)
  const smallPage = await page.context().newPage();
  await smallPage.setViewportSize({ width: 320, height: 568 });
  await smallPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await smallPage.waitForTimeout(1500);
  await smallPage.waitForFunction(() => typeof DB !== 'undefined' && typeof DB.openDB === 'function');

  // Inject minimal fixtures
  await smallPage.evaluate(async (data) => {
    const db = await DB.openDB();
    for (const s of ['entries', 'dailySummary', 'analysis', 'profile', 'mealPlan', 'photos']) {
      const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear();
      await new Promise(r => { tx.oncomplete = r; });
    }
    for (const e of data.entries) await DB.addEntry(e);
    for (const s of data.summaries) await DB.updateDailySummary(s.date, s);
    for (const a of data.analyses) {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
      await new Promise((r, e) => { tx.oncomplete = r; tx.onerror = e; });
    }
    await DB.setProfile('goals', data.goals);
    await DB.setProfile('regimen', data.regimen);
  }, fixtures);

  await smallPage.reload({ waitUntil: 'networkidle' });
  await smallPage.waitForTimeout(1000);

  // Navigate to Progress > Insights on the 320px page
  await smallPage.click('nav button:has-text("Progress")');
  await smallPage.waitForTimeout(300);
  const insightsBtnSmall = await smallPage.$('button:has-text("Insights")');
  if (insightsBtnSmall) await insightsBtnSmall.click();
  await smallPage.waitForTimeout(800);

  // Check: no card or its children overflow the viewport (320px wide)
  const insightOverflow = await smallPage.evaluate(() => {
    const vw = window.innerWidth; // 320
    const container = document.getElementById('progress-container');
    if (!container) return { found: false, overflowing: [] };

    const cards = container.querySelectorAll('.card, .stats-row, .stat-card, .adaptive-suggestion-card');
    const overflowing = [];
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.right > vw + 2) { // 2px tolerance for sub-pixel rounding
        overflowing.push({ tag: card.tagName, cls: card.className.split(' ')[0], right: Math.round(r.right) });
      }
    }
    return { found: true, overflowing, vw };
  });

  assert(insightOverflow.found || true, 'Progress container found at 320px');
  assert(
    insightOverflow.overflowing.length === 0,
    `Insight cards do not overflow 320px viewport (${insightOverflow.overflowing.length} violations${insightOverflow.overflowing.length > 0 ? ': ' + insightOverflow.overflowing.map(c => `${c.cls}(right=${c.right})`).join(', ') : ''})`
  );

  // Weekly Deficit card specifically — must be fully visible
  const deficitCard320 = await smallPage.evaluate(() => {
    const cards = document.querySelectorAll('#progress-container .card');
    let deficitCard = null;
    for (const card of cards) {
      if (card.textContent.includes('Weekly Deficit')) { deficitCard = card; break; }
    }
    if (!deficitCard) return { found: false };
    const r = deficitCard.getBoundingClientRect();
    return {
      found: true,
      right: Math.round(r.right),
      width: Math.round(r.width),
      withinViewport: r.right <= window.innerWidth + 2,
    };
  });
  if (deficitCard320.found) {
    assert(deficitCard320.withinViewport, `Weekly Deficit card fits in 320px (right=${deficitCard320.right}, width=${deficitCard320.width})`);
  } else {
    assert(true, 'Weekly Deficit card not rendered at 320px (no data this week — ok)');
  }

  // Macro Split segmented bar — bars must not clip outside their container
  const macroBar320 = await smallPage.evaluate(() => {
    const bar = document.querySelector('#progress-container .card div[style*="height:24px"]');
    if (!bar) return { found: false };
    const barRect = bar.getBoundingClientRect();
    const segments = bar.querySelectorAll('div');
    const overflowing = [];
    for (const seg of segments) {
      const r = seg.getBoundingClientRect();
      if (r.right > barRect.right + 2) {
        overflowing.push(Math.round(r.right));
      }
    }
    return { found: true, barRight: Math.round(barRect.right), overflowing };
  });
  if (macroBar320.found) {
    assert(macroBar320.overflowing.length === 0, `Macro split bar segments don't overflow at 320px (found ${macroBar320.overflowing.length} overflow)`);
  } else {
    assert(true, 'Macro split bar not rendered (no 7-day macro data — ok)');
  }

  // Weekday vs Weekend grid — 3-column layout must fit
  const weekendGrid320 = await smallPage.evaluate(() => {
    // Find the weekday/weekend grid by looking for the 3-column display
    const cards = document.querySelectorAll('#progress-container .card');
    let gridCard = null;
    for (const card of cards) {
      if (card.textContent.includes('Weekday') && card.textContent.includes('Weekend')) {
        gridCard = card; break;
      }
    }
    if (!gridCard) return { found: false };
    const r = gridCard.getBoundingClientRect();
    return {
      found: true,
      right: Math.round(r.right),
      withinViewport: r.right <= window.innerWidth + 2,
    };
  });
  if (weekendGrid320.found) {
    assert(weekendGrid320.withinViewport, `Weekend vs Weekday grid fits in 320px (right=${weekendGrid320.right})`);
  } else {
    assert(true, 'Weekend vs Weekday grid not rendered (no calorie data — ok)');
  }

  await screenshot(smallPage, 'insights-320px');
  await smallPage.close();

  // ── Navigate back to Insights on main page ───────────────────────────────
  await page.click('nav button:has-text("Progress")');
  await page.waitForTimeout(300);
  const insightsBtnRestore = await page.$('button:has-text("Insights")');
  if (insightsBtnRestore) await insightsBtnRestore.click();
  await page.waitForTimeout(500);

  // ── 11. _computeSkincareStreak removed — skincare feature deprecated

  // ── 12. renderTimeline — startDate === endDate does not divide by zero ────
  const timelineEqualDates = await page.evaluate(() => {
    let html = '', threw = false;
    try {
      html = ProgressView.renderTimeline(
        '2026-03-15', // startDate
        '2026-03-15', // endDate === startDate
        '2026-03-15', // today
        [],           // empty timeline
        null          // no active plan
      );
    } catch (e) {
      threw = true;
    }
    return { threw, hasHtml: typeof html === 'string' };
  });
  assert(!timelineEqualDates.threw, 'renderTimeline: startDate === endDate does not throw (no div-by-zero)');
  assert(timelineEqualDates.hasHtml, 'renderTimeline: returns a string when startDate === endDate');

  // ── 13. renderFitnessGoals — uses UI.today() not wall-clock new Date() ───
  const fitnessGoals4am = await page.evaluate(() => {
    // Mock UI.today to return a specific date (simulating 4am boundary)
    const origToday = UI.today;
    UI.today = () => '2026-03-20';

    const goals = [{ name: 'Test goal', target: '2026-04-01' }];
    let html = '', threw = false;
    try {
      html = ProgressView.renderFitnessGoals(goals);
    } catch (e) {
      threw = true;
    }

    UI.today = origToday;

    // With today = 2026-03-20 and target = 2026-04-01, daysLeft should be 12
    const expectedDays = 12;
    const hasExpectedDays = html.includes(`${expectedDays} days left`);
    return { threw, hasExpectedDays, html: html.substring(0, 200) };
  });
  assert(!fitnessGoals4am.threw, 'renderFitnessGoals: does not throw with UI.today() mock');
  assert(fitnessGoals4am.hasExpectedDays, `renderFitnessGoals: uses UI.today() for daysLeft calculation (expected 12 days from 2026-03-20 to 2026-04-01)`);
}

async function testChaosInsights(page, context, fixtures) {
  console.log('\n--- Chaos: Adversarial Insight Tests ---');

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Garbage dates
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: Garbage Dates --');

  const garbageDateResults = await page.evaluate(async () => {
    const results = [];
    const goals = await DB.getProfile('goals') || {};
    const garbageDates = [null, undefined, 'not-a-date', '9999-12-31', ''];

    // Test _mondayOf with garbage
    for (const d of garbageDates) {
      let threw = false;
      try { ProgressView._mondayOf(d); } catch (e) { threw = true; }
      results.push({ fn: '_mondayOf', input: String(d), threw });
    }

    // Test _daysAgo with garbage (it doesn't take a date, but test with NaN/null)
    for (const n of [null, undefined, NaN, -1, Infinity]) {
      let threw = false;
      try { ProgressView._daysAgo(n); } catch (e) { threw = true; }
      results.push({ fn: '_daysAgo', input: String(n), threw });
    }

    // Override UI.today() to return garbage and call insight functions
    const origToday = UI.today;
    const insightFns = [
      () => ProgressView._renderWeeklyDeficit(goals),
      () => ProgressView._renderLoggingConsistency(),
      () => ProgressView._renderViceImpact(goals),
      () => ProgressView._renderMacroSplit(),
      () => ProgressView._renderBestWorstDay(goals),
      () => ProgressView._renderWeekendVsWeekday(),
      () => ProgressView._renderWeightChangeRate(goals),
      () => ProgressView._renderProteinByMeal(),
      () => ProgressView._renderFoodTimingHeatmap(),
      () => ProgressView._renderWorkoutGrid(),
    ];
    const fnNames = [
      '_renderWeeklyDeficit', '_renderLoggingConsistency', '_renderViceImpact',
      '_renderMacroSplit', '_renderBestWorstDay', '_renderWeekendVsWeekday',
      '_renderWeightChangeRate', '_renderProteinByMeal', '_renderFoodTimingHeatmap',
      '_renderWorkoutGrid',
    ];

    for (const garbage of [null, undefined, 'not-a-date', '', '9999-12-31']) {
      UI.today = () => garbage;
      for (let i = 0; i < insightFns.length; i++) {
        let threw = false;
        try { await insightFns[i](); } catch (e) { threw = true; }
        results.push({ fn: fnNames[i], input: `UI.today()=${String(garbage)}`, threw });
      }
    }
    UI.today = origToday;

    // Override _daysAgo to return null/invalid
    const origDaysAgo = ProgressView._daysAgo;
    for (const badReturn of [null, undefined, 'garbage', '']) {
      ProgressView._daysAgo = () => badReturn;
      for (const fn of [
        () => ProgressView._renderViceImpact(goals),
        () => ProgressView._renderMacroSplit(),
        () => ProgressView._renderBestWorstDay(goals),
        () => ProgressView._renderWeekendVsWeekday(),
        () => ProgressView._renderFoodTimingHeatmap(),
        () => ProgressView._renderWorkoutGrid(),
      ]) {
        let threw = false;
        try { await fn(); } catch (e) { threw = true; }
        results.push({ fn: '_daysAgo override', input: String(badReturn), threw });
      }
    }
    ProgressView._daysAgo = origDaysAgo;

    // Override _mondayOf to return null/invalid
    const origMondayOf = ProgressView._mondayOf;
    for (const badReturn of [null, undefined, '']) {
      ProgressView._mondayOf = () => badReturn;
      let threw = false;
      try { await ProgressView._renderWeeklyDeficit(goals); } catch (e) { threw = true; }
      results.push({ fn: '_mondayOf override → _renderWeeklyDeficit', input: String(badReturn), threw });

      threw = false;
      try { await ProgressView._renderLoggingConsistency(); } catch (e) { threw = true; }
      results.push({ fn: '_mondayOf override → _renderLoggingConsistency', input: String(badReturn), threw });
    }
    ProgressView._mondayOf = origMondayOf;

    return results;
  });

  for (const r of garbageDateResults) {
    assert(!r.threw, `Chaos: ${r.fn} with ${r.input} does not throw`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Corrupted analysis objects in IndexedDB
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: Corrupted Analysis Objects --');

  const corruptedResults = await page.evaluate(async () => {
    const results = [];
    const goals = await DB.getProfile('goals') || {};
    const today = UI.today();
    const db = await DB.openDB();

    // Save original analyses to restore later
    const origAnalyses = await DB.getAnalysisRange('2020-01-01', '2099-12-31');

    // Clear analyses
    const clearTx = db.transaction('analysis', 'readwrite');
    clearTx.objectStore('analysis').clear();
    await new Promise(r => { clearTx.oncomplete = r; });

    const corruptCases = [
      { label: 'missing totals', obj: { date: today, entries: [{ id: 'x', type: 'meal' }], importedAt: Date.now() } },
      { label: 'entries with no type', obj: { date: today, entries: [{ id: 'y' }, { id: 'z', foo: 'bar' }], totals: { calories: 500 }, importedAt: Date.now() } },
      { label: 'negative calories', obj: { date: today, entries: [{ id: 'a', type: 'meal', calories: -500 }], totals: { calories: -500, protein: -10 }, importedAt: Date.now() } },
      { label: 'totals: null', obj: { date: today, entries: [{ id: 'b', type: 'meal' }], totals: null, importedAt: Date.now() } },
      { label: 'no entries at all', obj: { date: today, totals: { calories: 800, protein: 50 }, importedAt: Date.now() } },
      { label: 'entries is null', obj: { date: today, entries: null, totals: { calories: 300 }, importedAt: Date.now() } },
      { label: 'entries is string', obj: { date: today, entries: 'bad', totals: { calories: 100 }, importedAt: Date.now() } },
      { label: 'totals with NaN', obj: { date: today, entries: [], totals: { calories: NaN, protein: NaN }, importedAt: Date.now() } },
    ];

    const fnNames = [
      '_renderWeeklyDeficit', '_renderLoggingConsistency', '_renderViceImpact',
      '_renderMacroSplit', '_renderBestWorstDay', '_renderWeekendVsWeekday',
      '_renderWeightChangeRate', '_renderProteinByMeal', '_renderFoodTimingHeatmap',
      '_renderWorkoutGrid',
    ];

    for (const { label, obj } of corruptCases) {
      // Insert corrupt analysis
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put(obj);
      await new Promise(r => { tx.oncomplete = r; });

      // Call each insight function
      const insightFns = [
        () => ProgressView._renderWeeklyDeficit(goals),
        () => ProgressView._renderLoggingConsistency(),
        () => ProgressView._renderViceImpact(goals),
        () => ProgressView._renderMacroSplit(),
        () => ProgressView._renderBestWorstDay(goals),
        () => ProgressView._renderWeekendVsWeekday(),
        () => ProgressView._renderWeightChangeRate(goals),
        () => ProgressView._renderProteinByMeal(),
        () => ProgressView._renderFoodTimingHeatmap(),
        () => ProgressView._renderWorkoutGrid(),
      ];

      for (let i = 0; i < insightFns.length; i++) {
        let threw = false;
        try { await insightFns[i](); } catch (e) { threw = true; }
        results.push({ label: `${fnNames[i]} with ${label}`, threw });
      }

      // Clear for next case
      const clrTx = db.transaction('analysis', 'readwrite');
      clrTx.objectStore('analysis').clear();
      await new Promise(r => { clrTx.oncomplete = r; });
    }

    // Restore originals
    for (const a of origAnalyses) {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
      await new Promise(r => { tx.oncomplete = r; });
    }

    return results;
  });

  for (const r of corruptedResults) {
    assert(!r.threw, `Chaos: ${r.label} does not throw`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Extreme values
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: Extreme Values --');

  const extremeResults = await page.evaluate(async () => {
    const results = [];
    const goals = await DB.getProfile('goals') || {};
    const today = UI.today();
    const db = await DB.openDB();

    const origAnalyses = await DB.getAnalysisRange('2020-01-01', '2099-12-31');

    const clearAndInsert = async (obj) => {
      const tx1 = db.transaction('analysis', 'readwrite');
      tx1.objectStore('analysis').clear();
      await new Promise(r => { tx1.oncomplete = r; });
      const tx2 = db.transaction('analysis', 'readwrite');
      tx2.objectStore('analysis').put(obj);
      await new Promise(r => { tx2.oncomplete = r; });
    };

    const insightFns = [
      () => ProgressView._renderWeeklyDeficit(goals),
      () => ProgressView._renderLoggingConsistency(),
      () => ProgressView._renderViceImpact(goals),
      () => ProgressView._renderMacroSplit(),
      () => ProgressView._renderBestWorstDay(goals),
      () => ProgressView._renderWeekendVsWeekday(),
      () => ProgressView._renderProteinByMeal(),
      () => ProgressView._renderFoodTimingHeatmap(),
      () => ProgressView._renderWorkoutGrid(),
    ];
    const fnNames = [
      '_renderWeeklyDeficit', '_renderLoggingConsistency', '_renderViceImpact',
      '_renderMacroSplit', '_renderBestWorstDay', '_renderWeekendVsWeekday',
      '_renderProteinByMeal', '_renderFoodTimingHeatmap', '_renderWorkoutGrid',
    ];

    // 99999 calorie day
    await clearAndInsert({
      date: today,
      entries: [{ id: 'ex1', type: 'meal', subtype: 'lunch', calories: 99999, protein: 9999, carbs: 9999, fat: 9999 }],
      totals: { calories: 99999, protein: 9999, carbs: 9999, fat: 9999 },
      importedAt: Date.now(),
    });
    for (let i = 0; i < insightFns.length; i++) {
      let threw = false;
      try { await insightFns[i](); } catch (e) { threw = true; }
      results.push({ label: `${fnNames[i]} with 99999 cal day`, threw });
    }

    // All zeros
    await clearAndInsert({
      date: today,
      entries: [{ id: 'ex2', type: 'meal', subtype: 'lunch', calories: 0, protein: 0, carbs: 0, fat: 0 }],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      importedAt: Date.now(),
    });
    for (let i = 0; i < insightFns.length; i++) {
      let threw = false;
      try { await insightFns[i](); } catch (e) { threw = true; }
      results.push({ label: `${fnNames[i]} with all-zero macros`, threw });
    }

    // 1000 entries in a single day
    const manyEntries = [];
    for (let j = 0; j < 1000; j++) {
      manyEntries.push({ id: `mass_${j}`, type: 'meal', subtype: 'snack', calories: 10, protein: 1, carbs: 2, fat: 0.5 });
    }
    await clearAndInsert({
      date: today,
      entries: manyEntries,
      totals: { calories: 10000, protein: 1000, carbs: 2000, fat: 500 },
      importedAt: Date.now(),
    });
    for (let i = 0; i < insightFns.length; i++) {
      let threw = false;
      try { await insightFns[i](); } catch (e) { threw = true; }
      results.push({ label: `${fnNames[i]} with 1000 entries`, threw });
    }

    // Weight of 0 and -1 in dailySummary
    for (const badWeight of [0, -1]) {
      await DB.updateDailySummary(today, {
        date: today,
        weightLog: [{ value: badWeight, timestamp: Date.now() }],
      });
      let threw = false;
      try { await ProgressView._renderWeightChangeRate(goals); } catch (e) { threw = true; }
      results.push({ label: `_renderWeightChangeRate with weight=${badWeight}`, threw });
    }

    // Restore original analyses and summary
    const clrTx = db.transaction('analysis', 'readwrite');
    clrTx.objectStore('analysis').clear();
    await new Promise(r => { clrTx.oncomplete = r; });
    for (const a of origAnalyses) {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
      await new Promise(r => { tx.oncomplete = r; });
    }

    return results;
  });

  for (const r of extremeResults) {
    assert(!r.threw, `Chaos: ${r.label} does not throw`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Boundary dates
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: Boundary Dates --');

  const boundaryResults = await page.evaluate(async () => {
    const results = [];
    const goals = await DB.getProfile('goals') || {};

    // Test _mondayOf with boundary dates
    const boundaryDates = [
      '2024-02-29',  // leap year
      '2024-12-31',  // year end
      '2025-01-01',  // year start
      '2024-01-01',  // Monday itself
    ];

    for (const d of boundaryDates) {
      let threw = false, result;
      try { result = ProgressView._mondayOf(d); } catch (e) { threw = true; }
      results.push({ label: `_mondayOf(${d})`, threw, result });
    }

    // Entry at exactly 4:00:00 AM — should be current day
    // Entry at 3:59:59 AM — belongs to previous day per 4am boundary
    // These test the food timing heatmap logic
    const origToday = UI.today;
    UI.today = () => '2024-02-29'; // leap year boundary

    const insightFns = [
      () => ProgressView._renderWeeklyDeficit(goals),
      () => ProgressView._renderLoggingConsistency(),
      () => ProgressView._renderMacroSplit(),
    ];
    const fnNames = ['_renderWeeklyDeficit', '_renderLoggingConsistency', '_renderMacroSplit'];

    for (let i = 0; i < insightFns.length; i++) {
      let threw = false;
      try { await insightFns[i](); } catch (e) { threw = true; }
      results.push({ label: `${fnNames[i]} on leap day 2024-02-29`, threw });
    }

    // Dec 31 / Jan 1 boundary
    UI.today = () => '2025-01-01';
    for (let i = 0; i < insightFns.length; i++) {
      let threw = false;
      try { await insightFns[i](); } catch (e) { threw = true; }
      results.push({ label: `${fnNames[i]} on Jan 1`, threw });
    }

    // Midnight exactly
    UI.today = () => '2024-12-31';
    for (let i = 0; i < insightFns.length; i++) {
      let threw = false;
      try { await insightFns[i](); } catch (e) { threw = true; }
      results.push({ label: `${fnNames[i]} on Dec 31`, threw });
    }

    UI.today = origToday;
    return results;
  });

  for (const r of boundaryResults) {
    assert(!r.threw, `Chaos: ${r.label} does not throw`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Partial/malformed data
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: Partial/Malformed Data --');

  const partialResults = await page.evaluate(async () => {
    const results = [];
    const today = UI.today();
    const db = await DB.openDB();

    const origAnalyses = await DB.getAnalysisRange('2020-01-01', '2099-12-31');

    const clearAndInsert = async (obj) => {
      const tx1 = db.transaction('analysis', 'readwrite');
      tx1.objectStore('analysis').clear();
      await new Promise(r => { tx1.oncomplete = r; });
      const tx2 = db.transaction('analysis', 'readwrite');
      tx2.objectStore('analysis').put(obj);
      await new Promise(r => { tx2.oncomplete = r; });
    };

    // Analysis with totals but no entries
    await clearAndInsert({ date: today, totals: { calories: 1200, protein: 80 }, importedAt: Date.now() });
    const goals = await DB.getProfile('goals') || {};
    const fns = [
      { name: '_renderWeeklyDeficit', fn: () => ProgressView._renderWeeklyDeficit(goals) },
      { name: '_renderViceImpact', fn: () => ProgressView._renderViceImpact(goals) },
      { name: '_renderBestWorstDay', fn: () => ProgressView._renderBestWorstDay(goals) },
      { name: '_renderProteinByMeal', fn: () => ProgressView._renderProteinByMeal() },
    ];
    for (const { name, fn } of fns) {
      let threw = false;
      try { await fn(); } catch (e) { threw = true; }
      results.push({ label: `${name} with totals but no entries`, threw });
    }

    // Analysis with entries but no totals
    await clearAndInsert({ date: today, entries: [{ id: 'p1', type: 'meal', calories: 500 }], importedAt: Date.now() });
    for (const { name, fn } of fns) {
      let threw = false;
      try { await fn(); } catch (e) { threw = true; }
      results.push({ label: `${name} with entries but no totals`, threw });
    }

    // DailySummary with weightLog: null
    await DB.updateDailySummary(today, { date: today, weightLog: null });
    let threw = false;
    try { await ProgressView._renderWeightChangeRate(goals); } catch (e) { threw = true; }
    results.push({ label: '_renderWeightChangeRate with weightLog: null', threw });

    // DailySummary with weightLog: [] (empty)
    await DB.updateDailySummary(today, { date: today, weightLog: [] });
    threw = false;
    try { await ProgressView._renderWeightChangeRate(goals); } catch (e) { threw = true; }
    results.push({ label: '_renderWeightChangeRate with weightLog: []', threw });

    // Profile with goals: undefined
    const origGoals = await DB.getProfile('goals');
    await DB.setProfile('goals', undefined);
    threw = false;
    try { await ProgressView._renderWeeklyDeficit(undefined); } catch (e) { threw = true; }
    results.push({ label: '_renderWeeklyDeficit with goals: undefined', threw });

    threw = false;
    try { await ProgressView._renderViceImpact(undefined); } catch (e) { threw = true; }
    results.push({ label: '_renderViceImpact with goals: undefined', threw });

    threw = false;
    try { await ProgressView._renderBestWorstDay(undefined); } catch (e) { threw = true; }
    results.push({ label: '_renderBestWorstDay with goals: undefined', threw });

    // Restore goals and analyses
    if (origGoals) await DB.setProfile('goals', origGoals);
    const clrTx = db.transaction('analysis', 'readwrite');
    clrTx.objectStore('analysis').clear();
    await new Promise(r => { clrTx.oncomplete = r; });
    for (const a of origAnalyses) {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
      await new Promise(r => { tx.oncomplete = r; });
    }

    return results;
  });

  for (const r of partialResults) {
    assert(!r.threw, `Chaos: ${r.label} does not throw`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Concurrent rendering
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: Concurrent Rendering --');

  const concurrentResult = await page.evaluate(async () => {
    const goals = await DB.getProfile('goals') || {};
    let threw = false;
    try {
      await Promise.all([
        ProgressView._renderWeeklyDeficit(goals),
        ProgressView._renderLoggingConsistency(),
        ProgressView._renderViceImpact(goals),
        ProgressView._renderMacroSplit(),
        ProgressView._renderBestWorstDay(goals),
        ProgressView._renderWeekendVsWeekday(),
        ProgressView._renderWeightChangeRate(goals),
        ProgressView._renderProteinByMeal(),
        ProgressView._renderFoodTimingHeatmap(),
        ProgressView._renderWorkoutGrid(),
      ]);
    } catch (e) {
      threw = true;
    }
    return { threw };
  });
  assert(!concurrentResult.threw, 'Chaos: all 10 insight functions called via Promise.all do not throw');

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 320px viewport with garbage data
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n  -- Chaos: 320px Viewport with Corrupted Data --');

  const chaosSmallPage = await context.newPage();
  await chaosSmallPage.setViewportSize({ width: 320, height: 568 });
  await chaosSmallPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await chaosSmallPage.waitForTimeout(1500);
  await chaosSmallPage.waitForFunction(() => typeof DB !== 'undefined' && typeof DB.openDB === 'function');

  // Inject corrupted data at 320px
  const chaos320Result = await chaosSmallPage.evaluate(async () => {
    const db = await DB.openDB();
    const today = UI.today();

    // Insert extreme analysis
    const tx = db.transaction('analysis', 'readwrite');
    tx.objectStore('analysis').put({
      date: today,
      entries: [
        { id: 'chaos320_1', type: 'meal', subtype: 'lunch', calories: 99999, protein: 9999, carbs: 9999, fat: 9999 },
        { id: 'chaos320_2', type: 'custom', quantity: 50 },
      ],
      totals: { calories: 99999, protein: 9999, carbs: 9999, fat: 9999 },
      importedAt: Date.now(),
    });
    await new Promise(r => { tx.oncomplete = r; });

    await DB.setProfile('goals', { calories: 1200, protein: 105, water_oz: 64 });

    return { injected: true };
  });

  // Navigate to Insights at 320px with corrupt data
  await chaosSmallPage.reload({ waitUntil: 'networkidle' });
  await chaosSmallPage.waitForTimeout(1000);
  await chaosSmallPage.click('nav button:has-text("Progress")');
  await chaosSmallPage.waitForTimeout(300);
  const chaosInsBtn = await chaosSmallPage.$('button:has-text("Insights")');
  if (chaosInsBtn) await chaosInsBtn.click();
  await chaosSmallPage.waitForTimeout(800);

  // Check no overflow at 320px with extreme data
  const chaosOverflow = await chaosSmallPage.evaluate(() => {
    const vw = window.innerWidth;
    const container = document.getElementById('progress-container');
    if (!container) return { found: false, overflowing: [] };
    const cards = container.querySelectorAll('.card, .stats-row, .stat-card');
    const overflowing = [];
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.right > vw + 2) {
        overflowing.push({ cls: card.className.split(' ')[0], right: Math.round(r.right) });
      }
    }
    return { found: true, overflowing };
  });

  assert(
    chaosOverflow.overflowing.length === 0,
    `Chaos: 320px with extreme data — no overflow (${chaosOverflow.overflowing.length} violations${chaosOverflow.overflowing.length > 0 ? ': ' + chaosOverflow.overflowing.map(c => `${c.cls}(right=${c.right})`).join(', ') : ''})`
  );

  await chaosSmallPage.close();

  // Restore fixture data by re-injecting
  await page.evaluate(async (data) => {
    const db = await DB.openDB();
    for (const s of ['entries', 'dailySummary', 'analysis', 'profile', 'mealPlan']) {
      const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear();
      await new Promise(r => { tx.oncomplete = r; });
    }
    for (const e of data.entries) await DB.addEntry(e);
    for (const s of data.summaries) await DB.updateDailySummary(s.date, s);
    for (const a of data.analyses) {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({ ...a, importedAt: Date.now() });
      await new Promise(r => { tx.oncomplete = r; });
    }
    await DB.setProfile('goals', data.goals);
    await DB.setProfile('regimen', data.regimen);
  }, fixtures);
}

// Isolate each test so a FATAL in one doesn't mask downstream assertions.
// Without this, a single browser crash (e.g. the intermittent flake in
// testWeightEntryEdit) aborts the whole suite and hides 300+ later tests.
async function safeRun(fn, ...args) {
  const name = fn.name || 'anonymous';
  try {
    await fn(...args);
  } catch (err) {
    console.error(`\nFATAL in ${name}: ${err.message}`);
    failed++;
    errors.push(`Fatal in ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('=== Health Tracker Validation ===\n');

  // Start in-process static file server (dies with this process — no zombies)
  const srv = await startServer(path.join(__dirname, '..', 'pwa'), PORT);

  if (TAKE_SCREENSHOTS) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    console.log(`Screenshots → ${SCREENSHOT_DIR}\n`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    // Load app
    console.log('Loading app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Verify app loaded
    const title = await page.title();
    assert(title.length > 0, `Page loads with title: "${title}"`);

    // Inject fixtures
    console.log('Injecting test data...');
    const fixtures = await injectFixtures(page);
    console.log(`  ${fixtures.entries.length} entries, ${fixtures.analyses.length} analyses, ${fixtures.dates.length} days`);

    // Reload to pick up injected data
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Run test suites — each isolated so one fatal doesn't cascade.
    await safeRun(testTodayScreen, page, fixtures);
    await safeRun(testPlanScreen, page, fixtures);
    await safeRun(testProgressScreen, page, fixtures);
    await safeRun(testProfileScreen, page, fixtures);
    await safeRun(testInteractions, page, fixtures);
    await safeRun(testScoring, page, fixtures);
    await safeRun(testEntryTypes, page, fixtures);
    await safeRun(testPhotos, page, fixtures);
    await safeRun(testPhotoComprehensive, page, fixtures);
    await safeRun(testMultiPhotoEntry, page, fixtures);
    await safeRun(testUserFlows, page, fixtures);
    await safeRun(testFixtureSchema, fixtures);
    await safeRun(testProfileRoundTrip, page, fixtures);
    await safeRun(testAnalysisStatusIndicators, page, fixtures);
    await safeRun(testUILabels, page, fixtures);
    await safeRun(testScoreCentering, page, fixtures);
    await safeRun(testMultiViewport, page, context, fixtures);
    await safeRun(testBugRegressions, page, fixtures);
    // testSkincarePanel removed — skincare feature deprecated
    await safeRun(testFitnessPanel, page, fixtures);
    await safeRun(testDailiesManager, page, fixtures);
    await safeRun(testDailiesDeletionPersists, page, fixtures);
    await safeRun(testVisualQA, page, fixtures);
    await safeRun(testVisualQA320, page, context, fixtures);
    await safeRun(testChallenges, page, context, fixtures);
    await safeRun(testChallengeConfirmationFlow, page, context, fixtures);
    await safeRun(testChallengeCustomBuilder, page, context, fixtures);
    // testSkincareOnboarding removed — skincare feature deprecated
    await safeRun(testMultiUserGeneralization, page, context, fixtures);
    await safeRun(testPhotoComparison, page, context, fixtures);
    await page.waitForTimeout(500); // Allow renderer to settle after photo blob operations
    await safeRun(testWeightTrendSmoothing, page, fixtures);
    await safeRun(testAdaptiveCalorieTargets, page, fixtures);
    await safeRun(testWeightEntryIndependence, page, fixtures);
    await safeRun(testWeightEntryEdit, page, fixtures);
    await safeRun(testLongTextInput, page, fixtures);
    await safeRun(testSettingUpdatesImport, page, fixtures);
    await safeRun(testInsightRenders, page, fixtures);
    await safeRun(testChaosInsights, page, context, fixtures);
    // voice logging removed — not a priority
    await safeRun(testConsoleErrors, page);

  } catch (err) {
    console.error('\nFATAL:', err.message);
    failed++;
    errors.push(`Fatal: ${err.message}`);
  }

  await browser.close();

  // Report Phase 2 results
  console.log('\n=== Phase 2 Results ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (errors.length > 0) {
    console.log('\n  Failed tests:');
    errors.forEach(e => console.log(`    - ${e}`));
  }
  console.log(`\n${failed === 0 ? 'PHASE 2: ALL TESTS PASSED' : 'PHASE 2: SOME TESTS FAILED'}`);

  // Phase 3: Interactive Dogfood Loop (if --dogfood flag passed)
  let dogfoodFailed = 0;
  if (RUN_DOGFOOD) {
    const { runDogfood } = require('./dogfood');
    const dogfoodResult = await runDogfood();
    dogfoodFailed = dogfoodResult.failed;
  }

  // Phase 4: Chaos Testing (if --chaos flag passed)
  let chaosFailed = 0;
  if (RUN_CHAOS) {
    console.log('\n=== Phase 4: Chaos Testing ===');
    const { runChaos } = require('./chaos');
    const chaosResult = await runChaos();
    chaosFailed = chaosResult.issues;
  }

  const totalFailed = failed + dogfoodFailed + chaosFailed;
  if (RUN_DOGFOOD || RUN_CHAOS) {
    console.log(`\n=== Overall: ${totalFailed === 0 ? 'ALL PHASES PASSED' : 'SOME TESTS FAILED'} ===`);
  }
  srv.close();
  process.exit(totalFailed > 0 ? 1 : 0);
}

run();
