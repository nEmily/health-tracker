// chaos.js — Random user behavior testing
// Simulates a real user who clicks around unpredictably.
// Run: node test-fixtures/chaos.js [--rounds 50] [--screenshots]

const { chromium } = require('playwright');
const { startServer } = require('./test-server');
const path = require('path');
const fs = require('fs');

const ROUNDS = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--rounds') || '30');
const SCREENSHOTS = process.argv.includes('--screenshots');
const SCREENSHOT_DIR = path.join(__dirname, '..', '.claude', 'test-screenshots', 'chaos');
const PORT = parseInt(process.env.PORT || '8080');
const BASE_URL = `http://localhost:${PORT}`;

// --- Action Pool ---
// Each action: { name, weight, fn(page) }
// Weight controls how likely the action is (higher = more common)
const actions = [
  // Navigation (very common — users browse around)
  { name: 'nav-prev-day', weight: 8, fn: async (page) => {
    await page.click('#header-prev').catch(() => {});
  }},
  { name: 'nav-next-day', weight: 5, fn: async (page) => {
    await page.click('#header-next').catch(() => {});
  }},
  { name: 'nav-today-tab', weight: 6, fn: async (page) => {
    await page.click('nav button[data-screen="today"]').catch(() => {});
  }},
  { name: 'nav-coach-tab', weight: 3, fn: async (page) => {
    await page.click('nav button[data-screen="coach"]').catch(() => {});
  }},
  { name: 'nav-progress-tab', weight: 3, fn: async (page) => {
    await page.click('nav button[data-screen="progress"]').catch(() => {});
  }},
  { name: 'nav-settings-tab', weight: 3, fn: async (page) => {
    await page.click('nav button[data-screen="settings"]').catch(() => {});
  }},

  // Quick actions (common — primary user interactions)
  { name: 'tap-water-btn', weight: 5, fn: async (page) => {
    await page.click('#quick-water-btn').catch(() => {});
  }},
  { name: 'tap-dailies-btn', weight: 4, fn: async (page) => {
    await page.click('#quick-supplement-btn').catch(() => {});
  }},
  { name: 'tap-more-btn', weight: 5, fn: async (page) => {
    await page.click('#quick-more-btn').catch(() => {});
  }},

  // Stat card taps
  { name: 'tap-water-stat', weight: 3, fn: async (page) => {
    await page.click('[data-stat-action="water"]').catch(() => {});
  }},
  // Skip food stat tap — triggers Camera.capture which blocks on file chooser
  // { name: 'tap-food-stat', weight: 2, fn: ... },
  { name: 'tap-workout-stat', weight: 2, fn: async (page) => {
    await page.click('[data-stat-action="workout"]').catch(() => {});
  }},
  { name: 'tap-weight-stat', weight: 3, fn: async (page) => {
    await page.click('[data-stat-action="weight"]').catch(() => {});
  }},

  // Modal interactions
  { name: 'close-modal', weight: 8, fn: async (page) => {
    // Try various close methods
    const closeBtn = await page.$('.modal-close');
    if (closeBtn) { await closeBtn.click().catch(() => {}); return; }
    // Tap overlay backdrop
    const overlay = await page.$('.modal-overlay');
    if (overlay) {
      await overlay.click({ position: { x: 10, y: 10 } }).catch(() => {});
    }
  }},
  { name: 'modal-select-first-option', weight: 4, fn: async (page) => {
    // Click first option in any open modal (water pick, more sheet option, supplement, etc.)
    const option = await page.$('.modal-overlay .water-pick, .modal-overlay .more-sheet-option, .modal-overlay .supplement-pick');
    if (option) await option.click().catch(() => {});
  }},

  // More sheet specific
  { name: 'more-workout', weight: 2, fn: async (page) => {
    const btn = await page.$('.modal-overlay [data-more-type="workout"]');
    if (btn) await btn.click().catch(() => {});
  }},
  { name: 'more-weight', weight: 2, fn: async (page) => {
    const btn = await page.$('.modal-overlay [data-more-type="weight"]');
    if (btn) await btn.click().catch(() => {});
  }},
  { name: 'more-body-photo', weight: 2, fn: async (page) => {
    const btn = await page.$('.modal-overlay [data-more-type="bodyPhoto"]');
    if (btn) await btn.click().catch(() => {});
  }},

  // Fitness interactions
  { name: 'toggle-exercise-check', weight: 3, fn: async (page) => {
    const checks = await page.$$('.fitness-check');
    if (checks.length > 0) {
      const idx = Math.floor(Math.random() * checks.length);
      await checks[idx].click().catch(() => {});
    }
  }},
  { name: 'tap-exercise-info', weight: 2, fn: async (page) => {
    const infoBtns = await page.$$('.fitness-info-btn');
    if (infoBtns.length > 0) {
      const idx = Math.floor(Math.random() * infoBtns.length);
      await infoBtns[idx].click().catch(() => {});
    }
  }},

  // Entry interactions
  { name: 'tap-entry', weight: 3, fn: async (page) => {
    const entries = await page.$$('.entry-item');
    if (entries.length > 0) {
      const idx = Math.floor(Math.random() * entries.length);
      await entries[idx].click().catch(() => {});
    }
  }},

  // Settings interactions
  { name: 'tap-edit-goals', weight: 2, fn: async (page) => {
    const btn = await page.$('#screen-settings .s-action-btn');
    if (btn) await btn.click().catch(() => {});
  }},

  // Progress interactions
  { name: 'tap-insights-segment', weight: 2, fn: async (page) => {
    const btn = await page.$('button:has-text("Insights")');
    if (btn) await btn.click().catch(() => {});
  }},
  { name: 'tap-trends-segment', weight: 2, fn: async (page) => {
    const btn = await page.$('button:has-text("Trends")');
    if (btn) await btn.click().catch(() => {});
  }},

  // Rapid double-tap (common mobile mistake)
  { name: 'double-tap-more', weight: 2, fn: async (page) => {
    await page.click('#quick-more-btn').catch(() => {});
    await page.click('#quick-more-btn').catch(() => {});
  }},
  { name: 'double-tap-water', weight: 2, fn: async (page) => {
    await page.click('#quick-water-btn').catch(() => {});
    await page.click('#quick-water-btn').catch(() => {});
  }},

  // --- Interrupt scenarios: open form then immediately navigate ---
  // These target the exact class of bug where async UI state goes stale
  { name: 'interrupt-body-photo-nav', weight: 4, fn: async (page) => {
    await page.click('nav button[data-screen="today"]').catch(() => {});
    await page.waitForTimeout(200);
    await page.click('#quick-more-btn').catch(() => {});
    await page.waitForTimeout(300);
    const bp = await page.$('[data-more-type="bodyPhoto"]');
    if (bp) { await bp.click().catch(() => {}); await page.waitForTimeout(300); }
    await page.click('#header-prev').catch(() => {});
  }},
  { name: 'interrupt-workout-nav', weight: 4, fn: async (page) => {
    await page.click('nav button[data-screen="today"]').catch(() => {});
    await page.waitForTimeout(200);
    await page.click('#quick-more-btn').catch(() => {});
    await page.waitForTimeout(300);
    const wk = await page.$('[data-more-type="workout"]');
    if (wk) { await wk.click().catch(() => {}); await page.waitForTimeout(300); }
    await page.click('#header-prev').catch(() => {});
  }},
  { name: 'interrupt-form-tab-switch', weight: 3, fn: async (page) => {
    await page.click('nav button[data-screen="today"]').catch(() => {});
    await page.waitForTimeout(200);
    await page.click('#quick-more-btn').catch(() => {});
    await page.waitForTimeout(300);
    const bp = await page.$('[data-more-type="bodyPhoto"]');
    if (bp) { await bp.click().catch(() => {}); await page.waitForTimeout(300); }
    // Switch to another tab while form is open
    await page.click('nav button[data-screen="progress"]').catch(() => {});
  }},
  { name: 'interrupt-water-modal-nav', weight: 3, fn: async (page) => {
    await page.click('#quick-water-btn').catch(() => {});
    await page.waitForTimeout(200);
    // Navigate while water modal is open
    await page.click('#header-prev').catch(() => {});
  }},

  // Segment switching (Diet, Fitness — Skin removed)
  { name: 'tap-diet-segment', weight: 3, fn: async (page) => {
    await page.click('.today-seg-btn[data-panel="diet"]').catch(() => {});
  }},
  { name: 'tap-fitness-segment', weight: 3, fn: async (page) => {
    await page.click('.today-seg-btn[data-panel="fitness"]').catch(() => {});
  }},
  { name: 'interrupt-fitness-nav', weight: 3, fn: async (page) => {
    await page.click('.today-seg-btn[data-panel="fitness"]').catch(() => {});
    await page.waitForTimeout(200);
    await page.click('#header-prev').catch(() => {});
  }},
];

// Weighted random selection
function pickAction() {
  const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }
  return actions[actions.length - 1];
}

// --- Invariant Checks ---
// These run after every action to verify the app is in a valid state
async function checkInvariants(page, actionName, round) {
  const issues = [];

  // 1. No horizontal overflow
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth).catch(() => 0);
  if (bodyWidth > 395) {
    issues.push(`Horizontal overflow: body=${bodyWidth}px`);
  }

  // 2. No stacked modals (max 1 overlay)
  const overlayCount = await page.$$eval('.modal-overlay', els => els.length).catch(() => 0);
  if (overlayCount > 1) {
    issues.push(`${overlayCount} modal overlays stacked`);
  }

  // 3. Inline form should not be visible after day navigation or on non-today screens
  const formState = await page.evaluate(() => {
    const f = document.getElementById('log-form-inline');
    const g = document.getElementById('log-type-grid-inline');
    const formVisible = f && f.style.display !== 'none' && f.offsetHeight > 0;
    const gridVisible = g && g.style.display !== 'none' && g.offsetHeight > 0;
    return {
      formVisible,
      gridVisible,
      screen: App.currentScreen,
      date: App.selectedDate,
      isToday: App.selectedDate === UI.today(),
    };
  }).catch(() => ({ formVisible: false, gridVisible: false, screen: 'unknown', isToday: true }));

  // Form visible on non-today screen = always bad
  if (formState.screen !== 'today' && (formState.formVisible || formState.gridVisible)) {
    issues.push(`Inline form/grid visible on ${formState.screen} screen`);
  }
  // Form visible but the date changed since it was opened = stale form
  // Track which date the form was opened on
  if (formState.formVisible && formState.screen === 'today') {
    if (!checkInvariants._formOpenDate) {
      checkInvariants._formOpenDate = formState.date;
    } else if (checkInvariants._formOpenDate !== formState.date) {
      issues.push(`Stale form visible on ${formState.date} (opened on ${checkInvariants._formOpenDate})`);
    }
  } else {
    checkInvariants._formOpenDate = null;
  }

  // 4. Nav has exactly 4 buttons, all visible
  const navCount = await page.$$eval('nav .nav-item', els => els.filter(e => e.offsetHeight > 0).length).catch(() => 0);
  if (navCount !== 4) {
    issues.push(`Nav has ${navCount} visible buttons (expected 4)`);
  }

  // 5. Exactly one active screen
  const activeScreens = await page.$$eval('.screen.active', els => els.length).catch(() => 0);
  if (activeScreens !== 1) {
    issues.push(`${activeScreens} active screens (expected 1)`);
  }

  // 6. No unhandled JS errors (checked separately in main loop)

  return issues;
}

// --- Main ---
async function runChaos({ rounds = ROUNDS, screenshots = SCREENSHOTS } = {}) {
  console.log(`=== Chaos Testing (${rounds} rounds) ===\n`);

  if (screenshots) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  // Auto-dismiss file chooser dialogs (Camera.capture opens file input)
  page.on('filechooser', async (fc) => {
    await fc.setFiles([]).catch(() => {});
  });

  // Load app and inject test data
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Inject sync key so Coach tab doesn't show pairing modal (which hides nav)
  await page.evaluate(() => {
    localStorage.setItem('cloudRelay_backup', JSON.stringify({
      workerUrl: 'https://fake-test-relay.example.com',
      syncKey: 'test-chaos-00000000-0000-0000-0000-000000000000'
    }));
  });

  // Inject regimen so workout cards render
  await page.evaluate(async () => {
    await DB.openDB();
    // Inject cloud relay config into IndexedDB too
    await DB.setProfile('cloudRelay', {
      workerUrl: 'https://fake-test-relay.example.com',
      syncKey: 'test-chaos-00000000-0000-0000-0000-000000000000'
    });
    await DB.setProfile('regimen', {
      weeklySchedule: [
        { day: 'monday', type: 'strength', description: 'Upper body', exercises: [
          { name: 'Push-ups', sets: 3, reps: '12', section: 'main', formCue: 'Elbows at 45' },
          { name: 'Plank', sets: 3, reps: '30s', section: 'core', formCue: 'Squeeze glutes' },
        ]},
        { day: 'tuesday', type: 'cardio', description: 'Easy run', exercises: [
          { name: '30-min jog', sets: 1, reps: '30 min', section: 'main', formCue: 'Easy pace' },
        ]},
        { day: 'wednesday', type: 'rest', description: 'Rest', exercises: [] },
        { day: 'thursday', type: 'strength', description: 'Lower body', exercises: [
          { name: 'Goblet Squats', sets: 3, reps: '12', section: 'main', formCue: 'Deep' },
          { name: 'Dead Bugs', sets: 3, reps: '10', section: 'core', formCue: 'Flat back' },
        ]},
        { day: 'friday', type: 'cardio', description: 'Walk', exercises: [
          { name: '40-min walk', sets: 1, reps: '40 min', section: 'main', formCue: 'Brisk' },
        ]},
        { day: 'saturday', type: 'rest', description: 'Rest', exercises: [] },
        { day: 'sunday', type: 'rest', description: 'Rest', exercises: [] },
      ],
    });
    await DB.setProfile('goals', { calories: 1200, protein: 105, water_oz: 64, hardcore: { calories: 1000, protein: 120, water_oz: 64 } });
    // Add a dummy entry for today so the app doesn't enter setup mode (which hides nav)
    const today = UI.today();
    const now = Date.now();
    const tx = (await DB.openDB()).transaction('entries', 'readwrite');
    tx.objectStore('entries').put({
      id: `water_${now}_chaos_seed`,
      date: today,
      type: 'water',
      timestamp: now,
      notes: '8oz water'
    });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    App.loadDayView();
  });
  await page.waitForTimeout(1000);

  let totalIssues = 0;
  const issueLog = [];
  const actionLog = [];

  for (let i = 0; i < rounds; i++) {
    const action = pickAction();
    const before = jsErrors.length;

    try {
      await Promise.race([
        action.fn(page),
        page.waitForTimeout(5000), // 5s timeout per action (interrupt actions need ~1.5s)
      ]);
    } catch (err) {
      // Action itself failed — that's fine, we just want to see if the app breaks
    }

    await page.waitForTimeout(100 + Math.random() * 150); // Simulate human delay

    // Check for new JS errors
    if (jsErrors.length > before) {
      const newErrors = jsErrors.slice(before);
      for (const err of newErrors) {
        const msg = `[Round ${i + 1}] JS Error after "${action.name}": ${err}`;
        console.log(`  ✗ ${msg}`);
        issueLog.push(msg);
        totalIssues++;
      }
    }

    // Run invariant checks
    const issues = await checkInvariants(page, action.name, i + 1);
    for (const issue of issues) {
      const msg = `[Round ${i + 1}] Invariant violated after "${action.name}": ${issue}`;
      console.log(`  ✗ ${msg}`);
      issueLog.push(msg);
      totalIssues++;

      if (screenshots) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `issue-${i + 1}-${action.name}.png`), fullPage: true });
      }
    }

    actionLog.push(action.name);

    // Progress indicator every 10 rounds
    if ((i + 1) % 10 === 0) {
      console.log(`  ... ${i + 1}/${rounds} rounds (${totalIssues} issues so far)`);
    }
  }

  // Final screenshot
  if (screenshots) {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-state.png'), fullPage: true });
  }

  await browser.close();

  // Report
  console.log(`\n=== Chaos Results ===`);
  console.log(`  Rounds: ${rounds}`);
  console.log(`  Actions: ${actionLog.length}`);
  console.log(`  JS Errors: ${jsErrors.length}`);
  console.log(`  Invariant Violations: ${totalIssues - jsErrors.length}`);
  console.log(`  Total Issues: ${totalIssues}`);

  if (issueLog.length > 0) {
    console.log(`\n  Issues:`);
    // Deduplicate
    const uniq = [...new Set(issueLog)];
    uniq.forEach(i => console.log(`    - ${i}`));
  }

  console.log(`\n${totalIssues === 0 ? 'CHAOS: ALL CLEAR' : 'CHAOS: ISSUES FOUND'}`);

  return { rounds, issues: totalIssues, jsErrors: jsErrors.length };
}

module.exports = { runChaos };

if (require.main === module) {
  startServer(path.join(__dirname, '..', 'pwa'), PORT).then(srv => {
    runChaos().then(result => {
      srv.close();
      process.exit(result.issues > 0 ? 1 : 0);
    });
  });
}
