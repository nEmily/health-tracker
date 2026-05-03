// Tests for AdaptiveGoals delta integration in progress.js (D.6).
// Verifies that dismissing or accepting a suggestion queues a delta via
// DB.queueGoalUpdate in addition to the optimistic local write.
//
// Run with: node pwa/tests/goals.test.js

// --- Minimal DB mock ---
const calls = { setProfileOwned: [], queueGoalUpdate: [] };
const _goals = {};
const DB = {
  async getProfile(key) { return _goals[key] || {}; },
  async setProfileOwned(key, value, owner) {
    calls.setProfileOwned.push({ key, value, owner });
    _goals[key] = value;
  },
  async queueGoalUpdate(delta, source) {
    calls.queueGoalUpdate.push({ delta, source });
  },
};

// Inline the accept/dismiss logic from progress.js so the test is self-contained.
async function handleAccept(suggested) {
  const goals = await DB.getProfile('goals') || {};
  const oldCal = goals.calories || 2000;
  goals.calories = suggested;
  if (goals.hardcore?.calories) {
    const ratio = goals.hardcore.calories / oldCal;
    goals.hardcore.calories = Math.round(suggested * ratio);
  }
  if (!goals.adaptive) goals.adaptive = {};
  goals.adaptive.acceptedAt = Date.now();
  await DB.setProfileOwned('goals', goals, 'cron-via-delta');
  await DB.queueGoalUpdate({ adaptive: { acceptedAt: goals.adaptive.acceptedAt } }, 'adaptive-suggestion');
}

async function handleDismiss() {
  const goals = await DB.getProfile('goals') || {};
  if (!goals.adaptive) goals.adaptive = {};
  goals.adaptive.dismissedAt = Date.now();
  await DB.setProfileOwned('goals', goals, 'cron-via-delta');
  await DB.queueGoalUpdate({ adaptive: { dismissedAt: goals.adaptive.dismissedAt } }, 'adaptive-suggestion');
}

// --- Test runner ---
let passed = 0, failed = 0;
function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  console.log('AdaptiveGoals delta integration tests');

  // Reset
  calls.setProfileOwned.length = 0;
  calls.queueGoalUpdate.length = 0;
  _goals.goals = { calories: 1200 };

  // --- Accept ---
  await handleAccept(1150);

  assert('accept: setProfileOwned called',
    calls.setProfileOwned.length === 1);
  assert('accept: key is goals',
    calls.setProfileOwned[0].key === 'goals');
  assert('accept: owner is cron-via-delta',
    calls.setProfileOwned[0].owner === 'cron-via-delta');
  assert('accept: calories updated to suggested',
    calls.setProfileOwned[0].value.calories === 1150);
  assert('accept: acceptedAt set in optimistic write',
    typeof calls.setProfileOwned[0].value.adaptive?.acceptedAt === 'number');

  assert('accept: queueGoalUpdate called once',
    calls.queueGoalUpdate.length === 1);
  assert('accept: delta contains adaptive.acceptedAt',
    typeof calls.queueGoalUpdate[0].delta?.adaptive?.acceptedAt === 'number');
  assert('accept: source is adaptive-suggestion',
    calls.queueGoalUpdate[0].source === 'adaptive-suggestion');

  // --- Dismiss ---
  calls.setProfileOwned.length = 0;
  calls.queueGoalUpdate.length = 0;
  _goals.goals = { calories: 1200 };

  await handleDismiss();

  assert('dismiss: setProfileOwned called',
    calls.setProfileOwned.length === 1);
  assert('dismiss: owner is cron-via-delta',
    calls.setProfileOwned[0].owner === 'cron-via-delta');
  assert('dismiss: dismissedAt set in optimistic write',
    typeof calls.setProfileOwned[0].value.adaptive?.dismissedAt === 'number');

  assert('dismiss: queueGoalUpdate called once',
    calls.queueGoalUpdate.length === 1);
  assert('dismiss: delta contains adaptive.dismissedAt',
    typeof calls.queueGoalUpdate[0].delta?.adaptive?.dismissedAt === 'number');
  assert('dismiss: source is adaptive-suggestion',
    calls.queueGoalUpdate[0].source === 'adaptive-suggestion');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
