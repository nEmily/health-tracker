// app.js — Routing, init, navigation

const App = {
  currentScreen: null,
  selectedDate: null,

  init() {
    App.selectedDate = UI.today();
    App.updateHeaderDate();
    App.setupNavigation();
    App.handleRoute();
    window.addEventListener('hashchange', () => App.handleRoute());

    // Initialize DB
    DB.openDB().then(() => {
      console.log('DB ready');
      App.loadDayView();
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
        window.location.hash = screen === 'today' ? '' : screen;
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

    if (entries.length === 0) {
      entryList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">\u{1F4CB}</div>
          <p>No entries yet today.<br>Tap + to start logging.</p>
        </div>
      `;
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
        analysisEl.innerHTML = `<h2 class="section-header" style="margin-top: var(--space-lg)">Analysis</h2>` +
          GoalsView.renderAnalysisSummary(analysis);
      } else {
        analysisEl.innerHTML = '';
      }
    }
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
    await Sync.clearProcessedPhotos();
    Settings.loadStorageInfo();
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
