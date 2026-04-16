// score.js — Daily score calculation (0-100) showing goal alignment

const DayScore = {
  // Calculate score from available data (works with or without analysis).
  // Accepts an optional `preloaded` object with any of:
  //   { goals, summary, entries, analysis, regimen }
  // Pre-populated values skip the corresponding DB read, reducing redundant reads
  // when the caller already has this data. Existing callers can omit the param.
  async calculate(date, preloaded) {
    const goals = preloaded?.goals ?? (await DB.getProfile('goals') || {});
    const summary = preloaded?.summary ?? await DB.getDailySummary(date);
    const entries = preloaded?.entries ?? await DB.getEntriesByDate(date);
    const analysis = preloaded?.analysis ?? await DB.getAnalysis(date);
    const regimen = preloaded?.regimen ?? await DB.getRegimen();

    const hc = goals.hardcore || {};
    const moderate = { calories: goals.calories || 2000, protein: goals.protein || 100, water_oz: goals.water_oz || 64, fiber: goals.fiber || 25 };
    const hardcore = { calories: hc.calories || 1500, protein: hc.protein || 130, water_oz: hc.water_oz || 64, fiber: hc.fiber || goals.fiber || 25 };

    // Get actuals — prefer analysis data, fall back to entry counting
    const totals = analysis?.totals || {};
    const calActual = totals.calories || 0;
    const proteinActual = totals.protein || 0;
    const fiberActual = totals.fiber || 0;
    const waterActual = summary.water_oz || 0;
    const hasAnalysis = !!analysis;

    // Workout check
    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const todayPlan = regimen?.weeklySchedule?.find(d => d.day === dayName);
    const isWorkoutDay = todayPlan && todayPlan.type !== 'rest';
    const workoutEntries = entries.filter(e => e.type === 'workout');
    const fitnessChecked = summary.fitness_checked || [];
    const didWorkout = workoutEntries.length > 0 || fitnessChecked.length > 0;

    // Vices
    const vices = entries.filter(e => e.type === 'custom');
    const drinkCount = vices.reduce((sum, v) => sum + (v.quantity || 1), 0);

    // Meal logging
    const meals = entries.filter(e => e.type === 'meal');

    // Bonus: cardio day + also did bonus strength exercises = +5
    const isCardioDay = todayPlan && todayPlan.type === 'cardio';
    const workoutSubtypes = workoutEntries.map(e => (e.subtype || '').toLowerCase());
    const checkedLower = fitnessChecked.map(s => s.toLowerCase());
    const didStrengthOnCardioDay = isCardioDay && didWorkout && (
      workoutSubtypes.some(s => s === 'strength' || s === 'bands' || s === 'resistance') ||
      checkedLower.some(s => s.includes('band') || s.includes('push-up') || s.includes('clam') || s.includes('bridge') || s.includes('woodchop') || s.includes('face pull') || s.includes('good morning'))
    );

    // --- Score calculation ---
    const scoreModerate = DayScore._calc(calActual, proteinActual, fiberActual, waterActual, moderate, hasAnalysis, meals, isWorkoutDay, didWorkout, drinkCount, didStrengthOnCardioDay);
    const scoreHardcore = DayScore._calc(calActual, proteinActual, fiberActual, waterActual, hardcore, hasAnalysis, meals, isWorkoutDay, didWorkout, drinkCount, didStrengthOnCardioDay);

    return {
      moderate: scoreModerate,
      hardcore: scoreHardcore,
      breakdown: scoreModerate.breakdown,
      goals: { moderate, hardcore },
    };
  },

  _calc(calActual, proteinActual, fiberActual, waterActual, goals, hasAnalysis, meals, isWorkoutDay, didWorkout, drinkCount, didStrengthOnCardioDay) {
    let score = 0;
    const breakdown = {};

    // Calories (25 pts) — within ±150 of target is full marks
    if (hasAnalysis && calActual > 0) {
      const diff = Math.abs(calActual - goals.calories);
      if (diff <= 150) { score += 25; breakdown.calories = 25; }
      else if (diff <= 300) { score += 15; breakdown.calories = 15; }
      else if (calActual > goals.calories + 300) { score += 0; breakdown.calories = 0; }
      else { score += 10; breakdown.calories = 10; }
    } else {
      // No analysis yet — give partial credit for logging
      breakdown.calories = null; // unknown
    }

    // Protein (25 pts) — proportional to target
    if (hasAnalysis && proteinActual > 0) {
      const pct = Math.min(1, proteinActual / goals.protein);
      const pts = Math.round(pct * 25);
      score += pts;
      breakdown.protein = pts;
    } else {
      breakdown.protein = null;
    }

    // Fiber (10 pts) — proportional to target
    if (hasAnalysis && fiberActual > 0) {
      const pct = Math.min(1, fiberActual / goals.fiber);
      const pts = Math.round(pct * 10);
      score += pts;
      breakdown.fiber = pts;
    } else {
      breakdown.fiber = null;
    }

    // Workout (25 pts)
    if (isWorkoutDay) {
      if (didWorkout) { score += 25; breakdown.workout = 25; }
      else { breakdown.workout = 0; }
    } else {
      // Rest day — full marks for resting
      score += 25;
      breakdown.workout = 25;
      breakdown._isRest = true;
    }

    // Water (10 pts)
    if (waterActual >= goals.water_oz) { score += 10; breakdown.water = 10; }
    else if (waterActual >= goals.water_oz * 0.5) { score += 5; breakdown.water = 5; }
    else { breakdown.water = 0; }

    // Logging consistency (15 pts) — logged at least 1 meal
    if (meals.length >= 1) { score += 15; breakdown.logging = 15; }
    else { breakdown.logging = 0; }

    // Bonus: cardio + strength on same day (+5, can exceed 100)
    if (didStrengthOnCardioDay) {
      score += 5;
      breakdown.bonus = 5;
    }

    // Vice penalty (-10 per drink, max -30)
    if (drinkCount > 0) {
      const penalty = Math.min(30, drinkCount * 10);
      score -= penalty;
      breakdown.vices = -penalty;
    }

    score = Math.max(0, Math.min(115, score));

    return { score, breakdown };
  },

  // Descriptor text for a given score value
  _descriptor(score) {
    if (score <= 20) return 'Just getting started';
    if (score <= 40) return 'Building momentum';
    if (score <= 60) return 'Solid effort';
    if (score <= 80) return 'Great day';
    return 'Crushing it';
  },

  // Calculate streak — consecutive days with ≥1 meal entry, walking backwards from date.
  // If today has no entries yet, starts from yesterday.
  async calculateStreak(date) {
    const todayEntries = await DB.getEntriesByDate(date);
    const hasTodayEntries = todayEntries.some(e => e.type === 'meal');

    let current = new Date(date + 'T12:00:00');
    if (!hasTodayEntries) {
      current.setDate(current.getDate() - 1);
    }

    let streak = 0;
    const maxDays = 365;

    for (let i = 0; i < maxDays; i++) {
      const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const entries = await DB.getEntriesByDate(dateStr);
      if (!entries.some(e => e.type === 'meal')) break;
      streak++;
      current.setDate(current.getDate() - 1);
    }

    return streak;
  },

  // Render the score gauge for the today screen
  render(result, streak) {
    const { moderate, hardcore, goals } = result;
    const ms = moderate.score;
    const hs = hardcore.score;
    const bd = moderate.breakdown;

    // If no meaningful activity logged (no calories data, no water, no meals), show muted empty state
    const hasActivity = bd.calories != null || bd.water > 0 || bd.logging > 0;
    if (!hasActivity && ms <= 25) {
      return `
        <div class="day-score day-score--empty" style="opacity: 0.6;">
          <div class="day-score-gauge">
            <svg viewBox="0 0 100 100" class="score-ring">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border-color)" stroke-width="6" stroke-dasharray="4 8"/>
            </svg>
            <div class="score-number" style="color:var(--text-muted); font-size:18px;">?</div>
          </div>
          <div class="day-score-labels">
            <div class="score-label-main" style="color:var(--text-muted)">Your score builds as you log</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px;">Snap a meal photo to get started</div>
          </div>
        </div>
      `;
    }

    const color = ms >= 75 ? 'var(--accent-green)' : ms >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';

    // SVG circular gauge
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(ms, 100) / 100) * circumference;

    // Breakdown chips
    const chips = [];
    if (bd.calories != null) chips.push({ label: 'Cal', pts: bd.calories, max: 25 });
    if (bd.protein != null) chips.push({ label: 'Protein', pts: bd.protein, max: 25 });
    if (bd.fiber != null) chips.push({ label: 'Fiber', pts: bd.fiber, max: 10 });
    chips.push({ label: bd._isRest ? 'Rest' : 'Workout', pts: bd.workout, max: 25 });
    chips.push({ label: 'Water', pts: bd.water, max: 10 });
    chips.push({ label: 'Logged', pts: bd.logging, max: 15 });
    if (bd.bonus) chips.push({ label: 'Bonus', pts: bd.bonus, max: 5 });
    if (bd.vices != null) chips.push({ label: 'Vices', pts: bd.vices, max: 0 });

    let chipsHtml = '';
    for (const chip of chips) {
      const chipColor = chip.pts < 0 ? 'var(--accent-red)' :
                        chip.pts >= chip.max ? 'var(--accent-green)' :
                        chip.pts > 0 ? 'var(--accent-orange)' : 'var(--text-muted)';
      const label = chip.pts != null ? `${chip.pts > 0 ? '+' : ''}${chip.pts}` : '?';
      chipsHtml += `<span class="score-chip" style="border-color:${chipColor}; color:${chipColor}">${chip.label} ${label}</span>`;
    }

    // Goal targets row — only when scores differ
    let targetsHtml = '';
    if (goals && ms !== hs) {
      const mg = goals.moderate;
      const hg = goals.hardcore;
      targetsHtml = `
        <div class="score-targets">
          <span class="score-target-item">
            <span class="score-target-label">Your Goal</span>
            <span class="score-target-value">${ms}</span>
          </span>
          <span class="score-target-sep">·</span>
          <span class="score-target-item">
            <span class="score-target-label">Stretch</span>
            <span class="score-target-value">${hs}</span>
          </span>
        </div>`;
    }

    return `
      <div class="day-score">
        <div class="day-score-top">
          <div class="day-score-gauge">
            <svg viewBox="0 0 100 100" class="score-ring">
              <circle cx="50" cy="50" r="${radius}" fill="none" stroke="var(--border-color)" stroke-width="6"/>
              <circle cx="50" cy="50" r="${radius}" fill="none" stroke="${color}" stroke-width="6"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                stroke-linecap="round" transform="rotate(-90 50 50)"
                class="score-ring-fill"/>
            </svg>
            <div class="score-number" style="color:${color}">${ms}</div>
          </div>
          <div class="day-score-labels">
            <div class="score-descriptor">${DayScore._descriptor(ms)}</div>
            ${streak >= 2 ? `<div class="streak-badge">${streak} day streak</div>` : ''}
            ${targetsHtml}
          </div>
        </div>
        <div class="score-breakdown-wrap">
          <div class="score-breakdown">
            ${chipsHtml}
          </div>
        </div>
      </div>
    `;
  },
};
