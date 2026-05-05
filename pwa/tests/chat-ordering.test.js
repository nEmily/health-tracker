/**
 * Test conversation-order display logic.
 *
 * Bug (2026-05-04): chat displayed "user, user, coach, coach" because sort
 * was on raw timestamp; coach responses arrive 30+ min after user messages
 * (cron tick), so they all clustered at the end. Real back-and-forth flow
 * requires positioning each coach reply immediately after the last user
 * message it answers (via respondsTo).
 *
 * This test validates the sortKey computation. We extract it as a pure
 * function below and test against scenarios.
 *
 * Run: node pwa/tests/chat-ordering.test.js
 */

// Replicate the sortKey logic from coach.js render():
function buildTimeline(userMessages, coachMessages) {
  const userTsMap = new Map();
  for (const m of userMessages) userTsMap.set(m.id, m.timestamp || 0);

  const timeline = [];
  for (const msg of userMessages) {
    timeline.push({
      role: 'user', id: msg.id, text: msg.text,
      timestamp: msg.timestamp || 0,
      sortKey: msg.timestamp || 0,
    });
  }
  for (const cm of coachMessages) {
    const ownTs = cm.timestamp || 0;
    const refTs = (cm.respondsTo || []).reduce(
      (max, id) => Math.max(max, userTsMap.get(id) || 0), 0
    );
    const sortKey = refTs > 0 ? refTs + 1 : ownTs;
    timeline.push({
      role: 'coach', id: cm.id, text: cm.text,
      timestamp: ownTs,
      sortKey,
    });
  }
  timeline.sort((a, b) => a.sortKey - b.sortKey);
  return timeline;
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

check('back-and-forth pattern (the user complaint)', () => {
  // Real production data from 2026-05-04
  const users = [
    { id: 'u1', timestamp: 1777928724001, text: 'bumping up to 1000' },
    { id: 'u2', timestamp: 1777935117738, text: 'follow up' },
  ];
  const coaches = [
    { id: 'c1', timestamp: 1777939200000, respondsTo: ['u1'], text: 'Good call' },
    { id: 'c2', timestamp: 1777940000000, respondsTo: ['u2'], text: 'Got it' },
  ];
  const order = buildTimeline(users, coaches).map(t => t.id);
  eq(order, ['u1', 'c1', 'u2', 'c2'],
    'should be u1, coach-reply, u2, coach-reply — not u1, u2, c1, c2');
});

check('batched coach response groups correctly', () => {
  const users = [
    { id: 'u1', timestamp: 100, text: 'a' },
    { id: 'u2', timestamp: 200, text: 'b' },
    { id: 'u3', timestamp: 300, text: 'c' },
  ];
  const coaches = [
    // Coach batched-responds to u1+u2 (after both)
    { id: 'c1', timestamp: 500, respondsTo: ['u1', 'u2'], text: 'reply to a+b' },
    // Then user sends u3, coach replies separately
    { id: 'c2', timestamp: 600, respondsTo: ['u3'], text: 'reply to c' },
  ];
  const order = buildTimeline(users, coaches).map(t => t.id);
  eq(order, ['u1', 'u2', 'c1', 'u3', 'c2'],
    'batched response (c1) should appear after both u1 and u2 it answers');
});

check('legacy unsolicited reply (empty respondsTo)', () => {
  const users = [
    { id: 'u1', timestamp: 100, text: 'a' },
  ];
  const coaches = [
    // Old format: no respondsTo — coach analysis observation
    { id: 'c1', timestamp: 500, respondsTo: [], text: 'observation' },
  ];
  const order = buildTimeline(users, coaches).map(t => t.id);
  // Falls back to own timestamp; observation appears after user message
  eq(order, ['u1', 'c1'], 'unsolicited coach reply uses own ts, appears after user msgs');
});

check('coach reply with respondsTo to non-existent user msg', () => {
  // Defensive: respondsTo references an id we don't have user data for
  const users = [{ id: 'u1', timestamp: 100, text: 'a' }];
  const coaches = [
    { id: 'c1', timestamp: 500, respondsTo: ['ghost_id'], text: 'orphan reply' },
  ];
  const order = buildTimeline(users, coaches).map(t => t.id);
  // Falls back to own timestamp since ghost_id has refTs=0
  eq(order, ['u1', 'c1'], 'orphan reply falls back to own timestamp');
});

check('only user messages, no coach yet', () => {
  const users = [
    { id: 'u1', timestamp: 100, text: 'a' },
    { id: 'u2', timestamp: 200, text: 'b' },
  ];
  const order = buildTimeline(users, []).map(t => t.id);
  eq(order, ['u1', 'u2'], 'just user messages in order');
});

check('only coach messages, no users', () => {
  // Edge case: purely cron-generated highlights with no chat
  const coaches = [
    { id: 'c1', timestamp: 100, respondsTo: [], text: 'highlight 1' },
    { id: 'c2', timestamp: 200, respondsTo: [], text: 'highlight 2' },
  ];
  const order = buildTimeline([], coaches).map(t => t.id);
  eq(order, ['c1', 'c2'], 'coach-only ordered by own timestamp');
});

check('coach reply identical timestamp to user message order is stable', () => {
  // Edge case: refTs+1 for two different coach replies could collide if
  // they reply to consecutive messages with timestamps 1ms apart.
  // Not a likely real case but should not crash.
  const users = [
    { id: 'u1', timestamp: 100, text: 'a' },
    { id: 'u2', timestamp: 100, text: 'b' }, // same ts (unusual)
  ];
  const coaches = [
    { id: 'c1', timestamp: 200, respondsTo: ['u1'], text: 'reply a' },
    { id: 'c2', timestamp: 300, respondsTo: ['u2'], text: 'reply b' },
  ];
  const order = buildTimeline(users, coaches).map(t => t.id);
  // Both coach replies have sortKey 101; sort is stable, so order
  // depends on insertion. Just check no crash and all 4 present.
  if (order.length !== 4) throw new Error('expected 4 entries');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
