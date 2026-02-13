// app.js — Routing, init, navigation

// --- Quick Log (zero-friction logging from Today screen) ---
const QuickLog = {
  init() {
    document.getElementById('quick-photo-btn')?.addEventListener('click', () => QuickLog.snapMeal());
    document.getElementById('quick-water-8')?.addEventListener('click', () => QuickLog.addWater(8));
    document.getElementById('quick-water-16')?.addEventListener('click', () => QuickLog.addWater(16));
    document.getElementById('quick-weight-btn')?.addEventListener('click', () => QuickLog.showWeightEntry());
  },

  // --- Snap meal → quick log modal (always logs to today) ---
  async snapMeal() {
    const photo = await Camera.capture('meal');
    if (!photo) return;
    QuickLog.showQuickLogModal(photo);
  },

  showQuickLogModal(photo) {
    const autoSub = UI.autoMealSubtype();
    let selectedType = 'meal';
    let selectedSubtype = autoSub;

    const overlay = UI.createElement('div', 'modal-overlay');

    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Quick Log</span>
        <button class="modal-close" id="ql-close">&times;</button>
      </div>
      <div class="ql-photo-preview">
        <img src="${photo.url}" alt="">
      </div>
      <div class="subtype-row" id="ql-type-chips">
        <button class="subtype-chip selected" data-type="meal">\u{1F37D}\uFE0F Meal</button>
        <button class="subtype-chip" data-type="snack">\u{1F36A} Snack</button>
        <button class="subtype-chip" data-type="drink">\u{1F964} Drink</button>
      </div>
      <div class="subtype-row" id="ql-subtype-chips">
        <button class="subtype-chip${autoSub === 'breakfast' ? ' selected' : ''}" data-sub="breakfast">Breakfast</button>
        <button class="subtype-chip${autoSub === 'lunch' ? ' selected' : ''}" data-sub="lunch">Lunch</button>
        <button class="subtype-chip${autoSub === 'dinner' ? ' selected' : ''}" data-sub="dinner">Dinner</button>
      </div>
      <div class="form-group">
        <textarea class="form-input" id="ql-notes" placeholder="Add notes (optional)" rows="2"></textarea>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="ql-save">Save</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Type chip selection
    sheet.querySelectorAll('#ql-type-chips .subtype-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sheet.querySelectorAll('#ql-type-chips .subtype-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedType = chip.dataset.type;
        const subtypeRow = document.getElementById('ql-subtype-chips');
        subtypeRow.style.display = selectedType === 'meal' ? 'flex' : 'none';
        if (selectedType !== 'meal') selectedSubtype = null;
      });
    });

    // Subtype chip selection
    sheet.querySelectorAll('#ql-subtype-chips .subtype-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sheet.querySelectorAll('#ql-subtype-chips .subtype-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedSubtype = chip.dataset.sub;
      });
    });

    const closeModal = () => {
      Camera.revokeURL(photo.url);
      overlay.remove();
    };

    document.getElementById('ql-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Save
    document.getElementById('ql-save').addEventListener('click', async () => {
      if (selectedType === 'meal' && !selectedSubtype) {
        UI.toast('Pick a meal type', 'error');
        return;
      }

      const notes = document.getElementById('ql-notes')?.value?.trim() || '';
      const today = UI.today();
      const entry = {
        id: UI.generateId(selectedType),
        type: selectedType,
        subtype: selectedSubtype,
        date: today,
        timestamp: new Date().toISOString(),
        notes,
        photo: true,
        duration_minutes: null,
      };

      const saveBtn = document.getElementById('ql-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        await DB.addEntry(entry, photo.blob);
        UI.toast(`${UI.entryLabel(entry.type, entry.subtype)} logged`);
        overlay.remove(); // Don't revoke — blob is in DB now
        // If viewing today, refresh; otherwise switch to today
        if (App.selectedDate !== today) {
          App.selectedDate = today;
          App.updateHeaderDate();
        }
        App.loadDayView();
      } catch (err) {
        console.error('Quick save failed:', err);
        UI.toast('Failed to save', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  },

  // --- Quick water increment (always logs to today) ---
  _waterBusy: false,
  async addWater(oz) {
    if (QuickLog._waterBusy) return;
    QuickLog._waterBusy = true;
    try {
      const today = UI.today();
      const summary = await DB.getDailySummary(today);
      const current = summary.water_oz || 0;
      const newTotal = current + oz;
      await DB.updateDailySummary(today, { water_oz: newTotal });
      UI.toast(`Water: ${newTotal} oz (+${oz})`);
      if (App.selectedDate === today) App.loadDayView();
    } catch (err) {
      console.error('Quick water failed:', err);
      UI.toast('Failed to save water', 'error');
    } finally {
      QuickLog._waterBusy = false;
    }
  },

  // --- Quick weight modal (always logs to today) ---
  showWeightEntry() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const today = UI.today();

    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '50dvh';
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Log Weight</span>
        <button class="modal-close" id="qw-close">&times;</button>
      </div>
      <div class="form-group">
        <div class="number-input" style="justify-content:center;">
          <button class="btn btn-secondary" id="qw-minus">\u2212</button>
          <input type="number" class="form-input" id="qw-weight" placeholder="135.0" step="0.1" inputmode="decimal">
          <button class="btn btn-secondary" id="qw-plus">+</button>
        </div>
        <div style="text-align:center; color:var(--text-muted); font-size:var(--text-sm); margin-top:var(--space-xs);">lbs</div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="qw-save">Save Weight</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Pre-fill current weight and auto-focus
    DB.getDailySummary(today).then(summary => {
      const input = document.getElementById('qw-weight');
      if (summary.weight) input.value = summary.weight.value;
      input.focus();
    }).catch(() => {});

    // +/- buttons (prevent going below 0)
    document.getElementById('qw-minus')?.addEventListener('click', () => {
      const input = document.getElementById('qw-weight');
      input.value = Math.max(0, parseFloat(input.value || 0) - 0.1).toFixed(1);
    });
    document.getElementById('qw-plus')?.addEventListener('click', () => {
      const input = document.getElementById('qw-weight');
      input.value = (parseFloat(input.value || 0) + 0.1).toFixed(1);
    });

    const closeModal = () => overlay.remove();
    document.getElementById('qw-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Save
    document.getElementById('qw-save').addEventListener('click', async () => {
      const value = parseFloat(document.getElementById('qw-weight')?.value);
      if (isNaN(value) || value <= 0) {
        UI.toast('Enter a valid weight', 'error');
        return;
      }
      try {
        await DB.updateDailySummary(today, { weight: { value, unit: 'lbs' } });
        UI.toast(`Weight: ${value} lbs saved`);
        overlay.remove();
        if (App.selectedDate === today) App.loadDayView();
      } catch (err) {
        console.error('Quick weight failed:', err);
        UI.toast('Failed to save weight', 'error');
      }
    });
  },
};

const App = {
  currentScreen: null,
  selectedDate: null,

  init() {
    App.selectedDate = UI.today();
    App.updateHeaderDate();
    App.setupNavigation();
    QuickLog.init();
    window.addEventListener('hashchange', () => App.handleRoute());

    // Initialize DB, then load the initial route
    DB.openDB().then(() => {
      console.log('DB ready');
      App.handleRoute();
    }).catch(err => {
      console.error('DB init failed:', err);
      UI.toast('Database error', 'error');
    });
  },

  // --- Routing ---
  routes: {
    '': 'today',
    '#today': 'today',
    '#log': 'log',
    '#calendar': 'calendar',
    '#goals': 'goals',
    '#settings': 'settings',
  },

  handleRoute() {
    const hash = window.location.hash || '';
    const screenId = App.routes[hash] || 'today';
    App.showScreen(screenId);
  },

  showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    // Show target
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.add('active');
      App.currentScreen = screenId;
    }

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.screen === screenId);
    });

    // Screen-specific init
    if (screenId === 'today') App.loadDayView();
    if (screenId === 'log') Log.init();
    if (screenId === 'calendar') Calendar.init();
    if (screenId === 'goals') GoalsView.init();
    if (screenId === 'settings') Settings.loadStorageInfo();
  },

  // --- Navigation ---
  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const screen = item.dataset.screen;
        if (screen === 'today') {
          App.selectedDate = UI.today();
          App.updateHeaderDate();
          if (window.location.hash === '' || window.location.hash === '#today') {
            App.showScreen('today');
          } else {
            window.location.hash = '';
          }
        } else {
          window.location.hash = screen;
        }
      });
    });
  },

  // --- Header ---
  updateHeaderDate() {
    const el = document.querySelector('.header-date');
    if (el) el.textContent = UI.formatRelativeDate(App.selectedDate);
  },

  // --- Today/Day View ---
  async loadDayView() {
    const date = App.selectedDate;
    App.updateHeaderDate();

    // Load entries
    const entries = await DB.getEntriesByDate(date);
    const entryList = document.getElementById('today-entries');
    if (!entryList) return;

    UI.clearChildren(entryList);

    // Show/hide export button based on entries
    const exportDiv = document.getElementById('today-export');
    if (exportDiv) exportDiv.style.display = entries.length > 0 ? 'block' : 'none';

    if (entries.length === 0) {
      const isToday = date === UI.today();
      // Check if this is a brand new user (no entries anywhere)
      const hasAnyEntries = isToday ? await DB.hasAnyEntries() : true;
      if (isToday && !hasAnyEntries) {
        entryList.innerHTML = App.renderWelcomeCard();
      } else {
        const dateLabel = isToday ? 'today' : `for ${UI.formatDate(date)}`;
        const hint = isToday ? 'Use the quick actions above to start logging.' : '';
        entryList.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">\u{1F4CB}</div>
            <p>No entries ${dateLabel}.${hint ? '<br>' + hint : ''}</p>
          </div>
        `;
      }
    } else {
      // Sort by timestamp
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      entries.forEach(entry => {
        entryList.appendChild(UI.renderEntryItem(entry));
      });
    }

    // Load daily summary stats
    const summary = await DB.getDailySummary(date);
    App.renderDayStats(summary, entries);

    // Load analysis if available
    const analysis = await DB.getAnalysis(date);
    const analysisEl = document.getElementById('today-analysis');
    if (analysisEl) {
      if (analysis) {
        // renderAnalysisSummary already includes its own header
        analysisEl.innerHTML = `<div style="margin-top: var(--space-lg);">` +
          GoalsView.renderAnalysisSummary(analysis) + `</div>`;
      } else {
        analysisEl.innerHTML = '';
      }
    }
  },

  renderWelcomeCard() {
    return `
      <div class="card" style="text-align:center; padding: var(--space-lg);">
        <div style="font-size: 40px; margin-bottom: var(--space-md);">\u{1F44B}</div>
        <h2 style="font-size: var(--text-lg); margin-bottom: var(--space-sm);">Welcome to Health Tracker</h2>
        <p style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: var(--space-lg); line-height: 1.6;">
          Log meals, water, workouts, and weight throughout the day.<br>
          Snap photos of your food and Claude will analyze everything nightly.
        </p>
        <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
          <button class="btn btn-primary btn-block btn-lg" onclick="App.showGoalSetup()">Set Your Goals</button>
          <button class="btn btn-secondary btn-block" onclick="window.location.hash='log'">Start Logging</button>
        </div>
        <p style="color: var(--text-muted); font-size: var(--text-xs); margin-top: var(--space-lg);">
          At the end of each day, export your data from Settings to sync with iCloud Drive.
        </p>
      </div>
    `;
  },

  async showGoalSetup() {
    const overlay = UI.createElement('div', 'modal-overlay');

    // Load existing goals
    const goals = await DB.getProfile('goals') || {};

    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Set Your Goals</span>
        <button class="modal-close" id="gs-close">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Daily Calories</label>
        <input type="number" class="form-input" id="gs-calories" value="${UI.escapeHtml(String(goals.calories || ''))}" placeholder="1800" inputmode="numeric">
      </div>
      <div class="form-group">
        <label class="form-label">Protein Goal (grams)</label>
        <input type="number" class="form-input" id="gs-protein" value="${UI.escapeHtml(String(goals.protein || ''))}" placeholder="130" inputmode="numeric">
      </div>
      <div class="form-group">
        <label class="form-label">Water Goal (oz)</label>
        <input type="number" class="form-input" id="gs-water" value="${UI.escapeHtml(String(goals.water_oz || ''))}" placeholder="96" inputmode="numeric">
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="gs-save">Save Goals</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    document.getElementById('gs-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('gs-save').addEventListener('click', async () => {
      const calories = parseInt(document.getElementById('gs-calories')?.value) || null;
      const protein = parseInt(document.getElementById('gs-protein')?.value) || null;
      const water_oz = parseInt(document.getElementById('gs-water')?.value) || null;

      const newGoals = { calories, protein, water_oz };
      await DB.setProfile('goals', newGoals);
      UI.toast('Goals saved');
      overlay.remove();
      App.loadDayView();
    });
  },

  renderDayStats(summary, entries) {
    const statsEl = document.getElementById('today-stats');
    if (!statsEl) return;

    const mealCount = entries.filter(e => ['meal', 'snack', 'drink'].includes(e.type)).length;
    const workouts = entries.filter(e => e.type === 'workout');
    const workoutMin = workouts.reduce((sum, w) => sum + (w.duration_minutes || 0), 0);

    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-value" style="color: var(--color-water)">${summary.water_oz || 0}<span class="unit" style="font-size: var(--text-sm); font-weight: 400; color: var(--text-secondary)"> oz</span></div>
        <div class="stat-label">Water</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--color-meal)">${mealCount}</div>
        <div class="stat-label">Meals logged</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--color-workout)">${workoutMin}<span class="unit" style="font-size: var(--text-sm); font-weight: 400; color: var(--text-secondary)"> min</span></div>
        <div class="stat-label">Exercise</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--color-weight)">${summary.weight ? summary.weight.value : '--'}<span class="unit" style="font-size: var(--text-sm); font-weight: 400; color: var(--text-secondary)"> ${summary.weight ? summary.weight.unit : ''}</span></div>
        <div class="stat-label">Weight</div>
      </div>
    `;
  },
};

// Settings helper
const Settings = {
  async loadStorageInfo() {
    const el = document.getElementById('storage-info');
    if (!el) return;

    const info = await Sync.getStorageInfo();
    const parts = [];
    if (info.unsynced > 0) parts.push(`${info.unsynced} unsynced`);
    if (info.synced > 0) parts.push(`${info.synced} synced`);
    if (info.processed > 0) parts.push(`${info.processed} processed`);

    if (parts.length === 0) {
      el.textContent = 'No photos stored.';
    } else {
      el.textContent = `${parts.join(', ')} — ${info.totalSizeMB} MB total`;
    }
  },

  async clearPhotos() {
    if (!confirm('Delete all processed meal photos? Body photos are kept.')) return;
    await Sync.clearProcessedPhotos();
    Settings.loadStorageInfo();
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
