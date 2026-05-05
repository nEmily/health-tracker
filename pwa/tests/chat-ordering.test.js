/**
 * Test chat display ordering — strict chronological by timestamp.
 *
 * Coach response timestamps are server-side (synthesis run time, set by the
 * orchestrator's _normalize_coach_responses, not the LLM). So raw-timestamp
 * sort reflects reality: user messages at the time the user sent them, coach
 * replies at the time the cron actually generated them.
 *
 * Earlier attempt: I built a sortKey hack to position coach replies right
 * after the message they responded to, faking back-and-forth flow. The user
 * pushed back: "it SHOULD be sorted into timestamp." Reverted; the real fix
 * is upstream — strip LLM-fabricated timestamps in synthesis output.
 *
 * Run: node pwa/tests/chat-ordering.test.js
 */

// Replicate the sort logic from coach.js render():
function buildTimeline(userMessages, coachMessages) {
  const timeline = [];
  for (const msg of userMessages) {
    timeline.push({ role: 'user', id: msg.id, text: msg.text, timestamp: msg.timestamp || 0 });
  }
  for (const cm of coachMessages) {
    timeline.push({ role: 'coach', id: cm.id, text: cm.text, timestamp: cm.timestamp || 0 });
  }
  timeline.sort((a, b) => a.timestamp - b.timestamp);
  return timeline;
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

check('strict chronological — user sends 2 msgs before coach replies', () => {
  // Real 2026-05-04 case: user sent both messages before cron ran.
  // Coach responses got REAL timestamps (synthesis time = after both user msgs).
  // Expected: u1, u2, c1, c2 (chronological).
  const users = [
    { id: 'u1', timestamp: 1777928724001, text: 'msg 1' },  // 14:05
    { id: 'u2', timestamp: 1777935117738, text: 'msg 2' },  // 15:51
  ];
  const coaches = [
    { id: 'c1', timestamp: 1777944793000, text: 'reply 1' },  // 18:33 (cron run)
    { id: 'c2', timestamp: 1777944793001, text: 'reply 2' },  // same cron run
  ];
  eq(buildTimeline(users, coaches).map(t => t.id),
     ['u1', 'u2', 'c1', 'c2'],
     'two user msgs sent back-to-back, then both coach replies on cron tick');
});

check('back-and-forth — user waits for coach reply before next msg', () => {
  // User sends, gets coach reply, sends again, gets reply.
  const users = [
    { id: 'u1', timestamp: 1000, text: 'a' },
    { id: 'u2', timestamp: 3000, text: 'b' },  // sent AFTER c1 received
  ];
  const coaches = [
    { id: 'c1', timestamp: 2000, text: 'reply a' },
    { id: 'c2', timestamp: 4000, text: 'reply b' },
  ];
  eq(buildTimeline(users, coaches).map(t => t.id),
     ['u1', 'c1', 'u2', 'c2'],
     'natural back-and-forth when user paces with coach');
});

check('only user messages, no coach yet', () => {
  const users = [
    { id: 'u1', timestamp: 100, text: 'a' },
    { id: 'u2', timestamp: 200, text: 'b' },
  ];
  eq(buildTimeline(users, []).map(t => t.id), ['u1', 'u2']);
});

check('only coach messages (cron-only highlights)', () => {
  const coaches = [
    { id: 'c1', timestamp: 100, text: 'highlight 1' },
    { id: 'c2', timestamp: 200, text: 'highlight 2' },
  ];
  eq(buildTimeline([], coaches).map(t => t.id), ['c1', 'c2']);
});

check('missing timestamps default to 0 (sort-stable)', () => {
  const items = [
    { id: 'a', timestamp: 100 },
    { id: 'b' }, // no timestamp
  ];
  // 'b' has timestamp 0, comes first. Defensive: don't crash.
  const result = buildTimeline([items[1]], [items[0]]).map(t => t.id);
  if (result.length !== 2) throw new Error('expected 2 items');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
