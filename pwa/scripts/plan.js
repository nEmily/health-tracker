// plan.js — Plan tab: meals, workout, stretching, shopping list

const PlanView = {
  _view: 'today', // 'today' or 'week'

  async init() {
    const container = document.getElementById('plan-container');
    if (!container) return;

    const date = App.selectedDate;
    const analysis = await DB.getAnalysis(date) || await DB.getAnalysis(UI.yesterday(date));
    const mealPlan = await DB.getMealPlan();
    const regimen = await DB.getRegimen();

    let html = '';

    // Day type badge
    if (mealPlan?.days) {
      const todayPlan = mealPlan.days.find(d => d.date === date);
      if (todayPlan?.dayType) {
        html += `<div style="text-align:center; margin-bottom:var(--space-md);">
          <span style="font-size:var(--text-xs); color:var(--accent-primary); background:var(--accent-primary-dim); padding:4px 12px; border-radius:var(--radius-full); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">${UI.escapeHtml(todayPlan.dayType)}</span>
        </div>`;
      }
    }

    // --- Meals ---
    if (mealPlan?.days) {
      const todayPlan = mealPlan.days.find(d => d.date === date);
      if (todayPlan) {
        html += PlanView.renderMeals(todayPlan, analysis);
      } else {
        html += PlanView.renderMealPlanOverview(mealPlan);
      }
    }

    // --- Workout ---
    if (regimen) {
      html += await PlanView.renderWorkout(regimen, date);
    }

    // --- Stretching ---
    if (regimen?.flexibility) {
      html += PlanView.renderStretching(regimen.flexibility);
    }

    // --- Shopping List ---
    if (mealPlan?.shoppingList) {
      html += PlanView.renderShoppingList(mealPlan.shoppingList);
    }

    if (!html) {
      html = `<div class="card" style="text-align:center; padding:var(--space-xl) var(--space-lg);">
        <div style="margin-bottom:var(--space-md); display:flex; justify-content:center;">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;">
            <rect x="4" y="3" width="16" height="18" rx="2"/>
            <polyline points="9 11 11 13 15 9"/>
            <line x1="8" y1="17" x2="16" y2="17"/>
          </svg>
        </div>
        <p style="color:var(--text-secondary); font-weight:500; font-size:var(--text-base); margin-bottom:var(--space-xs);">Your plan is on the way</p>
        <p style="color:var(--text-muted); font-size:var(--text-sm); margin-bottom:var(--space-lg); line-height:1.6;">Once Cloud Sync is connected, your coach will build personalized meal plans and workout routines based on your goals.</p>
        <button class="btn btn-primary btn-block btn-lg" onclick="window.location.hash='profile'">Connect Cloud Sync</button>
        <p style="color:var(--text-muted); font-size:var(--text-xs); margin-top:var(--space-md);">Plans refresh every 30 minutes automatically.</p>
      </div>`;
    }

    container.innerHTML = html;

    // Bind fitness events
    Fitness.bindEvents(date, container);
  },

  renderMeals(todayPlan, analysis) {
    let html = '<h2 class="section-header">Meals</h2>';

    // Context tip based on analysis
    if (analysis?.goals) {
      const goals = analysis.goals.moderate || analysis.goals;
      const proteinStatus = goals.protein?.status;
      if (proteinStatus === 'low') {
        html += `<div class="card" style="border-left:3px solid var(--accent-orange); margin-bottom:var(--space-sm);">
          <div style="font-size:var(--text-sm); color:var(--accent-orange);">Protein is behind — prioritize high-protein options today</div>
        </div>`;
      }
    }

    if (todayPlan.meals) {
      for (const meal of todayPlan.meals) {
        // Support both old schema (meal.type, meal.calories, meal.ingredients)
        // and current processing schema (meal.time, meal.totals.calories, meal.items)
        const mealType = UI.escapeHtml(meal.type || meal.time || meal.meal || '');
        const mealName = UI.escapeHtml(meal.suggestion || meal.name || meal.description || '');
        const desc = meal.description ? UI.escapeHtml(meal.description) : '';
        const mealCal = meal.calories ?? meal.totals?.calories;
        const mealProtein = meal.protein ?? meal.totals?.protein_label ?? meal.totals?.protein ?? 0;
        const mealFiber = meal.fiber ?? meal.totals?.fiber;
        const fiberText = mealFiber ? ` · ${mealFiber}g fiber` : '';

        // Render items list (current schema: meal.items with name/volume/grams/notes)
        // Falls back to legacy meal.ingredients format
        let ingredientsHtml = UI.renderIngredientList(meal.ingredients);
        if (!ingredientsHtml && Array.isArray(meal.items) && meal.items.length > 0) {
          ingredientsHtml = '<ul style="margin:var(--space-xs) 0 0; padding-left:var(--space-md); font-size:var(--text-sm); color:var(--text-secondary);">';
          for (const item of meal.items) {
            const vol = item.volume ? ` — ${UI.escapeHtml(item.volume)}` : (item.grams ? ` — ${item.grams}g` : '');
            ingredientsHtml += `<li style="margin-bottom:2px;">${UI.escapeHtml(item.name || '')}${vol}${item.notes ? ' <span style="color:var(--text-muted);">(' + UI.escapeHtml(item.notes) + ')</span>' : ''}</li>`;
          }
          ingredientsHtml += '</ul>';
        }

        html += `
          <div class="card" style="margin-bottom:var(--space-sm);">
            <div style="font-size:var(--text-xs); color:var(--accent-green); text-transform:uppercase; font-weight:600; margin-bottom:2px;">${mealType}</div>
            <div style="font-weight:500;">${mealName}</div>
            ${ingredientsHtml}
            ${desc && desc !== mealName && !ingredientsHtml ? `<div style="font-size:var(--text-sm); color:var(--text-muted); margin-top:var(--space-xs);">${desc}</div>` : ''}
            <div style="font-size:var(--text-xs); color:var(--text-secondary); margin-top:var(--space-xs);">
              ${mealCal != null ? mealCal : '?'} cal · ${mealProtein}g protein${fiberText}${meal.prep_time ? ' · ' + meal.prep_time : ''}
            </div>
          </div>
        `;
      }

      if (todayPlan.day_totals) {
        const dt = todayPlan.day_totals;
        const fiberTotal = dt.fiber != null ? ` · ~${dt.fiber}g fiber` : '';
        html += `<div style="font-size:var(--text-xs); color:var(--text-muted); text-align:center; margin-bottom:var(--space-md);">
          Day target: ~${dt.calories} cal · ~${dt.protein}g protein${fiberTotal}
          ${todayPlan.snack_buffer ? ` · ${todayPlan.snack_buffer} cal snack buffer` : ''}
        </div>`;
      }
    }

    return html;
  },

  async renderWorkout(regimen, date) {
    let html = '<h2 class="section-header">Workout</h2>';
    html += await Fitness.render(regimen, date);
    return html;
  },

  renderStretching(flex) {
    let html = `<h2 class="section-header">Splits Stretching</h2>`;
    html += `<div class="card">`;
    html += `<div style="font-size:var(--text-xs); color:var(--accent-cyan); margin-bottom:var(--space-sm);">${UI.escapeHtml(flex.frequency || 'Daily, 15-20 min')}</div>`;

    if (flex.routine) {
      for (let i = 0; i < flex.routine.length; i++) {
        const ex = flex.routine[i];
        const isLast = i === flex.routine.length - 1;
        html += `<div style="display:flex; justify-content:space-between; align-items:baseline; padding:4px 0; ${!isLast ? 'border-bottom:1px solid var(--border-color);' : ''}">
          <div>
            <div style="font-size:var(--text-sm);">${UI.escapeHtml(ex.name)}</div>
            <div style="font-size:var(--text-xs); color:var(--text-muted);">${UI.escapeHtml(ex.target)}${ex.notes ? ' · ' + UI.escapeHtml(ex.notes) : ''}</div>
          </div>
          <span style="font-size:var(--text-xs); color:var(--text-secondary); white-space:nowrap; margin-left:var(--space-sm);">${UI.escapeHtml(ex.duration)}</span>
        </div>`;
      }
    }

    html += `</div>`;
    return html;
  },

  renderShoppingList(list) {
    let html = `<h2 class="section-header">Shopping List</h2><div class="card">`;

    const sections = [
      { key: 'proteins', label: 'Proteins' },
      { key: 'produce', label: 'Produce' },
      { key: 'pantry', label: 'Pantry' },
    ];

    for (const sec of sections) {
      const items = list[sec.key];
      if (!items?.length) continue;
      html += `<div style="font-size:var(--text-xs); color:var(--accent-green); text-transform:uppercase; font-weight:600; margin-top:var(--space-sm); margin-bottom:2px;">${sec.label}</div>`;
      for (const item of items) {
        html += `<div style="font-size:var(--text-sm); padding:2px 0;">${UI.escapeHtml(item)}</div>`;
      }
    }

    if (list.already_have?.length) {
      html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-top:var(--space-sm);">Already have: ${list.already_have.map(i => UI.escapeHtml(i)).join(', ')}</div>`;
    }

    html += `</div>`;
    return html;
  },

  renderMealPlanOverview(plan) {
    let html = '<h2 class="section-header">Meal Plan</h2>';
    if (plan.theme) {
      html += `<div style="font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-sm);">${UI.escapeHtml(plan.theme)}</div>`;
    }

    for (const day of (plan.days || [])) {
      const dayCals = day.day_totals?.calories || (day.meals ? day.meals.reduce((sum, m) => sum + (m.calories || 0), 0) : 0);
      html += `<div class="card" style="margin-bottom:var(--space-sm); cursor:pointer;" onclick="App.goToDate('${day.date}')">`;
      html += `<div style="display:flex; justify-content:space-between; align-items:baseline;">
        <span style="font-weight:500;">${UI.formatDate(day.date)}</span>
        <span style="font-size:var(--text-xs); color:var(--text-muted);">${dayCals || '?'} cal</span>
      </div>`;
      if (day.dayType) {
        html += `<div style="font-size:var(--text-xs); color:var(--accent-primary);">${UI.escapeHtml(day.dayType)}</div>`;
      }
      html += `</div>`;
    }

    return html;
  },
};
