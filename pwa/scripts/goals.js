// goals.js — Goals, streaks, meal plan, workout plan display

const GoalsView = {
  async init() {
    const container = document.getElementById('goals-container');
    if (!container) return;

    const date = App.selectedDate;
    const analysis = await DB.getAnalysis(date);
    const mealPlan = await DB.getMealPlan();
    const regimen = await DB.getRegimen();

    let html = '';

    // --- Daily Summary (from analysis) ---
    if (analysis) {
      html += GoalsView.renderAnalysisSummary(analysis);
    } else {
      html += `
        <div class="card" style="text-align:center; padding: var(--space-lg);">
          <p style="color: var(--text-muted); font-size: var(--text-sm);">No analysis yet for ${UI.formatRelativeDate(date)}.</p>
          <p style="color: var(--text-muted); font-size: var(--text-xs); margin-top: var(--space-xs);">Import analysis from Settings after Claude processes.</p>
        </div>
      `;
    }

    // --- Streaks ---
    if (analysis && analysis.streaks) {
      html += GoalsView.renderStreaks(analysis.streaks);
    }

    // --- Meal Plan ---
    if (mealPlan && mealPlan.days) {
      html += GoalsView.renderMealPlan(mealPlan);
    }

    // --- Workout Plan ---
    if (regimen) {
      html += GoalsView.renderRegimen(regimen);
    }

    container.innerHTML = html;
  },

  // Normalize analysis data to a consistent shape for rendering.
  // Handles both the old schema (a.calories.intake, a.macros.protein.grams) and
  // the actual processing schema (a.totals.calories, a.goals.calories.target).
  _normalizeAnalysis(a) {
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
      for (const name of ['protein', 'carbs', 'fat']) {
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

    return { calIntake, calGoal, calBurned, calNet, macros, waterActual, waterGoal };
  },

  renderAnalysisSummary(a) {
    let html = '<h2 class="section-header">Daily Summary</h2>';
    const n = GoalsView._normalizeAnalysis(a);

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
        const pct = m.goal ? Math.min(100, Math.round((m.actual / m.goal) * 100)) : 0;
        const color = m.goal && m.actual >= m.goal * 0.85 ? 'var(--accent-green)' : 'var(--accent-orange)';
        html += `
          <div style="margin-bottom: var(--space-sm);">
            <div style="display:flex; justify-content:space-between; font-size:var(--text-sm);">
              <span style="text-transform:capitalize;">${name}</span>
              <span style="color:var(--text-secondary)">${m.actual}g / ${m.goal || '?'}g</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>
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

    // Highlights & Concerns
    if (a.highlights?.length || a.concerns?.length) {
      html += '<div class="card" style="margin-top: var(--space-sm);">';
      if (a.highlights?.length) {
        html += `<div style="margin-bottom: var(--space-sm);">`;
        for (const h of a.highlights) {
          html += `<div style="font-size:var(--text-sm); color:var(--accent-green); margin-bottom:2px;">\u2713 ${h}</div>`;
        }
        html += '</div>';
      }
      if (a.concerns?.length) {
        for (const c of a.concerns) {
          html += `<div style="font-size:var(--text-sm); color:var(--accent-orange); margin-bottom:2px;">\u26A0 ${c}</div>`;
        }
      }
      html += '</div>';
    }

    return html;
  },

  renderStreaks(streaks) {
    let html = '<h2 class="section-header">Streaks</h2><div class="stats-row">';
    const streakIcons = {
      logging: '\u{1F4CB}', tracking: '\u{1F4CB}',
      waterGoal: '\u{1F4A7}', water_goal: '\u{1F4A7}',
      workout: '\u{1F4AA}',
      proteinGoal: '\u{1F356}', protein_goal: '\u{1F356}',
      calorie_goal: '\u{1F525}',
    };
    const streakLabels = {
      logging: 'Logging', tracking: 'Logging',
      waterGoal: 'Water Goal', water_goal: 'Water Goal',
      workout: 'Workout',
      proteinGoal: 'Protein Goal', protein_goal: 'Protein Goal',
      calorie_goal: 'Calorie Goal',
    };

    for (const [key, val] of Object.entries(streaks)) {
      const icon = streakIcons[key] || '\u{1F525}';
      const label = streakLabels[key] || key;
      html += `
        <div class="stat-card">
          <div style="font-size:var(--text-xl);">${icon}</div>
          <div class="stat-value">${val}</div>
          <div class="stat-label">${label}</div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  },

  renderMealPlan(plan) {
    let html = '<h2 class="section-header">Meal Plan</h2>';
    const genDate = plan.generatedDate || plan.generated;
    html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-sm);">Generated ${UI.formatDate(genDate)}</div>`;

    for (const day of plan.days) {
      html += `<div class="card" style="margin-bottom: var(--space-sm);">`;
      html += `<div style="font-weight:600; margin-bottom:var(--space-sm);">${UI.formatDate(day.date)}</div>`;

      // Handle remaining_meal (single suggestion for current day)
      if (day.remaining_meal && !day.meals) {
        const rm = day.remaining_meal;
        html += `
          <div style="font-size:var(--text-sm); padding: 4px 0;">
            <div style="font-weight:500; margin-bottom:2px;">${rm.name || rm.suggestion || 'Suggestion'}</div>
            ${rm.note ? `<div style="color:var(--text-muted); font-size:var(--text-xs); margin-bottom:4px;">${rm.note}</div>` : ''}
            <span style="color:var(--text-muted);">${rm.calories || rm.approxCalories || '?'} cal, ${rm.protein || '?'}g protein</span>
          </div>
        `;
      }

      // Handle meals array
      if (day.meals) {
        for (const meal of day.meals) {
          const mealType = meal.type || meal.meal || '';
          const mealName = meal.suggestion || meal.name || meal.description || '';
          const mealCal = meal.approxCalories || meal.calories || '?';
          html += `
            <div style="display:flex; justify-content:space-between; font-size:var(--text-sm); margin-bottom:var(--space-xs); padding: 4px 0; border-bottom: 1px solid var(--border-color);">
              <div>
                <span style="color:var(--text-muted); text-transform:capitalize; width:70px; display:inline-block;">${mealType}</span>
                ${mealName}
              </div>
              <span style="color:var(--text-muted); white-space:nowrap; margin-left:var(--space-sm);">${mealCal}cal</span>
            </div>
          `;
        }
      }

      const totalCal = day.totalCalories || day.day_totals?.calories || '';
      const totalPro = day.totalProtein || day.day_totals?.protein || '';
      if (totalCal || totalPro) {
        html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-xs);">Total: ~${totalCal} cal, ~${totalPro}g protein</div>`;
      }
      html += '</div>';
    }

    return html;
  },

  renderRegimen(regimen) {
    let html = '<h2 class="section-header">Workout Plan</h2>';

    if (regimen.description) {
      html += `<div class="card" style="margin-bottom: var(--space-sm);"><p style="font-size:var(--text-sm); color:var(--text-secondary);">${regimen.description}</p></div>`;
    }

    if (regimen.weeklySchedule) {
      html += '<div class="card">';
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

      for (const day of regimen.weeklySchedule) {
        const isToday = day.day === today;
        html += `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border-color); ${isToday ? 'font-weight:600;' : ''}">
            <span style="text-transform:capitalize; width:90px; ${isToday ? 'color:var(--accent-green);' : ''}">${day.day}</span>
            <span style="color:var(--text-secondary); text-transform:capitalize;">${day.type}</span>
            <span style="font-size:var(--text-sm); color:var(--text-muted); flex:1; text-align:right;">${day.description}</span>
          </div>
        `;
      }
      html += '</div>';
    }

    if (regimen.weeklyReview) {
      html += `<div class="card" style="margin-top: var(--space-sm);">
        <div style="font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-xs);">Weekly Review</div>
        <p style="font-size:var(--text-sm);">${regimen.weeklyReview}</p>
      </div>`;
    }

    return html;
  },
};
