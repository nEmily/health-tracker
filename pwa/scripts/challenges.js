// challenges.js -- Challenge system: templates, enrollment, auto-checks, rendering, sharing

const ChallengeTemplates = {
  '75hard': {
    id: '75hard',
    name: '75 Hard',
    description: '75 days of discipline. Two workouts, strict diet, water, reading, progress photo — every single day. Miss one and you restart.',
    durationDays: 75,
    restartOnMiss: true,
    tasks: [
      { id: 'water_gallon', label: 'Drink 1 gallon of water', autoCheck: { source: 'water', threshold: 128 } },
      { id: 'workout_1', label: 'Workout #1 (45+ min)', autoCheck: null },
      { id: 'workout_2', label: 'Workout #2 (45+ min, outdoor)', autoCheck: null },
      { id: 'diet', label: 'Follow your diet plan', autoCheck: null },
      { id: 'no_alcohol', label: 'No alcohol', autoCheck: null },
      { id: 'read', label: 'Read 10 pages', autoCheck: null },
      { id: 'progress_photo', label: 'Take a progress photo', autoCheck: { source: 'bodyPhotos', threshold: 1 } },
    ],
  },
  '30hard': {
    id: '30hard',
    name: '30 Hard',
    description: '30 days. No restarts, no excuses. Two workouts, 10k steps, hit your diet goals, water, reading, progress photo — every single day. Miss a day? Keep going. Track everything.',
    durationDays: 30,
    restartOnMiss: false,
    tasks: [
      { id: 'workout_1', label: 'Workout #1 (45+ min)', autoCheck: { source: 'workout', threshold: 1 } },
      { id: 'workout_2', label: 'Workout #2 (45+ min)', autoCheck: { source: 'workout', threshold: 2 } },
      { id: 'steps_10k', label: '10,000 steps', autoCheck: { source: 'steps', threshold: 10000 }, optional: true },
      { id: 'diet_goals', label: 'Hit diet goals', autoCheck: { source: 'diet_goals', threshold: null } },
      { id: 'no_alcohol', label: 'No alcohol', autoCheck: null },
      { id: 'water', label: 'Drink 64+ oz water', autoCheck: { source: 'water', threshold: 64 } },
      { id: 'read', label: 'Read 10 pages', autoCheck: null },
      { id: 'progress_photo', label: 'Take a progress photo', autoCheck: { source: 'bodyPhotos', threshold: 1 } },
      { id: 'share_post', label: 'Share/post with friends', autoCheck: null, optional: true },
      { id: 'bedtime', label: 'In bed by 10pm', autoCheck: null, optional: true },
    ],
  },
  '7day_reset': {
    id: '7day_reset',
    name: '7-Day Reset',
    description: 'A short reset to build momentum. Hit your water, skip the drinks, get a workout in, and log every meal.',
    durationDays: 7,
    restartOnMiss: false,
    tasks: [
      { id: 'water', label: 'Hit water goal', autoCheck: { source: 'water', threshold: 64 } },
      { id: 'no_alcohol', label: 'No alcohol', autoCheck: null },
      { id: 'workout', label: 'Complete a workout', autoCheck: { source: 'workout', threshold: 1 } },
      { id: 'log_meals', label: 'Log all meals', autoCheck: { source: 'logging', threshold: 2 } },
    ],
  },
  '100day': {
    id: '100day',
    name: '100-Day Challenge',
    description: 'Build lasting habits over 100 days. Water, workouts, no alcohol, and hit your calorie goal daily.',
    durationDays: 100,
    restartOnMiss: false,
    tasks: [
      { id: 'water', label: 'Hit water goal', autoCheck: { source: 'water', threshold: 64 } },
      { id: 'workout', label: 'Complete a workout', autoCheck: { source: 'workout', threshold: 1 } },
      { id: 'no_alcohol', label: 'No alcohol', autoCheck: null },
      { id: 'calorie_goal', label: 'Stay under calorie goal', autoCheck: { source: 'calories', threshold: null } },
    ],
  },
};

const Challenges = {
  // --- Optional task helpers ---
  _requiredTasks(challenge) {
    return challenge.tasks.filter(t => !t.optional);
  },
  _requiredCount(challenge) {
    return challenge.tasks.filter(t => !t.optional).length;
  },

  // --- Enrollment ---
  async enroll(templateId, customOptions) {
    let template;
    if (templateId === 'custom') {
      template = {
        id: 'custom',
        name: customOptions.name || 'Custom Challenge',
        description: customOptions.description || '',
        durationDays: customOptions.durationDays || 30,
        restartOnMiss: customOptions.restartOnMiss || false,
        tasks: (customOptions.tasks || []).map((t, i) => ({
          id: 'custom_' + i,
          label: t.label || t,
          autoCheck: null,
          optional: (typeof t === 'object' && t.optional) || false,
        })),
      };
    } else {
      template = ChallengeTemplates[templateId];
      if (!template) return null;
    }

    const today = App.selectedDate;
    const startDate = today;
    const endObj = new Date(startDate + 'T12:00:00');
    endObj.setDate(endObj.getDate() + template.durationDays - 1);
    const endDate = Challenges._fmt(endObj);

    const challenge = {
      id: 'chal_' + template.id + '_' + Date.now(),
      templateId: template.id,
      name: template.name,
      description: template.description,
      durationDays: template.durationDays,
      startDate,
      endDate,
      status: 'active',
      restartOnMiss: template.restartOnMiss,
      completedDate: null,
      restartCount: 0,
      tasks: template.tasks.map(t => ({ ...t })),
    };

    await DB.saveChallenge(challenge);
    UI.toast('Challenge started: ' + challenge.name);
    return challenge;
  },

  async abandon(challengeId) {
    const challenge = await DB.getChallenge(challengeId);
    if (!challenge) return;
    challenge.status = 'abandoned';
    challenge.completedDate = App.selectedDate;
    await DB.saveChallenge(challenge);
    UI.toast('Challenge abandoned');
  },

  // --- Auto-check evaluation ---
  async evaluateAutoChecks(challenge, date) {
    const autoChecked = [];
    const [summary, entries, photos, analysis] = await Promise.all([
      DB.getDailySummary(date),
      DB.getEntriesByDate(date),
      DB.getBodyPhotos(date),
      DB.getAnalysis(date).catch(() => null),
    ]);

    // Load calorie goal if needed
    let calorieTarget = null;
    const needsCal = challenge.tasks.some(t => t.autoCheck?.source === 'calories');
    if (needsCal) {
      const goals = await DB.getProfile('goals') || {};
      calorieTarget = Goals.resolve(goals).calories;
    }

    for (const task of challenge.tasks) {
      if (!task.autoCheck) continue;
      const src = task.autoCheck.source;
      const threshold = task.autoCheck.threshold;

      let passes = false;
      if (src === 'water') {
        passes = (summary?.water_oz || 0) >= threshold;
      } else if (src === 'bodyPhotos') {
        passes = (photos || []).length >= threshold;
      } else if (src === 'workout') {
        const workouts = entries.filter(e => e.type === 'workout');
        passes = workouts.length >= threshold;
      } else if (src === 'logging') {
        const meals = entries.filter(e => e.type === 'meal');
        passes = meals.length >= threshold;
      } else if (src === 'calories') {
        const target = calorieTarget || 2000;
        const total = analysis?.totals?.calories || 0;
        // Only auto-check if we have analysis data to compare
        if (analysis && analysis.totals) {
          passes = total <= target * 1.1; // 10% tolerance
        }
      } else if (src === 'steps') {
        // Steps from health data (cloud relay sync)
        const health = await CloudRelay.getHealthData(date).catch(() => null);
        passes = health && (health.steps || 0) >= threshold;
      } else if (src === 'diet_goals') {
        // Check both calories and protein against profile goals
        if (analysis && analysis.totals) {
          const goals = await DB.getProfile('goals') || {};
          const _rc = Goals.resolve(goals);
          const calTarget = _rc.calories;
          const proteinTarget = _rc.protein;
          const calActual = analysis.totals.calories || 0;
          const proteinActual = analysis.totals.protein || 0;
          // Under calorie goal (10% tolerance) AND hit protein target (90% threshold)
          passes = calActual <= calTarget * 1.1 && proteinActual >= proteinTarget * 0.9;
        }
      }

      if (passes) autoChecked.push(task.id);
    }
    return autoChecked;
  },

  async applyAutoChecks(challenge, date) {
    const progressId = challenge.id + '_' + date;
    let progress = await DB.getChallengeProgress(challenge.id, date);
    const dayNum = Challenges.getDayNumber(challenge, date);
    if (dayNum < 1 || dayNum > challenge.durationDays) return progress;

    if (!progress) {
      progress = {
        id: progressId,
        challengeId: challenge.id,
        date,
        checked: [],
        autoChecked: [],
        manualOverrides: [],
        dayNumber: dayNum,
        allComplete: false,
      };
    }

    const autoResults = await Challenges.evaluateAutoChecks(challenge, date);
    const previousAuto = progress.autoChecked || [];

    // Remove previously auto-checked tasks that no longer pass and weren't manually overridden
    progress.checked = progress.checked.filter(taskId => {
      if (previousAuto.includes(taskId) && !autoResults.includes(taskId) && !progress.manualOverrides.includes(taskId)) {
        return false;
      }
      return true;
    });

    progress.autoChecked = autoResults;

    // Add auto-checked tasks that are not manually overridden
    for (const taskId of autoResults) {
      if (!progress.manualOverrides.includes(taskId) && !progress.checked.includes(taskId)) {
        progress.checked.push(taskId);
      }
    }

    const requiredIds = Challenges._requiredTasks(challenge).map(t => t.id);
    progress.allComplete = requiredIds.length > 0 && requiredIds.every(id => progress.checked.includes(id));
    await DB.saveChallengeProgress(progress);
    return progress;
  },

  // --- Streak calculation ---
  getStreak(progressRecords) {
    if (!progressRecords || progressRecords.length === 0) return 0;
    // Sort by date descending
    const sorted = [...progressRecords].sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    for (const rec of sorted) {
      if (rec.allComplete) streak++;
      else break;
    }
    return streak;
  },

  getDayNumber(challenge, date) {
    const start = new Date(challenge.startDate + 'T12:00:00');
    const curr = new Date(date + 'T12:00:00');
    return Math.floor((curr - start) / 86400000) + 1;
  },

  _fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // --- Check for restart / completion ---
  async checkStatus(challenge, date) {
    const dayNum = Challenges.getDayNumber(challenge, date);
    if (dayNum > challenge.durationDays) {
      // Check if last day was complete
      const lastDate = challenge.endDate;
      const lastProgress = await DB.getChallengeProgress(challenge.id, lastDate);
      if (lastProgress?.allComplete) {
        challenge.status = 'completed';
        challenge.completedDate = date;
        await DB.saveChallenge(challenge);
      }
      return;
    }

    if (!challenge.restartOnMiss || dayNum <= 1) return;

    // Check yesterday — if incomplete and restartOnMiss, restart
    const yesterday = new Date(date + 'T12:00:00');
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = Challenges._fmt(yesterday);
    if (yDate < challenge.startDate) return;

    const yProgress = await DB.getChallengeProgress(challenge.id, yDate);
    if (yProgress && !yProgress.allComplete) {
      // Restart the challenge
      challenge.startDate = date;
      const endObj = new Date(date + 'T12:00:00');
      endObj.setDate(endObj.getDate() + challenge.durationDays - 1);
      challenge.endDate = Challenges._fmt(endObj);
      challenge.restartCount++;
      await DB.saveChallenge(challenge);
      UI.toast(challenge.name + ' restarted — Day 1');
    }
  },

  // --- Rendering: Active challenges (Progress tab) ---
  async renderActive(container, date) {
    const challenges = await DB.getChallenges();
    const active = challenges.filter(c => c.status === 'active');
    const completed = challenges.filter(c => c.status === 'completed');
    const abandoned = challenges.filter(c => c.status === 'abandoned');

    let html = '';

    if (active.length === 0 && completed.length === 0 && abandoned.length === 0) {
      html += `
        <div class="challenge-empty">
          <div class="challenge-empty-icon">${UI.svg.target || UI.svg.clipboard}</div>
          <div class="challenge-empty-title">No challenges yet</div>
          <div class="challenge-empty-desc">Pick a challenge to build streaks, track daily tasks, and stay accountable.</div>
          <button class="btn btn-primary" id="chal-start-first">Start a Challenge</button>
        </div>
      `;
      return html;
    }

    // Active challenges
    for (const chal of active) {
      await Challenges.checkStatus(chal, date);
      if (chal.status !== 'active') continue; // may have changed
      const progress = await Challenges.applyAutoChecks(chal, date);
      const allProgress = await DB.getChallengeProgressRange(chal.id, chal.startDate, chal.endDate);
      const streak = Challenges.getStreak(allProgress);
      const dayNum = Challenges.getDayNumber(chal, date);

      html += Challenges._renderChallengeCard(chal, progress, streak, dayNum, allProgress, true);
    }

    html += `<button class="challenge-add-btn" id="chal-add-more">+ Start Another Challenge</button>`;

    // Completed / abandoned history
    if (completed.length > 0 || abandoned.length > 0) {
      html += '<div class="challenge-history-label">History</div>';
      for (const chal of [...completed, ...abandoned]) {
        const allProgress = await DB.getChallengeProgressRange(chal.id, chal.startDate, chal.endDate);
        const completedDays = allProgress.filter(p => p.allComplete).length;
        const pct = Math.round((completedDays / chal.durationDays) * 100);
        const statusClass = chal.status === 'completed' ? 'completed' : 'abandoned';
        html += `
          <div class="challenge-card challenge-card--${statusClass}">
            <div class="challenge-header">
              <div>
                <div class="challenge-name">${UI.escapeHtml(chal.name)}</div>
                <div class="challenge-meta">${completedDays}/${chal.durationDays} days completed</div>
              </div>
              <span class="challenge-status-badge challenge-status-badge--${statusClass}">${chal.status === 'completed' ? 'Done' : 'Quit'}</span>
            </div>
            <div class="challenge-progress-bar"><div class="challenge-progress-fill" style="width:${pct}%;${chal.status === 'abandoned' ? 'background:var(--text-muted);' : ''}"></div></div>
          </div>
        `;
      }
    }

    return html;
  },

  _renderChallengeCard(chal, progress, streak, dayNum, allProgress, showActions) {
    const pct = Math.round((dayNum / chal.durationDays) * 100);
    const checked = progress?.checked || [];
    const requiredTasks = Challenges._requiredTasks(chal);
    const requiredIds = requiredTasks.map(t => t.id);
    const checkedCount = checked.filter(id => requiredIds.includes(id)).length;
    const totalTasks = requiredTasks.length;

    // SVG ring constants
    const ringR = 17;
    const ringC = Math.round(2 * Math.PI * ringR);
    const ringOffset = Math.round(ringC * (1 - Math.min(pct, 100) / 100));

    let html = `<div class="challenge-card" data-challenge-id="${UI.escapeHtml(chal.id)}">`;

    // Header: name + ring
    html += `<div class="challenge-header">`;
    html += `<div>`;
    html += `<div class="challenge-name">${UI.escapeHtml(chal.name)}</div>`;
    html += `<div class="challenge-meta">Day ${dayNum} of ${chal.durationDays}`;
    if (chal.restartCount > 0) html += ` (restart #${chal.restartCount})`;
    html += `</div>`;
    html += `</div>`;
    html += `<div class="challenge-ring">`;
    html += `<svg viewBox="0 0 40 40"><circle class="challenge-ring-bg" cx="20" cy="20" r="${ringR}"/><circle class="challenge-ring-fill" cx="20" cy="20" r="${ringR}" stroke-dasharray="${ringC}" stroke-dashoffset="${ringOffset}"/></svg>`;
    html += `<div class="challenge-ring-label">${pct}%</div>`;
    html += `</div>`;
    html += `</div>`;

    // Progress bar with labels
    html += `<div class="challenge-progress-label">`;
    html += `<span class="challenge-progress-pct">${checkedCount}/${totalTasks} today</span>`;
    if (streak > 0) {
      html += `<span class="challenge-streak"><span class="challenge-streak-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4 0-7-3-7-7 0-3 2-5 4-7 1-1 2-2 2-4 1 2 3 3 4 5 .5-1 1-2 1-3 2 2 3 4 3 6 0 4-3 10-7 10z"/></svg></span>${streak}d streak</span>`;
    } else {
      html += `<span class="challenge-progress-day">${Math.min(pct, 100)}% complete</span>`;
    }
    html += `</div>`;
    html += `<div class="challenge-progress-bar"><div class="challenge-progress-fill" style="width:${Math.min(pct, 100)}%;"></div></div>`;

    // Task checklist
    html += `<div class="challenge-tasks">`;
    for (const task of chal.tasks) {
      const isChecked = checked.includes(task.id);
      const isAuto = progress?.autoChecked?.includes(task.id) && isChecked;
      html += `
        <label class="challenge-task${isAuto ? ' auto-checked' : ''}" data-task-id="${UI.escapeHtml(task.id)}" data-challenge-id="${UI.escapeHtml(chal.id)}">
          <button class="challenge-check${isChecked ? ' checked' : ''}" data-task-id="${UI.escapeHtml(task.id)}" data-challenge-id="${UI.escapeHtml(chal.id)}" aria-label="Toggle ${UI.escapeHtml(task.label)}">${isChecked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</button>
          <span class="challenge-task-label">${UI.escapeHtml(task.label)}</span>
          ${task.optional ? '<span class="challenge-optional-label">optional</span>' : ''}
          ${isAuto ? '<span class="challenge-auto-label">auto</span>' : ''}
        </label>
      `;
    }
    html += `</div>`;

    // Calendar
    if (allProgress && allProgress.length > 0) {
      html += Challenges.renderCalendar(allProgress, chal);
    }

    // Actions
    if (showActions) {
      html += `<div class="challenge-actions">`;
      html += `<button class="btn btn-ghost challenge-share-btn" data-challenge-id="${UI.escapeHtml(chal.id)}">Share</button>`;
      html += `<button class="btn btn-ghost challenge-link-btn" data-challenge-id="${UI.escapeHtml(chal.id)}">Copy Link</button>`;
      html += `<button class="btn btn-ghost challenge-abandon-btn" data-challenge-id="${UI.escapeHtml(chal.id)}" style="color:var(--accent-red);">Abandon</button>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  },

  // --- Day checklist widget for Today tab ---
  async renderDayChecklist(challenge, date) {
    const dayNum = Challenges.getDayNumber(challenge, date);
    if (dayNum < 1 || dayNum > challenge.durationDays) return '';

    const progress = await Challenges.applyAutoChecks(challenge, date);
    const allProgress = await DB.getChallengeProgressRange(challenge.id, challenge.startDate, challenge.endDate);
    const streak = Challenges.getStreak(allProgress);
    const checked = progress?.checked || [];
    const requiredTasks = Challenges._requiredTasks(challenge);
    const requiredIds = requiredTasks.map(t => t.id);
    const totalTasks = requiredTasks.length;
    const checkedCount = checked.filter(id => requiredIds.includes(id)).length;

    let html = `<div class="challenge-widget" data-challenge-id="${UI.escapeHtml(challenge.id)}">`;
    html += `<div class="challenge-widget-header" data-nav-challenge="${UI.escapeHtml(challenge.id)}">`;
    html += `<div class="challenge-widget-title">${UI.escapeHtml(challenge.name)}</div>`;
    html += `<div class="challenge-widget-meta">Day ${dayNum} -- ${checkedCount}/${totalTasks}${streak > 0 ? ' -- ' + streak + 'd streak' : ''}</div>`;
    html += `</div>`;
    html += `<div class="challenge-tasks">`;

    for (const task of challenge.tasks) {
      const isChecked = checked.includes(task.id);
      const isAuto = progress?.autoChecked?.includes(task.id) && isChecked;
      html += `
        <label class="challenge-task${isAuto ? ' auto-checked' : ''}" data-task-id="${UI.escapeHtml(task.id)}" data-challenge-id="${UI.escapeHtml(challenge.id)}">
          <button class="challenge-check${isChecked ? ' checked' : ''}" data-task-id="${UI.escapeHtml(task.id)}" data-challenge-id="${UI.escapeHtml(challenge.id)}" aria-label="Toggle ${UI.escapeHtml(task.label)}">${isChecked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</button>
          <span class="challenge-task-label">${UI.escapeHtml(task.label)}</span>
          ${task.optional ? '<span class="challenge-optional-label">optional</span>' : ''}
          ${isAuto ? '<span class="challenge-auto-label">auto</span>' : ''}
        </label>
      `;
    }

    html += `</div></div>`;
    return html;
  },

  // --- Calendar dot grid ---
  renderCalendar(progressRecords, challenge) {
    const byDate = {};
    for (const p of progressRecords) byDate[p.date] = p;

    const today = UI.today();
    const start = new Date(challenge.startDate + 'T12:00:00');
    const totalDays = challenge.durationDays;

    let html = '<div class="challenge-calendar">';
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = Challenges._fmt(d);
      const rec = byDate[dateStr];
      let cls = 'challenge-dot';
      if (dateStr > today) {
        cls += ' future';
      } else if (rec?.allComplete) {
        cls += ' complete';
      } else {
        cls += ' incomplete';
      }
      html += `<div class="${cls}" title="Day ${i + 1}"></div>`;
    }
    html += '</div>';
    return html;
  },

  // --- Difficulty labels for templates ---
  _templateDifficulty(t) {
    if (t.restartOnMiss && t.durationDays >= 75) return { label: 'Extreme', cls: 'extreme' };
    if (t.durationDays >= 100) return { label: 'Hard', cls: 'hard' };
    if (t.durationDays >= 30) return { label: 'Moderate', cls: 'moderate' };
    return { label: 'Beginner', cls: 'beginner' };
  },

  _templateIcon(id) {
    const icons = {
      '75hard': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4 0-7-3-7-7 0-3 2-5 4-7 1-1 2-2 2-4 1 2 3 3 4 5 .5-1 1-2 1-3 2 2 3 4 3 6 0 4-3 10-7 10z"/></svg>',
      '30hard': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
      '7day_reset': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>',
      '100day': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
      'custom': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    };
    return icons[id] || icons['custom'];
  },

  _templateAccent(id) {
    const accents = {
      '75hard': 'var(--accent-red)',
      '30hard': 'var(--accent-primary)',
      '7day_reset': 'var(--accent-blue)',
      '100day': 'var(--accent-orange)',
      'custom': 'var(--accent-purple)',
    };
    return accents[id] || 'var(--accent-primary)';
  },

  // --- Template picker ---
  renderTemplatePicker() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '85dvh';

    const templates = Object.values(ChallengeTemplates);

    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Start a Challenge</span>
        <button class="modal-close" id="chal-picker-close" aria-label="Close">&times;</button>
      </div>
      <div class="chal-picker-list">
        ${templates.map(t => {
          const diff = Challenges._templateDifficulty(t);
          const icon = Challenges._templateIcon(t.id);
          const accent = Challenges._templateAccent(t.id);
          const autoCount = t.tasks.filter(tk => tk.autoCheck).length;
          return `
          <div class="challenge-template-card chal-tpl-enhanced" data-template-id="${UI.escapeHtml(t.id)}">
            <div class="chal-tpl-icon-row">
              <div class="chal-tpl-icon" style="color:${accent}; background:color-mix(in srgb, ${accent} 12%, transparent);">${icon}</div>
              <span class="chal-tpl-difficulty chal-tpl-difficulty--${diff.cls}">${diff.label}</span>
            </div>
            <div class="challenge-template-name">${UI.escapeHtml(t.name)}</div>
            <div class="challenge-template-desc">${UI.escapeHtml(t.description)}</div>
            <div class="chal-tpl-tags">
              <span class="chal-tpl-tag">${t.durationDays} days</span>
              <span class="chal-tpl-tag">${t.tasks.length} daily tasks</span>
              ${autoCount > 0 ? `<span class="chal-tpl-tag chal-tpl-tag--auto">${autoCount} auto-tracked</span>` : ''}
              ${t.restartOnMiss ? '<span class="chal-tpl-tag chal-tpl-tag--restart">restarts on miss</span>' : ''}
            </div>
            <div class="chal-tpl-task-preview">
              ${t.tasks.slice(0, 3).map(tk => `<span class="chal-tpl-task-pill">${UI.escapeHtml(tk.label)}</span>`).join('')}
              ${t.tasks.length > 3 ? `<span class="chal-tpl-task-pill chal-tpl-task-more">+${t.tasks.length - 3} more</span>` : ''}
            </div>
          </div>
        `}).join('')}
        <div class="challenge-template-card chal-tpl-enhanced" data-template-id="custom">
          <div class="chal-tpl-icon-row">
            <div class="chal-tpl-icon" style="color:var(--accent-purple); background:color-mix(in srgb, var(--accent-purple) 12%, transparent);">${Challenges._templateIcon('custom')}</div>
          </div>
          <div class="challenge-template-name">Custom Challenge</div>
          <div class="challenge-template-desc">Design your own challenge with custom tasks, duration, and rules.</div>
          <div class="chal-tpl-tags">
            <span class="chal-tpl-tag">You choose</span>
          </div>
        </div>
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('chal-picker-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    sheet.querySelectorAll('.challenge-template-card').forEach(card => {
      card.addEventListener('click', () => {
        const tid = card.dataset.templateId;
        close();
        if (tid === 'custom') {
          Challenges.showCustomBuilder();
        } else {
          Challenges.showConfirmation(tid);
        }
      });
    });
  },

  // --- Confirmation / customization step ---
  showConfirmation(templateId, customTemplate) {
    const template = customTemplate || ChallengeTemplates[templateId];
    if (!template) return;

    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '90dvh';

    const diff = Challenges._templateDifficulty(template);
    const icon = Challenges._templateIcon(template.id);
    const accent = Challenges._templateAccent(template.id);
    const autoCount = template.tasks.filter(t => t.autoCheck).length;

    // We'll track editable tasks state
    let editableTasks = template.tasks.map((t, i) => ({ ...t, _idx: i }));

    const renderTaskList = () => {
      return editableTasks.map((t, i) => `
        <div class="chal-confirm-task" data-idx="${i}">
          <div class="chal-confirm-task-main">
            <span class="chal-confirm-task-label">${UI.escapeHtml(t.label)}</span>
            ${t.optional ? '<span class="challenge-optional-label">optional</span>' : ''}
            ${t.autoCheck ? '<span class="challenge-auto-label">auto</span>' : ''}
          </div>
          <button class="chal-confirm-task-remove" data-idx="${i}" aria-label="Remove task">&times;</button>
        </div>
      `).join('');
    };

    const renderSheet = () => {
      const startDate = App.selectedDate;
      const endObj = new Date(startDate + 'T12:00:00');
      endObj.setDate(endObj.getDate() + template.durationDays - 1);
      const endDate = UI.formatDate(Challenges._fmt(endObj));

      sheet.innerHTML = `
        <div class="modal-header">
          <button class="chal-confirm-back" id="chal-confirm-back" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="modal-title">Review</span>
          <button class="modal-close" id="chal-confirm-close" aria-label="Close">&times;</button>
        </div>

        <div class="chal-confirm-hero">
          <div class="chal-confirm-icon" style="color:${accent}; background:color-mix(in srgb, ${accent} 15%, transparent);">${icon}</div>
          <div class="chal-confirm-name">${UI.escapeHtml(template.name)}</div>
          <div class="chal-confirm-desc">${UI.escapeHtml(template.description)}</div>
        </div>

        <div class="chal-confirm-stats">
          <div class="chal-confirm-stat">
            <div class="chal-confirm-stat-value">${template.durationDays}</div>
            <div class="chal-confirm-stat-label">Days</div>
          </div>
          <div class="chal-confirm-stat">
            <div class="chal-confirm-stat-value">${editableTasks.length}</div>
            <div class="chal-confirm-stat-label">Daily Tasks</div>
          </div>
          <div class="chal-confirm-stat">
            <div class="chal-confirm-stat-value">${template.restartOnMiss ? 'Yes' : 'No'}</div>
            <div class="chal-confirm-stat-label">Restart</div>
          </div>
        </div>

        <div class="chal-confirm-date-row">
          <span>${UI.formatDate(startDate)}</span>
          <span class="chal-confirm-arrow">--&gt;</span>
          <span>${endDate}</span>
        </div>

        <div class="chal-confirm-section-label">Daily Tasks</div>
        <div class="chal-confirm-section-hint">Tap x to remove, or add your own tasks below</div>
        <div class="chal-confirm-tasks" id="chal-confirm-task-list">
          ${renderTaskList()}
        </div>

        <div class="chal-confirm-add-row">
          <input type="text" class="input-field chal-confirm-add-input" id="chal-confirm-add-input" placeholder="Add a task..." maxlength="100">
          <button class="btn btn-ghost chal-confirm-add-btn" id="chal-confirm-add-btn">Add</button>
        </div>

        ${template.restartOnMiss ? '<div class="chal-confirm-warning">Miss a day and you restart from Day 1. No exceptions.</div>' : ''}

        <button class="btn btn-primary btn-block chal-confirm-begin" id="chal-confirm-begin">Begin Challenge</button>
      `;
    };

    renderSheet();
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    const bindConfirmEvents = () => {
      document.getElementById('chal-confirm-close').addEventListener('click', close);
      document.getElementById('chal-confirm-back').addEventListener('click', () => {
        close();
        if (customTemplate) {
          Challenges.showCustomBuilder(customTemplate);
        } else {
          Challenges.renderTemplatePicker();
        }
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      // Remove task buttons
      sheet.querySelectorAll('.chal-confirm-task-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          if (editableTasks.length <= 1) {
            UI.toast('Need at least one task');
            return;
          }
          editableTasks.splice(idx, 1);
          renderSheet();
          bindConfirmEvents();
        });
      });

      // Add task
      const addInput = document.getElementById('chal-confirm-add-input');
      const addBtn = document.getElementById('chal-confirm-add-btn');
      const doAdd = () => {
        const val = addInput.value.trim();
        if (!val) return;
        editableTasks.push({ id: 'custom_' + Date.now(), label: val, autoCheck: null, optional: false });
        addInput.value = '';
        renderSheet();
        bindConfirmEvents();
      };
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

      // Begin challenge
      document.getElementById('chal-confirm-begin').addEventListener('click', async () => {
        if (editableTasks.length === 0) {
          UI.toast('Add at least one task');
          return;
        }
        const chalData = customTemplate ? {
          name: template.name,
          description: template.description || '',
          durationDays: template.durationDays,
          restartOnMiss: template.restartOnMiss,
          tasks: editableTasks.map(t => ({ label: t.label, autoCheck: t.autoCheck || null, optional: t.optional || false })),
        } : undefined;

        let challenge;
        if (customTemplate) {
          challenge = await Challenges.enroll('custom', chalData);
        } else {
          // If tasks were modified from the original, enroll as custom with template name
          const origTasks = template.tasks.map(t => t.label).join('|');
          const newTasks = editableTasks.map(t => t.label).join('|');
          if (origTasks !== newTasks) {
            challenge = await Challenges.enroll('custom', {
              name: template.name,
              description: template.description,
              durationDays: template.durationDays,
              restartOnMiss: template.restartOnMiss,
              tasks: editableTasks.map(t => ({ label: t.label, autoCheck: t.autoCheck || null, optional: t.optional || false })),
            });
          } else {
            challenge = await Challenges.enroll(templateId);
          }
        }
        close();
        Challenges.showOnboarding(challenge);
      });
    };

    bindConfirmEvents();
  },

  // --- Post-enrollment onboarding ---
  showOnboarding(challenge) {
    if (!challenge) {
      if (App.currentScreen === 'progress') ProgressView.init();
      if (App.currentScreen === 'today') App.loadDayView();
      return;
    }

    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '85dvh';

    const accent = Challenges._templateAccent(challenge.templateId);
    const icon = Challenges._templateIcon(challenge.templateId);
    const autoTasks = challenge.tasks.filter(t => t.autoCheck);
    const manualTasks = challenge.tasks.filter(t => !t.autoCheck);

    let tipsHtml = '';

    if (autoTasks.length > 0) {
      tipsHtml += `
        <div class="chal-onboard-tip">
          <div class="chal-onboard-tip-icon" style="color:var(--accent-blue);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="chal-onboard-tip-text">
            <strong>${autoTasks.length} task${autoTasks.length > 1 ? 's' : ''} auto-track</strong> based on your logged data (water, workouts, meals, photos). Just log normally and they check themselves.
          </div>
        </div>
      `;
    }

    if (manualTasks.length > 0) {
      tipsHtml += `
        <div class="chal-onboard-tip">
          <div class="chal-onboard-tip-icon" style="color:var(--accent-primary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="chal-onboard-tip-text">
            <strong>${manualTasks.length} task${manualTasks.length > 1 ? 's' : ''} need manual check-off</strong> each day. Tap the checkbox when you complete them.
          </div>
        </div>
      `;
    }

    if (challenge.restartOnMiss) {
      tipsHtml += `
        <div class="chal-onboard-tip">
          <div class="chal-onboard-tip-icon" style="color:var(--accent-red);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <div class="chal-onboard-tip-text">
            <strong>Restart on miss is ON.</strong> If you don't complete all tasks in a day, the challenge resets to Day 1. Stay sharp.
          </div>
        </div>
      `;
    } else {
      tipsHtml += `
        <div class="chal-onboard-tip">
          <div class="chal-onboard-tip-icon" style="color:var(--accent-green);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div class="chal-onboard-tip-text">
            <strong>No restarts.</strong> If you miss a day, you just keep going. Progress counts, not perfection.
          </div>
        </div>
      `;
    }

    sheet.innerHTML = `
      <div class="chal-onboard-hero" style="background:color-mix(in srgb, ${accent} 8%, transparent);">
        <div class="chal-onboard-icon" style="color:${accent}; background:color-mix(in srgb, ${accent} 15%, transparent);">${icon}</div>
        <div class="chal-onboard-heading">You're in.</div>
        <div class="chal-onboard-name">${UI.escapeHtml(challenge.name)}</div>
        <div class="chal-onboard-subtitle">${challenge.durationDays} days starting today</div>
      </div>
      <div class="chal-onboard-body">
        <div class="chal-onboard-section-label">What to expect</div>
        ${tipsHtml}
        <div class="chal-onboard-section-label" style="margin-top:var(--space-lg);">Your daily checklist appears on the Today tab and Progress tab. Complete all tasks each day to build your streak.</div>
        <button class="btn btn-primary btn-block chal-onboard-go" id="chal-onboard-go">Let's go</button>
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      if (App.currentScreen === 'progress') ProgressView.init();
      if (App.currentScreen === 'today') App.loadDayView();
    };

    document.getElementById('chal-onboard-go').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  },

  // --- Custom challenge builder ---
  showCustomBuilder(prefill) {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '90dvh';

    let tasks = prefill ? prefill.tasks.map((t, i) => ({ id: 'custom_' + i, label: typeof t === 'string' ? t : (t.label || ''), autoCheck: null, optional: (typeof t === 'object' && t.optional) || false })) : [];

    const renderTasks = () => {
      if (tasks.length === 0) {
        return '<div class="chal-builder-empty">No tasks yet. Add your first daily task below.</div>';
      }
      return tasks.map((t, i) => `
        <div class="chal-builder-task" data-idx="${i}">
          <span class="chal-builder-task-handle" aria-label="Drag to reorder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
          </span>
          <span class="chal-builder-task-label">${UI.escapeHtml(t.label)}</span>
          <div class="chal-builder-task-actions">
            ${i > 0 ? `<button class="chal-builder-task-move" data-idx="${i}" data-dir="up" aria-label="Move up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="18 15 12 9 6 15"/></svg></button>` : ''}
            ${i < tasks.length - 1 ? `<button class="chal-builder-task-move" data-idx="${i}" data-dir="down" aria-label="Move down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg></button>` : ''}
            <button class="chal-builder-task-optional${t.optional ? ' is-optional' : ''}" data-idx="${i}" aria-label="Toggle optional">${t.optional ? 'optional' : 'required'}</button>
            <button class="chal-builder-task-del" data-idx="${i}" aria-label="Remove">&times;</button>
          </div>
        </div>
      `).join('');
    };

    const render = () => {
      sheet.innerHTML = `
        <div class="modal-header">
          <button class="chal-confirm-back" id="chal-builder-back" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="modal-title">Build Your Challenge</span>
          <button class="modal-close" id="chal-builder-close" aria-label="Close">&times;</button>
        </div>
        <div class="chal-builder-body">
          <div class="chal-builder-field">
            <label class="input-label">Name</label>
            <input type="text" id="chal-builder-name" class="input-field" placeholder="e.g. 30-Day Clean Eating" maxlength="60" value="${UI.escapeHtml((prefill && prefill.name) || '')}">
          </div>
          <div class="chal-builder-row">
            <div class="chal-builder-field" style="flex:1;">
              <label class="input-label">Duration</label>
              <div class="chal-builder-duration-row">
                <input type="number" id="chal-builder-days" class="input-field" value="${(prefill && prefill.durationDays) || 30}" min="1" max="365">
                <span class="chal-builder-duration-unit">days</span>
              </div>
            </div>
            <div class="chal-builder-field" style="flex:1;">
              <label class="input-label">On miss</label>
              <select id="chal-builder-restart" class="input-field">
                <option value="no"${prefill && prefill.restartOnMiss ? '' : ' selected'}>Continue</option>
                <option value="yes"${prefill && prefill.restartOnMiss ? ' selected' : ''}>Restart Day 1</option>
              </select>
            </div>
          </div>

          <div class="chal-builder-section-label">Daily Tasks (${tasks.length})</div>
          <div class="chal-builder-task-list" id="chal-builder-task-list">
            ${renderTasks()}
          </div>

          <div class="chal-builder-add-row">
            <input type="text" class="input-field chal-builder-add-input" id="chal-builder-add-input" placeholder="Add a task..." maxlength="100">
            <button class="btn btn-ghost chal-builder-add-btn" id="chal-builder-add-btn">Add</button>
          </div>

          <button class="btn btn-primary btn-block" id="chal-builder-next" style="margin-top:var(--space-lg);">Review Challenge</button>
        </div>
      `;
    };

    render();
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    const bindBuilderEvents = () => {
      document.getElementById('chal-builder-close').addEventListener('click', close);
      document.getElementById('chal-builder-back').addEventListener('click', () => {
        close();
        Challenges.renderTemplatePicker();
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      // Add task
      const addInput = document.getElementById('chal-builder-add-input');
      const addBtn = document.getElementById('chal-builder-add-btn');
      const doAdd = () => {
        const val = addInput.value.trim();
        if (!val) return;
        tasks.push({ id: 'custom_' + Date.now(), label: val, autoCheck: null, optional: false });
        render();
        bindBuilderEvents();
        // Focus the add input again
        document.getElementById('chal-builder-add-input').focus();
      };
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

      // Delete task
      sheet.querySelectorAll('.chal-builder-task-del').forEach(btn => {
        btn.addEventListener('click', () => {
          tasks.splice(parseInt(btn.dataset.idx), 1);
          render();
          bindBuilderEvents();
        });
      });

      // Toggle optional
      sheet.querySelectorAll('.chal-builder-task-optional').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          tasks[idx].optional = !tasks[idx].optional;
          render();
          bindBuilderEvents();
        });
      });

      // Move task
      sheet.querySelectorAll('.chal-builder-task-move').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          const dir = btn.dataset.dir;
          const target = dir === 'up' ? idx - 1 : idx + 1;
          if (target < 0 || target >= tasks.length) return;
          [tasks[idx], tasks[target]] = [tasks[target], tasks[idx]];
          render();
          bindBuilderEvents();
        });
      });

      // Next -> confirmation
      document.getElementById('chal-builder-next').addEventListener('click', () => {
        const name = document.getElementById('chal-builder-name').value.trim();
        const days = parseInt(document.getElementById('chal-builder-days').value) || 30;
        const restart = document.getElementById('chal-builder-restart').value === 'yes';

        if (!name) { UI.toast('Enter a challenge name'); return; }
        if (tasks.length === 0) { UI.toast('Add at least one task'); return; }

        close();
        Challenges.showConfirmation('custom', {
          id: 'custom',
          name,
          description: '',
          durationDays: days,
          restartOnMiss: restart,
          tasks: tasks.map(t => ({ ...t })),
        });
      });
    };

    bindBuilderEvents();
  },

  // --- Event binding ---
  bindEvents(container) {
    // Checkbox toggles
    container.querySelectorAll('.challenge-check').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const chalId = btn.dataset.challengeId;
        const date = App.selectedDate;
        const challenge = await DB.getChallenge(chalId);
        if (!challenge) return;

        let progress = await DB.getChallengeProgress(chalId, date);
        const dayNum = Challenges.getDayNumber(challenge, date);
        if (!progress) {
          progress = {
            id: chalId + '_' + date,
            challengeId: chalId,
            date,
            checked: [],
            autoChecked: [],
            manualOverrides: [],
            dayNumber: dayNum,
            allComplete: false,
          };
        }

        const idx = progress.checked.indexOf(taskId);
        if (idx >= 0) {
          // Unchecking
          progress.checked.splice(idx, 1);
          // If this was auto-checked, mark as manual override
          if (progress.autoChecked.includes(taskId)) {
            if (!progress.manualOverrides.includes(taskId)) {
              progress.manualOverrides.push(taskId);
            }
          }
        } else {
          // Checking
          progress.checked.push(taskId);
          // Remove from manual overrides if re-checking
          const ovIdx = progress.manualOverrides.indexOf(taskId);
          if (ovIdx >= 0) progress.manualOverrides.splice(ovIdx, 1);
        }

        const reqIds = Challenges._requiredTasks(challenge).map(t => t.id);
        progress.allComplete = reqIds.length > 0 && reqIds.every(id => progress.checked.includes(id));
        await DB.saveChallengeProgress(progress);

        // Queue sync
        if (typeof CloudRelay !== 'undefined') CloudRelay.queueUpload(date);

        // Re-render
        if (App.currentScreen === 'progress') ProgressView.init();
        else if (App.currentScreen === 'today') App.loadDayView();
      });
    });

    // Abandon buttons
    container.querySelectorAll('.challenge-abandon-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chalId = btn.dataset.challengeId;
        if (!confirm('Abandon this challenge? This cannot be undone.')) return;
        await Challenges.abandon(chalId);
        if (App.currentScreen === 'progress') ProgressView.init();
        else if (App.currentScreen === 'today') App.loadDayView();
      });
    });

    // Start challenge buttons
    const startFirst = container.querySelector('#chal-start-first');
    if (startFirst) startFirst.addEventListener('click', () => Challenges.renderTemplatePicker());
    const addMore = container.querySelector('#chal-add-more');
    if (addMore) addMore.addEventListener('click', () => Challenges.renderTemplatePicker());

    // Share buttons
    container.querySelectorAll('.challenge-share-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chalId = btn.dataset.challengeId;
        const challenge = await DB.getChallenge(chalId);
        if (!challenge) return;
        const allProgress = await DB.getChallengeProgressRange(challenge.id, challenge.startDate, challenge.endDate);
        await Challenges.shareMenu(challenge, allProgress);
      });
    });

    // Copy link buttons
    container.querySelectorAll('.challenge-link-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chalId = btn.dataset.challengeId;
        const challenge = await DB.getChallenge(chalId);
        if (!challenge) return;
        const url = Challenges.exportTemplate(challenge);
        try {
          await navigator.clipboard.writeText(url);
          UI.toast('Link copied');
        } catch (_) {
          UI.toast('Could not copy link');
        }
      });
    });

    // Today widget header taps -> navigate to Progress challenges
    container.querySelectorAll('[data-nav-challenge]').forEach(el => {
      el.addEventListener('click', () => {
        ProgressView._tab = 'challenges';
        App.showScreen('progress');
      });
    });
  },

  // --- Sharing: URL fragment ---
  exportTemplate(challenge) {
    const payload = {
      name: challenge.name,
      duration: challenge.durationDays,
      restart: challenge.restartOnMiss,
      tasks: challenge.tasks.map(t => ({
        label: t.label,
        auto: t.autoCheck || null,
        optional: t.optional || false,
      })),
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const base = location.origin + location.pathname;
    return base + '#challenge=' + b64;
  },

  importFromURL() {
    const hash = location.hash;
    if (!hash.startsWith('#challenge=')) return;

    try {
      const b64 = hash.slice('#challenge='.length);
      const json = decodeURIComponent(escape(atob(b64)));
      const payload = JSON.parse(json);

      // Show import modal
      const overlay = UI.createElement('div', 'modal-overlay');
      const sheet = UI.createElement('div', 'modal-sheet');
      sheet.innerHTML = `
        <div class="modal-header">
          <span class="modal-title">Import Challenge</span>
          <button class="modal-close" id="chal-import-close" aria-label="Close">&times;</button>
        </div>
        <div style="padding:var(--space-md);">
          <div class="challenge-template-card" style="pointer-events:none;">
            <div class="challenge-template-name">${UI.escapeHtml(payload.name)}</div>
            <div class="challenge-template-meta">${UI.escapeHtml(String(payload.duration))} days -- ${UI.escapeHtml(String(payload.tasks.length))} tasks${payload.restart ? ' -- restarts on miss' : ''}</div>
          </div>
          <div style="display:flex; gap:var(--space-sm); margin-top:var(--space-md);">
            <button class="btn btn-primary" id="chal-import-start" style="flex:1;">Start Challenge</button>
            <button class="btn btn-ghost" id="chal-import-cancel" style="flex:1;">Cancel</button>
          </div>
        </div>
      `;

      overlay.appendChild(sheet);
      document.body.appendChild(overlay);

      const close = () => {
        overlay.remove();
        history.replaceState(null, '', location.pathname);
      };

      document.getElementById('chal-import-close').addEventListener('click', close);
      document.getElementById('chal-import-cancel').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      document.getElementById('chal-import-start').addEventListener('click', async () => {
        await Challenges.enroll('custom', {
          name: payload.name,
          durationDays: payload.duration,
          restartOnMiss: payload.restart,
          tasks: payload.tasks.map(t => ({
            label: t.label,
            autoCheck: null,
            optional: t.optional || false,
          })),
        });
        close();
        if (App.currentScreen === 'progress') ProgressView.init();
        if (App.currentScreen === 'today') App.loadDayView();
      });
    } catch (e) {
      console.warn('Failed to import challenge from URL:', e);
    }
  },

  // --- Share menu ---
  async shareMenu(challenge, progressRecords) {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Share</span>
        <button class="modal-close" id="share-menu-close" aria-label="Close">&times;</button>
      </div>
      <div class="more-sheet-options">
        <button class="more-sheet-option" id="share-today-btn">
          <span class="more-sheet-icon" style="color:var(--accent-primary);">${UI.svg.bodyPhoto || UI.svg.clipboard}</span>
          <div class="more-sheet-text">
            <span class="more-sheet-label">Share Today</span>
            <span class="more-sheet-desc">Share today's task checklist</span>
          </div>
        </button>
        <button class="more-sheet-option" id="share-progress-btn">
          <span class="more-sheet-icon" style="color:var(--accent-primary);">${UI.svg.clipboard || ''}</span>
          <div class="more-sheet-text">
            <span class="more-sheet-label">Share Progress</span>
            <span class="more-sheet-desc">Share 30-day overview</span>
          </div>
        </button>
        <button class="more-sheet-option" id="share-text-btn">
          <span class="more-sheet-icon" style="color:var(--accent-primary);">${UI.svg.clipboard || ''}</span>
          <div class="more-sheet-text">
            <span class="more-sheet-label">Copy as Text</span>
            <span class="more-sheet-desc">Copy progress text to clipboard</span>
          </div>
        </button>
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('share-menu-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('share-today-btn').addEventListener('click', async () => {
      close();
      await Challenges.generateDayCard(challenge, progressRecords);
    });

    document.getElementById('share-progress-btn').addEventListener('click', async () => {
      close();
      await Challenges.generateProgressCard(challenge, progressRecords);
    });

    document.getElementById('share-text-btn').addEventListener('click', async () => {
      close();
      const text = Challenges.generateShareText(challenge, progressRecords);
      try {
        await navigator.clipboard.writeText(text);
        UI.toast('Copied to clipboard');
      } catch (_) {
        UI.toast('Could not copy text');
      }
    });
  },

  // --- Canvas share cards ---
  _roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  },

  _shareOrDownload(blob, filename, challenge, progressRecords) {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        files: [file],
        title: challenge.name,
        text: Challenges.generateShareText(challenge, progressRecords),
      }).catch(() => {
        Challenges._downloadBlob(blob, filename);
      });
    } else {
      Challenges._downloadBlob(blob, filename);
    }
  },

  async generateDayCard(challenge, progressRecords) {
    const W = 600;
    const H = 460;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const today = App.selectedDate;
    const dayNum = Challenges.getDayNumber(challenge, today);
    const todayProgress = progressRecords.find(p => p.date === today);
    const checked = todayProgress?.checked || [];
    const requiredIds = Challenges._requiredTasks(challenge).map(t => t.id);
    const totalTasks = requiredIds.length;
    const checkedCount = checked.filter(id => requiredIds.includes(id)).length;
    const allDone = checkedCount === totalTasks;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1f2e');
    bg.addColorStop(1, '#151926');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Teal accent stripe
    ctx.fillStyle = '#2dd4bf';
    ctx.fillRect(0, 0, W, 3);

    // Challenge name label
    ctx.fillStyle = '#2dd4bf';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(challenge.name.toUpperCase(), 30, 32);

    // Day number
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Day ' + dayNum, 30, 70);

    // Completion ring top-right
    const ringCx = W - 55;
    const ringCy = 52;
    const ringR = 24;
    // Background ring
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = '#2a3040';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Progress arc
    const ringPct = totalTasks > 0 ? checkedCount / totalTasks : 0;
    if (ringPct > 0) {
      ctx.beginPath();
      ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ringPct);
      ctx.strokeStyle = allDone ? '#22c55e' : '#2dd4bf';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // Ring center text
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(checkedCount + '/' + totalTasks, ringCx, ringCy);

    // Divider
    ctx.beginPath();
    ctx.moveTo(30, 90);
    ctx.lineTo(W - 30, 90);
    ctx.strokeStyle = '#2a3040';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Task list
    const taskStartY = 118;
    const rowH = 32;
    const maxVisible = Math.floor((H - 48 - taskStartY) / rowH);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    for (let i = 0; i < Math.min(challenge.tasks.length, maxVisible); i++) {
      const task = challenge.tasks[i];
      const y = taskStartY + i * rowH;
      const isChecked = checked.includes(task.id);
      const cbX = 36;
      const cbY = y + 4;
      const cbSize = 20;
      const cbR = 4;

      if (isChecked) {
        // Green filled checkbox
        ctx.fillStyle = '#22c55e';
        Challenges._roundedRect(ctx, cbX, cbY, cbSize, cbSize, cbR);
        ctx.fill();
        // White checkmark
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cbX + 5, cbY + 10);
        ctx.lineTo(cbX + 9, cbY + 14);
        ctx.lineTo(cbX + 15, cbY + 6);
        ctx.stroke();
        // Muted label with strikethrough
        ctx.fillStyle = '#94a3b8';
        ctx.font = '15px -apple-system, BlinkMacSystemFont, sans-serif';
        const labelX = cbX + cbSize + 14;
        const labelY = y + 18;
        ctx.fillText(task.label, labelX, labelY);
        if (task.optional) {
          const tw = ctx.measureText(task.label).width;
          ctx.fillStyle = '#64748b';
          ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.fillText(' (optional)', labelX + tw, labelY);
          ctx.font = '15px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.fillStyle = '#94a3b8';
        }
        // Strikethrough line
        const textW = ctx.measureText(task.label).width;
        ctx.beginPath();
        ctx.moveTo(labelX, labelY - 5);
        ctx.lineTo(labelX + textW, labelY - 5);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Outlined checkbox
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        Challenges._roundedRect(ctx, cbX, cbY, cbSize, cbSize, cbR);
        ctx.stroke();
        // White label
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '15px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(task.label, cbX + cbSize + 14, y + 18);
        if (task.optional) {
          const tw = ctx.measureText(task.label).width;
          ctx.fillStyle = '#64748b';
          ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.fillText(' (optional)', cbX + cbSize + 14 + tw, y + 18);
        }
      }
    }

    // "+N more" overflow label
    if (challenge.tasks.length > maxVisible) {
      const overflow = challenge.tasks.length - maxVisible;
      const overflowY = taskStartY + maxVisible * rowH + 16;
      ctx.fillStyle = '#64748b';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`+${overflow} more`, 36, overflowY);
    }

    // Footer bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, H - 48, W, 48);
    ctx.fillStyle = '#475569';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Coach', 30, H - 26);
    // Date right-aligned
    const dateObj = new Date(today + 'T12:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = months[dateObj.getMonth()] + ' ' + dateObj.getDate() + ', ' + dateObj.getFullYear();
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, W - 30, H - 26);

    // Export
    canvas.toBlob((blob) => {
      if (!blob) return;
      Challenges._shareOrDownload(blob, 'challenge-day.png', challenge, progressRecords);
    }, 'image/png');
  },

  async generateProgressCard(challenge, progressRecords) {
    const W = 600;
    const H = 420;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const today = App.selectedDate;
    const dayNum = Challenges.getDayNumber(challenge, today);
    const totalTasks = Challenges._requiredCount(challenge);

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1f2e');
    bg.addColorStop(1, '#151926');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Teal accent stripe
    ctx.fillStyle = '#2dd4bf';
    ctx.fillRect(0, 0, W, 3);

    // Title
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(challenge.name.toUpperCase(), 30, 45);

    // Day counter
    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Day ' + dayNum + ' of ' + challenge.durationDays, 30, 75);

    // Build byDate lookup
    const byDate = {};
    for (const p of progressRecords) byDate[p.date] = p;

    // Grid
    const cellSize = 16;
    const cellGap = 4;
    const cols = 10;
    const gridX = 30;
    const gridY = 100;
    let bestDays = 0;
    let totalChecked = 0;
    let totalPossible = 0;

    for (let d = 1; d <= challenge.durationDays; d++) {
      const col = (d - 1) % cols;
      const row = Math.floor((d - 1) / cols);
      const x = gridX + col * (cellSize + cellGap);
      const y = gridY + row * (cellSize + cellGap);

      let color;
      if (d > dayNum) {
        // Future
        color = '#1e2538';
      } else {
        // Past or today — find date for this day number
        const dayDate = new Date(challenge.startDate + 'T12:00:00');
        dayDate.setDate(dayDate.getDate() + d - 1);
        const dateStr = Challenges._fmt(dayDate);
        const prog = byDate[dateStr];
        const reqIds = Challenges._requiredTasks(challenge).map(t => t.id);
        const checkedCount = prog?.checked ? prog.checked.filter(id => reqIds.includes(id)).length : 0;
        totalPossible += totalTasks;
        totalChecked += checkedCount;

        if (checkedCount === totalTasks && totalTasks > 0) {
          // All tasks — perfect
          color = '#22c55e';
          bestDays++;
        } else if (checkedCount >= Math.ceil(totalTasks * 0.5)) {
          // 50%+
          color = '#2dd4bf';
          if (checkedCount >= Math.ceil(totalTasks * 0.75)) {
            bestDays++;
          }
        } else if (checkedCount > 0) {
          // Some
          color = '#eab308';
        } else {
          // Missed
          color = '#ef4444';
        }
      }

      ctx.fillStyle = color;
      Challenges._roundedRect(ctx, x, y, cellSize, cellSize, 3);
      ctx.fill();
    }

    // Legend row below grid
    const totalRows = Math.ceil(challenge.durationDays / cols);
    const legendY = gridY + totalRows * (cellSize + cellGap) + 12;
    const legendItems = [
      { color: '#22c55e', label: 'Perfect' },
      { color: '#2dd4bf', label: '50%+' },
      { color: '#eab308', label: 'Some' },
      { color: '#ef4444', label: 'Missed' },
      { color: '#1e2538', label: 'Future' },
    ];
    let legendX = gridX;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    for (const item of legendItems) {
      ctx.fillStyle = item.color;
      Challenges._roundedRect(ctx, legendX, legendY, 10, 10, 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, legendX + 14, legendY + 5);
      legendX += 14 + ctx.measureText(item.label).width + 16;
    }

    // Stats section
    const statsY = legendY + 30;
    const boxW = 160;
    const boxH = 70;
    const boxGap = 20;
    const completionPct = totalPossible > 0 ? Math.round((totalChecked / totalPossible) * 100) : 0;

    const stats = [
      { value: completionPct + '%', label: 'Completion', color: '#e2e8f0' },
      { value: String(bestDays), label: 'Best Days', color: '#22c55e' },
      { value: String(dayNum), label: 'Days In', color: '#2dd4bf' },
    ];

    for (let i = 0; i < stats.length; i++) {
      const bx = 30 + i * (boxW + boxGap);
      const by = statsY;
      ctx.fillStyle = '#1e2538';
      Challenges._roundedRect(ctx, bx, by, boxW, boxH, 8);
      ctx.fill();
      // Value
      ctx.fillStyle = stats[i].color;
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stats[i].value, bx + boxW / 2, by + 28);
      // Label
      ctx.fillStyle = '#64748b';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(stats[i].label, bx + boxW / 2, by + 54);
    }

    // Footer bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, H - 48, W, 48);
    ctx.fillStyle = '#475569';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Coach', 30, H - 26);
    ctx.textAlign = 'right';
    ctx.fillText(challenge.name + ' Challenge', W - 30, H - 26);

    // Export
    canvas.toBlob((blob) => {
      if (!blob) return;
      Challenges._shareOrDownload(blob, 'challenge-progress.png', challenge, progressRecords);
    }, 'image/png');
  },

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast('Image downloaded');
  },

  // --- Text share ---
  generateShareText(challenge, progressRecords) {
    const dayNum = Challenges.getDayNumber(challenge, App.selectedDate);
    const streak = Challenges.getStreak(progressRecords);
    const today = App.selectedDate;
    const todayProgress = progressRecords.find(p => p.date === today);
    const checked = todayProgress?.checked || [];

    let lines = [];
    lines.push('Day ' + dayNum + '/' + challenge.durationDays + ' of ' + challenge.name);
    if (streak > 0) lines.push(streak + '-day streak');
    lines.push('');
    for (const task of challenge.tasks) {
      const done = checked.includes(task.id);
      lines.push((done ? '[x] ' : '[ ] ') + task.label + (task.optional ? ' (optional)' : ''));
    }
    lines.push('');
    lines.push('#' + challenge.name.replace(/\s+/g, '') + ' #Coach');
    return lines.join('\n');
  },
};

window.Challenges = Challenges;
window.ChallengeTemplates = ChallengeTemplates;
