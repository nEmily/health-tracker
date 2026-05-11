// progress.js -- Progress tab: Insights / Trends / Fitness segments

const ProgressView = {
  _tab: 'insights',
  _fitnessSort: 'recent', // 'recent' | 'overdue' | 'category' | 'session'
  _fitnessCache: null,    // cached aggregated exercise history

  async init() {
    const container = document.getElementById('progress-container');
    if (!container) return;

    const activeTab = ProgressView._tab || 'insights';

    // Segment control (3 tabs)
    let html = `
      <div class="segment-control" style="margin-bottom:var(--space-md);">
        <button class="segment-btn${activeTab === 'insights' ? ' active' : ''}" data-ptab="insights">Insights</button>
        <button class="segment-btn${activeTab === 'plan' ? ' active' : ''}" data-ptab="plan">Plan</button>
        <button class="segment-btn${activeTab === 'trends' ? ' active' : ''}" data-ptab="trends">Trends</button>
        <button class="segment-btn${activeTab === 'challenges' ? ' active' : ''}" data-ptab="challenges">Challenges</button>
        <button class="segment-btn${activeTab === 'fitness' ? ' active' : ''}" data-ptab="fitness">Fitness</button>
      </div>
    `;

    if (activeTab === 'insights') {
      html += await ProgressView.renderInsights();
    } else if (activeTab === 'plan') {
      html += await ProgressView.renderPlan();
    } else if (activeTab === 'trends') {
      html += await ProgressView.renderTrends();
    } else if (activeTab === 'challenges') {
      html += await Challenges.renderActive(container, App.selectedDate);
    } else if (activeTab === 'fitness') {
      html += await ProgressView.renderFitness();
    }

    container.innerHTML = html;

    // Bind segment tabs
    container.querySelectorAll('.segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ProgressView._tab = btn.dataset.ptab;
        ProgressView.init();
      });
    });

    // Wire adaptive calorie suggestion buttons (Insights tab)
    if (activeTab === 'insights') {
      const acceptBtn = container.querySelector('.adaptive-accept-btn');
      const dismissBtn = container.querySelector('.adaptive-dismiss-btn');
      if (acceptBtn) {
        acceptBtn.addEventListener('click', async () => {
          const suggested = parseInt(acceptBtn.dataset.suggested, 10);
          if (!suggested) return;
          const goals = await DB.getProfile('goals') || {};
          const oldCal = Goals.resolve(goals).calories;
          goals.calories = suggested;
          // Also update hardcore variant proportionally
          if (goals.hardcore?.calories) {
            const ratio = goals.hardcore.calories / oldCal;
            goals.hardcore.calories = Math.round(suggested * ratio);
          }
          // Mark as accepted to prevent immediate re-suggestion
          if (!goals.adaptive) goals.adaptive = {};
          goals.adaptive.acceptedAt = Date.now();
          // Optimistic local update so the UI reflects the change immediately.
          await DB.setProfileOwned('goals', goals, 'cron-via-delta');
          // Queue delta so cron applies the acceptance and echoes back canonical shape.
          await DB.queueGoalUpdate({ adaptive: { acceptedAt: goals.adaptive.acceptedAt } }, 'adaptive-suggestion');
          UI.toast(`Calorie target updated to ${suggested} cal/day`);
          await ProgressView.init();
        });
      }
      if (dismissBtn) {
        dismissBtn.addEventListener('click', async () => {
          const goals = await DB.getProfile('goals') || {};
          if (!goals.adaptive) goals.adaptive = {};
          goals.adaptive.dismissedAt = Date.now();
          // Optimistic local update so the card hides immediately.
          await DB.setProfileOwned('goals', goals, 'cron-via-delta');
          // Queue delta so cron records the dismissal and respects the cooldown.
          await DB.queueGoalUpdate({ adaptive: { dismissedAt: goals.adaptive.dismissedAt } }, 'adaptive-suggestion');
          await ProgressView.init();
        });
      }
    }

    // Wire calendar day taps (Trends tab)
    container.querySelectorAll('.cal-day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => App.goToDate(el.dataset.date));
    });

    // Wire weight chart touch interaction (Trends tab)
    if (activeTab === 'trends') {
      ProgressView._initWeightChartTouch();
      // Wire photo scroll reveal
      container.querySelectorAll('.progress-photos-scroll').forEach(el => ProgressView._wirePhotoScroll(el));
      // Wire compare buttons
      container.querySelectorAll('.compare-photos-btn').forEach(btn => {
        btn.addEventListener('click', () => ProgressView._showPhotoComparison(btn.dataset.subtype));
      });
    }
    // Wire face photo scroll (Skin tab)
    if (activeTab === 'skin') {
      const faceScroll = container.querySelector('.progress-photos-scroll');
      if (faceScroll) ProgressView._wirePhotoScroll(faceScroll);
      // Wire compare button for face photos
      container.querySelectorAll('.compare-photos-btn').forEach(btn => {
        btn.addEventListener('click', () => ProgressView._showPhotoComparison(btn.dataset.subtype));
      });
    }
    // Wire challenge events (Challenges tab)
    if (activeTab === 'challenges') {
      Challenges.bindEvents(container);
    }

    // Wire fitness sort buttons
    if (activeTab === 'fitness') {
      container.querySelectorAll('.fitness-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          ProgressView._fitnessSort = btn.dataset.sort;
          ProgressView.init();
        });
      });
      // Wire exercise history expand/collapse
      container.querySelectorAll('.fh-exercise-card').forEach(card => {
        card.addEventListener('click', () => {
          const hist = card.querySelector('.fh-history');
          if (hist) hist.style.display = hist.style.display === 'none' ? 'block' : 'none';
        });
      });
    }
  },

  // --- Insights ---
  async renderInsights() {
    const today = UI.today();
    const goals = await DB.getProfile('goals') || {};
    let analysis = await DB.getAnalysis(today);
    if (!analysis) analysis = await DB.getAnalysis(UI.yesterday(today));

    let html = '';

    // Adaptive calorie target suggestion (top of Insights)
    html += await ProgressView._renderAdaptiveSuggestion(goals);

    // Weekly deficit running total (#1)
    html += await ProgressView._renderWeeklyDeficit(goals);

    // Logging consistency (#4)
    html += await ProgressView._renderLoggingConsistency();

    // Weekly summary (this week vs last week)
    html += await ProgressView.renderWeeklySummary(goals);

    // Goal consistency (moved from Goals segment)
    const activePlan = goals.activePlan || 'moderate';
    const timeline = goals.timeline || {};
    const startDate = timeline.start || today;
    const analyses = await DB.getAnalysisRange(startDate, today);
    if (analyses.length > 0) {
      const _rg = Goals.resolve(goals);
      const calTarget = _rg.calories;
      const proTarget = _rg.protein;
      const calHits = analyses.filter(a => (a.totals?.calories || 0) <= calTarget * 1.1).length;
      const proHits = analyses.filter(a => (a.totals?.protein || 0) >= proTarget * 0.85).length;
      const workoutDays = analyses.filter(a => (a.entries || []).some(e => e.type === 'workout')).length;

      html += '<h2 class="section-header">Goal Consistency</h2><div class="card">';
      html += `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:var(--space-sm); text-align:center;">
        <div>
          <div style="font-size:var(--text-lg); font-weight:600; color:${calHits/analyses.length >= 0.7 ? 'var(--accent-green)' : 'var(--accent-orange)'};">${calHits}/${analyses.length}</div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">Cal target</div>
        </div>
        <div>
          <div style="font-size:var(--text-lg); font-weight:600; color:${proHits/analyses.length >= 0.7 ? 'var(--accent-green)' : 'var(--accent-orange)'};">${proHits}/${analyses.length}</div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">Protein target</div>
        </div>
        <div>
          <div style="font-size:var(--text-lg); font-weight:600; color:var(--accent-primary);">${workoutDays}/${analyses.length}</div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">Workouts</div>
        </div>
      </div>`;
      html += '</div>';
    }

    // Vice impact on score (#3)
    html += await ProgressView._renderViceImpact(goals);

    // Macro % split (#5)
    html += await ProgressView._renderMacroSplit();

    // Best/worst day of week (#7)
    html += await ProgressView._renderBestWorstDay(goals);

    // Weekend vs weekday split (#9)
    html += await ProgressView._renderWeekendVsWeekday();

    // Meal plan
    const mealPlan = await DB.getMealPlan();
    if (mealPlan?.days?.length) {
      html += '<h2 class="section-header">Meal Plan</h2>';
      for (const day of mealPlan.days) {
        html += `<div class="card" style="margin-bottom:var(--space-sm);">`;
        const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        html += `<div style="font-weight:600; font-size:var(--text-sm); margin-bottom:var(--space-xs);">${dayLabel}</div>`;
        if (day.meals) {
          // Normalize meals dict -> array (synthesis emits {breakfast: ..., lunch: ...})
          const mealsArr = Array.isArray(day.meals) ? day.meals
            : Object.entries(day.meals).map(([type, m]) => ({ ...m, type: m.type || type }));
          for (const m of mealsArr) {
            const ingredientsHtml = UI.renderIngredientList(m.ingredients);
            const fiberText = m.fiber ? ` - ${m.fiber}g F` : '';
            html += `<div style="padding:4px 0;">
              <div style="display:flex; justify-content:space-between; font-size:var(--text-sm);">
                <span>${UI.escapeHtml(m.name || m.meal)}</span>
                <span style="color:var(--text-muted); font-size:var(--text-xs);">${m.calories} cal - ${m.protein}g P${fiberText}</span>
              </div>
              ${ingredientsHtml}
            </div>`;
          }
        }
        if (day.day_totals) {
          const dt = day.day_totals;
          const fiberTotal = dt.fiber != null ? ` - ${dt.fiber}g F` : '';
          html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-xs); padding-top:var(--space-xs); border-top:1px solid var(--border-color);">
            ~${dt.calories} cal - ${dt.protein}g P${fiberTotal}
          </div>`;
        }
        if (day.notes) {
          html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:4px;">${UI.escapeHtml(day.notes)}</div>`;
        }
        html += '</div>';
      }
    }

    // Highlights from recent analysis
    if (analysis?.highlights?.length) {
      html += '<h2 class="section-header">Highlights</h2><div class="card">';
      for (const h of analysis.highlights) {
        html += `<div style="font-size:var(--text-sm); color:var(--accent-green); margin-bottom:4px;">&#10003; ${UI.escapeHtml(h)}</div>`;
      }
      html += '</div>';
    }

    if (!html) {
      html = `<div class="card" style="text-align:center; padding:var(--space-lg); color:var(--text-muted);">
        <div style="font-size:var(--text-sm);">Log meals, water, and workouts to see insights here.</div>
      </div>`;
    }

    return html;
  },

  // --- Adaptive Calorie Suggestion Card ---
  async _renderAdaptiveSuggestion(goals) {
    // Gather 28 days of summaries and analyses
    const today = UI.today();
    const windowStart = new Date(today + 'T12:00:00');
    windowStart.setDate(windowStart.getDate() - 28);
    const startStr = `${windowStart.getFullYear()}-${String(windowStart.getMonth() + 1).padStart(2, '0')}-${String(windowStart.getDate()).padStart(2, '0')}`;

    const summaries = await DB.getDailySummaryRange(startStr, today);
    const analyses = await DB.getAnalysisRange(startStr, today);

    const suggestion = AdaptiveGoals.computeSuggestion(goals, summaries, analyses);
    if (!suggestion) return '';

    const arrowIcon = suggestion.direction === 'decrease'
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M4 9l4 4 4-4"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';

    return `
      <div class="adaptive-suggestion-card">
        <div class="adaptive-suggestion-header">
          <span class="adaptive-suggestion-icon">${arrowIcon}</span>
          <span class="adaptive-suggestion-title">Calorie Target Adjustment</span>
        </div>
        <div class="adaptive-suggestion-body">
          <div class="adaptive-suggestion-values">
            <div class="adaptive-suggestion-current">
              <div class="adaptive-suggestion-label">Current</div>
              <div class="adaptive-suggestion-value">${suggestion.currentTarget}</div>
              <div class="adaptive-suggestion-unit">cal/day</div>
            </div>
            <div class="adaptive-suggestion-arrow">&#8594;</div>
            <div class="adaptive-suggestion-proposed">
              <div class="adaptive-suggestion-label">Suggested</div>
              <div class="adaptive-suggestion-value">${suggestion.suggestedTarget}</div>
              <div class="adaptive-suggestion-unit">cal/day</div>
            </div>
          </div>
          <div class="adaptive-suggestion-reason">${UI.escapeHtml(suggestion.reason)}</div>
        </div>
        <div class="adaptive-suggestion-actions">
          <button class="adaptive-dismiss-btn">Dismiss</button>
          <button class="adaptive-accept-btn" data-suggested="${suggestion.suggestedTarget}">Accept</button>
        </div>
      </div>
    `;
  },

  // --- My Plan ---
  async renderPlan() {
    const goals = await DB.getProfile('goals') || {};
    const regimen = await DB.getProfile('regimen') || {};
    const prefs = await DB.getProfile('preferences') || {};
    const activePlan = goals.activePlan || 'moderate';
    // Legacy schema had {goals: {moderate: {...}, hardcore: {...}}} — current
    // schema is flat ({calories, macros, water_oz, fiber, ...} directly on
    // goals). Fall back to the flat shape so Daily Targets actually populate.
    const plan = goals[activePlan] || goals.moderate || goals;
    const timeline = goals.timeline || {};
    const milestones = timeline.milestones || goals.fitnessGoals || [];
    const today = new Date(UI.today() + 'T12:00:00');

    let html = '';

    // --- Active Plan Banner ---
    html += `<div class="card" style="text-align:center; padding:var(--space-md);">
      <div style="font-size:var(--text-xs); text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted); margin-bottom:4px;">Active Plan</div>
      <div style="font-size:var(--text-lg); font-weight:700; color:var(--accent-primary); text-transform:capitalize;">${UI.escapeHtml(activePlan)}</div>
      ${timeline.phase ? `<div style="font-size:var(--text-xs); color:var(--text-secondary); margin-top:2px;">${UI.escapeHtml(timeline.phase)}</div>` : ''}
    </div>`;

    // --- Daily Targets ---
    // Tolerant of two schema shapes:
    //   New:  {calories:{daily},  macros:{protein:{grams},  fat:{grams}}, water_oz, fiber:{daily_g}}
    //   Old:  {calories:{daily}, protein:{grams}, fat:{grams}, water:{daily_oz}, fiber:{daily_g}}
    // The renderer was reading only the old shape, so every field showed '—'
    // when goals.json uses the new nested schema.
    const cal = plan.calories?.daily ?? plan.calories ?? '—';
    const prot = plan.macros?.protein?.grams ?? plan.macros?.protein?.target
              ?? plan.protein?.grams ?? plan.protein ?? '—';
    const fat = plan.macros?.fat?.grams ?? plan.macros?.fat?.target
             ?? plan.fat?.grams ?? plan.fat ?? '—';
    const water = plan.water_oz ?? plan.water?.daily_oz ?? plan.water ?? '—';
    const fiber = plan.fiber?.daily_g ?? plan.fiber?.target ?? plan.fiber ?? null;

    html += '<h2 class="section-header">Daily Targets</h2><div class="card">';
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-sm);">
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${cal}</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">calories</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${prot}g</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">protein</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${water} oz</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">water</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${fat}g</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">fat floor</div>
      </div>
      ${fiber ? `<div style="text-align:center; grid-column: 1 / -1;">
        <div style="font-size:var(--text-lg); font-weight:600;">${fiber}g</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">fiber target</div>
      </div>` : ''}
    </div>`;
    if (plan.calories?.sunday_flexible) {
      html += `<div style="font-size:var(--text-xs); color:var(--text-muted); text-align:center; margin-top:var(--space-xs);">Sundays: ${plan.calories.sunday_flexible} cal flexible</div>`;
    }
    html += '</div>';

    // --- Meal Structure ---
    const mp = prefs.mealPlan || {};
    if (mp.mealsPerDay || mp.officeDays || mp.homeDays) {
      html += '<h2 class="section-header">Meal Structure</h2><div class="card">';
      if (mp.mealsPerDay) {
        html += `<div style="font-size:var(--text-sm); font-weight:600; margin-bottom:var(--space-xs);">${mp.mealsPerDay} meals/day${mp.includeSnacks === false ? ', no snacks' : ''}</div>`;
      }
      if (mp.officeDays) {
        const days = (mp.officeDays.days || []).map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join('/');
        html += `<div style="margin-bottom:var(--space-sm);">
          <div style="font-size:var(--text-xs); color:var(--accent-primary); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Office Days <span style="font-weight:400; color:var(--text-muted); text-transform:none;">${days}</span></div>
          <div style="font-size:var(--text-sm); color:var(--text-secondary); margin-top:2px;">${UI.escapeHtml(mp.officeDays.schedule || '')}</div>
        </div>`;
      }
      if (mp.homeDays) {
        const days = (mp.homeDays.days || []).map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join('/');
        html += `<div style="margin-bottom:var(--space-sm);">
          <div style="font-size:var(--text-xs); color:var(--accent-primary); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Home Days <span style="font-weight:400; color:var(--text-muted); text-transform:none;">${days}</span></div>
          <div style="font-size:var(--text-sm); color:var(--text-secondary); margin-top:2px;">${UI.escapeHtml(mp.homeDays.schedule || '')}</div>
        </div>`;
      }
      if (mp.notes) {
        html += `<div style="font-size:var(--text-xs); color:var(--text-muted); border-top:1px solid var(--border-color); padding-top:var(--space-xs); margin-top:var(--space-xs);">${UI.escapeHtml(mp.notes)}</div>`;
      }
      html += '</div>';
    }

    // --- Weekly Workout Schedule ---
    const schedule = regimen.weeklySchedule || [];
    if (schedule.length > 0) {
      html += '<h2 class="section-header">Workout Schedule</h2><div class="card">';
      const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const todayName = dayNames[(today.getDay() + 6) % 7]; // JS getDay: 0=Sun

      for (const day of schedule) {
        const isToday = day.day === todayName;
        const isRest = day.type === 'rest' || day.type === 'active_recovery';
        html += `<div style="display:flex; align-items:center; gap:var(--space-sm); padding:6px 0; ${isToday ? 'background:color-mix(in srgb, var(--accent-primary) 8%, transparent); margin:0 calc(-1 * var(--space-md)); padding-left:var(--space-md); padding-right:var(--space-md); border-radius:var(--radius-sm);' : ''}">
          <div style="width:32px; font-size:var(--text-xs); font-weight:600; color:${isToday ? 'var(--accent-primary)' : 'var(--text-muted)'}; text-transform:uppercase;">${day.day.slice(0, 3)}</div>
          <div style="flex:1;">
            <div style="font-size:var(--text-sm); ${isRest ? 'color:var(--text-muted); font-style:italic;' : ''}">${UI.escapeHtml(day.description || day.type)}</div>
          </div>
          <div style="font-size:var(--text-xs); color:var(--text-muted); text-transform:capitalize;">${day.type.replace('_', ' ')}</div>
        </div>`;
      }
      html += '</div>';
      if (regimen.description) {
        html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:4px; padding:0 var(--space-sm);">${UI.escapeHtml(regimen.description)}</div>`;
      }
    }

    // --- Milestones ---
    if (milestones.length > 0) {
      html += '<h2 class="section-header">Milestones</h2><div class="card">';
      for (const m of milestones) {
        const target = m.target ? new Date(m.target + 'T12:00:00') : null;
        const daysLeft = target ? Math.ceil((target - today) / 86400000) : null;
        const isPast = daysLeft !== null && daysLeft < 0;
        const isClose = daysLeft !== null && daysLeft <= 14 && daysLeft >= 0;

        html += `<div style="display:flex; align-items:center; gap:var(--space-sm); padding:8px 0; ${milestones.indexOf(m) < milestones.length - 1 ? 'border-bottom:1px solid var(--border-color);' : ''}">
          <div style="flex:1;">
            <div style="font-size:var(--text-sm); font-weight:500;">${UI.escapeHtml(m.name)}</div>
            ${m.note ? `<div style="font-size:var(--text-xs); color:var(--text-muted);">${UI.escapeHtml(m.note)}</div>` : ''}
          </div>
          ${daysLeft !== null ? `<div style="text-align:right;">
            <div style="font-size:var(--text-sm); font-weight:600; color:${isPast ? 'var(--accent-red)' : isClose ? 'var(--accent-orange)' : 'var(--accent-primary)'};">${isPast ? 'overdue' : daysLeft === 0 ? 'today' : `${daysLeft}d`}</div>
            <div style="font-size:var(--text-xs); color:var(--text-muted);">${target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
          </div>` : ''}
        </div>`;
      }
      html += '</div>';
    }

    // --- Weight Goal ---
    if (goals.weight) {
      const w = goals.weight;
      html += '<h2 class="section-header">Weight</h2><div class="card">';
      html += `<div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:var(--text-lg); font-weight:600;">${w.current || '?'} <span style="font-size:var(--text-xs); color:var(--text-muted);">${w.unit || 'lbs'}</span></div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">current</div>
        </div>
        <div style="font-size:var(--text-lg); color:var(--text-muted);">→</div>
        <div style="text-align:right;">
          <div style="font-size:var(--text-lg); font-weight:600; color:var(--accent-primary);">${w.goal || '?'} <span style="font-size:var(--text-xs); color:var(--text-muted);">${w.unit || 'lbs'}</span></div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">goal</div>
        </div>
      </div>`;
      if (w.note) {
        html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-xs); text-align:center;">${UI.escapeHtml(w.note)}</div>`;
      }
      html += '</div>';
    }

    // --- Bloat Tracking ---
    const bloat = goals.bloatTracking;
    if (bloat?.enabled) {
      html += '<h2 class="section-header">Bloat Triggers</h2><div class="card">';
      if (bloat.commonTriggers?.length) {
        html += `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:var(--space-xs);">`;
        for (const t of bloat.commonTriggers) {
          html += `<span style="font-size:var(--text-xs); padding:2px 8px; border-radius:12px; border:1px solid var(--accent-orange); color:var(--accent-orange);">${UI.escapeHtml(t)}</span>`;
        }
        html += '</div>';
      }
      if (bloat.mitigations?.length) {
        html += `<div style="margin-top:var(--space-xs);">`;
        for (const m of bloat.mitigations) {
          html += `<div style="font-size:var(--text-xs); color:var(--accent-green); margin-bottom:2px;">&#10003; ${UI.escapeHtml(m)}</div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    if (!html) {
      html = `<div class="card" style="text-align:center; padding:var(--space-lg); color:var(--text-muted);">
        <div style="font-size:var(--text-sm);">No plan data yet. Your coach will set this up during processing.</div>
      </div>`;
    }

    return html;
  },

  async renderWeeklySummary(goals) {
    const today = new Date(UI.today() + 'T12:00:00');
    // This week: Monday to today
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - mondayOffset);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const thisWeek = await DB.getAnalysisRange(fmt(thisMonday), fmt(today));
    const lastWeek = await DB.getAnalysisRange(fmt(lastMonday), fmt(lastSunday));

    if (thisWeek.length === 0 && lastWeek.length === 0) return '';

    const avg = (arr, fn) => arr.length ? Math.round(arr.reduce((s, a) => s + fn(a), 0) / arr.length) : 0;
    const thisAvgCal = avg(thisWeek, a => a.totals?.calories || 0);
    const lastAvgCal = avg(lastWeek, a => a.totals?.calories || 0);
    const thisAvgPro = avg(thisWeek, a => a.totals?.protein || 0);
    const lastAvgPro = avg(lastWeek, a => a.totals?.protein || 0);
    const thisWorkouts = thisWeek.filter(a => (a.entries || []).some(e => e.type === 'workout')).length;
    const lastWorkouts = lastWeek.filter(a => (a.entries || []).some(e => e.type === 'workout')).length;
    const waterTarget = Goals.resolve(goals).water_oz;
    const thisWater = thisWeek.filter(a => (a.goals?.water?.actual_oz || 0) >= waterTarget).length;
    const lastWater = lastWeek.filter(a => (a.goals?.water?.actual_oz || 0) >= waterTarget).length;

    const arrow = (curr, prev, lowerBetter) => {
      if (prev === 0) return '';
      const better = lowerBetter ? curr < prev : curr > prev;
      const same = curr === prev;
      if (same) return '<span style="color:var(--text-muted);">--</span>';
      return better
        ? '<span style="color:var(--accent-green);">&#9650;</span>'
        : '<span style="color:var(--accent-red);">&#9660;</span>';
    };

    let html = '<h2 class="section-header">This Week</h2><div class="card">';
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-sm);">
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${thisAvgCal}</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">avg cal ${arrow(thisAvgCal, lastAvgCal, true)}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${thisAvgPro}g</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">avg protein ${arrow(thisAvgPro, lastAvgPro, false)}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${thisWorkouts}</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">workouts ${arrow(thisWorkouts, lastWorkouts, false)}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:var(--text-lg); font-weight:600;">${thisWater}/${thisWeek.length || '-'}</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">water goal ${arrow(thisWater, lastWater, false)}</div>
      </div>
    </div>`;
    html += '</div>';
    return html;
  },

  // --- Fitness History ---
  // Category mapping for exercises
  _exerciseCategories: {
    core: ['cable crunches','cable pallof press','pallof press','hanging leg raises','hanging knee raises','plank','dead bugs','bicycle crunches','leg raises','plank shoulder taps','bird dogs','ab wheel rollouts','reverse crunches','v-sits','stomach vacuums','hollow body hold'],
    upper: ['push-ups','dumbbell rows','dumbbell overhead press','dumbbell bench press','pull-up negatives','resistance band pull-aparts','dumbbell bicep curls','tube band rows','dumbbell floor press','tube band overhead press','tube band pull-aparts','tube band tricep pushdowns','cable rows','lat pulldowns','face pulls','bench press','overhead press','tricep pushdowns','seated dumbbell overhead press','incline dumbbell press','cable lateral raises','barbell bench press'],
    lower: ['goblet squats','lunges','romanian deadlifts','bodyweight squats','kettlebell swings','step-up lunges','glute bridges','calf raises','banded squats','banded glute bridges','banded lateral walks','banded donkey kicks','banded fire hydrants','bulgarian split squats','barbell back squats','barbell romanian deadlifts','walking lunges','leg press','kettlebell goblet squats','dumbbell romanian deadlifts'],
  },

  _getExerciseCategory(name) {
    const lower = name.toLowerCase();
    for (const [cat, list] of Object.entries(ProgressView._exerciseCategories)) {
      if (list.some(k => lower.includes(k) || k.includes(lower))) return cat;
    }
    return 'other';
  },

  // Aggregate exercise history. The cron's daily synthesis is the canonical
  // parser for free-form workout notes — its output lands in
  // analysis.fitness = {subtype, sessionLabel, exercises: [{name, sets:[]}]}.
  // We read that structured field as the primary source. No JS regex parser:
  // the LLM is the parser, the PWA is the renderer.
  //
  // Sources, in priority order:
  //   1. analysis.fitness (LLM-structured, canonical) — past days
  //   2. dailySummary.fitness_sets (live checklist check-offs) — today and any
  //      day the user actively checked sets in the panel
  //
  // For days where neither is present, the day shows up empty in the strip.
  // Live notes-only entries for *today* won't show structured exercises until
  // the cron runs (~30 min) — by design; we never run a heuristic parser.
  //
  // Every session record carries _subtype so the activity strip can
  // distinguish gym from walk.
  async _buildFitnessHistory() {
    if (ProgressView._fitnessCache) return ProgressView._fitnessCache;
    const all = await DB.getAllDailySummaries();
    const map = {};       // exerciseName → [{date, sets, _subtype, _source}]
    const dayMeta = {};   // date → { subtypes: Set, hasParsed: bool }

    const markDay = (date, subtype) => {
      if (!dayMeta[date]) dayMeta[date] = { subtypes: new Set(), hasParsed: false };
      if (subtype) dayMeta[date].subtypes.add(subtype);
    };

    // Pull canonical fitness blocks from per-day analysis JSONs (cron output).
    // These are the LLM-structured fitness sessions -- the source of truth
    // for historical data. Live (today) data falls back to fitness_sets below.
    const analysisByDate = {};
    try {
      const allA = (DB.getAllAnalyses && await DB.getAllAnalyses()) || [];
      for (const a of allA) {
        if (a && a.date) analysisByDate[a.date] = a;
      }
    } catch (e) { /* non-fatal */ }

    for (const summary of all.sort((a, b) => a.date.localeCompare(b.date))) {
      const analysis = analysisByDate[summary.date];
      const fitnessBlock = analysis && analysis.fitness;

      // Source 1 (canonical): analysis.fitness from the cron synthesis.
      if (fitnessBlock && typeof fitnessBlock === 'object') {
        const subtype = fitnessBlock.subtype || 'strength';
        markDay(summary.date, subtype);
        dayMeta[summary.date].hasParsed = true;
        const exercises = Array.isArray(fitnessBlock.exercises) ? fitnessBlock.exercises : [];
        for (const ex of exercises) {
          if (!ex || !ex.name) continue;
          const sets = Array.isArray(ex.sets) ? ex.sets : [];
          const setsArr = sets.map(s => ({
            reps: s.reps == null ? null : s.reps,
            weight: s.weight_lbs == null ? (s.weight == null ? null : s.weight) : s.weight_lbs,
            done: true,
          }));
          if (!setsArr.length) continue;
          if (!map[ex.name]) map[ex.name] = [];
          map[ex.name].push({
            date: summary.date,
            sets: setsArr,
            _subtype: subtype,
            _source: 'analysis',
            _label: fitnessBlock.sessionLabel || '',
          });
        }
        // Cardio/walk with no exercises -- still surface on strip + lists.
        if (exercises.length === 0 && subtype !== 'strength') {
          const key = fitnessBlock.sessionLabel || (subtype === 'cardio' ? 'Walk / cardio session' : 'Session');
          if (!map[key]) map[key] = [];
          map[key].push({
            date: summary.date,
            sets: [{ reps: subtype === 'cardio' ? 'walk' : subtype, done: true }],
            _subtype: subtype,
            _source: 'analysis',
            _label: key,
          });
        }
        continue; // analysis.fitness is authoritative
      }

      // Source 2 (live fallback): structured checklist set check-offs.
      // Used for today and any day actively check-marked pre-cron.
      if (summary.fitness_sets) {
        for (const [exName, sets] of Object.entries(summary.fitness_sets)) {
          if (!Array.isArray(sets) || !sets.some(s => s.done)) continue;
          if (!map[exName]) map[exName] = [];
          map[exName].push({ date: summary.date, sets, _subtype: 'strength', _source: 'checklist' });
          markDay(summary.date, 'strength');
          dayMeta[summary.date].hasParsed = true;
        }
      }

      // Source 3 (live fallback): workout entries with no structure yet.
      // Surface them so the strip shows ''yes I worked out'' even pre-cron.
      const workouts = (summary.entries || []).filter(e => e.type === 'workout');
      if (workouts.length && !dayMeta[summary.date].hasParsed) {
        const subtype = (workouts[0].subtype || '').toLowerCase().includes('cardio') ? 'cardio' : 'strength';
        markDay(summary.date, subtype);
        const key = subtype === 'cardio' ? 'Walk / cardio session' : 'Workout (pending sync)';
        if (!map[key]) map[key] = [];
        map[key].push({
          date: summary.date,
          sets: [{ reps: '...', done: true }],
          _subtype: subtype,
          _source: 'live',
          _pending: true,
        });
      }
    }

    ProgressView._fitnessCache = map;
    ProgressView._dayMetaCache = dayMeta;
    return map;
  },

  async renderFitness() {
    const today = UI.today();
    const history = await ProgressView._buildFitnessHistory();
    const dayMeta = ProgressView._dayMetaCache || {};
    const sort = ProgressView._fitnessSort;

    // 14-day workout activity strip — shows both gym days (strength) and
    // cardio/walks distinctly so the user can see what they actually did.
    const stripDays = 14;
    const activityStrip = [];
    for (let i = stripDays - 1; i >= 0; i--) {
      const d = new Date(today + 'T12:00:00');
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLetter = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
      const meta = dayMeta[dateStr];
      const subtypes = meta?.subtypes || new Set();
      activityStrip.push({
        dateStr,
        label: dayLetter,
        isStrength: subtypes.has('strength'),
        isCardio: subtypes.has('cardio'),
        isFlex: subtypes.has('flexibility'),
        isToday: dateStr === today,
      });
    }

    // Count last-7-days strength sessions for the header
    const last7 = activityStrip.slice(-7);
    const strengthCount = last7.filter(d => d.isStrength).length;
    const cardioCount = last7.filter(d => d.isCardio).length;

    let html = `
      <div class="fh-strip-header">
        <span class="fh-strip-summary">Last 14 days</span>
        <span class="fh-strip-counts">
          <span class="fh-count-pill fh-count-strength">${strengthCount} gym${strengthCount === 1 ? '' : 's'} / 7d</span>
          <span class="fh-count-pill fh-count-cardio">${cardioCount} cardio / 7d</span>
        </span>
      </div>
      <div class="fh-strip">
        ${activityStrip.map(d => {
          const cls = [
            'fh-strip-day',
            d.isStrength ? 'has-strength' : '',
            d.isCardio ? 'has-cardio' : '',
            d.isFlex ? 'has-flex' : '',
            d.isToday ? 'is-today' : '',
          ].filter(Boolean).join(' ');
          return `
            <div class="${cls}" title="${d.dateStr}">
              <div class="fh-strip-marker">
                ${d.isStrength ? '<span class="fh-mark-strength"></span>' : ''}
                ${d.isCardio ? '<span class="fh-mark-cardio"></span>' : ''}
                ${!d.isStrength && !d.isCardio ? '<span class="fh-mark-empty"></span>' : ''}
              </div>
              <div class="fh-strip-label">${d.label}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="fh-sort-row">
        <button class="fh-sort-btn${sort === 'recent' ? ' active' : ''}" data-sort="recent">Recent</button>
        <button class="fh-sort-btn${sort === 'overdue' ? ' active' : ''}" data-sort="overdue">Overdue</button>
        <button class="fh-sort-btn${sort === 'category' ? ' active' : ''}" data-sort="category">Category</button>
        <button class="fh-sort-btn${sort === 'session' ? ' active' : ''}" data-sort="session">By Day</button>
      </div>
    `;

    if (Object.keys(history).length === 0) {
      html += `<div class="card" style="text-align:center; padding:var(--space-lg); color:var(--text-muted);">
        <div style="font-size:var(--text-sm);">Log workouts to see your history here.</div>
      </div>`;
      return html;
    }

    if (sort === 'session') {
      // Group all exercises by date (session view)
      const sessionMap = {}; // date → [{exName, sets}]
      for (const [exName, sessions] of Object.entries(history)) {
        for (const session of sessions) {
          if (!sessionMap[session.date]) sessionMap[session.date] = [];
          sessionMap[session.date].push({ exName, sets: session.sets });
        }
      }
      const sortedDates = Object.keys(sessionMap).sort((a, b) => b.localeCompare(a));
      for (const date of sortedDates) {
        const d = new Date(date + 'T12:00:00');
        const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const exercises = sessionMap[date];
        html += `<div class="card fh-session-card" style="margin-bottom:var(--space-sm);">
          <div class="fh-session-date">${label}</div>
          ${exercises.map(({ exName, sets }) => {
            const doneSets = sets.filter(s => s.done);
            const summary = ProgressView._formatSetsSummary(doneSets);
            return `<div class="fh-session-ex"><span class="fh-session-exname">${UI.escapeHtml(exName)}</span><span class="fh-session-perf">${summary}</span></div>`;
          }).join('')}
        </div>`;
      }
    } else {
      // Exercise-centric views (recent, overdue, category)
      let exercises = Object.entries(history).map(([name, sessions]) => {
        const last = sessions[sessions.length - 1];
        const lastDate = new Date(last.date + 'T12:00:00');
        const daysAgo = Math.round((new Date(today + 'T12:00:00') - lastDate) / 86400000);
        return { name, sessions, lastDate: last.date, daysAgo, category: ProgressView._getExerciseCategory(name) };
      });

      if (sort === 'recent') {
        exercises.sort((a, b) => a.daysAgo - b.daysAgo);
      } else if (sort === 'overdue') {
        exercises.sort((a, b) => b.daysAgo - a.daysAgo);
      } else if (sort === 'category') {
        const catOrder = { core: 0, upper: 1, lower: 2, other: 3 };
        exercises.sort((a, b) => (catOrder[a.category] ?? 3) - (catOrder[b.category] ?? 3) || a.daysAgo - b.daysAgo);
      }

      let currentCat = null;
      for (const ex of exercises) {
        if (sort === 'category' && ex.category !== currentCat) {
          currentCat = ex.category;
          const catLabel = currentCat.charAt(0).toUpperCase() + currentCat.slice(1);
          html += `<div class="fh-category-header">${catLabel}</div>`;
        }

        const lastSession = ex.sessions[ex.sessions.length - 1];
        const doneSets = lastSession.sets.filter(s => s.done);
        const lastPerf = ProgressView._formatSetsSummary(doneSets);
        const daysLabel = ex.daysAgo === 0 ? 'Today' : ex.daysAgo === 1 ? 'Yesterday' : `${ex.daysAgo}d ago`;
        const overdueClass = ex.daysAgo >= 7 ? ' fh-overdue' : '';

        // Build history rows (all past sessions, newest first, skip last since it's shown in header)
        const historyRows = ex.sessions.slice().reverse().map(s => {
          const d = new Date(s.date + 'T12:00:00');
          const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const perf = ProgressView._formatSetsSummary(s.sets.filter(set => set.done));
          return `<div class="fh-history-row"><span class="fh-history-date">${dateLabel}</span><span class="fh-history-perf">${perf}</span></div>`;
        }).join('');

        html += `
          <div class="card fh-exercise-card${overdueClass}" style="margin-bottom:var(--space-xs);">
            <div class="fh-exercise-header">
              <div class="fh-exercise-name">${UI.escapeHtml(ex.name)}</div>
              <div class="fh-exercise-last${overdueClass}">${daysLabel}</div>
            </div>
            <div class="fh-exercise-perf">${lastPerf}</div>
            <div class="fh-history" style="display:none;">
              <div class="fh-history-title">${ex.sessions.length} session${ex.sessions.length !== 1 ? 's' : ''}</div>
              ${historyRows}
            </div>
          </div>
        `;
      }
    }

    // Bind sort buttons inline after rendering
    return html;
  },

  // Format completed sets into a readable summary e.g. "3×8 @ 25 lbs" or "3×10"
  _formatSetsSummary(doneSets) {
    if (!doneSets.length) return '—';
    const weights = doneSets.map(s => s.weight).filter(Boolean);
    const reps = doneSets.map(s => s.reps).filter(r => r > 0);
    const setCount = doneSets.length;
    const avgReps = reps.length ? Math.round(reps.reduce((a, b) => a + b, 0) / reps.length) : null;
    const maxWeight = weights.length ? Math.max(...weights) : null;

    let summary = `${setCount}×${avgReps ?? '?'}`;
    if (maxWeight) summary += ` @ ${maxWeight} lbs`;
    return summary;
  },

  // --- Trends ---
  async renderTrends() {
    const goals = await DB.getProfile('goals') || {};
    const activePlan = goals.activePlan || 'moderate';
    const timeline = goals.timeline || {};
    const today = UI.today();

    // Show at least 14 days of history
    const minStart = (() => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - 14); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    const startDate = timeline.start && timeline.start < minStart ? timeline.start : minStart;
    const defaultEnd = (() => { const d = new Date(startDate + 'T12:00:00'); d.setDate(d.getDate() + 90); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    const endDate = activePlan === 'hardcore'
      ? (timeline.hardcore_end || defaultEnd)
      : (timeline.moderate_end || defaultEnd);

    const analyses = await DB.getAnalysisRange(startDate, today);
    const regimen = await DB.getRegimen();

    let html = '';

    // Score sparkline
    if (analyses.length > 0) {
      html += ProgressView.renderScores(analyses, startDate, today, activePlan, goals, regimen);
      html += ProgressView.renderAverages(analyses, goals);
    }

    // Calendar heatmap
    html += await ProgressView.renderCalendarHeatmap();

    // Rate of weight change (#2)
    html += await ProgressView._renderWeightChangeRate(goals);

    // Weight trend
    html += await ProgressView.renderWeightTrend();

    // Protein distribution by meal (#6)
    html += await ProgressView._renderProteinByMeal();

    // Food timing heatmap (#8)
    html += await ProgressView._renderFoodTimingHeatmap();

    // Workout consistency grid (#10)
    html += await ProgressView._renderWorkoutGrid();

    // Progress photos
    html += await ProgressView.renderProgressPhotos();

    // Streaks
    const latestAnalysis = analyses.length > 0 ? analyses[analyses.length - 1] : null;
    if (latestAnalysis?.streaks) {
      html += ProgressView.renderStreaks(latestAnalysis.streaks);
    }

    if (!html) {
      html = `<div class="card" style="text-align:center; padding:var(--space-lg); color:var(--text-muted);">
        <div style="font-size:var(--text-sm);">Log meals and workouts to see trends here.</div>
      </div>`;
    }

    return html;
  },

  async renderWeightTrend() {
    // Get weight data from daily summaries (batch lookup, 90 days)
    const today = UI.today();
    const ninetyDaysAgo = new Date(today + 'T12:00:00');
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const startDate = fmt(ninetyDaysAgo);
    const endDate = today;

    const summaries = await DB.getDailySummaryRange(startDate, endDate);
    const points = [];
    // Collect all timestamped measurements for AM/PM analysis
    const allMeasurements = [];
    for (const s of summaries) {
      // Canonical value: weight.value survives phone-side edits (weightLog[0] may still hold the original typo)
      const canonical = s.weight?.value;
      if (typeof canonical === 'number') {
        points.push({ date: s.date, weight: canonical });
      }
      // weightLog is only used for AM/PM multi-measurement analysis — not the trend point
      if (Array.isArray(s.weightLog)) {
        for (const entry of s.weightLog) {
          if (entry.timestamp && typeof entry.value === 'number') {
            allMeasurements.push(entry);
          }
        }
      }
      // If there is no weight.value but a timestamp on the weight object, include it for AM/PM
      if (!canonical && s.weight?.timestamp) allMeasurements.push(s.weight);
    }

    if (points.length < 2) return '';

    const weights = points.map(p => p.weight);
    const minW = Math.min(...weights) - 1;
    const maxW = Math.max(...weights) + 1;
    const range = maxW - minW || 1;
    const svgW = 300;
    const svgH = 80;

    let pathD = '';
    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * svgW;
      const y = svgH - ((points[i].weight - minW) / range) * svgH;
      pathD += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
    }

    // 7-day moving average
    let maPathD = '';
    const maPoints = [];
    for (let i = 0; i < points.length; i++) {
      const windowStart = Math.max(0, i - 6);
      const windowSlice = points.slice(windowStart, i + 1);
      // Only emit MA points where >=3 raw points exist in the window
      if (windowSlice.length >= 3) {
        const avg = windowSlice.reduce((sum, p) => sum + p.weight, 0) / windowSlice.length;
        const x = (i / (points.length - 1)) * svgW;
        const y = svgH - ((avg - minW) / range) * svgH;
        maPoints.push({ x, y });
      }
    }
    if (maPoints.length >= 2) {
      for (let i = 0; i < maPoints.length; i++) {
        maPathD += (i === 0 ? 'M' : 'L') + `${maPoints[i].x.toFixed(1)},${maPoints[i].y.toFixed(1)}`;
      }
    }

    const latest = points[points.length - 1];
    const first = points[0];
    const delta = (latest.weight - first.weight).toFixed(1);
    const deltaColor = delta <= 0 ? 'var(--accent-green)' : 'var(--accent-orange)';

    const pointsJson = JSON.stringify(points.map(p => ({ date: p.date, weight: p.weight })));

    let html = '<h2 class="section-header">Weight</h2><div class="card" id="weight-trend-card">';
    html += `<div style="display:flex; justify-content:space-between; margin-bottom:var(--space-xs); font-size:var(--text-sm);">
      <span style="font-weight:600;">${latest.weight} lbs</span>
      <span style="color:${deltaColor};">${delta > 0 ? '+' : ''}${delta} lbs</span>
    </div>`;
    html += `<div style="position:relative; touch-action:pan-y;">
      <svg id="weight-trend-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}" preserveAspectRatio="none"
           data-points='${pointsJson.replace(/'/g, '&apos;')}' data-minw="${minW}" data-maxw="${maxW}" data-svgw="${svgW}" data-svgh="${svgH}" style="display:block; overflow:visible;">
        <path d="${pathD}" fill="none" stroke="var(--accent-primary)" stroke-width="2"/>
        ${maPathD ? `<path d="${maPathD}" fill="none" stroke="var(--accent-blue)" stroke-width="1.5" stroke-dasharray="4,3"/>` : ''}
      </svg>
    </div>`;
    html += `<div style="display:flex; justify-content:space-between; font-size:var(--text-xs); color:var(--text-muted);">
      <span>${UI.formatDate(first.date)}</span><span>${UI.formatDate(latest.date)}</span>
    </div>`;
    if (maPathD) {
      html += `<div style="display:flex; gap:var(--space-sm); margin-top:var(--space-xs); font-size:var(--text-xs); color:var(--text-muted);">
        <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-block; width:16px; height:2px; background:var(--accent-primary);"></span>Daily</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-block; width:16px; height:0; border-top:1.5px dashed var(--accent-blue);"></span>7-day avg</span>
      </div>`;
    }
    html += '</div>';

    // Touch interaction is wired in init() after innerHTML is set

    // AM vs PM pattern — only show when there are enough timestamped measurements
    if (allMeasurements.length >= 5) {
      const amMeasurements = allMeasurements.filter(m => new Date(m.timestamp).getHours() < 12);
      const pmMeasurements = allMeasurements.filter(m => new Date(m.timestamp).getHours() >= 12);
      if (amMeasurements.length > 0 && pmMeasurements.length > 0) {
        const avg = arr => (arr.reduce((s, m) => s + m.value, 0) / arr.length).toFixed(1);
        const amAvg = avg(amMeasurements);
        const pmAvg = avg(pmMeasurements);
        html += '<h2 class="section-header" style="margin-top:var(--space-md);">Weight by Time of Day</h2>';
        html += '<div class="stats-row">';
        html += `<div class="stat-card"><div class="stat-value">${amAvg}</div><div class="stat-label">AM avg</div></div>`;
        html += `<div class="stat-card"><div class="stat-value">${pmAvg}</div><div class="stat-label">PM avg</div></div>`;
        html += '</div>';
      }
    }

    return html;
  },

  _initWeightChartTouch() {
    const svg = document.getElementById('weight-trend-svg');
    if (!svg) return;

    const points = JSON.parse(svg.dataset.points || '[]');
    if (points.length < 2) return;

    const svgW = parseFloat(svg.dataset.svgw);
    const svgH = parseFloat(svg.dataset.svgh);
    const minW = parseFloat(svg.dataset.minw);
    const maxW = parseFloat(svg.dataset.maxw);
    const range = maxW - minW || 1;

    // Create indicator elements inside the SVG
    const ns = 'http://www.w3.org/2000/svg';

    const indicator = document.createElementNS(ns, 'line');
    indicator.setAttribute('x1', '0');
    indicator.setAttribute('x2', '0');
    indicator.setAttribute('y1', '0');
    indicator.setAttribute('y2', svgH);
    indicator.setAttribute('stroke', 'var(--accent-primary)');
    indicator.setAttribute('stroke-width', '1.5');
    indicator.setAttribute('stroke-dasharray', '3,2');
    indicator.setAttribute('opacity', '0');
    indicator.setAttribute('pointer-events', 'none');
    svg.appendChild(indicator);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', 'var(--accent-primary)');
    dot.setAttribute('stroke', 'var(--bg-primary)');
    dot.setAttribute('stroke-width', '2');
    dot.setAttribute('opacity', '0');
    dot.setAttribute('pointer-events', 'none');
    svg.appendChild(dot);

    // Tooltip — rendered as a foreign element approach would be complex in SVG;
    // use a regular HTML element absolutely positioned over the chart wrapper
    const wrapper = svg.parentElement;
    wrapper.style.position = 'relative';

    const tooltip = document.createElement('div');
    tooltip.className = 'weight-chart-tooltip';
    tooltip.style.display = 'none';
    wrapper.appendChild(tooltip);

    let hideTimer = null;

    const showPoint = (touch) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;

      // Map touch X to SVG coordinate space
      const touchX = touch.clientX - rect.left;
      const svgX = (touchX / rect.width) * svgW;

      // Find nearest data point by X position
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const px = (i / (points.length - 1)) * svgW;
        const dist = Math.abs(px - svgX);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }

      const pt = points[bestIdx];
      const px = (bestIdx / (points.length - 1)) * svgW;
      const py = svgH - ((pt.weight - minW) / range) * svgH;

      // Position indicator line
      indicator.setAttribute('x1', px);
      indicator.setAttribute('x2', px);
      indicator.setAttribute('opacity', '0.7');

      // Position dot
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', py);
      dot.setAttribute('opacity', '1');

      // Tooltip content
      const dateLabel = new Date(pt.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      tooltip.textContent = `${pt.weight} lbs · ${dateLabel}`;
      tooltip.style.display = 'block';

      // Position tooltip: center on the touch X, keep within wrapper
      const tooltipW = tooltip.offsetWidth || 110;
      const wrapperW = wrapper.offsetWidth || rect.width;
      let tipLeft = touchX - tooltipW / 2;
      tipLeft = Math.max(0, Math.min(wrapperW - tooltipW, tipLeft));
      tooltip.style.left = tipLeft + 'px';

      // Place above the dot if room, else below
      const dotScreenY = (py / svgH) * rect.height;
      tooltip.style.top = dotScreenY > 28 ? (dotScreenY - 28) + 'px' : (dotScreenY + 8) + 'px';
    };

    const hideAll = (delay = 300) => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        indicator.setAttribute('opacity', '0');
        dot.setAttribute('opacity', '0');
        tooltip.style.display = 'none';
        hideTimer = null;
      }, delay);
    };

    let touchStartX = null;
    let touchStartY = null;
    let tracking = false;

    svg.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      tracking = false;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }, { passive: true });

    svg.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);

      // Only activate on primarily horizontal movement
      if (!tracking && dy > dx && dy > 6) return; // vertical scroll — stay out of the way
      if (!tracking && dx > 4) tracking = true;

      if (tracking) {
        e.preventDefault(); // prevent scroll only when we're handling it
        showPoint(e.touches[0]);
      }
    }, { passive: false });

    svg.addEventListener('touchend', () => {
      tracking = false;
      hideAll(300);
    }, { passive: true });

    svg.addEventListener('touchcancel', () => {
      tracking = false;
      hideAll(0);
    }, { passive: true });
  },

  async renderProgressPhotos() {
    // Limit to last 30 days
    const today = UI.today();
    const thirtyDaysAgo = new Date(today + 'T12:00:00');
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const startDate = fmt(thirtyDaysAgo);

    // Load entries and user's subtype config in parallel
    const [entries, rawTypes] = await Promise.all([
      DB.getEntriesByType('bodyPhoto', startDate, today),
      DB.getProfile('bodyPhotoTypes'),
    ]);

    // Determine which subtypes to display (fall back to just 'body')
    const types = rawTypes && rawTypes.length
      ? rawTypes
      : [{ key: 'body', name: 'Body' }];

    // Build map: subtype key → { date → entry } (first entry per date wins)
    const byTypeDate = {};
    for (const t of types) byTypeDate[t.key] = {};

    for (const e of (entries || [])) {
      const key = e.subtype || 'body';
      if (!byTypeDate[key]) byTypeDate[key] = {};  // handle unknown subtypes gracefully
      if (!byTypeDate[key][e.date]) byTypeDate[key][e.date] = e;
    }

    // Only render section when at least one subtype has photos
    const anyPhotos = types.some(t => Object.keys(byTypeDate[t.key] || {}).length > 0);
    if (!anyPhotos) return '';

    let html = '<h2 class="section-header">Progress Photos</h2>';
    html += '<div class="card" style="padding:var(--space-sm) var(--space-md);">';

    const scrollIds = [];

    for (const type of types) {
      const dateMap = byTypeDate[type.key] || {};
      const dates = Object.keys(dateMap).sort((a, b) => b.localeCompare(a));

      html += '<div class="progress-photos-subtype">';
      html += `<div class="progress-photos-subtype-header">`;
      html += `<div class="progress-photos-subtype-label">${UI.escapeHtml(type.name)}</div>`;
      if (dates.length >= 2) {
        html += `<button class="photo-compare-btn" data-subtype="${UI.escapeHtml(type.key)}" data-dates='${JSON.stringify(dates)}'>Compare</button>`;
      }
      html += `</div>`;

      if (dates.length === 0) {
        html += `<div class="progress-photos-empty">No ${UI.escapeHtml(type.name.toLowerCase())} photos yet</div>`;
      } else {
        const scrollId = `pp-scroll-${type.key}`;
        scrollIds.push(scrollId);
        html += `<div class="progress-photos-scroll" id="${scrollId}">`;
        for (const date of dates) {
          const entry = dateMap[date];
          const d = new Date(date + 'T12:00:00');
          const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          html += `<div class="progress-photo-card" data-entry-id="${UI.escapeHtml(entry.id)}" data-date="${date}">
            <div class="progress-photo-thumb entry-photo-locked">
              ${UI.svg.lock}
            </div>
            <div class="progress-photo-label">${label}</div>
          </div>`;
        }
        html += '</div>';
        if (dates.length >= 2) {
          html += `<button class="compare-photos-btn" data-subtype="${UI.escapeHtml(type.key)}">Compare</button>`;
        }
      }

      html += '</div>'; // .progress-photos-subtype
    }

    html += '</div>'; // .card

    // Wire tap-to-reveal and compare buttons after paint
    setTimeout(() => {
      for (const id of scrollIds) {
        const el = document.getElementById(id);
        if (el) ProgressView._wirePhotoScroll(el);
      }
      // Wire compare buttons
      document.querySelectorAll('.photo-compare-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const subtype = btn.dataset.subtype;
          const dates = JSON.parse(btn.dataset.dates);
          const subtypeEntries = {};
          for (const date of dates) {
            const card = document.querySelector(`.progress-photo-card[data-date="${date}"]`);
            if (card) subtypeEntries[date] = card.dataset.entryId;
          }
          ProgressView._openComparePicker(subtype, dates, subtypeEntries);
        });
      });
    }, 0);

    return html;
  },

  // --- Photo Comparison ---

  _openComparePicker(subtype, dates, entryMap) {
    // Bottom sheet with date selection
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay photo-compare-picker-overlay';
    overlay.setAttribute('data-compare-picker', 'true');

    const formatDate = (dateStr) => {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    let html = '<div class="photo-compare-picker">';
    html += '<div class="photo-compare-picker-title">Select two dates to compare</div>';
    html += '<div class="photo-compare-picker-dates">';
    for (const date of dates) {
      html += `<button class="photo-compare-date-btn" data-date="${date}">${formatDate(date)}</button>`;
    }
    html += '</div>';
    html += '<button class="photo-compare-picker-cancel">Cancel</button>';
    html += '</div>';
    overlay.innerHTML = html;

    const selected = [];
    overlay.querySelectorAll('.photo-compare-date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const date = btn.dataset.date;
        if (btn.classList.contains('selected')) {
          btn.classList.remove('selected');
          const idx = selected.indexOf(date);
          if (idx >= 0) selected.splice(idx, 1);
        } else {
          if (selected.length >= 2) {
            // Deselect the first one
            const first = selected.shift();
            overlay.querySelector(`.photo-compare-date-btn[data-date="${first}"]`).classList.remove('selected');
          }
          selected.push(date);
          btn.classList.add('selected');
        }
        if (selected.length === 2) {
          overlay.remove();
          // Sort chronologically — left is older, right is newer
          selected.sort();
          const entryIdA = entryMap[selected[0]];
          const entryIdB = entryMap[selected[1]];
          const fmtDate = (ds) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          ProgressView._openCompareModal(entryIdA, entryIdB, fmtDate(selected[0]), fmtDate(selected[1]));
        }
      });
    });

    overlay.querySelector('.photo-compare-picker-cancel').addEventListener('click', () => {
      overlay.remove();
    });

    // Close on backdrop tap
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  },


  // Shared tap-to-reveal wiring for a .progress-photos-scroll element
  _wirePhotoScroll(scrollEl) {
    scrollEl.querySelectorAll('.progress-photo-card').forEach(card => {
      const thumb = card.querySelector('.progress-photo-thumb');
      if (!thumb) return;
      let currentUrl = null;
      let hideTimer = null;
      const hide = () => {
        thumb.classList.remove('revealed');
        thumb.innerHTML = UI.svg.lock;
        thumb.style.backgroundImage = '';
        if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      };
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (thumb.classList.contains('revealed')) { hide(); return; }
        const entryId = card.dataset.entryId;
        DB.getPhotos(entryId).then(photos => {
          if (photos.length > 0 && photos[0].blob) {
            currentUrl = URL.createObjectURL(photos[0].blob);
            thumb.innerHTML = '';
            thumb.style.backgroundImage = `url(${currentUrl})`;
            thumb.style.backgroundSize = 'cover';
            thumb.style.backgroundPosition = 'center';
            thumb.classList.add('revealed');
            hideTimer = setTimeout(() => { if (thumb.classList.contains('revealed')) hide(); }, 5000);
          }
        });
      });
    });
  },

  // --- Shared render methods ---

  renderFitnessGoals(fitnessGoals) {
    let html = '<h2 class="section-header">Fitness Goals</h2><div class="card">';
    for (let i = 0; i < fitnessGoals.length; i++) {
      const g = fitnessGoals[i];
      const isLast = i === fitnessGoals.length - 1;
      const targetDate = new Date(g.target + 'T12:00:00');
      const now = new Date(UI.today() + 'T12:00:00');
      const daysLeft = Math.max(0, Math.round((targetDate - now) / 86400000));
      html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; ${!isLast ? 'border-bottom:1px solid var(--border-color);' : ''}">
        <div>
          <div style="font-size:var(--text-sm); font-weight:500;">${UI.escapeHtml(g.name)}</div>
          <div style="font-size:var(--text-xs); color:var(--text-muted);">${daysLeft} days left</div>
        </div>
        <span style="font-size:var(--text-xs); color:var(--accent-primary);">${UI.formatDate(g.target)}</span>
      </div>`;
    }
    html += '</div>';
    return html;
  },

  renderTimeline(startDate, endDate, today, timeline, activePlan) {
    const startMs = new Date(startDate + 'T12:00:00').getTime();
    const endMs = new Date(endDate + 'T12:00:00').getTime();
    const todayMs = new Date(today + 'T12:00:00').getTime();
    const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000));
    const elapsedDays = Math.round((todayMs - startMs) / 86400000);
    const pct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));

    let html = '<h2 class="section-header">Timeline</h2><div class="card">';
    html += `<div style="display:flex; justify-content:space-between; font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-xs);">
      <span>${UI.formatDate(startDate)}</span>
      <span style="color:var(--accent-green);">Day ${elapsedDays} of ${totalDays}</span>
      <span>${UI.formatDate(endDate)}</span>
    </div>`;
    html += `<div class="progress-bar" style="height:8px;">
      <div class="progress-fill" style="width:${pct}%; background:linear-gradient(90deg, var(--accent-primary), var(--accent-green));"></div>
    </div>`;

    if (timeline.milestones?.length) {
      html += '<div style="margin-top:var(--space-sm);">';
      for (const m of timeline.milestones) {
        const mMs = new Date(m.target + 'T12:00:00').getTime();
        const mDays = Math.max(0, Math.round((mMs - todayMs) / 86400000));
        const done = todayMs >= mMs;
        html += `<div style="display:flex; justify-content:space-between; font-size:var(--text-xs); padding:2px 0;">
          <span style="color:${done ? 'var(--accent-green)' : 'var(--text-secondary)'};">${done ? '&#10003; ' : ''}${UI.escapeHtml(m.name)}</span>
          <span style="color:var(--text-muted);">${done ? 'Done' : mDays + ' days'}</span>
        </div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  _scoreFromAnalysis(analysis, goals, regimen) {
    if (!analysis) return { moderate: null, hardcore: null };
    const _r = Goals.resolve(goals);
    const _hr = goals.hardcore ? Goals.resolve(goals.hardcore) : _r;
    const totals = analysis.totals || {};
    const cal = totals.calories || 0;
    const pro = totals.protein || 0;
    const water = analysis.goals?.water?.actual_oz || 0;
    const entries = Array.isArray(analysis.entries) ? analysis.entries : [];
    const hasWorkout = entries.some(e => e.type === 'workout');
    const hasMeals = entries.some(e => e.type === 'meal' || e.type === 'drink' || e.type === 'snack');
    const viceCount = entries.filter(e => e.type === 'custom').reduce((s, e) => s + (e.quantity || 1), 0);

    const dayName = new Date(analysis.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayPlan = regimen?.weeklySchedule?.find(d => d.day === dayName);
    const isWorkoutDay = dayPlan && dayPlan.type !== 'rest';

    const calc = (target) => {
      let score = 0;
      if (cal > 0) {
        const diff = Math.abs(cal - target.calories);
        if (diff <= 150) score += 25;
        else if (diff <= 300) score += 15;
        else if (cal > target.calories + 300) score += 0;
        else score += 10;
      }
      if (pro > 0) score += Math.round(Math.min(1, pro / target.protein) * 25);
      if (isWorkoutDay) { if (hasWorkout) score += 25; }
      else score += 25;
      if (water >= target.water) score += 10;
      else if (water >= target.water * 0.5) score += 5;
      if (hasMeals) score += 15;
      if (viceCount > 0) score -= Math.min(30, viceCount * 10);
      return Math.max(0, Math.min(100, score));
    };

    return {
      moderate: calc({ calories: _r.calories, protein: _r.protein, water: _r.water_oz }),
      hardcore: calc({ calories: _hr.calories || _r.calories, protein: _hr.protein || _r.protein, water: _hr.water_oz || _r.water_oz }),
    };
  },

  renderScores(analyses, startDate, today, activePlan, goals, regimen) {
    let html = '<h2 class="section-header">Daily Scores</h2><div class="card">';

    const dayData = [];
    const analysisMap = {};
    for (const a of analyses) analysisMap[a.date] = a;

    const cursor = new Date(startDate + 'T12:00:00');
    const todayDate = new Date(today + 'T12:00:00');
    while (cursor <= todayDate) {
      const ds = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const a = analysisMap[ds];
      const scores = ProgressView._scoreFromAnalysis(a, goals, regimen);
      dayData.push({ date: ds, moderate: scores.moderate, hardcore: scores.hardcore });
      cursor.setDate(cursor.getDate() + 1);
    }

    const barWidth = Math.max(10, Math.min(32, Math.floor(300 / dayData.length)));
    const gap = 4;
    const svgWidth = dayData.length * (barWidth + gap);
    const svgHeight = 80;

    html += '<div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">';
    html += `<svg viewBox="0 0 ${svgWidth} ${svgHeight + 20}" width="${svgWidth}" height="${svgHeight + 20}" style="display:block;">`;

    for (let i = 0; i < dayData.length; i++) {
      const d = dayData[i];
      const x = i * (barWidth + gap);
      const ms = d.moderate;
      const hs = d.hardcore;

      if (ms != null) {
        const barH = (ms / 100) * svgHeight;
        const y = svgHeight - barH;
        const color = ms >= 75 ? 'var(--accent-green)' : ms >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';
        html += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="${color}" opacity="0.85"/>`;
        if (hs != null) {
          const hcY = svgHeight - (hs / 100) * svgHeight;
          html += `<line x1="${x}" y1="${hcY}" x2="${x + barWidth}" y2="${hcY}" stroke="var(--accent-primary)" stroke-width="2" stroke-dasharray="3,2" opacity="0.7"/>`;
        }
        html += `<text x="${x + barWidth / 2}" y="${y - 3}" text-anchor="middle" fill="var(--text-primary)" font-size="9" font-family="var(--font-sans)">${ms}</text>`;
      } else {
        html += `<rect x="${x}" y="${svgHeight - 4}" width="${barWidth}" height="4" rx="2" fill="var(--border-color)" opacity="0.3"/>`;
      }

      const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
      html += `<text x="${x + barWidth / 2}" y="${svgHeight + 14}" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--font-sans)">${dayLabel}</text>`;
    }

    html += '</svg></div>';

    html += `<div style="display:flex; justify-content:center; gap:var(--space-md); margin-top:var(--space-sm); font-size:var(--text-xs); color:var(--text-muted);">
      <span>&#9632; Great</span>
      <span style="color:var(--accent-primary);">--- Crush It</span>
    </div>`;

    const scored = dayData.filter(d => d.moderate != null);
    if (scored.length > 0) {
      const avgMod = Math.round(scored.reduce((s, d) => s + d.moderate, 0) / scored.length);
      const hcScored = scored.filter(d => d.hardcore != null);
      const avgHc = hcScored.length ? Math.round(hcScored.reduce((s, d) => s + d.hardcore, 0) / hcScored.length) : 0;
      html += `<div style="display:flex; justify-content:center; gap:var(--space-lg); margin-top:var(--space-xs); font-size:var(--text-sm);">
        <span>Avg: <strong style="color:${avgMod >= 75 ? 'var(--accent-green)' : avgMod >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)'};">${avgMod}</strong></span>
        <span style="color:var(--accent-primary);">HC: <strong>${avgHc}</strong></span>
        <span style="color:var(--text-muted);">${scored.length} day${scored.length > 1 ? 's' : ''}</span>
      </div>`;
    }

    html += '</div>';
    return html;
  },

  renderAverages(analyses, goals) {
    const _ra = Goals.resolve(goals);
    const calTarget = _ra.calories;
    const proTarget = _ra.protein;
    const waterTarget = _ra.water_oz;

    const count = analyses.length || 1;
    const avgCal = Math.round(analyses.reduce((s, a) => s + (a.totals?.calories || 0), 0) / count);
    const avgPro = Math.round(analyses.reduce((s, a) => s + (a.totals?.protein || 0), 0) / count);
    const workoutDays = analyses.filter(a => (a.entries || []).some(e => e.type === 'workout')).length;
    const waterHit = analyses.filter(a => (a.goals?.water?.actual_oz || 0) >= waterTarget).length;

    let html = '<h2 class="section-header">Averages</h2><div class="stats-row">';
    html += `<div class="stat-card"><div class="stat-value" style="color:${avgCal <= calTarget ? 'var(--accent-green)' : 'var(--accent-orange)'};">${avgCal}</div><div class="stat-label">Avg Cal</div></div>`;
    html += `<div class="stat-card"><div class="stat-value" style="color:${avgPro >= proTarget ? 'var(--accent-green)' : 'var(--accent-orange)'};">${avgPro}g</div><div class="stat-label">Avg Protein</div></div>`;
    html += `<div class="stat-card"><div class="stat-value" style="color:var(--accent-primary);">${workoutDays}/${analyses.length}</div><div class="stat-label">Workouts</div></div>`;
    html += `<div class="stat-card"><div class="stat-value" style="color:var(--accent-cyan);">${waterHit}/${analyses.length}</div><div class="stat-label">Water Goal</div></div>`;
    html += '</div>';
    return html;
  },

  async renderCalendarHeatmap() {
    const today = UI.today();
    const now = new Date(today + 'T12:00:00');
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();

    let html = `<h2 class="section-header">${monthName}</h2>`;
    html += '<div class="card"><div class="cal-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>';
    html += '<div class="cal-grid">';

    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === today;
      const isSelected = dateStr === App.selectedDate;
      const cls = `cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`;
      html += `<div class="${cls}" data-date="${dateStr}"><span class="cal-day-num">${d}</span><span class="cal-day-dot" id="dot-${dateStr}"></span></div>`;
    }

    html += '</div></div>';
    setTimeout(() => ProgressView.colorCodeDays(year, month, daysInMonth), 0);
    return html;
  },

  async colorCodeDays(year, month, daysInMonth) {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const entries = await DB.getEntriesByDateRange(startDate, endDate);
    const analyses = await DB.getAnalysisRange(startDate, endDate);
    const goals = await DB.getProfile('goals') || {};
    const regimen = await DB.getRegimen();

    const entryDates = new Set();
    for (const e of entries) entryDates.add(e.date);
    const analysisMap = {};
    for (const a of analyses) analysisMap[a.date] = a;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dot = document.getElementById(`dot-${dateStr}`);
      if (!dot) continue;

      const analysis = analysisMap[dateStr];
      if (analysis) {
        const scores = ProgressView._scoreFromAnalysis(analysis, goals, regimen);
        const score = scores.moderate;
        if (score != null) {
          dot.classList.add(score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red');
        } else {
          dot.classList.add('green');
        }
      } else if (entryDates.has(dateStr)) {
        dot.classList.add('yellow');
      }
    }
  },

  renderStreaks(streaks) {
    const icons = {
      logging: UI.svg.logging, tracking: UI.svg.logging,
      waterGoal: UI.svg.water, water_goal: UI.svg.water,
      workout: UI.svg.workout,
      proteinGoal: UI.svg.target, protein_goal: UI.svg.target,
      calorie_goal: UI.svg.flame,
    };
    const labels = {
      logging: 'Logging', tracking: 'Logging',
      waterGoal: 'Water Goal', water_goal: 'Water Goal',
      workout: 'Workout',
      proteinGoal: 'Protein Goal', protein_goal: 'Protein Goal',
      calorie_goal: 'Calorie Goal',
    };

    let html = '<h2 class="section-header">Streaks</h2><div class="stats-row">';
    for (const [key, val] of Object.entries(streaks)) {
      const icon = icons[key] || UI.svg.flame;
      const label = labels[key] || key;
      html += `<div class="stat-card">
        <div style="width:28px; height:28px; margin:0 auto;">${icon}</div>
        <div class="stat-value">${val}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    }
    html += '</div>';
    return html;
  },

  // --- Skin segment ---

  // --- Photo Comparison ---

  async _showPhotoComparison(subtype) {
    // Load body photo entries for this subtype (last 90 days)
    const today = UI.today();
    const ninetyDaysAgo = new Date(today + 'T12:00:00');
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const startDate = fmt(ninetyDaysAgo);

    const entries = await DB.getEntriesByType('bodyPhoto', startDate, today);
    if (!entries || entries.length === 0) return;

    // Filter to matching subtype, group by date (first entry per date)
    const byDate = {};
    for (const e of entries) {
      const key = e.subtype || 'body';
      if (key !== subtype) continue;
      if (!byDate[e.date]) byDate[e.date] = e;
    }
    const dates = Object.keys(byDate).sort((a, b) => a.localeCompare(b)); // oldest first
    if (dates.length < 2) return;

    // Remove any existing sheet
    const existing = document.querySelector('.compare-date-sheet');
    if (existing) existing.remove();

    // Build bottom sheet with date picker
    const sheet = document.createElement('div');
    sheet.className = 'compare-date-sheet';

    let sheetHtml = '<div class="compare-date-sheet-inner">';
    sheetHtml += '<div class="compare-date-sheet-header">';
    sheetHtml += `<span class="compare-date-sheet-title">Compare ${UI.escapeHtml(subtype.charAt(0).toUpperCase() + subtype.slice(1))} Photos</span>`;
    sheetHtml += '<button class="compare-date-sheet-close" aria-label="Close">&times;</button>';
    sheetHtml += '</div>';
    sheetHtml += '<div class="compare-date-sheet-hint">Pick two dates to compare</div>';
    sheetHtml += '<div class="compare-date-grid">';

    for (const date of dates) {
      const d = new Date(date + 'T12:00:00');
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const entryId = byDate[date].id;
      sheetHtml += `<button class="compare-date-chip" data-date="${date}" data-entry-id="${entryId}">${label}</button>`;
    }

    sheetHtml += '</div>';
    sheetHtml += '<button class="compare-date-go" disabled>Compare</button>';
    sheetHtml += '</div>';

    sheet.innerHTML = sheetHtml;
    document.body.appendChild(sheet);

    // Force reflow then animate in
    sheet.offsetHeight;
    sheet.classList.add('open');

    const selected = [];
    const goBtn = sheet.querySelector('.compare-date-go');
    const chips = sheet.querySelectorAll('.compare-date-chip');

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.classList.contains('selected')) {
          chip.classList.remove('selected');
          const idx = selected.findIndex(s => s.date === chip.dataset.date);
          if (idx >= 0) selected.splice(idx, 1);
        } else {
          if (selected.length >= 2) {
            // Deselect oldest selection
            const removed = selected.shift();
            const oldChip = sheet.querySelector(`.compare-date-chip[data-date="${removed.date}"]`);
            if (oldChip) oldChip.classList.remove('selected');
          }
          selected.push({ date: chip.dataset.date, entryId: chip.dataset.entryId });
          chip.classList.add('selected');
        }
        goBtn.disabled = selected.length !== 2;
      });
    });

    const closeSheet = () => {
      sheet.classList.remove('open');
      setTimeout(() => sheet.remove(), 250);
    };

    sheet.querySelector('.compare-date-sheet-close').addEventListener('click', closeSheet);
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) closeSheet();
    });

    goBtn.addEventListener('click', () => {
      if (selected.length !== 2) return;
      // Sort so earlier date is on the left
      selected.sort((a, b) => a.date.localeCompare(b.date));
      const labelA = new Date(selected[0].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const labelB = new Date(selected[1].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      closeSheet();
      ProgressView._openCompareModal(selected[0].entryId, selected[1].entryId, labelA, labelB);
    });
  },

  async _openCompareModal(entryIdA, entryIdB, labelA, labelB) {
    // Load photos for both entries
    const [photosA, photosB] = await Promise.all([
      DB.getPhotos(entryIdA),
      DB.getPhotos(entryIdB),
    ]);

    if (!photosA.length || !photosB.length || !photosA[0].blob || !photosB[0].blob) {
      UI.toast('Could not load photos');
      return;
    }

    const urlA = URL.createObjectURL(photosA[0].blob);
    const urlB = URL.createObjectURL(photosB[0].blob);

    const modal = document.createElement('div');
    modal.className = 'photo-compare-modal';

    modal.innerHTML = `
      <div class="photo-compare-viewport">
        <img class="photo-compare-img photo-compare-right" src="${urlB}" alt="After" draggable="false">
        <img class="photo-compare-img photo-compare-left" src="${urlA}" alt="Before" draggable="false">
        <div class="photo-compare-handle">
          <div class="photo-compare-handle-line"></div>
          <div class="photo-compare-handle-grip"></div>
          <div class="photo-compare-handle-line"></div>
        </div>
      </div>
      <div class="photo-compare-labels">
        <span class="photo-compare-label-left">${UI.escapeHtml(labelA)}</span>
        <span class="photo-compare-label-right">${UI.escapeHtml(labelB)}</span>
      </div>
      <button class="photo-compare-done">Done</button>
    `;

    document.body.appendChild(modal);

    // Force reflow then show
    modal.offsetHeight;
    modal.classList.add('open');

    // Wire slider
    ProgressView._initCompareSlider(modal);

    // Done button and cleanup
    const cleanup = () => {
      modal.classList.remove('open');
      setTimeout(() => {
        modal.remove();
        URL.revokeObjectURL(urlA);
        URL.revokeObjectURL(urlB);
      }, 250);
    };

    modal.querySelector('.photo-compare-done').addEventListener('click', cleanup);
  },

  _initCompareSlider(modal) {
    const viewport = modal.querySelector('.photo-compare-viewport');
    const leftImg = modal.querySelector('.photo-compare-left');
    const handle = modal.querySelector('.photo-compare-handle');

    let sliderPct = 50; // start at center

    const updateSlider = (pct) => {
      sliderPct = Math.max(2, Math.min(98, pct));
      leftImg.style.clipPath = `inset(0 ${100 - sliderPct}% 0 0)`;
      handle.style.left = sliderPct + '%';
    };

    // Initialize at 50%
    updateSlider(50);

    const getPointerPct = (clientX) => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width === 0) return 50;
      return ((clientX - rect.left) / rect.width) * 100;
    };

    // Pointer events with capture for smooth dragging
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        updateSlider(getPointerPct(ev.clientX));
      };

      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    // Also allow tapping anywhere on the viewport to reposition
    viewport.addEventListener('pointerdown', (e) => {
      if (e.target === handle || handle.contains(e.target)) return;
      updateSlider(getPointerPct(e.clientX));
    });
  },

  // =============================================
  // DATA INSIGHTS (#1–#10)
  // =============================================

  // Helper: date string N days ago from today
  _daysAgo(n) {
    const d = new Date(UI.today() + 'T12:00:00');
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // Helper: get Monday of the week containing dateStr
  _mondayOf(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay();
    const offset = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // #1 — Weekly Deficit Running Total
  async _renderWeeklyDeficit(goals) {
    const today = UI.today();
    if (!today) return '';
    goals = goals || {};
    const monday = ProgressView._mondayOf(today);
    if (!monday || monday > today) return '';
    const analyses = await DB.getAnalysisRange(monday, today);
    if (analyses.length === 0) return '';

    const calTarget = Goals.resolve(goals).calories;
    let totalDeficit = 0;
    for (const a of analyses) {
      const actual = a.totals?.calories || 0;
      if (actual > 0) totalDeficit += (calTarget - actual);
    }

    const isDeficit = totalDeficit > 0;
    const lbsPerWeek = (totalDeficit / 3500).toFixed(1);
    const sign = isDeficit ? '-' : '+';
    const absDeficit = Math.abs(totalDeficit).toLocaleString();
    const color = isDeficit ? 'var(--accent-green)' : 'var(--accent-red)';

    let html = '<div class="card" style="text-align:center; padding:var(--space-md);">';
    html += `<div style="font-size:var(--text-xs); text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted); margin-bottom:4px;">Weekly Deficit</div>`;
    html += `<div style="font-size:28px; font-weight:700; color:${color};">${sign}${absDeficit} cal</div>`;
    html += `<div style="font-size:var(--text-xs); color:var(--text-secondary); margin-top:4px;">On pace for ${sign}${Math.abs(lbsPerWeek)} lbs/wk</div>`;
    html += '</div>';
    return html;
  },

  // #2 — Rate of Weight Change
  async _renderWeightChangeRate(goals) {
    const today = UI.today();
    if (!today) return '';
    goals = goals || {};
    const start = ProgressView._daysAgo(30);
    if (!start || start > today) return '';
    const summaries = await DB.getDailySummaryRange(start, today);
    const analyses = await DB.getAnalysisRange(start, today);

    // Gather weight points — use weight.value (canonical, survives edits) not weightLog[0]
    const weightPoints = [];
    for (const s of summaries) {
      const canonical = s.weight?.value;
      if (typeof canonical === 'number') {
        weightPoints.push({ date: s.date, weight: canonical });
      }
    }
    if (weightPoints.length < 2) return '';

    const first = weightPoints[0];
    const last = weightPoints[weightPoints.length - 1];
    const daysBetween = Math.max(1, (new Date(last.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / 86400000);
    const actualPerWeek = ((last.weight - first.weight) / daysBetween * 7).toFixed(1);

    // Expected from deficit
    const calTarget = Goals.resolve(goals).calories;
    let totalDeficit = 0;
    let daysWithData = 0;
    for (const a of analyses) {
      const actual = a.totals?.calories || 0;
      if (actual > 0) {
        totalDeficit += (calTarget - actual);
        daysWithData++;
      }
    }
    const avgDailyDeficit = daysWithData > 0 ? totalDeficit / daysWithData : 0;
    const expectedPerWeek = (-(avgDailyDeficit * 7) / 3500).toFixed(1);

    const diff = Math.abs(parseFloat(actualPerWeek) - parseFloat(expectedPerWeek));
    const matches = diff <= 0.3;
    const icon = matches
      ? '<span style="color:var(--accent-green);">&#10003;</span>'
      : '<span style="color:var(--accent-orange);">&#9888;</span>';

    let html = '<h2 class="section-header">Weight Change Rate</h2>';
    html += '<div class="card">';
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-sm); text-align:center;">
      <div>
        <div style="font-size:var(--text-lg); font-weight:600;">${actualPerWeek > 0 ? '+' : ''}${actualPerWeek}</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">lbs/wk actual</div>
      </div>
      <div>
        <div style="font-size:var(--text-lg); font-weight:600;">${expectedPerWeek > 0 ? '+' : ''}${expectedPerWeek}</div>
        <div style="font-size:var(--text-xs); color:var(--text-muted);">lbs/wk expected</div>
      </div>
    </div>`;
    html += `<div style="text-align:center; margin-top:var(--space-xs); font-size:var(--text-xs); color:var(--text-secondary);">
      ${icon} ${matches ? 'Weight tracking matches deficit' : 'Weight and deficit are diverging'}
    </div>`;
    html += '</div>';
    return html;
  },

  // #3 — Vice Impact on Score
  async _renderViceImpact(goals) {
    const today = UI.today();
    if (!today) return '';
    goals = goals || {};
    const start = ProgressView._daysAgo(30);
    if (!start || start > today) return '';
    const analyses = await DB.getAnalysisRange(start, today);
    const regimen = await DB.getRegimen();
    if (analyses.length === 0) return '';

    const viceDays = [];
    const cleanDays = [];
    for (const a of analyses) {
      const viceCount = (Array.isArray(a.entries) ? a.entries : []).filter(e => e.type === 'custom').reduce((s, e) => s + (e.quantity || 1), 0);
      const score = ProgressView._scoreFromAnalysis(a, goals, regimen).moderate;
      if (score == null) continue;
      if (viceCount > 0) {
        viceDays.push(score);
      } else {
        cleanDays.push(score);
      }
    }

    if (viceDays.length === 0) return ''; // No vices logged — don't show

    const avgVice = Math.round(viceDays.reduce((s, v) => s + v, 0) / viceDays.length);
    const avgClean = cleanDays.length > 0 ? Math.round(cleanDays.reduce((s, v) => s + v, 0) / cleanDays.length) : null;

    let html = '<h2 class="section-header">Vice Impact</h2>';
    html += '<div class="stats-row">';
    html += `<div class="stat-card">
      <div class="stat-value" style="color:var(--accent-red);">${viceDays.length}</div>
      <div class="stat-label">Vice days</div>
    </div>`;
    if (avgClean !== null) {
      html += `<div class="stat-card">
        <div class="stat-value" style="color:var(--accent-orange);">${avgVice} vs ${avgClean}</div>
        <div class="stat-label">Avg score (vice vs clean)</div>
      </div>`;
    } else {
      html += `<div class="stat-card">
        <div class="stat-value" style="color:var(--accent-orange);">${avgVice}</div>
        <div class="stat-label">Avg score (vice days)</div>
      </div>`;
    }
    html += '</div>';
    return html;
  },

  // #4 — Logging Consistency
  async _renderLoggingConsistency() {
    const today = UI.today();
    if (!today) return '';
    const weeks = [];
    for (let w = 0; w < 3; w++) {
      const weekEnd = new Date(UI.today() + 'T12:00:00');
      weekEnd.setDate(weekEnd.getDate() - w * 7);
      const monday = ProgressView._mondayOf(`${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`);
      if (!monday) return '';
      const sunday = new Date(monday + 'T12:00:00');
      sunday.setDate(sunday.getDate() + 6);
      const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
      const endStr = w === 0 ? today : sundayStr;
      const analyses = await DB.getAnalysisRange(monday, endStr);
      const daysWithMeals = new Set();
      for (const a of analyses) {
        if ((Array.isArray(a.entries) ? a.entries : []).some(e => e.type === 'meal')) {
          daysWithMeals.add(a.date);
        }
      }
      const totalDays = w === 0
        ? Math.max(1, Math.min(7, Math.floor((new Date(today + 'T12:00:00') - new Date(monday + 'T12:00:00')) / 86400000) + 1))
        : 7;
      weeks.push({ logged: daysWithMeals.size, total: totalDays });
    }

    const trend = weeks[0].logged / weeks[0].total > weeks[1].logged / weeks[1].total
      ? '&#9650;'
      : weeks[0].logged / weeks[0].total < weeks[1].logged / weeks[1].total
        ? '&#9660;'
        : '--';
    const trendColor = weeks[0].logged / weeks[0].total >= weeks[1].logged / weeks[1].total
      ? 'var(--accent-green)' : 'var(--accent-red)';

    let html = '<div class="card" style="padding:var(--space-sm) var(--space-md);">';
    html += `<div style="font-size:var(--text-xs); text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted); margin-bottom:6px;">Logging Consistency</div>`;
    html += `<div style="display:flex; justify-content:space-between; align-items:center; font-size:var(--text-sm);">`;
    html += `<span>This wk: <strong>${weeks[0].logged}/${weeks[0].total}</strong></span>`;
    html += `<span>Last wk: <strong>${weeks[1].logged}/${weeks[1].total}</strong></span>`;
    html += `<span>Prev: <strong>${weeks[2].logged}/${weeks[2].total}</strong></span>`;
    html += `<span style="color:${trendColor};">${trend}</span>`;
    html += '</div></div>';
    return html;
  },

  // #5 — Macro % Split (7-day avg)
  async _renderMacroSplit() {
    const today = UI.today();
    if (!today) return '';
    const start = ProgressView._daysAgo(7);
    if (!start || start > today) return '';
    const analyses = await DB.getAnalysisRange(start, today);
    if (analyses.length === 0) return '';

    let totalProtein = 0, totalCarbs = 0, totalFat = 0;
    let count = 0;
    for (const a of analyses) {
      const t = a.totals || {};
      if ((t.protein || 0) + (t.carbs || 0) + (t.fat || 0) === 0) continue;
      totalProtein += t.protein || 0;
      totalCarbs += t.carbs || 0;
      totalFat += t.fat || 0;
      count++;
    }
    if (count === 0) return '';

    const avgP = totalProtein / count;
    const avgC = totalCarbs / count;
    const avgF = totalFat / count;

    const calP = avgP * 4;
    const calC = avgC * 4;
    const calF = avgF * 9;
    const total = calP + calC + calF;
    if (total === 0) return '';

    const pctP = Math.round((calP / total) * 100);
    const pctC = Math.round((calC / total) * 100);
    const pctF = 100 - pctP - pctC; // Ensure they add to 100

    let html = '<h2 class="section-header">Macro Split (7-day avg)</h2><div class="card">';
    // Segmented bar
    html += `<div style="display:flex; height:24px; border-radius:var(--radius-sm); overflow:hidden; margin-bottom:var(--space-xs);">`;
    if (pctP > 0) html += `<div style="width:${pctP}%; background:var(--accent-green); display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; font-weight:600;">${pctP > 8 ? pctP + '%' : ''}</div>`;
    if (pctC > 0) html += `<div style="width:${pctC}%; background:var(--accent-blue); display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; font-weight:600;">${pctC > 8 ? pctC + '%' : ''}</div>`;
    if (pctF > 0) html += `<div style="width:${pctF}%; background:var(--accent-orange); display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; font-weight:600;">${pctF > 8 ? pctF + '%' : ''}</div>`;
    html += '</div>';
    // Legend
    html += `<div style="display:flex; justify-content:space-between; font-size:var(--text-xs); color:var(--text-muted);">`;
    html += `<span style="color:var(--accent-green);">P ${pctP}% (${Math.round(avgP)}g)</span>`;
    html += `<span style="color:var(--accent-blue);">C ${pctC}% (${Math.round(avgC)}g)</span>`;
    html += `<span style="color:var(--accent-orange);">F ${pctF}% (${Math.round(avgF)}g)</span>`;
    html += '</div></div>';
    return html;
  },

  // #6 — Protein Distribution by Meal
  async _renderProteinByMeal() {
    const today = UI.today();
    if (!today) return '';
    const start = ProgressView._daysAgo(14);
    if (!start || start > today) return '';
    const analyses = await DB.getAnalysisRange(start, today);
    if (analyses.length === 0) return '';

    const slots = { breakfast: [], lunch: [], dinner: [], snack: [] };
    for (const a of analyses) {
      for (const e of (Array.isArray(a.entries) ? a.entries : [])) {
        if (e.type !== 'meal') continue;
        const sub = (e.subtype || 'snack').toLowerCase();
        const slot = slots[sub] || slots.snack;
        const protein = e.protein || 0;
        if (protein > 0) slot.push(protein);
      }
    }

    const avgSlots = {};
    let maxAvg = 0;
    for (const [key, vals] of Object.entries(slots)) {
      if (vals.length === 0) continue;
      const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      avgSlots[key] = avg;
      if (avg > maxAvg) maxAvg = avg;
    }

    if (Object.keys(avgSlots).length === 0) return '';

    const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
    let html = '<h2 class="section-header">Protein by Meal (14d avg)</h2><div class="card">';
    for (const key of ['breakfast', 'lunch', 'dinner', 'snack']) {
      if (avgSlots[key] == null) continue;
      const pct = maxAvg > 0 ? Math.round((avgSlots[key] / maxAvg) * 100) : 0;
      html += `<div style="display:flex; align-items:center; gap:var(--space-sm); margin-bottom:6px;">
        <div style="width:60px; font-size:var(--text-xs); color:var(--text-muted);">${labels[key]}</div>
        <div style="flex:1; height:16px; background:var(--bg-tertiary); border-radius:var(--radius-sm); overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--accent-green); border-radius:var(--radius-sm);"></div>
        </div>
        <div style="width:36px; text-align:right; font-size:var(--text-xs); font-weight:600;">${avgSlots[key]}g</div>
      </div>`;
    }
    html += '</div>';
    return html;
  },

  // #7 — Best/Worst Day of Week
  async _renderBestWorstDay(goals) {
    const today = UI.today();
    if (!today) return '';
    goals = goals || {};
    const start = ProgressView._daysAgo(30);
    if (!start || start > today) return '';
    const analyses = await DB.getAnalysisRange(start, today);
    const regimen = await DB.getRegimen();
    if (analyses.length === 0) return '';

    const dayScores = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }; // 0=Mon
    for (const a of analyses) {
      const score = ProgressView._scoreFromAnalysis(a, goals, regimen).moderate;
      if (score == null) continue;
      const d = new Date(a.date + 'T12:00:00');
      const dayIdx = (d.getDay() + 6) % 7; // Mon=0
      dayScores[dayIdx].push(score);
    }

    const avgs = [];
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 0; i < 7; i++) {
      const arr = dayScores[i];
      avgs.push(arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
    }

    const validAvgs = avgs.filter(a => a !== null);
    if (validAvgs.length === 0) return '';

    const bestVal = Math.max(...validAvgs);
    const worstVal = Math.min(...validAvgs);

    let html = '<h2 class="section-header">Score by Day of Week</h2>';
    html += '<div class="card"><div style="display:flex; gap:4px; justify-content:space-between;">';
    for (let i = 0; i < 7; i++) {
      const avg = avgs[i];
      let bg, fg;
      if (avg === null) { bg = 'var(--bg-tertiary)'; fg = 'var(--text-muted)'; }
      else if (avg >= 70) { bg = 'color-mix(in srgb, var(--accent-green) 20%, var(--bg-card))'; fg = 'var(--accent-green)'; }
      else if (avg >= 40) { bg = 'color-mix(in srgb, var(--accent-orange) 20%, var(--bg-card))'; fg = 'var(--accent-orange)'; }
      else { bg = 'color-mix(in srgb, var(--accent-red) 20%, var(--bg-card))'; fg = 'var(--accent-red)'; }

      const isBest = avg === bestVal && avg !== null;
      const isWorst = avg === worstVal && avg !== null && bestVal !== worstVal;
      const border = isBest ? 'border:1.5px solid var(--accent-green);' : isWorst ? 'border:1.5px solid var(--accent-red);' : 'border:1.5px solid transparent;';

      html += `<div style="flex:1; text-align:center; padding:6px 2px; border-radius:var(--radius-sm); background:${bg}; ${border}">
        <div style="font-size:var(--text-xs); color:var(--text-muted);">${dayLabels[i]}</div>
        <div style="font-size:var(--text-sm); font-weight:600; color:${fg};">${avg !== null ? avg : '-'}</div>
      </div>`;
    }
    html += '</div></div>';
    return html;
  },

  // #8 — Food Timing Heatmap
  async _renderFoodTimingHeatmap() {
    const today = UI.today();
    if (!today) return '';
    const start = ProgressView._daysAgo(30);
    if (!start || start > today) return '';
    const analyses = await DB.getAnalysisRange(start, today);
    if (analyses.length === 0) return '';

    const blocks = {
      'Morning': { range: [6, 10], cal: 0, count: 0 },
      'Midday': { range: [10, 14], cal: 0, count: 0 },
      'Afternoon': { range: [14, 18], cal: 0, count: 0 },
      'Evening': { range: [18, 22], cal: 0, count: 0 },
      'Late': { range: [22, 6], cal: 0, count: 0 },
    };

    // Build map of analysis entries by id for calorie data
    const analysisEntryMap = {};
    for (const a of analyses) {
      for (const ae of (Array.isArray(a.entries) ? a.entries : [])) {
        if (ae.id) analysisEntryMap[ae.id] = ae;
      }
    }
    // Load raw entries for timestamps
    const rawEntries = await DB.getEntriesByDateRange(start, today);
    for (const e of (rawEntries || [])) {
      if (e.type !== 'meal' && e.type !== 'snack' && e.type !== 'drink') continue;
      if (!e.timestamp) continue;
      const hour = new Date(e.timestamp).getHours();
      const ae = analysisEntryMap[e.id];
      const cal = ae?.calories || ae?.calories_est || e.calories_est || 0;
      // Entries before 4am belong to the previous day's "Late" bucket (4am day boundary)
      if (hour < 4) {
        blocks['Late'].cal += cal;
        blocks['Late'].count++;
        continue;
      }
      for (const [, block] of Object.entries(blocks)) {
        const [lo, hi] = block.range;
        if (lo < hi) {
          if (hour >= lo && hour < hi) { block.cal += cal; block.count++; break; }
        } else {
          if (hour >= lo || hour < hi) { block.cal += cal; block.count++; break; }
        }
      }
    }

    const maxCal = Math.max(...Object.values(blocks).map(b => b.cal), 1);
    const hasData = Object.values(blocks).some(b => b.count > 0);
    if (!hasData) return '';

    const timeLabels = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late'];
    const timeSubLabels = ['6-10a', '10a-2p', '2-6p', '6-10p', '10p-6a'];

    let html = '<h2 class="section-header">Eating Times (30 days)</h2><div class="card">';
    for (let i = 0; i < timeLabels.length; i++) {
      const block = blocks[timeLabels[i]];
      const pct = Math.round((block.cal / maxCal) * 100);
      const intensity = block.cal > 0 ? Math.max(0.2, block.cal / maxCal) : 0;
      html += `<div style="display:flex; align-items:center; gap:var(--space-sm); margin-bottom:6px;">
        <div style="width:70px;">
          <div style="font-size:var(--text-xs); font-weight:500;">${timeLabels[i]}</div>
          <div style="font-size:9px; color:var(--text-muted);">${timeSubLabels[i]}</div>
        </div>
        <div style="flex:1; height:20px; background:var(--bg-tertiary); border-radius:var(--radius-sm); overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--accent-primary); opacity:${intensity.toFixed(2)}; border-radius:var(--radius-sm);"></div>
        </div>
        <div style="width:48px; text-align:right; font-size:var(--text-xs); color:var(--text-muted);">${block.cal > 0 ? Math.round(block.cal).toLocaleString() : '-'}</div>
      </div>`;
    }
    html += `<div style="font-size:var(--text-xs); color:var(--text-muted); text-align:right; margin-top:2px;">Total cal by time block</div>`;
    html += '</div>';
    return html;
  },

  // #9 — Weekend vs Weekday Split
  async _renderWeekendVsWeekday() {
    const today = UI.today();
    if (!today) return '';
    const start = ProgressView._daysAgo(30);
    if (!start || start > today) return '';
    const analyses = await DB.getAnalysisRange(start, today);
    if (analyses.length === 0) return '';

    const weekday = { cal: [], pro: [] };
    const weekend = { cal: [], pro: [] };
    for (const a of analyses) {
      const d = new Date(a.date + 'T12:00:00');
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const bucket = isWeekend ? weekend : weekday;
      const cal = a.totals?.calories || 0;
      const pro = a.totals?.protein || 0;
      if (cal > 0) bucket.cal.push(cal);
      if (pro > 0) bucket.pro.push(pro);
    }

    if (weekday.cal.length === 0 && weekend.cal.length === 0) return '';

    const avg = arr => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
    const wdCal = avg(weekday.cal);
    const weCal = avg(weekend.cal);
    const wdPro = avg(weekday.pro);
    const wePro = avg(weekend.pro);
    const calDelta = weCal - wdCal;
    const proDelta = wePro - wdPro;

    let html = '<h2 class="section-header">Weekday vs Weekend</h2><div class="card">';
    html += '<div style="display:grid; grid-template-columns:1fr auto 1fr; gap:var(--space-sm); text-align:center;">';
    // Header row
    html += '<div style="font-size:var(--text-xs); color:var(--text-muted); font-weight:600;">Weekday</div>';
    html += '<div></div>';
    html += '<div style="font-size:var(--text-xs); color:var(--text-muted); font-weight:600;">Weekend</div>';
    // Calories row
    html += `<div style="font-size:var(--text-lg); font-weight:600;">${wdCal}</div>`;
    html += `<div style="font-size:var(--text-xs); color:${calDelta > 0 ? 'var(--accent-red)' : 'var(--accent-green)'};">${calDelta > 0 ? '+' : ''}${calDelta} cal</div>`;
    html += `<div style="font-size:var(--text-lg); font-weight:600;">${weCal}</div>`;
    // Protein row
    html += `<div style="font-size:var(--text-sm); color:var(--text-secondary);">${wdPro}g P</div>`;
    html += `<div style="font-size:var(--text-xs); color:${proDelta < 0 ? 'var(--accent-red)' : 'var(--accent-green)'};">${proDelta > 0 ? '+' : ''}${proDelta}g</div>`;
    html += `<div style="font-size:var(--text-sm); color:var(--text-secondary);">${wePro}g P</div>`;
    html += '</div></div>';
    return html;
  },

  // #10 — Workout Consistency Grid
  async _renderWorkoutGrid() {
    const today = UI.today();
    if (!today) return '';
    const start = ProgressView._daysAgo(56); // 8 weeks
    if (!start || start > today) return '';
    const entries = await DB.getEntriesByDateRange(start, today);
    const regimen = await DB.getRegimen();
    const schedule = regimen?.weeklySchedule || [];

    if (!entries || entries.length === 0) return '';

    // Build set of dates with workouts
    const workoutDates = new Set();
    for (const e of entries) {
      if (e.type === 'workout') workoutDates.add(e.date);
    }

    // Build schedule lookup: day name -> type
    const scheduleMap = {};
    for (const day of schedule) {
      scheduleMap[day.day] = day.type;
    }

    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    // Build 8 weeks of data, starting from the Monday 8 weeks ago
    const todayDate = new Date(today + 'T12:00:00');
    const mondayStart = new Date(today + 'T12:00:00');
    const dayOfWeek = mondayStart.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    mondayStart.setDate(mondayStart.getDate() - mondayOffset - 49); // 7 weeks back from this week's Monday

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    let html = '<h2 class="section-header">Workout Grid (8 weeks)</h2><div class="card">';
    // Day headers
    html += '<div style="display:grid; grid-template-columns:32px repeat(7, 1fr); gap:3px; margin-bottom:4px;">';
    html += '<div></div>';
    for (const label of dayLabels) {
      html += `<div style="text-align:center; font-size:9px; color:var(--text-muted);">${label}</div>`;
    }
    html += '</div>';

    const cursor = new Date(mondayStart);
    for (let week = 0; week < 8; week++) {
      const weekLabel = week === 7 ? 'This' : week === 6 ? 'Last' : `-${7 - week}`;
      html += `<div style="display:grid; grid-template-columns:32px repeat(7, 1fr); gap:3px; margin-bottom:3px;">`;
      html += `<div style="font-size:9px; color:var(--text-muted); display:flex; align-items:center;">${weekLabel}</div>`;
      for (let d = 0; d < 7; d++) {
        const dateStr = fmt(cursor);
        const isFuture = cursor > todayDate;
        const hasWorkout = workoutDates.has(dateStr);
        const dayType = scheduleMap[dayNames[d]] || '';
        const isRestDay = dayType === 'rest' || dayType === 'active_recovery';
        const isWorkoutDay = dayType && !isRestDay;

        let bg, border;
        if (isFuture) {
          bg = 'transparent'; border = '1px solid var(--border-color)';
        } else if (hasWorkout) {
          bg = 'var(--accent-primary)'; border = '1px solid var(--accent-primary)';
        } else if (isRestDay) {
          bg = 'var(--bg-tertiary)'; border = '1px solid var(--border-color)';
        } else if (isWorkoutDay) {
          bg = 'color-mix(in srgb, var(--accent-red) 15%, var(--bg-card))'; border = '1px solid color-mix(in srgb, var(--accent-red) 30%, var(--border-color))';
        } else {
          bg = 'var(--bg-tertiary)'; border = '1px solid var(--border-color)';
        }

        html += `<div style="aspect-ratio:1; border-radius:3px; background:${bg}; border:${border};"></div>`;
        cursor.setDate(cursor.getDate() + 1);
      }
      html += '</div>';
    }

    // Legend
    html += `<div style="display:flex; gap:var(--space-sm); margin-top:var(--space-xs); font-size:var(--text-xs); color:var(--text-muted); flex-wrap:wrap;">
      <span style="display:inline-flex; align-items:center; gap:3px;"><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:var(--accent-primary);"></span>Worked out</span>
      <span style="display:inline-flex; align-items:center; gap:3px;"><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:var(--bg-tertiary);"></span>Rest day</span>
      <span style="display:inline-flex; align-items:center; gap:3px;"><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:color-mix(in srgb, var(--accent-red) 15%, var(--bg-card)); border:1px solid color-mix(in srgb, var(--accent-red) 30%, var(--border-color));"></span>Missed</span>
    </div>`;
    html += '</div>';
    return html;
  },
};
