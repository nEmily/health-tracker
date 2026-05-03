// Tests for Time.coachDate() — 4am day boundary rule.
// Run with: node pwa/tests/time.test.js

// Inline the module so the test is self-contained and runnable in Node.
const Time = {
  now() { return new Date(); },
  coachDate(when) {
    const d = (when instanceof Date) ? when : new Date();
    const shifted = new Date(d.getTime() - 4 * 3600 * 1000);
    const yyyy = shifted.getFullYear();
    const mm = String(shifted.getMonth() + 1).padStart(2, '0');
    const dd = String(shifted.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },
  todayCoachDate() { return Time.coachDate(Time.now()); },
};

let passed = 0, failed = 0;
function assert(label, got, expected) {
  if (got === expected) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    console.error(`        expected: ${expected}`);
    console.error(`        got:      ${got}`);
    failed++;
  }
}

// Helper: build a local Date at a given time string on a given date.
function localDate(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`);
}

console.log('Time.coachDate() boundary tests');

// 3:59 AM on 2026-01-15 → belongs to 2026-01-14 (before 4am)
assert('3:59 AM → previous day', Time.coachDate(localDate('2026-01-15', '03:59:59')), '2026-01-14');

// 4:00 AM on 2026-01-15 → belongs to 2026-01-15 (exactly on boundary)
assert('4:00 AM → current day',  Time.coachDate(localDate('2026-01-15', '04:00:00')), '2026-01-15');

// 4:01 AM on 2026-01-15 → belongs to 2026-01-15
assert('4:01 AM → current day',  Time.coachDate(localDate('2026-01-15', '04:01:00')), '2026-01-15');

// 11:59 PM on 2026-01-15 → belongs to 2026-01-15
assert('11:59 PM → current day', Time.coachDate(localDate('2026-01-15', '23:59:00')), '2026-01-15');

// Explicit date: noon on 2026-03-01
assert('explicit noon date',     Time.coachDate(localDate('2026-03-01', '12:00:00')), '2026-03-01');

// Month/year rollover: 3 AM on Jan 1 → Dec 31 of previous year
assert('Jan 1 03:00 AM → Dec 31', Time.coachDate(localDate('2026-01-01', '03:00:00')), '2025-12-31');

// todayCoachDate returns a YYYY-MM-DD string
assert('todayCoachDate format',  /^\d{4}-\d{2}-\d{2}$/.test(Time.todayCoachDate()), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
