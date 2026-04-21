#!/usr/bin/env node
// build-summary.js — Generates a compact weekly-summary.md for coach sessions
// Run after processing. Reads analysis/*.json, outputs a human-readable
// summary the coach loads instead of 7 full analysis files (~1KB vs ~155KB).

const fs = require('fs');
const path = require('path');

const coachDir = process.env.COACH_DIR || path.join(require('os').homedir(), 'Coach');
const analysisDir = path.join(coachDir, 'analysis');
const goalsPath = path.join(coachDir, 'profile', 'goals.json');
const outPath = path.join(coachDir, 'weekly-summary.md');
const statsOutPath = path.join(coachDir, 'profile', 'current-stats.json');

// Helper — emit current-stats.json even in failure/empty cases so coach never reads stale data
function writeCurrentStats(stats) {
  try {
    const profileDir = path.dirname(statsOutPath);
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(statsOutPath, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error('Failed to write current-stats.json:', e.message);
  }
}

const emptyStats = () => ({
  generated_at: new Date().toISOString(),
  generated_from_analysis_date: null,
  weight: {
    current_lbs: null,
    morning_today_lbs: null,
    morning_timestamp: null,
    trend_7d: null,
    trend_30d: null,
    readings_count_7d: 0,
    readings_count_30d: 0,
  },
  adherence_7d: {
    days_tracked: 0,
    avg_calories: null,
    avg_protein_g: null,
    cal_hits: 0,
    protein_hits: 0,
    water_hits: 0,
    workout_days: 0,
  },
  streaks: { tracking: 0, calorie_goal: 0, protein_goal: 0 },
});

if (!fs.existsSync(analysisDir)) {
  fs.writeFileSync(outPath, '# Weekly Summary\n\n_No analysis data yet._\n');
  writeCurrentStats(emptyStats());
  console.log('No analysis dir — wrote empty summary + current-stats');
  process.exit(0);
}

// Load goals for context
let goals = {};
try { goals = JSON.parse(fs.readFileSync(goalsPath, 'utf8')); } catch (e) {}
const activePlan = goals.activePlan || 'moderate';
const plan = goals[activePlan] || goals.moderate || {};
const calTarget = plan.calories?.daily ?? 1200;
const proTarget = plan.protein?.grams ?? 105;
const waterTarget = plan.water?.daily_oz ?? 64;

// Read last 14 days of analysis (show 7, use 14 for trends)
const today = new Date();
const files = fs.readdirSync(analysisDir)
  .filter(f => f.endsWith('.json'))
  .sort()
  .slice(-14);

const days = [];
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(analysisDir, f), 'utf8'));
    const entries = d.entries || [];
    const meals = entries.filter(e => ['meal', 'drink', 'snack', 'custom'].includes(e.type));
    const workouts = entries.filter(e => e.type === 'workout');

    days.push({
      date: d.date,
      cal: d.totals?.calories || 0,
      protein: d.totals?.protein || 0,
      carbs: d.totals?.carbs || 0,
      fat: d.totals?.fat || 0,
      water: d.water_oz || 0,
      weight: d.weight?.value || null,
      mealCount: meals.length,
      workedOut: workouts.length > 0,
      workoutDesc: workouts.map(w => w.description || w.type).join(', '),
      calStatus: d.goals?.calories?.status || (d.totals?.calories <= calTarget ? 'under' : 'over'),
      proStatus: (d.totals?.protein || 0) >= proTarget * 0.85 ? 'hit' : 'low',
      waterStatus: (d.water_oz || 0) >= waterTarget ? 'hit' : 'low',
      highlights: (d.highlights || []).slice(0, 2),
      concerns: (d.concerns || []).slice(0, 2),
      // Meal details for quick reference (no need to open full file)
      meals: meals.map(m => ({
        desc: (m.description || '').substring(0, 60),
        cal: m.calories || 0,
        protein: m.protein || 0,
      })),
    });
  } catch (e) { /* skip corrupt files */ }
}

if (days.length === 0) {
  fs.writeFileSync(outPath, '# Weekly Summary\n\n_No analysis data yet._\n');
  writeCurrentStats(emptyStats());
  console.log('No analysis files — wrote empty summary + current-stats');
  process.exit(0);
}

// Split into this week and last week
const thisWeek = days.slice(-7);
const lastWeek = days.slice(-14, -7);

// Calculate aggregates
const avg = (arr, fn) => arr.length ? Math.round(arr.reduce((s, d) => s + fn(d), 0) / arr.length) : 0;
const count = (arr, fn) => arr.filter(fn).length;

const thisAvgCal = avg(thisWeek, d => d.cal);
const thisAvgPro = avg(thisWeek, d => d.protein);
const thisWorkouts = count(thisWeek, d => d.workedOut);
const thisWaterHits = count(thisWeek, d => d.waterStatus === 'hit');
const thisCalHits = count(thisWeek, d => d.calStatus === 'under' || d.calStatus === 'on_track');
const thisProHits = count(thisWeek, d => d.proStatus === 'hit');

// Weight trend
const weights = days.filter(d => d.weight).map(d => ({ date: d.date, w: d.weight }));
const weightTrend = weights.length >= 2
  ? `${weights[0].w} → ${weights[weights.length - 1].w} lbs (${weights[weights.length - 1].w < weights[0].w ? 'down' : 'up'} ${Math.abs(weights[weights.length - 1].w - weights[0].w).toFixed(1)})`
  : weights.length === 1 ? `${weights[0].w} lbs (single reading)` : 'no data';

// Build markdown
let md = '# Weekly Summary\n\n';
md += `Auto-generated from analysis data. Coach reads this instead of loading all analysis files.\n`;
md += `For details on a specific day, read \`analysis/YYYY-MM-DD.json\`.\n\n`;

// Overview
md += `## This Week (${thisWeek.length} days tracked)\n\n`;
md += `| Metric | Avg/Count | Target | Status |\n`;
md += `|--------|-----------|--------|--------|\n`;
md += `| Calories | ${thisAvgCal}/day | ${calTarget} | ${thisCalHits}/${thisWeek.length} days on target |\n`;
md += `| Protein | ${thisAvgPro}g/day | ${proTarget}g | ${thisProHits}/${thisWeek.length} days hit |\n`;
md += `| Water | ${thisWaterHits}/${thisWeek.length} days | ${waterTarget}oz | ${thisWaterHits >= thisWeek.length * 0.7 ? 'good' : 'needs work'} |\n`;
md += `| Workouts | ${thisWorkouts}/${thisWeek.length} days | - | ${thisWorkouts >= 4 ? 'solid' : thisWorkouts >= 2 ? 'ok' : 'low'} |\n`;
md += `| Weight | ${weightTrend} | ${goals.weight?.goal || '?'} lbs | - |\n`;
md += '\n';

// Day-by-day
md += '## Day by Day\n\n';
for (const d of thisWeek) {
  if (d.cal === 0 && d.mealCount === 0) continue; // skip empty days
  const dateObj = new Date(d.date + 'T12:00:00');
  if (isNaN(dateObj.getTime())) continue; // skip malformed dates
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const flags = [];
  if (d.calStatus === 'over') flags.push('over cal');
  if (d.proStatus === 'low') flags.push('low protein');
  if (d.waterStatus === 'low') flags.push('low water');
  if (d.workedOut) flags.push('workout');

  md += `### ${dayName} — ${d.cal} cal, ${d.protein}g protein${d.weight ? ', ' + d.weight + ' lbs' : ''}\n`;
  md += `${flags.join(' | ')}\n\n`;

  // Meals compact list
  for (const m of d.meals) {
    md += `- ${m.desc} (${m.cal} cal, ${m.protein}g P)\n`;
  }

  if (d.highlights.length) {
    md += `\n**Good:** ${d.highlights.join('; ')}\n`;
  }
  if (d.concerns.length) {
    md += `**Watch:** ${d.concerns.join('; ')}\n`;
  }
  md += '\n';
}

// Patterns (coach-useful observations)
md += '## Patterns\n\n';

// Calorie consistency
const calStdDev = Math.round(Math.sqrt(thisWeek.reduce((s, d) => s + Math.pow(d.cal - thisAvgCal, 2), 0) / thisWeek.length));
md += `- Calorie consistency: avg ${thisAvgCal}, std dev ${calStdDev} (${calStdDev < 200 ? 'consistent' : 'variable'})\n`;

// Protein trend
const proBelow = thisWeek.filter(d => d.protein < proTarget * 0.85);
if (proBelow.length > 0) {
  md += `- Protein under target ${proBelow.length}/${thisWeek.length} days (avg ${thisAvgPro}g vs ${proTarget}g goal)\n`;
}

// Workout consistency
if (thisWorkouts < 4) {
  md += `- Only ${thisWorkouts} workouts this week\n`;
}

// Late-day patterns (if data available)
const highCalDays = thisWeek.filter(d => d.cal > calTarget * 1.1);
if (highCalDays.length > 0) {
  md += `- Over-cal days: ${highCalDays.map(d => new Date(d.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'})).join(', ')}\n`;
}

md += '\n';

fs.writeFileSync(outPath, md);
console.log(`Built weekly-summary.md: ${thisWeek.length} days, ${md.length} bytes`);

// ─────────────────────────────────────────────────────────────────────────────
// current-stats.json — computed artifact, overwritten every processing cycle.
// Coach reads this for CURRENT body stats. identity.md does NOT contain numbers
// that drift (weight, BMI, PRs) — only immutable identity facts live there.
// ─────────────────────────────────────────────────────────────────────────────
(function buildCurrentStats() {
  const stats = emptyStats();

  // Pull last 30 days of analysis with richer weight objects
  const allFiles = fs.readdirSync(analysisDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.prebug-backup') && !f.endsWith('.uploaded'))
    .sort()
    .slice(-30);

  const weightReadings = []; // { date, value, morning_value, morning_timestamp }
  let latestFile = null;
  let latestData = null;
  for (const f of allFiles) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(analysisDir, f), 'utf8'));
      if (d.date) { latestFile = f; latestData = d; }
      if (d.weight && (d.weight.value != null || d.weight.morning_value != null)) {
        weightReadings.push({
          date: d.date,
          value: d.weight.value ?? null,
          morning_value: d.weight.morning_value ?? null,
          morning_timestamp: d.weight.morning_timestamp ?? null,
        });
      }
    } catch (e) { /* skip corrupt */ }
  }

  if (latestData) stats.generated_from_analysis_date = latestData.date;

  // Weight: prefer morning_value (more consistent), fall back to value
  const pickWeight = (r) => (r.morning_value != null ? r.morning_value : r.value);

  if (weightReadings.length > 0) {
    const latest = weightReadings[weightReadings.length - 1];
    stats.weight.current_lbs = pickWeight(latest);
    stats.weight.morning_today_lbs = latest.morning_value ?? null;
    stats.weight.morning_timestamp = latest.morning_timestamp ?? null;

    const last7 = weightReadings.slice(-7);
    const last30 = weightReadings.slice(-30);
    stats.weight.readings_count_7d = last7.length;
    stats.weight.readings_count_30d = last30.length;

    if (last7.length >= 2) {
      const s = pickWeight(last7[0]);
      const e = pickWeight(last7[last7.length - 1]);
      if (s != null && e != null) {
        stats.weight.trend_7d = { start: s, end: e, delta: +(e - s).toFixed(1) };
      }
    }
    if (last30.length >= 2) {
      const s = pickWeight(last30[0]);
      const e = pickWeight(last30[last30.length - 1]);
      if (s != null && e != null) {
        stats.weight.trend_30d = { start: s, end: e, delta: +(e - s).toFixed(1) };
      }
    }
  }

  // Adherence from the weekly aggregates already computed
  stats.adherence_7d = {
    days_tracked: thisWeek.length,
    avg_calories: thisWeek.length ? thisAvgCal : null,
    avg_protein_g: thisWeek.length ? thisAvgPro : null,
    cal_hits: thisCalHits,
    protein_hits: thisProHits,
    water_hits: thisWaterHits,
    workout_days: thisWorkouts,
  };

  // Streaks — pull from latest analysis if present
  if (latestData && latestData.streaks) {
    stats.streaks = {
      tracking: latestData.streaks.tracking ?? 0,
      calorie_goal: latestData.streaks.calorie_goal ?? 0,
      protein_goal: latestData.streaks.protein_goal ?? 0,
    };
  }

  writeCurrentStats(stats);
  console.log(`Built current-stats.json: weight=${stats.weight.current_lbs} lbs (${weightReadings.length} readings in last 30d)`);
})();
