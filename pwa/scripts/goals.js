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

  renderAnalysisSummary(a) {
    let html = '<h2 class="section-header">Daily Summary</h2>';

    // Calorie bar
    if (a.calories) {
      const c = a.calories;
      const pct = c.goal ? Math.min(100, Math.round((c.intake / c.goal) * 100)) : 0;
      const overUnder = c.goal ? c.intake - c.goal : 0;
      const color = Math.abs(overUnder) <= c.goal * 0.1 ? 'var(--accent-green)' :
                    overUnder > 0 ? 'var(--accent-red)' : 'var(--accent-orange)';

      html += `
        <div class="card">
          <div style="display:flex; justify-content:space-between; margin-bottom: var(--space-xs);">
            <span style="font-weight:600;">Calories</span>
            <span style="color:var(--text-secondary)">${c.intake} / ${c.goal || '?'}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>
          ${c.burned ? `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-xs);">Burned: ${c.burned} | Net: ${c.net}</div>` : ''}
        </div>
      `;
    }

    // Macro bars
    if (a.macros) {
      html += '<div class="card" style="margin-top: var(--space-sm);">';
      for (const [name, m] of Object.entries(a.macros)) {
        const pct = m.goal ? Math.min(100, Math.round((m.grams / m.goal) * 100)) : 0;
        const color = m.grams >= m.goal * 0.85 ? 'var(--accent-green)' : 'var(--accent-orange)';
        html += `
          <div style="margin-bottom: var(--space-sm);">
            <div style="display:flex; justify-content:space-between; font-size:var(--text-sm);">
              <span style="text-transform:capitalize;">${name}</span>
              <span style="color:var(--text-secondary)">${m.grams}g / ${m.goal || '?'}g</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color}"></div></div>
          </div>
        `;
      }
      html += '</div>';
    }

    // Water
    if (a.water) {
      const w = a.water;
      const pct = w.goal_oz ? Math.min(100, Math.round((w.total_oz / w.goal_oz) * 100)) : 0;
      const color = w.total_oz >= w.goal_oz ? 'var(--accent-blue)' : 'var(--accent-orange)';
      html += `
        <div class="card" style="margin-top: var(--space-sm);">
          <div style="display:flex; justify-content:space-between; margin-bottom: var(--space-xs);">
            <span style="font-weight:600;">Water</span>
            <span style="color:var(--text-secondary)">${w.total_oz} / ${w.goal_oz} oz</span>
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
      logging: '\u{1F4CB}',
      waterGoal: '\u{1F4A7}',
      workout: '\u{1F4AA}',
      proteinGoal: '\u{1F356}',
    };
    const streakLabels = {
      logging: 'Logging',
      waterGoal: 'Water Goal',
      workout: 'Workout',
      proteinGoal: 'Protein Goal',
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
    html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-sm);">Generated ${UI.formatDate(plan.generatedDate)}</div>`;

    for (const day of plan.days) {
      html += `<div class="card" style="margin-bottom: var(--space-sm);">`;
      html += `<div style="font-weight:600; margin-bottom:var(--space-sm);">${UI.formatDate(day.date)}</div>`;

      for (const meal of day.meals) {
        html += `
          <div style="display:flex; justify-content:space-between; font-size:var(--text-sm); margin-bottom:var(--space-xs); padding: 4px 0; border-bottom: 1px solid var(--border-color);">
            <div>
              <span style="color:var(--text-muted); text-transform:capitalize; width:70px; display:inline-block;">${meal.type}</span>
              ${meal.suggestion}
            </div>
            <span style="color:var(--text-muted); white-space:nowrap; margin-left:var(--space-sm);">${meal.approxCalories}cal</span>
          </div>
        `;
      }

      html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-xs);">Total: ~${day.totalCalories} cal, ~${day.totalProtein}g protein</div>`;
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
