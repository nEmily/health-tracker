// calendar.js — Calendar view with day color coding

const Calendar = {
  currentMonth: null, // Date object for first of displayed month

  init() {
    const now = new Date();
    Calendar.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    Calendar.render();
  },

  render() {
    const container = document.getElementById('calendar-container');
    if (!container) return;

    const year = Calendar.currentMonth.getFullYear();
    const month = Calendar.currentMonth.getMonth();
    const monthName = Calendar.currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Header with nav
    let html = `
      <div class="cal-header">
        <button class="btn btn-ghost" id="cal-prev">&lsaquo;</button>
        <span class="cal-month-label">${monthName}</span>
        <button class="btn btn-ghost" id="cal-next">&rsaquo;</button>
      </div>
      <div class="cal-weekdays">
        <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
      </div>
      <div class="cal-grid" id="cal-grid">
    `;

    // Fill grid
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = UI.today();

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="cal-day empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === today;
      const isSelected = dateStr === App.selectedDate;
      const classes = ['cal-day'];
      if (isToday) classes.push('today');
      if (isSelected) classes.push('selected');

      html += `<div class="${classes.join(' ')}" data-date="${dateStr}"><span class="cal-day-num">${d}</span><span class="cal-day-dot" id="dot-${dateStr}"></span></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Wire nav
    document.getElementById('cal-prev')?.addEventListener('click', () => {
      Calendar.currentMonth = new Date(year, month - 1, 1);
      Calendar.render();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      Calendar.currentMonth = new Date(year, month + 1, 1);
      Calendar.render();
    });

    // Wire day taps
    container.querySelectorAll('.cal-day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => {
        const date = el.dataset.date;
        App.selectedDate = date;
        App.updateHeaderDate();
        Calendar.render(); // Re-render to update selection
        // Switch to today/day view for that date
        if (window.location.hash === '' || window.location.hash === '#today') {
          // Hash won't change, so manually trigger the view
          App.showScreen('today');
        } else {
          window.location.hash = '';
        }
      });
    });

    // Load analysis data to color-code days
    Calendar.loadMonthData(year, month, daysInMonth);
  },

  async loadMonthData(year, month, daysInMonth) {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    // Check which days have entries
    const entries = await DB.getEntriesByDateRange(startDate, endDate);
    const analyses = await DB.getAnalysisRange(startDate, endDate);

    // Group entries by date
    const entryDates = new Set();
    for (const e of entries) entryDates.add(e.date);

    // Group analyses by date
    const analysisMap = {};
    for (const a of analyses) analysisMap[a.date] = a;

    // Color-code each day
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dot = document.getElementById(`dot-${dateStr}`);
      if (!dot) continue;

      const analysis = analysisMap[dateStr];
      const hasEntries = entryDates.has(dateStr);

      if (analysis) {
        // Has analysis — check goal adherence
        // Support both old schema (analysis.calories.intake/goal) and new (analysis.totals/goals)
        let calIntake = null, calGoal = null, proActual = null, proGoal = null;
        if (analysis.calories) {
          calIntake = analysis.calories.intake; calGoal = analysis.calories.goal;
        } else if (analysis.totals && analysis.goals?.calories) {
          calIntake = analysis.totals.calories; calGoal = analysis.goals.calories.target;
        }
        if (analysis.macros?.protein) {
          proActual = analysis.macros.protein.grams; proGoal = analysis.macros.protein.goal;
        } else if (analysis.totals && analysis.goals?.protein) {
          proActual = analysis.totals.protein; proGoal = analysis.goals.protein.target;
        }

        let goalsHit = 0;
        let goalTotal = 0;

        if (calGoal) {
          goalTotal++;
          if (Math.abs(calIntake - calGoal) <= calGoal * 0.15) goalsHit++;
        }
        if (proGoal) {
          goalTotal++;
          if (proActual >= proGoal * 0.85) goalsHit++;
        }

        if (goalTotal > 0 && goalsHit === goalTotal) {
          dot.classList.add('green');
        } else if (goalTotal > 0) {
          dot.classList.add('yellow');
        } else {
          dot.classList.add('green');
        }
      } else if (hasEntries) {
        dot.classList.add('yellow');
      }
      // No data = no dot (gray default)
    }
  },
};
