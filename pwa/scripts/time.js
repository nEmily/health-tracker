// time.js — Canonical date helpers for the health tracker.
// Entries logged before 4am local time belong to the previous calendar day.

const Time = {
  // Plain Date for now. No boundary adjustment.
  now() {
    return new Date();
  },

  // YYYY-MM-DD for a given Date (or now) honoring the 4am day boundary.
  coachDate(when) {
    const d = (when instanceof Date) ? when : new Date();
    const shifted = new Date(d.getTime() - 4 * 3600 * 1000);
    const yyyy = shifted.getFullYear();
    const mm = String(shifted.getMonth() + 1).padStart(2, '0');
    const dd = String(shifted.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  // Convenience wrapper: today's coach date as YYYY-MM-DD.
  todayCoachDate() {
    return Time.coachDate(Time.now());
  },
};
