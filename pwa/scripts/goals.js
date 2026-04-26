// goals.js — Analysis rendering utilities (shared by app.js, profile views)

// --- Adaptive Calorie Targets ---
// Analyzes weight trend vs calorie intake to suggest target adjustments.
// Always a suggestion — user explicitly accepts or dismisses.
const AdaptiveGoals = {
  // Minimum data thresholds
  MIN_DAYS: 14,
  MIN_WEIGHT_MEASUREMENTS: 6,
  MIN_CALORIE_DAYS: 10,
  // Safety bounds (cal/day)
  MIN_CALORIES: 800,
  MAX_CALORIES: 4000,
  // Adjustment step (cal)
  STEP: 50,
  // Dismissal cooldown (days)
  DISMISS_COOLDOWN_DAYS: 14,
  // Expected weekly rate of change (lbs/wk, negative = loss)
  DEFAULT_EXPECTED_RATE: -0.5,
  // Tolerance band: within 0.5 lbs/wk of expected rate = no suggestion
  TOLERANCE: 0.5,

  // Compute 7-day moving average from an array of { date, weight } objects.
  // Returns array of { date, ma } where ma is the average of up to 7 preceding values.
  _movingAverage(points) {
    if (points.length === 0) return [];
    const result = [];
    for (let i = 0; i < points.length; i++) {
      const windowStart = Math.max(0, i - 6);
      const window = points.slice(windowStart, i + 1);
      const avg = window.reduce((s, p) => s + p.weight, 0) / window.length;
      result.push({ date: points[i].date, ma: avg });
    }
    return result;
  },

  // Main algorithm. Returns null (no suggestion) or { currentTarget, suggestedTarget, reason, direction }.
  // goals: user's profile goals object
  // summaries: array of dailySummary objects (from DB.getDailySummaryRange)
  // analyses: array of analysis objects (from DB.getAnalysisRange)
  computeSuggestion(goals, summaries, analyses) {
    if (!goals || !summaries || !analyses) return null;

    // Check dismissal/acceptance cooldown
    const dismissedAt = goals.adaptive?.dismissedAt;
    if (dismissedAt) {
      const daysSinceDismiss = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
      if (daysSinceDismiss < AdaptiveGoals.DISMISS_COOLDOWN_DAYS) return null;
    }
    const acceptedAt = goals.adaptive?.acceptedAt;
    if (acceptedAt) {
      const daysSinceAccept = (Date.now() - acceptedAt) / (1000 * 60 * 60 * 24);
      if (daysSinceAccept < AdaptiveGoals.DISMISS_COOLDOWN_DAYS) return null;
    }

    // Extract weight points from summaries
    const weightPoints = [];
    for (const s of summaries) {
      if (s.weight?.value && s.date) {
        weightPoints.push({ date: s.date, weight: s.weight.value });
      }
    }

    // Sort by date ascending
    weightPoints.sort((a, b) => a.date.localeCompare(b.date));

    // Count days with calorie analysis
    const calorieDays = analyses.filter(a => a.totals?.calories != null && a.totals.calories > 0).length;

    // Gating checks
    const totalDays = summaries.length;
    if (totalDays < AdaptiveGoals.MIN_DAYS) return null;
    if (weightPoints.length < AdaptiveGoals.MIN_WEIGHT_MEASUREMENTS) return null;
    if (calorieDays < AdaptiveGoals.MIN_CALORIE_DAYS) return null;

    // Compute 7-day MA
    const ma = AdaptiveGoals._movingAverage(weightPoints);
    if (ma.length < 2) return null;

    // Compare MA at start vs end of window
    // Use first 7 MA values avg vs last 7 MA values avg for stability
    const startWindow = ma.slice(0, Math.min(7, ma.length));
    const endWindow = ma.slice(Math.max(0, ma.length - 7));
    const startMA = startWindow.reduce((s, p) => s + p.ma, 0) / startWindow.length;
    const endMA = endWindow.reduce((s, p) => s + p.ma, 0) / endWindow.length;

    // Compute actual weekly change rate
    const firstDate = new Date(ma[0].date + 'T12:00:00');
    const lastDate = new Date(ma[ma.length - 1].date + 'T12:00:00');
    const weeksElapsed = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 7);
    if (weeksElapsed < 1) return null;

    const totalChange = endMA - startMA;
    const weeklyChange = totalChange / weeksElapsed;

    // Expected rate (negative for loss)
    const expectedRate = goals.adaptive?.expectedRate ?? AdaptiveGoals.DEFAULT_EXPECTED_RATE;

    // Difference: how far off from expected
    // If expectedRate = -0.5 and weeklyChange = 0 → losing 0.5 lbs/wk too slow
    // If expectedRate = -0.5 and weeklyChange = -1.0 → losing 0.5 lbs/wk too fast
    const deviation = weeklyChange - expectedRate;

    const currentTarget = goals.calories || 2000;

    // Within tolerance: no suggestion
    if (Math.abs(deviation) < AdaptiveGoals.TOLERANCE) return null;

    let suggestedTarget;
    let reason;
    let direction;

    if (deviation >= AdaptiveGoals.TOLERANCE) {
      // Losing too slow (or gaining) — reduce calories
      suggestedTarget = currentTarget - AdaptiveGoals.STEP;
      direction = 'decrease';
      reason = `Weight trend is ${Math.abs(weeklyChange).toFixed(1)} lbs/wk `
        + (weeklyChange >= 0 ? '(gaining)' : '(losing)')
        + ` vs target of ${Math.abs(expectedRate).toFixed(1)} lbs/wk loss. `
        + `Reducing target by ${AdaptiveGoals.STEP} cal to accelerate progress.`;
    } else {
      // Losing too fast — increase calories (safety)
      suggestedTarget = currentTarget + AdaptiveGoals.STEP;
      direction = 'increase';
      reason = `Weight trend is ${Math.abs(weeklyChange).toFixed(1)} lbs/wk loss `
        + `vs target of ${Math.abs(expectedRate).toFixed(1)} lbs/wk. `
        + `Increasing target by ${AdaptiveGoals.STEP} cal for sustainable progress.`;
    }

    // Safety bounds
    if (suggestedTarget < AdaptiveGoals.MIN_CALORIES) return null;
    if (suggestedTarget > AdaptiveGoals.MAX_CALORIES) return null;

    // Don't suggest if same as current
    if (suggestedTarget === currentTarget) return null;

    return { currentTarget, suggestedTarget, reason, direction, weeklyChange, expectedRate };
  },
};

const GoalsView = {
  // Normalize analysis data to a consistent shape for rendering.
  // Handles both the old schema (a.calories.intake, a.macros.protein.grams) and
  // the actual processing schema (a.totals.calories, a.goals.calories.target).
  // profileGoals (optional): user's current profile goals — overrides stale analysis targets.
  _normalizeAnalysis(a, profileGoals) {
    let calIntake = null, calGoal = null, calBurned = null, calNet = null;
    const macros = {}; // { protein: { actual, goal }, carbs: {...}, fat: {...} }
    let waterActual = null, waterGoal = null;

    // Calories
    if (a.calories) {
      calIntake = a.calories.intake; calGoal = a.calories.goal;
      calBurned = a.calories.burned; calNet = a.calories.net;
    } else if (a.totals && a.goals?.calories) {
      calIntake = a.totals.calories; calGoal = a.goals.calories.target;
    }

    // Macros
    if (a.macros) {
      for (const [name, m] of Object.entries(a.macros)) {
        macros[name] = { actual: m.grams, goal: m.goal };
      }
    } else if (a.totals) {
      for (const name of ['protein', 'carbs', 'fat', 'fiber']) {
        if (a.totals[name] != null) {
          macros[name] = {
            actual: a.totals[name],
            goal: a.goals?.[name]?.target || null,
          };
        }
      }
    }

    // Water
    if (a.water) {
      waterActual = a.water.total_oz; waterGoal = a.water.goal_oz;
    } else if (a.goals?.water) {
      waterActual = a.goals.water.actual_oz; waterGoal = a.goals.water.target_oz;
    }

    // Override with current profile goals (analysis may have stale targets)
    if (profileGoals) {
      if (profileGoals.calories) calGoal = profileGoals.calories;
      if (profileGoals.protein && macros.protein) macros.protein.goal = profileGoals.protein;
      if (profileGoals.water_oz) waterGoal = profileGoals.water_oz;
    }

    return { calIntake, calGoal, calBurned, calNet, macros, waterActual, waterGoal };
  },

  renderRemainingBudget(analysis, profileGoals) {
    const n = GoalsView._normalizeAnalysis(analysis, profileGoals);
    let html = '<h2 class="section-header">Remaining Today</h2><div class="card">';

    if (n.calIntake != null && n.calGoal) {
      const remaining = n.calGoal - n.calIntake;
      const remainingCal = Math.round(remaining);
      const pct = Math.min(100, Math.round((n.calIntake / n.calGoal) * 100));
      const color = remaining > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      html += `
        <div style="display:flex; justify-content:space-between; margin-bottom: var(--space-xs);">
          <span style="font-weight:600;">Calories</span>
          <span style="color:var(--text-secondary)">${remaining > 0 ? remainingCal + ' remaining' : Math.abs(remainingCal) + ' over'}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>
        <div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:2px;">${n.calIntake} eaten of ${n.calGoal}</div>
      `;
    }

    // Macro remaining
    if (Object.keys(n.macros).length > 0) {
      html += '<div style="margin-top: var(--space-sm);">';
      for (const [name, m] of Object.entries(n.macros)) {
        if (!m.goal) continue;
        const remaining = m.goal - m.actual;
        const remainingDisplay = Math.round(remaining * 10) / 10;
        html += `
          <div style="display:flex; justify-content:space-between; font-size:var(--text-sm); margin-bottom:4px;">
            <span style="text-transform:capitalize;">${name}</span>
            <span style="color:var(--text-secondary)">${remaining > 0 ? remainingDisplay + 'g left' : 'goal hit!'}</span>
          </div>
        `;
      }
      html += '</div>';
    }

    // Water remaining
    if (n.waterActual != null && n.waterGoal) {
      const remaining = n.waterGoal - n.waterActual;
      const remainingWater = Math.round(remaining * 10) / 10;
      html += `
        <div style="display:flex; justify-content:space-between; font-size:var(--text-sm); margin-top:var(--space-sm);">
          <span>Water</span>
          <span style="color:var(--text-secondary)">${remaining > 0 ? remainingWater + ' oz left' : 'goal hit!'}</span>
        </div>
      `;
    }

    html += '</div>';

    // Forward-looking tips for rest of the day
    if (analysis.concerns?.length) {
      html += '<h2 class="section-header">Rest of Your Day</h2><div class="card">';
      for (const c of analysis.concerns) {
        html += `<div style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom:6px;">${UI.escapeHtml(c)}</div>`;
      }
      html += '</div>';
    }

    return html;
  },

  renderDayLog(analysis) {
    if (!analysis.entries || analysis.entries.length === 0) return '';

    let html = '<h2 class="section-header">What You Ate</h2><div class="card">';

    for (const entry of analysis.entries) {
      if (entry.type === 'bodyPhoto') continue;
      const cal = entry.type === 'workout' ? `${entry.calories_burned || (entry.calories ? Math.abs(entry.calories) : '?')} cal burned` :
                  `${entry.calories || 0} cal`;
      const protein = entry.type !== 'workout' && entry.protein ? ` \u00B7 ${entry.protein}g protein` : '';
      const fiber = entry.type !== 'workout' && entry.fiber ? ` \u00B7 ${entry.fiber}g fiber` : '';

      html += `
        <div style="padding:var(--space-xs) 0; border-bottom:1px solid var(--border-color);">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <span style="font-size:var(--text-sm);">${UI.escapeHtml(entry.description || entry.notes || entry.type)}</span>
          </div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">${cal}${protein}${fiber}${entry.confidence ? ' \u00B7 ' + entry.confidence + ' confidence' : ''}</div>
        </div>
      `;
    }

    // Totals row
    if (analysis.totals) {
      const t = analysis.totals;
      html += `
        <div style="padding-top:var(--space-sm); font-weight:600; font-size:var(--text-sm); display:flex; justify-content:space-between;">
          <span>Total</span>
          <span>${t.calories} cal \u00B7 ${t.protein}g protein \u00B7 ${t.carbs}g carbs \u00B7 ${t.fat}g fat${t.fiber != null ? ` \u00B7 ${t.fiber}g fiber` : ''}</span>
        </div>
      `;
    }

    html += '</div>';

    // Highlights
    if (analysis.highlights?.length) {
      html += '<div class="card" style="margin-top: var(--space-sm);">';
      for (const h of analysis.highlights) {
        html += `<div style="font-size:var(--text-sm); color:var(--accent-green); margin-bottom:4px;">${UI.escapeHtml(h)}</div>`;
      }
      html += '</div>';
    }

    return html;
  },

  renderAnalysisSummary(a, profileGoals) {
    const dateLabel = a.date ? UI.formatDate(a.date) : 'Daily Summary';
    let html = `<h2 class="section-header">${UI.escapeHtml(dateLabel)} Analysis</h2>`;
    const n = GoalsView._normalizeAnalysis(a, profileGoals);

    // Calorie bar
    if (n.calIntake != null) {
      const pct = n.calGoal ? Math.min(100, Math.round((n.calIntake / n.calGoal) * 100)) : 0;
      const overUnder = n.calGoal ? n.calIntake - n.calGoal : 0;
      const color = n.calGoal && Math.abs(overUnder) <= n.calGoal * 0.1 ? 'var(--accent-green)' :
                    overUnder > 0 ? 'var(--accent-red)' : 'var(--accent-orange)';

      html += `
        <div class="card">
          <div style="display:flex; justify-content:space-between; margin-bottom: var(--space-xs);">
            <span style="font-weight:600;">Calories</span>
            <span style="color:var(--text-secondary)">${n.calIntake} / ${n.calGoal || '?'}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>
          ${n.calBurned ? `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-xs);">Burned: ${n.calBurned} | Net: ${n.calNet}</div>` : ''}
        </div>
      `;
    }

    // Macro bars
    if (Object.keys(n.macros).length > 0) {
      html += '<div class="card" style="margin-top: var(--space-sm);">';
      for (const [name, m] of Object.entries(n.macros)) {
        const hasGoal = m.goal && m.goal > 0;
        const pct = hasGoal ? Math.min(100, Math.round((m.actual / m.goal) * 100)) : 0;
        const color = hasGoal && m.actual >= m.goal * 0.85 ? 'var(--accent-green)' : 'var(--accent-orange)';
        html += `
          <div style="margin-bottom: var(--space-sm);">
            <div style="display:flex; justify-content:space-between; font-size:var(--text-sm);">
              <span style="text-transform:capitalize;">${name}</span>
              <span style="color:var(--text-secondary)">${m.actual}g${hasGoal ? ' / ' + m.goal + 'g' : ''}</span>
            </div>
            ${hasGoal ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>` : ''}
          </div>
        `;
      }
      html += '</div>';
    }

    // Water
    if (n.waterActual != null && n.waterGoal) {
      const pct = Math.min(100, Math.round((n.waterActual / n.waterGoal) * 100));
      const color = n.waterActual >= n.waterGoal ? 'var(--accent-blue)' : 'var(--accent-orange)';
      html += `
        <div class="card" style="margin-top: var(--space-sm);">
          <div style="display:flex; justify-content:space-between; margin-bottom: var(--space-xs);">
            <span style="font-weight:600;">Water</span>
            <span style="color:var(--text-secondary)">${n.waterActual} / ${n.waterGoal} oz</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>
        </div>
      `;
    }

    // Entry breakdown (per-item calories)
    if (a.entries?.length) {
      html += '<div class="card" style="margin-top: var(--space-sm);">';
      html += '<div style="font-weight:600; margin-bottom:var(--space-xs);">Breakdown</div>';
      for (const entry of a.entries) {
        if (entry.type === 'bodyPhoto') continue;
        const isWorkout = entry.type === 'workout';
        const calText = isWorkout ? `${entry.calories_burned || (entry.calories ? Math.abs(entry.calories) : '?')} burned` : `${entry.calories || 0} cal`;
        const proteinText = !isWorkout && entry.protein ? ` \u00B7 ${entry.protein}g P` : '';
        const fiberText = !isWorkout && entry.fiber ? ` \u00B7 ${entry.fiber}g fiber` : '';
        const icon = isWorkout ? '\u{1F3CB}' : (entry.type === 'drink' ? '\u{1F375}' : '\u{1F374}');
        const desc = entry.description || entry.notes || entry.type;
        html += `
          <div style="padding:6px 0; border-bottom:1px solid var(--border-color);">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:var(--text-sm); font-weight:500;">${icon} ${calText}${proteinText}${fiberText}</span>
            </div>
            <div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:2px;">${UI.escapeHtml(desc)}</div>
          </div>
        `;
      }
      if (a.totals) {
        html += `<div style="display:flex; justify-content:space-between; padding-top:var(--space-xs); font-weight:600; font-size:var(--text-xs);">
          <span>Total</span><span>${a.totals.calories} cal \u00B7 ${a.totals.protein}g P${a.totals.fiber != null ? ` \u00B7 ${a.totals.fiber}g fiber` : ''}</span>
        </div>`;
      }
      html += '</div>';
    }

    // Highlights & Concerns
    if (a.highlights?.length || a.concerns?.length) {
      html += '<div class="card" style="margin-top: var(--space-sm);">';
      if (a.highlights?.length) {
        html += `<div style="margin-bottom: var(--space-sm);">`;
        for (const h of a.highlights) {
          html += `<div style="font-size:var(--text-sm); color:var(--accent-green); margin-bottom:2px;">+ ${UI.escapeHtml(h)}</div>`;
        }
        html += '</div>';
      }
      if (a.concerns?.length) {
        for (const c of a.concerns) {
          html += `<div style="font-size:var(--text-sm); color:var(--accent-orange); margin-bottom:2px;">- ${UI.escapeHtml(c)}</div>`;
        }
      }
      html += '</div>';
    }

    return html;
  },
};
