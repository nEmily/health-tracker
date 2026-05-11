// app.js — Routing, init, navigation

// --- Quick Log (zero-friction logging from Today screen) ---
const QuickLog = {
  init() {
    document.getElementById('quick-photo-btn')?.addEventListener('click', () => QuickLog.snapFood());
    document.getElementById('quick-water-btn')?.addEventListener('click', () => QuickLog.showWaterPicker());
    document.getElementById('quick-supplement-btn')?.addEventListener('click', () => QuickLog.showSupplementPicker());
    document.getElementById('quick-more-btn')?.addEventListener('click', () => QuickLog.showMoreSheet());
  },

  async showMoreSheet() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '70dvh';

    // Built-in options (universal)
    const builtIn = [
      { type: 'meal', icon: UI.svg.meal, label: 'Log Food', color: 'var(--color-meal)', desc: 'Photo, text, or both' },
      { type: 'workout', icon: UI.svg.workout, label: 'Workout', color: 'var(--color-workout)', desc: 'Log a gym session' },
      { type: 'weight', icon: UI.svg.weight, label: 'Weight', color: 'var(--color-weight)', desc: 'Record today\'s weight' },
      { type: 'bodyPhoto', icon: UI.svg.bodyPhoto, label: 'Body Photo', color: 'var(--color-body-photo, var(--accent-primary))', desc: 'Progress photos' },
      { type: 'batchPhotos', icon: UI.svg.gallery, label: 'Batch Photos', color: 'var(--color-meal)', desc: 'Upload multiple meal photos at once' },
    ];

    // Add period option only if explicitly enabled in preferences
    const prefs = await DB.getProfile('preferences') || {};
    if (prefs.trackPeriod) {
      const periodState = await Period.getState();
      builtIn.push({
        type: 'period', icon: UI.svg.period,
        label: periodState.active ? 'End Period' : 'Period',
        color: 'var(--color-period)',
        desc: periodState.active ? `Day ${Math.floor((new Date(UI.today() + 'T12:00:00') - new Date(periodState.startDate + 'T12:00:00')) / 86400000) + 1} — tap to end` : 'Start tracking your cycle',
      });
    }

    // BM tracking — opt-in via Settings
    if (prefs.trackBM) {
      builtIn.push({
        type: 'bm', icon: UI.svg.bm, label: 'BM',
        color: 'var(--color-bm)',
        desc: 'Tap to log a bowel movement',
      });
    }

    // User-specific options (added by relay/coach processing)
    const custom = await DB.getProfile('moreOptions') || [];
    const options = [...builtIn, ...custom.map(o => ({
      ...o,
      icon: (o.icon && UI.svg[o.icon]) ? UI.svg[o.icon] : UI.svg.meal,
    }))];

    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Log Entry</span>
        <button class="modal-close" id="more-close" aria-label="Close">&times;</button>
      </div>
      <div class="more-sheet-options">
        ${options.map(o => `
          <button class="more-sheet-option" data-more-type="${UI.escapeHtml(o.type)}" ${o.subtype ? `data-more-subtype="${UI.escapeHtml(o.subtype)}"` : ''}>
            <span class="more-sheet-icon" style="color: ${UI.escapeHtml(o.color || 'var(--text-secondary)')}">${o.icon}</span>
            <div class="more-sheet-text">
              <span class="more-sheet-label">${UI.escapeHtml(o.label)}</span>
              <span class="more-sheet-desc">${UI.escapeHtml(o.desc || '')}</span>
            </div>
          </button>
        `).join('')}
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    document.getElementById('more-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    sheet.querySelectorAll('[data-more-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.moreType;
        closeModal();
        if (type === 'meal') {
          QuickLog.showFoodNote();
        } else if (type === 'weight') {
          QuickLog.showWeightEntry();
        } else if (type === 'batchPhotos') {
          QuickLog.batchPhotos();
        } else if (type === 'period') {
          const fresh = await Period.getState();
          if (fresh.active) Period.end(); else Period.start();
        } else if (type === 'bm') {
          // One-tap BM log — no form
          Log.saveBM();
        } else {
          // Show inline form for this type
          const logGrid = document.getElementById('log-type-grid-inline');
          if (logGrid) logGrid.style.display = 'none';
          Log._gridId = 'log-type-grid-inline';
          Log._formId = null;
          Log._formContentId = 'log-form-content-inline';
          Log.selectType(type);
        }
      });
    });
  },

  // --- Batch photos → pick multiple, each becomes a meal entry ---
  async batchPhotos() {
    const photos = await Camera.pickMultiple('meal');
    if (photos.length === 0) return;

    const date = App.selectedDate;
    let saved = 0;

    for (const photo of photos) {
      const entry = {
        id: UI.generateId('meal'),
        type: 'meal',
        subtype: null,
        date,
        timestamp: photo.takenAt && photo.takenAt.startsWith(date) ? photo.takenAt : new Date().toISOString(),
        notes: '',
        photo: true,
        duration_minutes: null,
      };

      try {
        await DB.addEntry(entry, photo.blob);
        Camera.revokeURL(photo.url);
        saved++;
      } catch (err) {
        console.error('Batch photo save failed:', err);
      }
    }

    if (saved > 0) {
      UI.toast(`${saved} photo${saved !== 1 ? 's' : ''} saved`);
      CloudRelay.queueUpload(date);
      App.loadDayView();
    } else {
      UI.toast('Failed to save photos', 'error');
    }
  },

  // --- Snap food → camera opens, auto-saves on capture ---
  async snapFood() {
    const result = await Camera.capture('meal');
    if (!result) return; // user cancelled camera

    const date = App.selectedDate;
    const entry = {
      id: UI.generateId('meal'),
      type: 'meal',
      subtype: null,
      date,
      timestamp: result.takenAt && result.takenAt.startsWith(date) ? result.takenAt : new Date().toISOString(),
      notes: '',
      photo: true,
      duration_minutes: null,
    };

    try {
      await DB.addEntry(entry, result.blob);
      Camera.revokeURL(result.url);
      UI.toast('Food photo saved');
      CloudRelay.queueUpload(date);
      App.loadDayView();
    } catch (err) {
      console.error('Quick snap failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },

  // --- Visual water picker ---
  async showWaterPicker() {
    const date = App.selectedDate;
    const summary = await DB.getDailySummary(date);
    const currentOz = summary.water_oz || 0;
    const goals = await DB.getProfile('goals') || {};
    const waterGoal = Goals.resolve(goals).water_oz;

    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');

    const containers = [
      { label: 'Small cup', oz: 6 },
      { label: 'Glass', oz: 10 },
      { label: 'Can', oz: 12 },
      { label: 'Tall glass', oz: 16 },
      { label: 'Bottle', oz: 24 },
      { label: 'Large bottle', oz: 32 },
      { label: 'Big jug', oz: 40 },
      { label: 'XL jug', oz: 64 },
    ];

    const renderSheet = (mode) => {
      const isAdd = mode === 'add';
      sheet.innerHTML = `
        <div class="modal-header">
          <span class="modal-title">Water</span>
          <button class="modal-close" id="wp-close" aria-label="Close">&times;</button>
        </div>
        <div style="text-align: center; margin-bottom: var(--space-md); color: var(--text-secondary); font-size: var(--text-sm);">
          Today: <strong style="color: var(--color-water)" id="wp-current">${currentOz} oz</strong> of ${waterGoal} oz goal
        </div>
        <div class="segment-control" style="margin-bottom: var(--space-md);">
          <button class="segment-btn${isAdd ? ' active' : ''}" id="wp-mode-add">Add</button>
          <button class="segment-btn${!isAdd ? ' active' : ''}" id="wp-mode-remove">Remove</button>
        </div>
        <div class="water-picker-grid">
          ${containers.map(c => `
            <button class="water-pick" data-oz="${c.oz}">
              <div class="water-pick-oz">${isAdd ? '+' : '-'}${c.oz} oz</div>
              <div class="water-pick-label">${c.label}</div>
            </button>
          `).join('')}
        </div>
      `;

      document.getElementById('wp-close').addEventListener('click', closeModal);
      document.getElementById('wp-mode-add').addEventListener('click', () => renderSheet('add'));
      document.getElementById('wp-mode-remove').addEventListener('click', () => renderSheet('remove'));

      let waterSaving = false;
      sheet.querySelectorAll('.water-pick').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (waterSaving) return;
          waterSaving = true;
          btn.classList.add('water-pick-saved');
          const oz = parseInt(btn.dataset.oz);
          try {
            const fresh = await DB.getDailySummary(date);
            const prev = fresh.water_oz || 0;
            const newTotal = isAdd ? prev + oz : Math.max(0, prev - oz);
            await DB.updateDailySummary(date, { water_oz: newTotal });
            const sign = isAdd ? '+' : '-';
            const actual = isAdd ? oz : Math.min(oz, prev);
            UI.toast(`${sign}${actual} oz — ${newTotal} oz total`);
            CloudRelay.queueUpload(date);
            setTimeout(() => {
              closeModal();
              App.loadDayView();
            }, 300);
          } catch (err) {
            console.error('Quick water failed:', err);
            UI.toast('Failed to save water', 'error');
            waterSaving = false;
            btn.classList.remove('water-pick-saved');
          }
        });
      });
    };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    renderSheet('add');
  },

  // --- Quick weight modal ---
  async showWeightEntry() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const date = App.selectedDate;
    const prefs = await DB.getProfile('preferences') || {};
    const weightUnit = prefs.weightUnit || 'lbs';

    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '50dvh';
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Log Weight</span>
        <button class="modal-close" id="qw-close" aria-label="Close">&times;</button>
      </div>
      <div class="form-group">
        <div class="number-input" style="justify-content:center;">
          <button class="btn btn-secondary" id="qw-minus">\u2212</button>
          <input type="number" class="form-input" id="qw-weight" placeholder="${weightUnit === 'kg' ? '60.0' : '135.0'}" step="0.1" inputmode="decimal">
          <button class="btn btn-secondary" id="qw-plus">+</button>
        </div>
        <div style="text-align:center; color:var(--text-muted); font-size:var(--text-sm); margin-top:var(--space-xs);">${weightUnit}</div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="qw-save">Save Weight</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Pre-fill current weight (or last known weight) and auto-focus
    DB.getDailySummary(date).then(async summary => {
      const input = document.getElementById('qw-weight');
      if (summary.weight) {
        input.value = summary.weight.value;
      } else {
        // Check yesterday for a recent weight to pre-fill
        const yesterday = UI.yesterday(date);
        const yesterdaySummary = await DB.getDailySummary(yesterday);
        if (yesterdaySummary.weight) {
          input.value = yesterdaySummary.weight.value;
        }
      }
      input.focus();
      input.select();
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
        const ts = Date.now();
        const isoTs = new Date(ts).toISOString();
        // Create an entry so each weight recording appears in the timeline
        const entry = {
          id: UI.generateId('weight'),
          type: 'weight',
          subtype: null,
          date,
          timestamp: isoTs,
          notes: `${value} ${weightUnit}`,
          photo: false,
          duration_minutes: null,
          weight_value: value,
          weight_unit: weightUnit,
        };
        await DB.addEntry(entry);
        // Also update daily summary for stat card + progress charts
        const fresh = await DB.getDailySummary(date);
        await DB.updateDailySummary(date, {
          weight: { value, unit: weightUnit, timestamp: ts },
          weightLog: [...(fresh.weightLog || []), { value, unit: weightUnit, timestamp: ts }],
        });
        UI.toast(`Weight: ${value} ${weightUnit} saved`);
        CloudRelay.queueUpload(date);
        overlay.remove();
        App.loadDayView();
      } catch (err) {
        console.error('Quick weight failed:', err);
        UI.toast('Failed to save weight', 'error');
      }
    });
  },

  // --- Log food (text + optional photo) ---
  async showFoodNote() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '75dvh';

    // Multi-photo per meal: dish + nutrition label + receipt all attach to
    // ONE entry. Pending photos array (was scalar). 'Take Photo' adds one;
    // 'Library' lets user pick multiple at once. Each added photo shows as
    // a thumbnail with a remove (×) button.
    let pendingPhotos = []; // Array<{ blob, url, takenAt }>

    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Log Food</span>
        <button class="modal-close" id="fn-close" aria-label="Close">&times;</button>
      </div>
      <div class="form-group">
        <div style="display:flex; gap:var(--space-sm); margin-bottom:var(--space-sm);">
          <button class="btn btn-secondary" id="fn-camera" style="flex:1;"><span class="btn-icon">${UI.svg.camera}</span> Take Photo</button>
          <button class="btn btn-ghost" id="fn-library" style="flex:1;"><span class="btn-icon">${UI.svg.gallery || UI.svg.camera}</span> Library</button>
        </div>
        <p class="form-hint" style="font-size:var(--text-xs); color:var(--text-muted); margin:0 0 var(--space-sm);">Add multiple shots of the same meal (dish + nutrition label + receipt). All photos attach to this ONE entry.</p>
        <div id="fn-photo-area" class="multi-photo-grid"></div>
      </div>
      <div class="form-group">
        <textarea class="form-input" id="fn-notes" placeholder="What did you eat? (optional if photo added)" rows="2"></textarea>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="fn-save">Save</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => {
      for (const p of pendingPhotos) Camera.revokeURL(p.url);
      pendingPhotos = [];
      overlay.remove();
    };
    document.getElementById('fn-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    const renderThumbs = () => {
      const area = document.getElementById('fn-photo-area');
      if (!area) return;
      area.innerHTML = '';
      pendingPhotos.forEach((photo, idx) => {
        area.appendChild(Camera.createPreview(photo.url, () => {
          Camera.revokeURL(photo.url);
          pendingPhotos.splice(idx, 1);
          renderThumbs();  // re-render after removal
        }));
      });
    };

    const addPhotos = (photos) => {
      for (const p of photos) pendingPhotos.push(p);
      renderThumbs();
    };

    document.getElementById('fn-camera').addEventListener('click', async () => {
      const result = await Camera.capture('meal');
      if (result) addPhotos([result]);
    });
    document.getElementById('fn-library').addEventListener('click', async () => {
      // Multi-select from library — all picked photos attach to this same entry.
      const results = await Camera.pickMultiple('meal');
      if (results && results.length) addPhotos(results);
    });

    // Focus textarea and scroll into view when keyboard opens
    const fnNotes = document.getElementById('fn-notes');
    if (fnNotes) {
      fnNotes.addEventListener('focus', () => {
        setTimeout(() => fnNotes.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
      });
      requestAnimationFrame(() => fnNotes.focus());
    }

    let saving = false;
    document.getElementById('fn-save').addEventListener('click', async () => {
      if (saving) return;
      const notes = document.getElementById('fn-notes')?.value?.trim() || '';
      if (!notes && pendingPhotos.length === 0) { UI.toast('Add a note or photo', 'error'); return; }

      saving = true;
      const date = App.selectedDate;
      const firstPhoto = pendingPhotos[0];
      const entry = {
        id: UI.generateId('meal'),
        type: 'meal',
        subtype: null,
        date,
        timestamp: firstPhoto?.takenAt && firstPhoto.takenAt.startsWith(date) ? firstPhoto.takenAt : new Date().toISOString(),
        notes,
        photo: pendingPhotos.length > 0,
        duration_minutes: null,
      };

      try {
        const blobs = pendingPhotos.map(p => p.blob);
        await DB.addEntry(entry, blobs.length > 0 ? blobs : null);
        // Don't revoke URLs — blobs are now in DB; closeModal handles cleanup
        pendingPhotos = [];  // prevent closeModal from revoking now-stored blobs
        UI.toast(`Food logged${blobs.length > 1 ? ` (${blobs.length} photos)` : ''}`);
        CloudRelay.queueUpload(date);
        closeModal();
        App.loadDayView();
      } catch (err) {
        console.error('Food log failed:', err);
        UI.toast('Failed to save', 'error');
        saving = false;
      }
    });
  },

  // --- Dailies (user-configurable supplements/items) ---
  _supplements: [],

  async loadSupplements() {
    const profile = await DB.getProfile('supplements');
    QuickLog._supplements = profile && profile.length > 0 ? profile : [];
  },

  async showSupplementPicker() {
    await QuickLog.loadSupplements();
    const supplements = QuickLog._supplements;
    const selected = new Set();

    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '60dvh';

    const renderList = () => {
      if (supplements.length === 0) {
        return `<div style="text-align:center; padding:var(--space-lg); color:var(--text-muted);">
          <p style="margin-bottom:var(--space-md);">No dailies configured yet.</p>
          <button class="btn btn-primary" id="sp-add-first">Add Your First Daily</button>
        </div>`;
      }
      return `
        <div class="supplement-grid">
          ${supplements.map(s => `
            <button class="supplement-pick${selected.has(s.key) ? ' selected' : ''}" data-key="${UI.escapeHtml(s.key)}">
              ${s.photo ? `<img src="${s.photo}" class="supplement-pick-photo" alt="">` : ''}
              <div style="font-weight:500;">${UI.escapeHtml(s.name)}</div>
              ${s.calories ? `<div style="font-size:var(--text-xs); color:var(--text-muted);">${s.calories} cal${s.protein ? ` · ${s.protein}g protein` : ''}</div>` : ''}
            </button>
          `).join('')}
        </div>
        <button class="btn btn-primary btn-block btn-lg${selected.size === 0 ? ' disabled' : ''}" id="sp-log-btn" style="margin-top:var(--space-md);"${selected.size === 0 ? ' disabled' : ''}>Log Selected (${selected.size})</button>
        <button class="btn btn-ghost btn-block" id="sp-manage" style="margin-top:var(--space-sm); font-size:var(--text-xs);">Manage Dailies</button>
      `;
    };

    const render = () => {
      sheet.innerHTML = `
        <div class="modal-header">
          <span class="modal-title">Dailies</span>
          <button class="modal-close" id="sp-close" aria-label="Close">&times;</button>
        </div>
        ${renderList()}
      `;
      bindEvents();
    };

    const closeModal = () => overlay.remove();

    const bindEvents = () => {
      document.getElementById('sp-close').addEventListener('click', closeModal);
      document.getElementById('sp-add-first')?.addEventListener('click', () => {
        closeModal();
        QuickLog.showDailiesManager();
      });
      document.getElementById('sp-manage')?.addEventListener('click', () => {
        closeModal();
        QuickLog.showDailiesManager();
      });

      sheet.querySelectorAll('.supplement-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          if (selected.has(key)) selected.delete(key);
          else selected.add(key);
          render();
        });
      });

      document.getElementById('sp-log-btn')?.addEventListener('click', async () => {
        if (selected.size === 0) return;
        const date = App.selectedDate;
        const logged = [];
        for (const key of selected) {
          const supp = supplements.find(s => s.key === key);
          if (!supp) continue;
          const entry = {
            id: UI.generateId('supplement'),
            type: 'supplement',
            subtype: supp.key,
            date,
            timestamp: new Date().toISOString(),
            notes: supp.notes || supp.name,
            photo: null,
            duration_minutes: null,
          };
          try {
            await DB.addEntry(entry);
            logged.push(supp.name);
          } catch (err) {
            console.error(`Supplement log failed for ${supp.name}:`, err);
          }
        }
        if (logged.length > 0) {
          UI.toast(`${logged.join(', ')} logged`);
          CloudRelay.queueUpload(date);
        }
        closeModal();
        App.loadDayView();
      });
    };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    render();
  },

  // --- Dailies Manager (add/remove/edit daily items) ---
  async showDailiesManager() {
    await QuickLog.loadSupplements();
    let items = [...QuickLog._supplements];
    let pendingPhoto = null; // { blob, url, dataURL } for new item

    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.style.maxHeight = '80dvh';

    const renderItems = () => {
      if (items.length === 0) {
        return `<div style="text-align:center; padding:var(--space-md); color:var(--text-muted); font-size:var(--text-sm);">
          No dailies yet. Add items you take or do every day.
        </div>`;
      }
      return items.map((item, i) => `
        <div class="dailies-item" data-index="${i}">
          ${item.photo ? `<img src="${item.photo}" class="dailies-item-photo" alt="">` : ''}
          <div class="dailies-item-body">
            <div style="font-weight:500; font-size:var(--text-sm);">${UI.escapeHtml(item.name)}</div>
            ${item.notes && item.notes !== item.name ? `<div style="font-size:var(--text-xs); color:var(--text-muted);">${UI.escapeHtml(item.notes)}</div>` : ''}
            ${item.calories ? `<div style="font-size:var(--text-xs); color:var(--text-muted);">${item.calories} cal${item.protein ? ` · ${item.protein}g protein` : ''}</div>` : ''}
            ${item.pending ? `<div style="font-size:var(--text-xs); color:var(--accent-blue);">Pending analysis</div>` : ''}
          </div>
          <button class="dailies-remove" data-index="${i}" title="Remove">&times;</button>
        </div>
      `).join('');
    };

    const render = () => {
      sheet.innerHTML = `
        <div class="modal-header">
          <span class="modal-title">Manage Dailies</span>
          <button class="modal-close" id="dm-close" aria-label="Close">&times;</button>
        </div>
        <div id="dm-list">${renderItems()}</div>
        <div class="dailies-add-form" id="dm-add-form">
          <div id="dm-photo-area" style="margin-bottom:var(--space-sm);"></div>
          <div style="display:flex; gap:var(--space-sm); margin-bottom:var(--space-sm);">
            <button class="btn btn-secondary btn-block" id="dm-camera-btn" style="display:flex; align-items:center; justify-content:center; gap:var(--space-xs);">
              <span style="display:inline-flex;">${UI.svg.camera}</span> Take Photo
            </button>
            <button class="btn btn-ghost btn-block" id="dm-pick-btn" style="display:flex; align-items:center; justify-content:center; gap:var(--space-xs);">
              <span style="display:inline-flex;">${UI.svg.gallery}</span> Choose from Library
            </button>
          </div>
          <textarea class="form-input" id="dm-desc" placeholder="Describe what this is (e.g. Creatine 5g, protein shake, daily vitamin)&#10;&#10;Or just snap a photo — processing will fill in the details" rows="2" style="margin-bottom:var(--space-sm);"></textarea>
          <details id="dm-details" style="margin-bottom:var(--space-sm);">
            <summary style="font-size:var(--text-xs); color:var(--text-muted); cursor:pointer; padding:var(--space-xs) 0;">Add nutrition details manually</summary>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-sm); margin-top:var(--space-sm);">
              <input type="number" class="form-input" id="dm-cal" placeholder="Calories" inputmode="numeric">
              <input type="number" class="form-input" id="dm-protein" placeholder="Protein (g)" inputmode="numeric">
            </div>
          </details>
          <button class="btn btn-primary btn-block" id="dm-add-btn">Add Daily</button>
        </div>
        <button class="btn btn-ghost btn-block btn-lg" id="dm-done" style="margin-top:var(--space-md);">Done</button>
      `;

      // Bind events
      document.getElementById('dm-close').addEventListener('click', closeModal);
      document.getElementById('dm-done').addEventListener('click', closeModal);

      const handlePhoto = async (result) => {
        if (!result) return;
        pendingPhoto = result;
        const reader = new FileReader();
        reader.onload = () => {
          pendingPhoto.dataURL = reader.result;
          const area = document.getElementById('dm-photo-area');
          area.innerHTML = '';
          area.appendChild(Camera.createPreview(result.url, () => {
            Camera.revokeURL(pendingPhoto.url);
            pendingPhoto = null;
            area.innerHTML = '';
          }));
        };
        reader.readAsDataURL(result.blob);
      };

      document.getElementById('dm-camera-btn').addEventListener('click', async () => {
        handlePhoto(await Camera.capture('meal'));
      });
      document.getElementById('dm-pick-btn').addEventListener('click', async () => {
        handlePhoto(await Camera.pick('meal'));
      });

      const descEl = document.getElementById('dm-desc');
      if (descEl) {
        UI.autoResize(descEl);
        descEl.addEventListener('input', () => UI.autoResize(descEl));
      }

      document.getElementById('dm-add-btn').addEventListener('click', () => {
        const desc = document.getElementById('dm-desc')?.value?.trim() || '';
        if (!desc && !pendingPhoto) { UI.toast('Add a photo or description', 'error'); return; }
        // Derive name from description or mark as pending
        const name = desc ? desc.split('\n')[0].slice(0, 50) : 'New item';
        const key = (name === 'New item' ? `item_${Date.now()}` : name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (items.some(it => it.key === key)) { UI.toast('Already exists', 'error'); return; }
        const cal = parseInt(document.getElementById('dm-cal')?.value) || 0;
        const protein = parseInt(document.getElementById('dm-protein')?.value) || 0;
        const pending = !desc && pendingPhoto;
        const item = { key, name, notes: desc || '', calories: cal, protein, carbs: 0, fat: 0, pending: !!pending };
        if (pendingPhoto?.dataURL) item.photo = pendingPhoto.dataURL;
        items.push(item);
        if (pendingPhoto) { Camera.revokeURL(pendingPhoto.url); pendingPhoto = null; }
        saveAndRender();
        if (pending) UI.toast('Saved — processing will identify this item');
      });

      sheet.querySelectorAll('.dailies-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index);
          const removed = items[idx];
          items.splice(idx, 1);
          saveAndRender(removed ? removed.key : null);
        });
      });
    };

    let saving = false;
    const saveAndRender = async (deletedKey) => {
      if (saving) return;
      saving = true;
      try {
        await DB.setProfile('supplements', items);
        QuickLog._supplements = items;
        // Persist deleted key so sync re-import cannot resurrect it
        if (deletedKey) {
          const existing = await DB.getProfile('deletedDailies') || [];
          if (!existing.includes(deletedKey)) {
            existing.push(deletedKey);
            await DB.setProfile('deletedDailies', existing);
          }
        }
      } catch (err) {
        console.error('Failed to save dailies:', err);
        UI.toast('Failed to save changes', 'error');
      } finally {
        saving = false;
        render();
      }
    };

    const closeModal = () => {
      if (pendingPhoto) { Camera.revokeURL(pendingPhoto.url); pendingPhoto = null; }
      overlay.remove();
    };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    render();
  },
};

const App = {
  currentScreen: null,
  selectedDate: null,
  _currentPanel: 'diet',

  init() {
    App.selectedDate = UI.today();
    App.updateHeaderDate();
    App.setupNavigation();
    App.setupDateNav();
    App.initPanels();
    QuickLog.init();
    UI.initKeyboardScroll();
    UI.initGlobalEscape();
    window.addEventListener('hashchange', () => App.handleRoute());

    // Auto-retry sync when coming back online
    window.addEventListener('online', async () => {
      const configured = await CloudRelay.isConfigured();
      if (!configured) return;
      const dates = await DB.getDatesNeedingSync();
      if (dates.length > 0) {
        UI.toast('Back online — syncing...');
        for (const date of dates) {
          await CloudRelay._doUpload(date);
        }
      }
      CloudRelay.checkForResults().catch(() => {});
    });

    // Check for results + upload stale dates when app is foregrounded (covers
    // iOS PWA resume, Android tab switch, and desktop alt-tab).
    let lastCatchUp = 0;
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      const configured = await CloudRelay.isConfigured();
      if (!configured) return;
      CloudRelay.checkForResults().catch(() => {});
      // Catch up stale dates (throttled to once per 30 min)
      const now = Date.now();
      if (now - lastCatchUp < 30 * 60 * 1000) return;
      lastCatchUp = now;
      const dates = await DB.getDatesNeedingSync();
      if (dates.length > 0) {
        CloudRelay.log(`Foreground catch-up: ${dates.length} stale date(s)`);
        for (const date of dates) {
          await CloudRelay._doUpload(date);
        }
      }
    });

    // Initialize DB, then load the initial route
    DB.openDB().then(async () => {
      console.log('DB ready');

      // Auto-configure sync from URL params (pairing link from /setup or welcome page)
      const urlParams = new URLSearchParams(location.search);
      if (urlParams.has('key')) {
        const key = urlParams.get('key');
        const relay = urlParams.get('relay') || '';
        if (key) {
          const existing = await CloudRelay.getConfig() || {};
          if (existing.syncKey !== key) {
            existing.syncKey = key;
            existing.workerUrl = relay;
            await CloudRelay.saveConfig(existing);
            UI.toast('Sync connected');
          }
          // Only clean URL in standalone mode (PWA already installed).
          // In browser mode, keep ?key= in the URL so it survives "Add to Home Screen"
          // (iOS Safari uses the current URL as the PWA bookmark if manifest start_url fails).
          const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
          if (isStandalone) {
            history.replaceState(null, '', location.pathname + location.hash);
          }
          // Pull data from relay
          CloudRelay.checkForResults().catch(() => {});
        }
      }

      // Load day boundary preference before anything uses UI.today()
      const prefs = await DB.getProfile('preferences');
      if (prefs != null && prefs.dayBoundaryHour !== undefined) {
        UI._dayBoundaryHours = prefs.dayBoundaryHour;
        App.selectedDate = UI.today(); // Re-derive with correct boundary
      }

      // Check for fresh install (empty DB) and attempt restore from cloud
      const hasData = await DB.hasAnyEntries();
      const hasProfile = await DB.getProfile('goals');
      if (!hasData && !hasProfile) {
        const restored = await App.attemptRestore();
        if (restored) {
          App.handleRoute();
          return;
        }
      }

      // Run goal migrations on every init (fixes water_oz 96->64, adds hardcore)
      await App.ensureDefaultGoals();
      // One-time cleanup: purge weight values > 200 lbs (typos like 1028 instead of 102.8)
      await App.purgeImpossibleWeightsV1();
      // Check for challenge import from URL
      if (typeof Challenges !== 'undefined') Challenges.importFromURL();
      // Check for cloud relay results
      CloudRelay.checkForResults().catch(err => console.warn('CloudRelay check failed:', err));
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
    '#coach': 'coach',
    '#progress': 'progress',
    '#settings': 'settings',
    // Legacy routes
    '#plan': 'progress',
    '#profile': 'settings',
    '#log': 'today',
    '#calendar': 'progress',
    '#goals': 'progress',
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

    // Header date nav: only relevant on Today (per-day stats). Chat is
    // continuous history; Progress + Settings have no day concept.
    const headerNav = document.querySelector('.header-nav');
    if (headerNav) headerNav.style.display = (screenId === 'today') ? '' : 'none';

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      const isActive = item.dataset.screen === screenId;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Screen-specific init
    if (screenId === 'today') App.loadDayView();
    if (screenId === 'coach') App.loadCoachView();
    if (screenId === 'progress') ProgressView.init();
    if (screenId === 'settings') {
      Settings.loadGoalsSummary();
      Settings.loadStorageInfo();
      Settings.loadCloudSyncStatus();
      Settings.loadWeightUnit();
      Settings.loadDayBoundary();
      Settings.loadOptionalTracking();
      Settings.initUpdateButton();
      Settings.loadVersion();
    }
  },

  // --- Today Panels (Diet / Fitness / Skin) ---
  initPanels() {
    // Segment button clicks
    document.querySelectorAll('.today-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => App.switchPanel(btn.dataset.panel));
    });

    // Touch swipe support
    const panels = document.getElementById('today-panels');
    if (panels) {
      let startX = 0;
      let startY = 0;
      panels.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }, { passive: true });
      panels.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        // Only trigger if horizontal swipe > 50px and more horizontal than vertical
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          // Only Diet + Fitness panels exist (the historical Skin panel was
          // removed). Keep the order short to avoid swiping to a ghost.
          const order = ['diet', 'fitness'];
          const idx = order.indexOf(App._currentPanel);
          if (dx < 0 && idx < order.length - 1) App.switchPanel(order[idx + 1]);
          if (dx > 0 && idx > 0) App.switchPanel(order[idx - 1]);
        }
      }, { passive: true });
    }
  },

  switchPanel(panel) {
    App._currentPanel = panel;
    const order = ['diet', 'fitness'];
    const idx = order.indexOf(panel);
    if (idx < 0) return; // unknown panel name — ignore

    // Update segment buttons
    document.querySelectorAll('.today-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.panel === panel);
    });

    // Slide panels
    document.querySelectorAll('.today-panel').forEach(p => {
      p.style.transform = `translateX(-${idx * 100}%)`;
    });

    // Update container height to match active panel (transform doesn't affect layout)
    App._updatePanelHeight();
  },

  _updatePanelHeight() {
    requestAnimationFrame(() => {
      const panel = document.querySelector(`#panel-${App._currentPanel}`);
      const container = document.getElementById('today-panels');
      if (panel && container) {
        container.style.minHeight = panel.scrollHeight + 'px';
      }
    });
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

  // --- Date Navigation ---
  setupDateNav() {
    document.getElementById('header-prev')?.addEventListener('click', () => App.navigateDay(-1));
    document.getElementById('header-next')?.addEventListener('click', () => App.navigateDay(1));
    document.getElementById('header-today')?.addEventListener('click', () => {
      App.selectedDate = UI.today();
      App.updateHeaderDate();
      if (App.currentScreen === 'today') App.loadDayView();
      if (App.currentScreen === 'coach') App.loadCoachView();
    });
  },

  navigateDay(offset) {
    const d = new Date(App.selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    const newDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Don't navigate into the future
    if (newDate > UI.today()) return;
    App.selectedDate = newDate;
    App.updateHeaderDate();
    if (App.currentScreen === 'today') App.loadDayView();
    if (App.currentScreen === 'coach') App.loadCoachView();
  },

  goToDate(dateStr) {
    App.selectedDate = dateStr;
    App.updateHeaderDate();
    window.location.hash = '';
    App.showScreen('today');
  },

  // --- Header ---
  updateHeaderDate() {
    const el = document.querySelector('.header-date');
    if (el) el.textContent = UI.formatRelativeDate(App.selectedDate);
    const isToday = App.selectedDate >= UI.today();
    // Hide next button if on today, show "Today" jump button if on a past date
    const nextBtn = document.getElementById('header-next');
    const todayBtn = document.getElementById('header-today');
    if (nextBtn) nextBtn.style.visibility = isToday ? 'hidden' : 'visible';
    if (todayBtn) todayBtn.style.display = isToday ? 'none' : 'inline-flex';
  },

  // --- Today/Day View ---
  async loadDayView() {
    const date = App.selectedDate;
    App.updateHeaderDate();

    // Close any open inline forms (prevents stale form after day navigation)
    const logGrid = document.getElementById('log-type-grid-inline');
    const logForm = document.getElementById('log-form-inline');
    if (logGrid) logGrid.style.display = 'none';
    if (logForm) logForm.style.display = 'none';

    // Fetch all independent data in parallel to avoid sequential DB round-trips.
    // analysis and regimen are needed by multiple downstream consumers so we
    // load them eagerly here and pass them as preloaded to avoid re-reads.
    const [entries, summary, goals, analysis, regimen] = await Promise.all([
      DB.getEntriesByDate(date),
      DB.getDailySummary(date),
      DB.getProfile('goals').then(g => g || {}),
      DB.getAnalysis(date).catch(() => null),
      DB.getRegimen().catch(() => null),
    ]);

    const entryList = document.getElementById('today-entries');
    if (!entryList) return;

    UI.clearChildren(entryList);

    if (entries.length === 0) {
      const isToday = date === UI.today();
      // Check if this is a brand new user (no entries anywhere)
      const hasAnyEntries = isToday ? await DB.hasAnyEntries() : true;
      const hasAnalysis = isToday ? !!(await DB.getAnalysis(date)) : false;
      if (App.currentScreen !== 'today') return;
      if (isToday && !hasAnyEntries && !hasAnalysis && !localStorage.getItem('cloudRelay_backup')) {
        // Brand new user, not yet paired — show welcome/pairing card
        await App.ensureDefaultGoals();
        entryList.innerHTML = App.renderWelcomeCard();
        App.setSetupMode(true);
        App.initPairingInputs();
      } else {
        // Existing user — make sure chrome is visible
        App.setSetupMode(false);
        // Try to show entries from analysis data (recovery after reinstall)
        if (analysis && analysis.entries && analysis.entries.length > 0) {
          analysis.entries.forEach(ae => {
            entryList.appendChild(UI.renderAnalysisEntry({ ...ae, date: analysis.date || date }));
          });
        } else {
          if (isToday) {
            entryList.innerHTML = App.renderEmptyDay();
          } else {
            entryList.innerHTML = `
              <div class="empty-state">
                <div class="empty-icon">${UI.svg.clipboard}</div>
                <p>Nothing logged on ${UI.formatDate(date)}.</p>
              </div>
            `;
          }
        }
      }
    } else {
      // Data exists — make sure setup mode is off
      App.setSetupMode(false);
      // Merge AI results into entry cards using the already-loaded analysis
      let analysisMap = {};
      const dayImportedAt = (analysis && analysis.importedAt) || 0;
      try {
        if (analysis && analysis.entries) {
          for (const ae of analysis.entries) {
            if (ae.id) analysisMap[ae.id] = { ...ae, _importedAt: dayImportedAt };
          }
        }
      } catch (err) {
        console.warn('Failed to process analysis:', err);
      }

      // Sort by timestamp
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      entries.forEach(entry => {
        const ae = analysisMap[entry.id] || null;
        entryList.appendChild(UI.renderEntryItem(entry, ae, dayImportedAt));
      });
    }

    // Period banner (shows if period is active on this date, and tracking is enabled)
    const _periodPrefs = await DB.getProfile('preferences') || {};
    if (_periodPrefs.trackPeriod) {
      await Period.renderBanner(date, entryList);
    }

    // Render stats and score in parallel — both use preloaded data
    const preloaded = { goals, summary, entries, analysis, regimen };

    await App.renderDayStats(summary, entries, date, preloaded);

    // Day Score (above coach)
    const scoreEl = document.getElementById('today-score');
    if (scoreEl) {
      try {
        const [scoreResult, streak] = await Promise.all([
          DayScore.calculate(date, preloaded),
          DayScore.calculateStreak(date)
        ]);
        scoreEl.innerHTML = DayScore.render(scoreResult, streak);
      } catch (e) { console.warn('Score error:', e); scoreEl.innerHTML = ''; }
    }

    // Workout exercises (individual cards, no collapsible wrapper)
    const workoutEl = document.getElementById('today-workout');
    if (workoutEl) {
      try {
        // Tolerate any of the regimen schedule shapes (weeklySchedule,
        // weekly_schedule, weeklyStructure, days). Fitness._normalizeSchedule
        // returns [] if none present, which means there's no plan for the day.
        const hasSchedule = regimen && (Fitness._normalizeSchedule
          ? Fitness._normalizeSchedule(regimen).length > 0
          : !!regimen.weeklySchedule);
        if (hasSchedule) {
          const fitnessHtml = await Fitness.render(regimen, date);
          workoutEl.innerHTML = fitnessHtml;
          Fitness.bindEvents(date, workoutEl);
        } else {
          // No regimen for this date — still surface any fitness_notes the
          // user saved that day so historical workout notes don't disappear.
          // Also surface any type=workout entries logged that day.
          const summary2 = preloaded?.summary || summary;
          const notes = summary2?.fitness_notes || '';
          const workoutEntries = (entries || []).filter(e => e.type === 'workout');
          let html = '';
          if (notes || workoutEntries.length > 0) {
            html += '<div class="card" style="padding: var(--space-md); margin-top: var(--space-sm);">';
            if (workoutEntries.length > 0) {
              html += '<div style="font-size:var(--text-xs); text-transform:uppercase; color:var(--text-muted); font-weight:600; margin-bottom:var(--space-xs);">Workout</div>';
              for (const w of workoutEntries) {
                const wn = (w.notes || w.description || '').replace(/\n/g, '<br>');
                html += `<div style="font-size:var(--text-sm); white-space:pre-wrap; margin-bottom:var(--space-sm);">${UI.escapeHtml(w.notes || w.description || '').replace(/\n/g, '<br>')}</div>`;
              }
            }
            if (notes) {
              html += '<div style="font-size:var(--text-xs); text-transform:uppercase; color:var(--text-muted); font-weight:600; margin-bottom:var(--space-xs);">Notes</div>';
              html += `<div style="font-size:var(--text-sm); white-space:pre-wrap;">${UI.escapeHtml(notes)}</div>`;
            }
            html += '</div>';
          } else {
            html = '<div class="card" style="padding: var(--space-lg); text-align: center; color: var(--text-secondary); font-size: var(--text-sm);">Log a workout from the + button above, or set up a workout plan in a coaching session.</div>';
          }
          workoutEl.innerHTML = html;
        }
      } catch (e) { console.warn('Workout render error:', e); workoutEl.innerHTML = ''; }
    }

    // Meal suggestion card (collapsible)
    const mealSuggEl = document.getElementById('today-meal-suggestion');
    if (mealSuggEl) {
      try {
        const mealPlan = await DB.getMealPlan();
        if (mealPlan?.days) {
          const todayPlan = mealPlan.days.find(d => d.date === date);
          const dinner = todayPlan?.meals?.find(m => (m.meal || '').toLowerCase().includes('dinner')) || todayPlan?.meals?.[todayPlan.meals.length - 1];
          if (dinner) {
            const allMealsHtml = todayPlan.meals.map(m => {
              const ingredientsHtml = UI.renderIngredientList(m.ingredients);
              const fiberText = m.fiber ? `, ${m.fiber}g F` : '';
              const prepText = m.prep_time ? ` - ${UI.escapeHtml(m.prep_time)}` : '';
              return `
                <div style="padding:var(--space-sm) 0; border-bottom:1px solid var(--border-color);">
                  <div style="display:flex; justify-content:space-between;">
                    <span style="font-weight:500; font-size:var(--text-sm); text-transform:capitalize;">${UI.escapeHtml(m.meal || m.name)}</span>
                    <span style="font-size:var(--text-xs); color:var(--text-muted);">${m.calories} cal - ${m.protein}g P${fiberText}${prepText}</span>
                  </div>
                  <div style="font-size:var(--text-xs); color:var(--text-secondary);">${UI.escapeHtml(m.name || '')}</div>
                  ${ingredientsHtml}
                </div>
              `;
            }).join('');
            mealSuggEl.innerHTML = `
              <div class="collapsible-section" style="margin-top:var(--space-sm);">
                <div class="collapsible-header" id="meal-collapse-header">
                  <div style="display:flex; align-items:center; gap:var(--space-sm);">
                    <span style="font-weight:600;">Tonight</span>
                    <span style="font-size:var(--text-sm); color:var(--text-secondary);">${UI.escapeHtml(dinner.name)}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:var(--space-sm);">
                    <span style="font-size:var(--text-xs); color:var(--text-muted);">${dinner.calories} cal</span>
                    <span class="collapsible-chevron">&#9660;</span>
                  </div>
                </div>
                <div class="collapsible-body collapsed" id="meal-collapse-body">
                  ${allMealsHtml}
                  ${todayPlan.notes ? `<div style="font-size:var(--text-xs); color:var(--text-muted); padding-top:var(--space-sm);">${UI.escapeHtml(todayPlan.notes)}</div>` : ''}
                </div>
              </div>
            `;
            document.getElementById('meal-collapse-header')?.addEventListener('click', () => {
              const body = document.getElementById('meal-collapse-body');
              const chevron = mealSuggEl.querySelector('.collapsible-chevron');
              if (body) { body.classList.toggle('collapsed'); chevron?.classList.toggle('open'); }
            });
          } else { mealSuggEl.innerHTML = ''; }
        } else { mealSuggEl.innerHTML = ''; }
      } catch (e) { mealSuggEl.innerHTML = ''; }
    }

    // Challenge widgets on Diet panel — clean up previous renders first
    if (entryList.parentNode) {
      entryList.parentNode.querySelectorAll('.challenge-day-widget').forEach(el => el.remove());
    }
    if (!App._setupMode) {
      try {
        const activeChallenges = await DB.getActiveChallenges();
        // Fix: check status (expiry) before rendering — otherwise dead challenges linger
        const stillActive = [];
        for (const chal of activeChallenges) {
          await Challenges.checkStatus(chal, date);
          if (chal.status === 'active') stillActive.push(chal);
        }
        if (stillActive.length > 0) {
          let chalHtml = '';
          for (const chal of stillActive) {
            chalHtml += await Challenges.renderDayChecklist(chal, date);
          }
          if (chalHtml) {
            const chalContainer = UI.createElement('div', 'challenge-day-widget');
            chalContainer.innerHTML = chalHtml;
            entryList.parentNode.appendChild(chalContainer);
            Challenges.bindEvents(chalContainer);
          }
        }
      } catch (e) { console.warn('Challenge widget error:', e); }
    }

    // Update panel container height (panels use transform, which doesn't affect layout)
    App._updatePanelHeight();
  },

  async loadCoachView() {
    // Coach inbox — continuous chat history. selectedDate is no longer
    // relevant (chat tab shows last 7 days regardless of header date).
    const inboxEl = document.getElementById('coach-inbox');
    if (inboxEl) {
      try {
        const savedText = document.getElementById('coach-input')?.value || '';
        // Reset window on tab entry so we always start from the default 7-day view
        CoachChat._windowDays = CoachChat._DEFAULT_WINDOW_DAYS;
        const coachHtml = await CoachChat.render();
        inboxEl.innerHTML = coachHtml;
        CoachChat.bindEvents();
        if (savedText) { const inp = document.getElementById('coach-input'); if (inp) inp.value = savedText; }
        // Auto-scroll to the bottom (newest) on open
        const msgs = document.getElementById('coach-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      } catch (e) { console.warn('Coach render error:', e); inboxEl.innerHTML = ''; }
    }

    // Per-day "Analysis" + "Remaining Today" cards used to live on the
    // Coach tab below the chat. As of 2026-05-10 they moved to Progress >
    // Insights (per-day analysis) and Today (cal ring + macro stats).
    // The Chat tab is now ONLY chat — continuous scroll, last 7 days.
    const analysisEl = document.getElementById('coach-analysis');
    if (analysisEl) analysisEl.innerHTML = '';
  },

  _getGreeting() {
    // Use boundary-adjusted time so greeting matches the user's "day"
    const adjusted = new Date(Date.now() - UI._dayBoundaryHours * 3600000);
    const h = adjusted.getHours();
    if (h < 6) return { text: 'Burning the midnight oil', sub: 'Log a late snack or get some rest.' };
    if (h < 12) return { text: 'Good morning', sub: 'Start your day right — snap your breakfast.' };
    if (h < 14) return { text: 'Afternoon check-in', sub: 'How\'s the day going? Log your lunch.' };
    if (h < 18) return { text: 'Keep it going', sub: 'You\'re doing great. Stay on track.' };
    if (h < 22) return { text: 'Evening wind-down', sub: 'Log dinner and wrap up your day.' };
    return { text: 'Almost bedtime', sub: 'Finish logging and rest up.' };
  },

  renderEmptyDay() {
    const g = App._getGreeting();
    return `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <p style="color: var(--text-secondary); font-weight: 500; font-size: var(--text-base); margin-bottom: 4px;">${g.text}</p>
        <p>${g.sub}</p>
      </div>
    `;
  },

  setSetupMode(on) {
    App._setupMode = on;
    // Hide/show all chrome so new users only see the welcome card
    const ids = ['today-score', 'today-stats', 'quick-actions', 'today-meal-suggestion'];
    const classes = ['today-segments', 'header-nav'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? 'none' : '';
    });
    classes.forEach(cls => {
      document.querySelectorAll('.' + cls).forEach(el => {
        el.style.display = on ? 'none' : '';
      });
    });
    // Bottom nav always stays visible — users need to navigate even during setup
  },

  renderWelcomeCard() {
    // Check if sync is already configured (came via pairing link)
    const syncConfigured = localStorage.getItem('cloudRelay_backup');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS Safari

    if (syncConfigured) {

      let installHint = '';
      if (!isStandalone) {
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isChromeOnIOS = isIOS && /CriOS/.test(ua);
        const isAndroid = /Android/.test(ua);

        let steps = '';
        if (isChromeOnIOS) {
          // Chrome on iOS can't install PWAs — need Safari
          steps = 'Open this page in <strong>Safari</strong> to install as an app. Chrome on iOS doesn\'t support home screen apps.';
        } else if (isIOS) {
          steps = 'Tap the <strong>Share</strong> button (square with arrow at the bottom), then tap <strong>Add to Home Screen</strong>.';
        } else if (isAndroid) {
          steps = 'Tap the <strong>menu</strong> (three dots), then tap <strong>Install app</strong> or <strong>Add to Home Screen</strong>.';
        } else {
          steps = 'Install this as an app from your browser menu for the best experience.';
        }

        installHint = `
          <div style="background: var(--bg-secondary); border-radius: var(--radius-md); padding: var(--space-md); margin-top: var(--space-md); text-align: left;">
            <p style="font-size: var(--text-sm); font-weight: 600; margin-bottom: var(--space-xs);">Install as an app</p>
            <p style="font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5;">${steps}</p>
          </div>
        `;
      }

      return `
        <div class="card welcome-card" style="text-align:center; padding: var(--space-xl) var(--space-lg);">
          <div style="margin-bottom: var(--space-md); display:flex; justify-content:center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h2 style="font-size: var(--text-lg); font-weight: 600; margin-bottom: var(--space-xs);">You're connected</h2>
          <p style="color: var(--text-secondary); font-size: var(--text-sm); line-height: 1.6;">
            Your goals and meal plan will appear here once your computer finishes setup. This usually takes a few minutes.
          </p>
          ${installHint}
        </div>
      `;
    }

    return `
      <div class="card welcome-card" style="text-align:center; padding: var(--space-xl) var(--space-lg);">
        <div style="margin-bottom: var(--space-md); display:flex; justify-content:center;">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48">
            <circle cx="12" cy="12" r="9"/>
            <circle cx="12" cy="12" r="1.5" fill="var(--accent-primary)"/>
          </svg>
        </div>
        <h2 style="font-size: var(--text-lg); font-weight: 600; margin-bottom: var(--space-xs);">Welcome to Coach</h2>
        <p style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: var(--space-md); line-height: 1.6;">
          AI-powered health tracking. Snap food photos, log workouts, and get personalized coaching.
        </p>
        ${!isStandalone ? `
        <div style="background: var(--bg-secondary); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-lg); text-align: left;">
          <p style="font-size: var(--text-sm); font-weight: 600; margin-bottom: var(--space-xs);">Step 1: Install the app</p>
          <p style="font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5;">
            ${/iPad|iPhone|iPod/.test(navigator.userAgent)
              ? (/CriOS/.test(navigator.userAgent)
                ? 'Open this page in <strong>Safari</strong> first. Chrome on iOS can\'t install home screen apps.'
                : 'Tap the <strong>Share</strong> button (square with arrow), then <strong>Add to Home Screen</strong>.')
              : /Android/.test(navigator.userAgent)
                ? 'Tap the <strong>menu</strong> (three dots at top), then <strong>Install app</strong> or <strong>Add to Home Screen</strong>.'
                : 'Install this as an app from your browser menu for the best experience.'}
          </p>
        </div>
        <p style="font-size: var(--text-sm); font-weight: 600; margin-bottom: var(--space-xs);">Step 2: Enter your pairing code</p>
        ` : `
        <label style="display: block; font-size: var(--text-sm); font-weight: 600; margin-bottom: var(--space-sm);">Enter your pairing code</label>
        `}
        <div role="group" aria-label="Pairing code" id="pairing-inputs" style="display: flex; justify-content: center; gap: var(--space-sm); margin-bottom: var(--space-sm);">
          <input type="tel" maxlength="1" inputmode="numeric" pattern="[0-9]" class="pair-digit" data-idx="0" aria-label="Digit 1" style="width: 48px; height: 56px; text-align: center; font-size: 24px; font-weight: 600; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); border-radius: var(--radius-sm); outline: none;" />
          <input type="tel" maxlength="1" inputmode="numeric" pattern="[0-9]" class="pair-digit" data-idx="1" aria-label="Digit 2" style="width: 48px; height: 56px; text-align: center; font-size: 24px; font-weight: 600; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); border-radius: var(--radius-sm); outline: none;" />
          <input type="tel" maxlength="1" inputmode="numeric" pattern="[0-9]" class="pair-digit" data-idx="2" aria-label="Digit 3" style="width: 48px; height: 56px; text-align: center; font-size: 24px; font-weight: 600; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); border-radius: var(--radius-sm); outline: none;" />
          <input type="tel" maxlength="1" inputmode="numeric" pattern="[0-9]" class="pair-digit" data-idx="3" aria-label="Digit 4" style="width: 48px; height: 56px; text-align: center; font-size: 24px; font-weight: 600; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); border-radius: var(--radius-sm); outline: none;" />
        </div>
        <p id="pair-status" style="font-size: var(--text-sm); color: var(--text-secondary); min-height: 1.4em; margin-bottom: var(--space-md); display: none;"></p>
        <a href="#" onclick="event.preventDefault(); App.showCoachSetup();" style="font-size: var(--text-xs); color: var(--text-secondary); text-decoration: underline;">Set up manually</a>
      </div>
    `;
  },

  initPairingInputs() {
    const inputs = document.querySelectorAll('#pairing-inputs .pair-digit');
    if (!inputs.length) return;

    // Auto-focus first input
    inputs[0].focus();

    const checkComplete = () => {
      const code = Array.from(inputs).map(i => i.value).join('');
      if (code.length === 4 && /^\d{4}$/.test(code)) {
        App.redeemPairingCode(code);
      }
    };

    inputs.forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        // Keep only last digit if somehow multiple chars
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val.slice(-1);
        if (e.target.value && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
        checkComplete();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].value = '';
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        for (let i = 0; i < inputs.length; i++) {
          inputs[i].value = pasted[i] || '';
        }
        // Focus last filled or the one after
        const focusIdx = Math.min(pasted.length, inputs.length - 1);
        inputs[focusIdx].focus();
        checkComplete();
      });

      // Highlight on focus
      input.addEventListener('focus', () => {
        input.style.borderColor = 'var(--accent-primary)';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = 'var(--border)';
      });
    });
  },

  async redeemPairingCode(code, attempt) {
    attempt = attempt || 1;
    const statusEl = document.getElementById('pair-status');
    const inputs = document.querySelectorAll('#pairing-inputs .pair-digit');

    if (statusEl) {
      statusEl.textContent = attempt > 1 ? 'Retrying...' : 'Connecting...';
      statusEl.style.color = 'var(--text-secondary)';
      statusEl.style.display = '';
    }

    // Disable inputs while redeeming
    inputs.forEach(i => { i.disabled = true; });

    try {
      const pairBase = location.hostname === 'localhost' || /^(10|192\.168|100)\.\d/.test(location.hostname)
        ? location.origin : '';
      if (!pairBase) {
        throw new Error('Pairing requires the relay URL — configure Cloud Sync first.');
      }
      const resp = await fetch(`${pairBase}/pair/${code}`);
      if (resp.ok) {
        const data = await resp.json();
        if (!data.relay || !data.syncKey) {
          throw new Error('Invalid pairing response from server');
        }
        const workerUrl = /^(10|192\.168|100)\.\d/.test(location.hostname) ? location.origin : data.relay;
        await CloudRelay.saveConfig({ workerUrl, syncKey: data.syncKey });
        UI.toast('Sync connected');
        App.setSetupMode(false);
        App.loadDayView();
      } else if (resp.status === 404) {
        // Auto-retry once after 2s (R2 edge replication delay)
        if (attempt < 3) {
          if (statusEl) {
            statusEl.textContent = 'Retrying...';
            statusEl.style.display = '';
          }
          await new Promise(r => setTimeout(r, 2000));
          return App.redeemPairingCode(code, attempt + 1);
        }
        if (statusEl) {
          statusEl.textContent = 'Invalid or expired code';
          statusEl.style.color = 'var(--accent-danger, #e53e3e)';
          statusEl.style.display = '';
        }
        inputs.forEach(i => { i.disabled = false; i.value = ''; });
        inputs[0].focus();
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Connection failed';
        statusEl.style.color = 'var(--accent-danger, #e53e3e)';
        statusEl.style.display = '';
      }
      inputs.forEach(i => { i.disabled = false; });
    }
  },

  showCoachSetup() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Set Up with Coach</span>
        <button class="modal-close" id="cs-coach-close" aria-label="Close">&times;</button>
      </div>
      <div style="text-align:center; margin-bottom:var(--space-lg);">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" width="40" height="40" style="margin-bottom:var(--space-sm);">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </div>
      <p style="font-size:var(--text-sm); color:var(--text-primary); line-height:1.6; margin-bottom:var(--space-md);">
        Coach runs on your computer using Claude Code. It analyzes your food photos, generates meal plans, and gives personalized coaching.
      </p>
      <div style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom:var(--space-lg);">
        <p style="font-weight:600; margin-bottom:var(--space-sm);">How to set up:</p>
        <ol style="margin:0; padding-left:1.5em; line-height:1.8; list-style-position:outside;">
          <li style="padding-left:4px; margin-bottom:4px;">On your computer, open the <a href="welcome.html" style="color:var(--accent-primary);" target="_blank">setup page</a> and run the installer</li>
          <li style="padding-left:4px; margin-bottom:4px;">In your Coach folder, type <code style="font-size:var(--text-xs); background:var(--bg-input); padding:2px 6px; border-radius:var(--radius-sm);">claude</code> to start onboarding</li>
          <li style="padding-left:4px;">Scan the pairing QR code to connect this phone</li>
        </ol>
      </div>
      <button class="btn btn-secondary btn-block" id="cs-coach-done">I've already set up Coach</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => { overlay.remove(); App.loadDayView(); };
    document.getElementById('cs-coach-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('cs-coach-done').addEventListener('click', closeModal);
  },

  _openLogGrid() {
    const logGrid = document.getElementById('log-type-grid-inline');
    if (logGrid) {
      logGrid.style.display = 'grid';
      Log.init('log-type-grid-inline', 'log-form-content-inline');
      logGrid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  // Profile-level sync actions (called from index.html buttons)
  async syncNow() {
    const configured = await CloudRelay.isConfigured();
    if (!configured) { UI.toast('Set up Cloud Sync first', 'error'); return; }
    UI.toast('Syncing...');
    // Find all dates that need sync (no analysis or entries newer than analysis)
    const dates = await DB.getDatesNeedingSync();
    if (dates.length === 0) {
      // Nothing unprocessed — just check for results
      CloudRelay._gotResults = false;
      await CloudRelay.checkForResults();
      if (CloudRelay._gotResults) {
        App.loadDayView();
      } else {
        UI.toast('Everything is up to date');
      }
      return;
    }
    UI.toast(`Uploading ${dates.length} day(s)...`);
    for (const date of dates) {
      await CloudRelay._doUpload(date);
    }
    CloudRelay._gotResults = false;
    await CloudRelay.checkForResults();
    if (CloudRelay._gotResults) {
      App.loadDayView();
    } else {
      UI.toast(`Uploaded ${dates.length} day(s) -- processing soon`);
    }
  },

  async checkResults() {
    const configured = await CloudRelay.isConfigured();
    if (!configured) { UI.toast('Set up Cloud Sync first', 'error'); return; }
    UI.toast('Checking for results...');
    CloudRelay._gotResults = false;
    await CloudRelay.checkForResults();
    if (CloudRelay._gotResults) {
      App.loadDayView();
    } else {
      UI.toast('No new results on relay');
    }
  },

  // One-time cleanup: remove impossible weight values (> 200 lbs) that snuck in
  // When the day boundary hour changes, entries logged under the old boundary may
  // show on the wrong date. Re-derive each entry's date from its timestamp using
  // the new boundary, and update any entries that shifted. Also updates photo dates.
  async migrateEntryDatesToBoundary(newHours) {
    function boundaryDate(iso, hours) {
      const d = new Date(new Date(iso).getTime() - hours * 3600000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    let allEntries;
    try {
      allEntries = await DB.getAllEntries();
    } catch (e) {
      console.warn('[boundary migration] Could not load entries:', e);
      return;
    }

    const affectedDates = new Set();
    let migrated = 0;

    for (const entry of allEntries) {
      if (!entry.timestamp) continue;
      const newDate = boundaryDate(entry.timestamp, newHours);
      if (newDate === entry.date) continue;

      affectedDates.add(entry.date);
      affectedDates.add(newDate);

      try {
        await DB.updateEntry({ ...entry, date: newDate });
        // Update associated photo dates (relevant for body photos indexed by date)
        const photos = await DB.getPhotos(entry.id);
        for (const photo of photos) {
          if (photo.date !== newDate) {
            await DB.updatePhotoDate(photo.id, newDate);
          }
        }
        migrated++;
      } catch (e) {
        console.warn(`[boundary migration] Failed to update entry ${entry.id}:`, e);
      }
    }

    if (migrated > 0) {
      console.log(`[boundary migration] Moved ${migrated} entries to match new boundary`);
      // Re-queue affected dates so processing sees the corrected data
      for (const date of affectedDates) {
        if (typeof CloudRelay !== 'undefined') CloudRelay.queueUpload(date);
      }
    }
  },

  // as typos (e.g. 1028 instead of 102.8). Sweeps dailySummary.weightLog,
  // dailySummary.weight, and entries of type=weight. Preserves all legitimate
  // multi-weight-per-day logs (values <= 200).
  async purgeImpossibleWeightsV1() {
    const flag = await DB.getProfile('purgeImpossibleWeightsV1');
    if (flag && flag.done) return;

    const THRESHOLD = 200;
    let summariesCleaned = 0;
    let entriesDeleted = 0;

    try {
      const db = await DB.openDB();
      const tx = db.transaction(['dailySummary', 'entries'], 'readwrite');
      const sumStore = tx.objectStore('dailySummary');
      const entryStore = tx.objectStore('entries');

      // Both cursors run on the same readwrite transaction. Chain the second
      // cursor from inside the first's null-branch to avoid an intermediate
      // `await` that would let IDB auto-commit (TransactionInactiveError on
      // Safari/iOS when requests aren't kept on the same event-loop tick).
      await new Promise((resolve, reject) => {
        const sumReq = sumStore.openCursor();
        sumReq.onerror = e => reject(e.target.error);
        sumReq.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) {
            const s = cursor.value;
            let dirty = false;
            if (Array.isArray(s.weightLog)) {
              const cleaned = s.weightLog.filter(w => typeof w.value !== 'number' || w.value <= THRESHOLD);
              if (cleaned.length !== s.weightLog.length) {
                s.weightLog = cleaned;
                dirty = true;
              }
            }
            if (s.weight && typeof s.weight.value === 'number' && s.weight.value > THRESHOLD) {
              if (Array.isArray(s.weightLog) && s.weightLog.length > 0) {
                const last = s.weightLog[s.weightLog.length - 1];
                s.weight = { ...s.weight, value: last.value, unit: last.unit || s.weight.unit || 'lbs' };
              } else {
                delete s.weight;
              }
              dirty = true;
            }
            if (dirty) { cursor.update(s); summariesCleaned++; }
            cursor.continue();
            return;
          }
          // Summaries cursor done — chain entries cursor synchronously on the same tx
          const entryReq = entryStore.openCursor();
          entryReq.onerror = err => reject(err.target.error);
          entryReq.onsuccess = ev => {
            const c = ev.target.result;
            if (!c) return resolve();
            const en = c.value;
            if (en.type === 'weight' && typeof en.weight_value === 'number' && en.weight_value > THRESHOLD) {
              c.delete();
              entriesDeleted++;
            }
            c.continue();
          };
        };
      });

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
        tx.onabort = e => reject(e.target.error);
      });

      await DB.setProfile('purgeImpossibleWeightsV1', { done: true, summariesCleaned, entriesDeleted, ranAt: new Date().toISOString() });
      if (summariesCleaned || entriesDeleted) {
        console.log(`purgeImpossibleWeightsV1: cleaned ${summariesCleaned} summaries, deleted ${entriesDeleted} entries`);
      }
    } catch (err) {
      console.error('purgeImpossibleWeightsV1 failed:', err);
    }
  },

  async ensureDefaultGoals() {
    const flag = await DB.getProfile('goalsMigrationV1');
    if (flag && flag.done) return;

    const existing = await DB.getProfile('goals');
    if (!existing) {
      await DB.setProfile('goals', {
        calories: 2000, protein: 100, water_oz: 64,
        hardcore: { calories: 1500, protein: 130, water_oz: 64 },
      });
    } else {
      let changed = false;
      if (!existing.hardcore) {
        existing.hardcore = { calories: 1500, protein: 130, water_oz: 64 };
        changed = true;
      }
      if (changed) await DB.setProfile('goals', existing);
    }

    await DB.setProfile('goalsMigrationV1', { done: true, ranAt: new Date().toISOString() });
  },

  // Attempt to restore data on fresh install using localStorage relay config backup
  async attemptRestore() {
    try {
      const backup = localStorage.getItem('cloudRelay_backup');
      if (!backup) return false;

      const config = JSON.parse(backup);
      if (!config.workerUrl || !config.syncKey) return false;

      console.log('AutoRestore: found relay config backup, restoring...');
      UI.toast('Restoring your data...');

      await DB.setProfile('cloudRelay', config);

      let resultCount = 0;
      const isValidDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);

      // Pull pending analysis results — verify before acking
      const baseUrl = `${config.workerUrl.trim()}/sync/${config.syncKey.trim()}`;
      const verifiedDates = [];
      try {
        const resp = await fetch(`${baseUrl}/results/new`);
        if (resp.ok) {
          const { newResults } = await resp.json();
          for (const date of (newResults || []).filter(isValidDate)) {
            try {
              const r = await fetch(`${baseUrl}/results/${date}`);
              if (r.ok) {
                const analysis = JSON.parse(await r.text());
                await DB.importAnalysis(date, analysis);
                // Verify import persisted
                const stored = await DB.getAnalysis(date);
                if (stored && stored.importedAt) {
                  verifiedDates.push(date);
                  resultCount++;
                } else {
                  console.warn(`AutoRestore: import verification failed for ${date}`);
                }
              }
            } catch (e) { console.warn(`AutoRestore: result ${date}:`, e); }
          }
          // Ack only verified imports
          for (const date of verifiedDates) {
            try {
              await fetch(`${baseUrl}/results/${date}/ack`, { method: 'POST' });
            } catch (e) { /* ack failure is safe — relay keeps it for retry */ }
          }
        }
      } catch (e) { console.warn('AutoRestore: results check failed:', e); }

      // Download ALL day ZIPs from relay (full sync — covers pending + already-processed dates)
      try {
        const datesResp = await fetch(`${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/dates`);
        if (datesResp.ok) {
          const { dates } = await datesResp.json();
          for (const date of (dates || []).filter(isValidDate)) {
            try {
              const r = await fetch(`${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/day/${date}`);
              if (r.ok) {
                await Sync.restoreFromZipData(new Uint8Array(await r.arrayBuffer()));
                resultCount++;
              }
            } catch (e) { console.warn(`AutoRestore: day ${date}:`, e); }
          }
        } else {
          // Fallback to pending-only if /dates endpoint not yet deployed
          const resp = await fetch(`${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/pending`);
          if (resp.ok) {
            const { pending } = await resp.json();
            for (const date of (pending || []).filter(isValidDate)) {
              try {
                const r = await fetch(`${config.workerUrl.trim()}/sync/${config.syncKey.trim()}/day/${date}`);
                if (r.ok) {
                  await Sync.restoreFromZipData(new Uint8Array(await r.arrayBuffer()));
                  resultCount++;
                }
              } catch (e) { console.warn(`AutoRestore: day ${date}:`, e); }
            }
          }
        }
      } catch (e) { console.warn('AutoRestore: full sync failed:', e); }

      await App.ensureDefaultGoals();
      UI.toast(resultCount > 0 ? 'Data restored!' : 'Sync reconnected');
      return true;
    } catch (e) {
      console.warn('AutoRestore: failed:', e);
      return false;
    }
  },

  async showGoalSetup() {
    const overlay = UI.createElement('div', 'modal-overlay');

    // Load existing goals
    const goals = await DB.getProfile('goals') || {};
    const resolved = Goals.resolve(goals);
    const hc = goals.hardcore || {};

    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Set Your Goals</span>
        <button class="modal-close" id="gs-close" aria-label="Close">&times;</button>
      </div>
      <div style="font-size:var(--text-xs); color:var(--text-muted); margin-bottom:var(--space-md);">Great = active plan. Crush It = stretch target shown for reference.</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-sm);">
        <div class="form-group">
          <label class="form-label">Calories (great)</label>
          <input type="number" class="form-input" id="gs-calories" value="${resolved.calories || ''}" placeholder="2000" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Calories (crush it)</label>
          <input type="number" class="form-input" id="gs-hc-calories" value="${Number(hc.calories) || ''}" placeholder="1500" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Protein (great)</label>
          <input type="number" class="form-input" id="gs-protein" value="${resolved.protein || ''}" placeholder="100" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Protein (crush it)</label>
          <input type="number" class="form-input" id="gs-hc-protein" value="${Number(hc.protein) || ''}" placeholder="130" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Fiber (great)</label>
          <input type="number" class="form-input" id="gs-fiber" value="${resolved.fiber || ''}" placeholder="25" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="form-label">Fiber (crush it)</label>
          <input type="number" class="form-input" id="gs-hc-fiber" value="${Number(hc.fiber) || ''}" placeholder="25" inputmode="numeric">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Water Goal (oz)</label>
        <input type="number" class="form-input" id="gs-water" value="${resolved.water_oz || ''}" placeholder="64" inputmode="numeric">
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
      const fiber = parseInt(document.getElementById('gs-fiber')?.value) || null;
      const water_oz = parseInt(document.getElementById('gs-water')?.value) || null;
      const hcCalories = parseInt(document.getElementById('gs-hc-calories')?.value) || null;
      const hcProtein = parseInt(document.getElementById('gs-hc-protein')?.value) || null;
      const hcFiber = parseInt(document.getElementById('gs-hc-fiber')?.value) || null;

      // Build delta of fields the user actually changed (not blank-out values).
      // Source of truth for goals is {DATA_DIR}/profile/goals.json on the processing
      // machine — this delta is shipped to the cron via profile/goal-updates.json on
      // the next upload. The cron applies, merges, and echoes the canonical shape
      // back via pwaProfile.goals; importAnalysis overwrites the local cache.
      const existing = (await DB.getProfile('goals')) || {};
      const existingResolved = Goals.resolve(existing);
      const delta = {};
      if (calories != null && calories !== existingResolved.calories) delta.calories = calories;
      if (protein != null && protein !== existingResolved.protein) delta.protein = protein;
      if (fiber != null && fiber !== existingResolved.fiber) delta.fiber = fiber;
      if (water_oz != null && water_oz !== existingResolved.water_oz) delta.water_oz = water_oz;
      const hcDelta = {};
      const ehc = existing.hardcore || {};
      if (hcCalories != null && hcCalories !== ehc.calories) hcDelta.calories = hcCalories;
      if (hcProtein != null && hcProtein !== ehc.protein) hcDelta.protein = hcProtein;
      if (hcFiber != null && hcFiber !== ehc.fiber) hcDelta.fiber = hcFiber;
      if (water_oz != null && water_oz !== ehc.water_oz) hcDelta.water_oz = water_oz;
      if (Object.keys(hcDelta).length > 0) delta.hardcore = hcDelta;

      // Optimistic local update preserving existing schema shape.
      const isNested = existing.calories != null && typeof existing.calories === 'object';
      let newGoals;
      if (isNested) {
        newGoals = { ...existing };
        if (calories != null) newGoals.calories = { ...(existing.calories || {}), daily: calories };
        if (protein != null) newGoals.protein = { ...(typeof existing.protein === 'object' && existing.protein ? existing.protein : {}), target: protein };
        if (fiber != null) newGoals.fiber = { ...(typeof existing.fiber === 'object' && existing.fiber ? existing.fiber : {}), daily_g: fiber };
        if (water_oz != null) newGoals.water = { ...(typeof existing.water === 'object' && existing.water ? existing.water : {}), daily_oz: water_oz };
        newGoals.hardcore = { ...(existing.hardcore || {}), calories: hcCalories, protein: hcProtein, fiber: hcFiber };
      } else {
        newGoals = {
          ...existing,
          calories, protein, fiber, water_oz,
          hardcore: { calories: hcCalories, protein: hcProtein, fiber: hcFiber, water_oz },
        };
      }
      await DB.setProfileOwned('goals', newGoals, 'cron-via-delta');

      // Queue delta for cron-side reconciliation (cron is the canonical writer).
      if (Object.keys(delta).length > 0) {
        await DB.queueGoalUpdate(delta, 'phone-settings');
        // Trigger a sync so the cron sees the delta within ~30 min.
        if (typeof CloudRelay !== 'undefined' && CloudRelay.queueUpload) {
          CloudRelay.queueUpload(UI.today());
        }
      }
      UI.toast('Goals saved — syncing to coach');

      // Always refresh the settings summary
      Settings.loadGoalsSummary();

      // If first-run (no sync configured), offer Cloud Sync setup
      const syncConfigured = await CloudRelay.isConfigured();
      if (!syncConfigured) {
        App._showSyncSetupStep(overlay);
      } else {
        overlay.remove();
        if (App.currentScreen === 'today') App.loadDayView();
      }
    });
  },

  _showSyncSetupStep(overlay) {
    const sheet = overlay.querySelector('.modal-sheet');
    if (!sheet) { overlay.remove(); App.loadDayView(); return; }

    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Cloud Sync</span>
        <button class="modal-close" id="gs-sync-close" aria-label="Close">&times;</button>
      </div>
      <div style="text-align:center; margin-bottom:var(--space-md);">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" width="40" height="40" style="margin-bottom:var(--space-sm);">
          <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
        </svg>
        <p style="font-size:var(--text-sm); color:var(--text-secondary); line-height:1.6;">
          Cloud Sync enables AI-powered photo analysis, meal plans, and coach responses.<br>
          You can set this up later in Settings &gt; Cloud Sync.
        </p>
      </div>
      <div class="form-group">
        <label class="form-label">Worker URL</label>
        <input type="url" class="form-input" id="gs-sync-url" placeholder="https://your-worker.workers.dev">
      </div>
      <div class="form-group">
        <label class="form-label">Sync Key</label>
        <input type="text" class="form-input" id="gs-sync-key" placeholder="UUID (e.g. from crypto.randomUUID())">
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="gs-sync-save">Connect</button>
      <button class="btn btn-ghost btn-block" id="gs-sync-skip" style="margin-top:var(--space-sm);">Skip for now</button>
    `;

    const closeAndLoad = () => { overlay.remove(); App.loadDayView(); };
    document.getElementById('gs-sync-close').addEventListener('click', closeAndLoad);
    document.getElementById('gs-sync-skip').addEventListener('click', closeAndLoad);

    document.getElementById('gs-sync-save').addEventListener('click', async () => {
      const url = document.getElementById('gs-sync-url')?.value?.trim();
      const key = document.getElementById('gs-sync-key')?.value?.trim();
      if (!url || !key) {
        UI.toast('Enter both URL and key', 'error');
        return;
      }
      await DB.setProfile('cloudRelay', { workerUrl: url, syncKey: key });
      localStorage.setItem('cloudRelay_backup', JSON.stringify({ workerUrl: url, syncKey: key }));
      UI.toast('Cloud Sync configured!');
      closeAndLoad();
    });
  },

  // preloaded is optional: { regimen, analysis } — avoids redundant DB reads when
  // the caller already holds these values.
  async renderDayStats(summary, entries, date, preloaded) {
    const statsEl = document.getElementById('today-stats');
    if (!statsEl) return;

    let foodCount = entries.filter(e => ['meal', 'snack', 'drink', 'food'].includes(e.type)).length;
    let waterOz = summary.water_oz || 0;
    let weightVal = summary.weight ? summary.weight.value : null;
    let weightUnit = summary.weight ? summary.weight.unit : '';

    // Workout progress from regimen + checked exercises
    let workoutDone = 0;
    let workoutTotal = 0;
    let workoutLabel = 'Workout';
    try {
      const regimen = preloaded?.regimen ?? await DB.getRegimen();
      const schedule = regimen ? (Fitness._normalizeSchedule
        ? Fitness._normalizeSchedule(regimen)
        : (regimen.weeklySchedule || [])) : [];
      if (schedule.length > 0) {
        const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const todayPlan = schedule.find(d => d.day === dayName);
        const isRest = !todayPlan || todayPlan.type === 'rest' || todayPlan.type === 'active_rest' || todayPlan.type === 'active_recovery';
        if (isRest) {
          workoutLabel = 'Rest Day';
        } else {
          const checked = await Fitness.getCheckedExercises(date);
          const exercises = Fitness.getExerciseList(todayPlan);
          workoutTotal = exercises.length;
          workoutDone = exercises.filter(e => checked.has(e.name)).length;
        }
      }
    } catch (e) { /* no regimen */ }

    // Calorie ring data — from analysis + goals
    let calEaten = null;
    let calTarget = null;
    const analysis = preloaded?.analysis ?? await DB.getAnalysis(date);
    const goals = preloaded?.goals ?? (await DB.getProfile('goals') || {});
    calTarget = goals.calories != null ? Goals.resolve(goals).calories : null;
    if (analysis?.totals?.calories != null) {
      calEaten = analysis.totals.calories;
    }

    // Fall back to analysis data when entries are empty (e.g. after reinstall)
    if (entries.length === 0 && date) {
      if (analysis) {
        const aEntries = analysis.entries || [];
        foodCount = aEntries.filter(e => ['meal', 'snack', 'drink', 'food'].includes(e.type)).length;
        waterOz = analysis.water_oz || waterOz;
        if (analysis.weight) { weightVal = analysis.weight.value || analysis.weight; weightUnit = analysis.weight.unit || 'lbs'; }
      }
    }

    // Build calorie ring SVG
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    let ringHtml;
    if (calEaten != null) {
      const displayCal = Math.round(calEaten);
      if (calTarget) {
        const ratio = Math.max(0, Math.min(calEaten / calTarget, 1));
        const offset = circumference - ratio * circumference;
        const over = calEaten > calTarget;
        const ringColor = over ? 'var(--accent-red)' : 'var(--accent-green)';
        ringHtml = `
        <div class="stat-card stat-card--tap calorie-ring-card" data-stat-action="food">
          <div class="calorie-ring-wrap">
            <svg viewBox="0 0 44 44" class="calorie-ring-svg">
              <circle cx="22" cy="22" r="${radius}" fill="none" stroke="var(--border-color)" stroke-width="3"/>
              <circle cx="22" cy="22" r="${radius}" fill="none" stroke="${ringColor}" stroke-width="3"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                stroke-linecap="round" transform="rotate(-90 22 22)"
                class="calorie-ring-fill"/>
            </svg>
            <div class="calorie-ring-center" style="color:${ringColor}">${displayCal}</div>
          </div>
          <div class="stat-label">of ${calTarget} cal</div>
        </div>`;
      } else {
        // No target set — show calories eaten with full green ring, no target label
        ringHtml = `
        <div class="stat-card stat-card--tap calorie-ring-card" data-stat-action="food">
          <div class="calorie-ring-wrap">
            <svg viewBox="0 0 44 44" class="calorie-ring-svg">
              <circle cx="22" cy="22" r="${radius}" fill="none" stroke="var(--accent-green)" stroke-width="3"/>
            </svg>
            <div class="calorie-ring-center" style="color:var(--accent-green)">${displayCal}</div>
          </div>
          <div class="stat-label">cal today</div>
        </div>`;
      }
    } else {
      // No analysis yet — show food count fallback
      ringHtml = `
      <div class="stat-card stat-card--tap calorie-ring-card" data-stat-action="food">
        <div class="calorie-ring-wrap">
          <svg viewBox="0 0 44 44" class="calorie-ring-svg">
            <circle cx="22" cy="22" r="${radius}" fill="none" stroke="var(--border-color)" stroke-width="3" stroke-dasharray="3 5"/>
          </svg>
          <div class="calorie-ring-center" style="color:var(--text-muted)">--</div>
        </div>
        <div class="stat-label">${foodCount} food logged</div>
      </div>`;
    }

    const zc = (val) => val === 0 || val === null ? ' stat-value--zero' : '';
    const workoutDisplay = workoutTotal > 0 ? `${workoutDone}/${workoutTotal}` : (workoutLabel === 'Rest Day' ? 'Rest' : '--');
    const workoutZero = workoutTotal === 0 && workoutLabel !== 'Rest Day';
    statsEl.innerHTML = `
      <div class="stat-card stat-card--tap" data-stat-action="water">
        <div class="stat-value${zc(waterOz)}" style="color: var(--color-water)">${waterOz}<span class="unit" style="font-size: var(--text-sm); font-weight: 400; color: var(--text-secondary)"> oz</span></div>
        <div class="stat-label">Water</div>
      </div>
      ${ringHtml}
      <div class="stat-card stat-card--tap" data-stat-action="workout">
        <div class="stat-value${workoutZero ? ' stat-value--zero' : ''}" style="color: var(--color-workout)">${workoutDisplay}</div>
        <div class="stat-label">${UI.escapeHtml(workoutLabel)}</div>
      </div>
      <div class="stat-card stat-card--tap" data-stat-action="weight">
        <div class="stat-value${zc(weightVal)}" style="color: var(--color-weight)">${weightVal || '--'}<span class="unit" style="font-size: var(--text-sm); font-weight: 400; color: var(--text-secondary)"> ${weightVal ? weightUnit : ''}</span></div>
        <div class="stat-label">Weight</div>
      </div>
    `;

    // Async: fetch health data from relay (non-blocking, updates after render)
    CloudRelay.getHealthData(date).then(health => {
      if (!health) return;
      const metrics = [];
      if (health.steps != null) {
        metrics.push({ value: Number(health.steps).toLocaleString(), label: 'Steps', color: 'var(--accent-primary)' });
      }
      if (health.distance_mi != null) {
        metrics.push({ value: Number(health.distance_mi).toFixed(1), label: 'Miles', color: 'var(--accent-secondary, var(--accent-primary))' });
      } else if (health.distance_km != null) {
        metrics.push({ value: Number(health.distance_km).toFixed(1), label: 'km', color: 'var(--accent-secondary, var(--accent-primary))' });
      }
      if (health.flights != null) {
        metrics.push({ value: Number(health.flights).toLocaleString(), label: 'Flights', color: 'var(--accent-secondary, var(--accent-primary))' });
      }
      if (health.activeCalories != null) {
        metrics.push({ value: Number(health.activeCalories).toLocaleString(), label: 'Active Cal', color: 'var(--accent-secondary, var(--accent-primary))' });
      }
      for (const m of metrics) {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
          <div class="stat-value" style="color: ${m.color}">${m.value}</div>
          <div class="stat-label">${m.label}</div>
        `;
        statsEl.appendChild(card);
      }
    }).catch(() => {});

    // Make stat cards tappable
    statsEl.querySelectorAll('[data-stat-action]').forEach(card => {
      card.addEventListener('click', async () => {
        const action = card.dataset.statAction;
        if (action === 'water') QuickLog.showWaterPicker();
        else if (action === 'food') QuickLog.snapFood();
        else if (action === 'weight') {
          // If a weight entry exists for this day, open edit modal instead of new entry
          const dayEntries = await DB.getEntriesByDate(App.selectedDate);
          const weightEntry = dayEntries.find(e => e.type === 'weight');
          if (weightEntry) {
            UI.showEditModal(weightEntry);
          } else {
            QuickLog.showWeightEntry();
          }
        }
        else if (action === 'workout') {
          const el = document.getElementById('today-workout');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  },
};

// Settings helper
const Settings = {
  async loadGoalsSummary() {
    const el = document.getElementById('goals-summary');
    if (!el) return;
    const goals = await DB.getProfile('goals');
    if (goals) {
      const r = Goals.resolve(goals);
      const parts = [];
      if (r.calories) parts.push(`${r.calories} cal`);
      if (r.protein) parts.push(`${r.protein}g protein`);
      if (r.fiber) parts.push(`${r.fiber}g fiber`);
      if (r.water_oz) parts.push(`${r.water_oz} oz water`);
      el.textContent = parts.join(' \u00B7 ') || 'Not set';
    } else {
      el.textContent = 'Not set \u2014 tap Edit to configure';
    }
  },

  async loadStorageInfo() {
    const el = document.getElementById('storage-info');
    if (!el) return;

    const info = await Sync.getStorageInfo();
    const parts = [];
    if (info.unsynced > 0) parts.push(`${info.unsynced} unsynced`);
    if (info.synced > 0) parts.push(`${info.synced} synced`);
    if (info.processed > 0) parts.push(`${info.processed} processed`);

    const clearBtn = document.getElementById('clear-photos-btn');
    if (parts.length === 0) {
      el.textContent = 'No photos stored.';
      if (clearBtn) clearBtn.style.display = 'none';
    } else {
      el.textContent = `${parts.join(', ')} — ${info.totalSizeMB} MB total`;
      if (clearBtn) clearBtn.style.display = '';
    }
  },

  async clearPhotos() {
    if (!confirm('Delete all processed meal photos? Body photos are kept.')) return;
    await Sync.clearProcessedPhotos();
    Settings.loadStorageInfo();
    // Offer to clear from relay too
    const configured = await CloudRelay.isConfigured();
    if (configured && confirm('Also delete photos from the cloud relay?')) {
      await CloudRelay.deleteAllFromRelay();
    }
  },

  async loadWeightUnit() {
    const select = document.getElementById('weight-unit-select');
    if (!select) return;
    const prefs = await DB.getProfile('preferences') || {};
    select.value = prefs.weightUnit || 'lbs';
    if (!select._weightUnitBound) {
      select._weightUnitBound = true;
      select.addEventListener('change', async () => {
        const unit = select.value;
        const fresh = await DB.getProfile('preferences') || {};
        fresh.weightUnit = unit;
        await DB.setProfile('preferences', fresh);
        UI.toast(`Weight unit set to ${unit}`);
      });
    }
  },

  async loadDayBoundary() {
    const select = document.getElementById('day-boundary-select');
    if (!select) return;
    const prefs = await DB.getProfile('preferences') || {};
    select.value = String(prefs.dayBoundaryHour ?? 4);
    // Prevent stacking listeners on repeated Settings visits
    if (!select._boundaryBound) {
      select._boundaryBound = true;
      select.addEventListener('change', async () => {
        const hour = parseInt(select.value) || 0;
        const fresh = await DB.getProfile('preferences') || {};
        const oldHour = fresh.dayBoundaryHour ?? 4;
        fresh.dayBoundaryHour = hour;
        await DB.setProfile('preferences', fresh);
        UI._dayBoundaryHours = hour;
        // Re-derive selected date and refresh view
        App.selectedDate = UI.today();
        App.updateHeaderDate();
        UI.toast(`Day starts at ${hour === 0 ? 'midnight' : hour + ' AM'}`);
        // Retroactively reassign entries whose timestamps fall on a different date
        // under the new boundary (e.g. 1 AM entry shifts from Apr 6 → Apr 5 when
        // boundary moves from midnight to 6 AM).
        if (hour !== oldHour) {
          App.migrateEntryDatesToBoundary(hour).then(() => {
            App.loadDayView();
          }).catch(err => console.warn('[boundary migration] Error:', err));
        }
      });
    }
  },

  async loadOptionalTracking() {
    const periodToggle = document.getElementById('toggle-track-period');
    const bmToggle = document.getElementById('toggle-track-bm');
    if (!periodToggle && !bmToggle) return;

    const prefs = await DB.getProfile('preferences') || {};
    if (periodToggle) periodToggle.checked = !!prefs.trackPeriod;
    if (bmToggle) bmToggle.checked = !!prefs.trackBM;

    const wire = (el, key, label) => {
      if (!el || el._optBound) return;
      el._optBound = true;
      el.addEventListener('change', async () => {
        const fresh = await DB.getProfile('preferences') || {};
        fresh[key] = !!el.checked;
        await DB.setProfile('preferences', fresh);
        UI.toast(`${label} ${el.checked ? 'on' : 'off'}`);
        // Refresh Today view so More-grid + log type-grid pick up the change
        if (typeof App !== 'undefined' && App.loadDayView) App.loadDayView();
      });
    };
    wire(periodToggle, 'trackPeriod', 'Period tracking');
    wire(bmToggle, 'trackBM', 'BM tracking');
  },

  async loadCloudSyncStatus() {
    const el = document.getElementById('cloud-sync-status');
    if (!el) return;
    const configured = await CloudRelay.isConfigured();
    if (!configured) {
      el.textContent = 'Not configured';
      return;
    }
    // Show last analysis date for processing status
    try {
      const today = UI.today();
      const analyses = await DB.getAnalysisRange('2020-01-01', today);
      if (analyses.length > 0) {
        const latest = analyses[analyses.length - 1];
        el.textContent = `Connected — last analysis: ${UI.formatDate(latest.date)}`;
      } else {
        el.textContent = 'Connected — no analysis received yet';
      }
    } catch {
      el.textContent = 'Connected — syncing automatically';
    }
  },

  async loadVersion() {
    const el = document.getElementById('app-version');
    if (!el) return;
    try {
      const keys = await caches.keys();
      const current = keys.find(k => k.startsWith('coach-v'));
      if (current) {
        el.textContent = current.replace('coach-', '');
      }
      // If no cache found (e.g. mid-update), leave the element empty — don't show stale version
    } catch { /* leave empty */ }
  },

  async clearCoachHistory() {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Clear Coach Chat History</span>
        <button class="modal-close" id="cch-close" aria-label="Close">&times;</button>
      </div>
      <p style="font-size:var(--text-sm);color:var(--text-primary);margin-bottom:var(--space-sm);">
        Permanently delete all coach conversations stored on this device.
      </p>
      <ul style="font-size:var(--text-xs);color:var(--text-secondary);margin:0 0 var(--space-md) var(--space-md);padding:0;line-height:1.8;">
        <li>All messages you sent to your coach</li>
        <li>All coach replies and proactive advice</li>
        <li>All setting-update notifications</li>
      </ul>
      <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--space-md);">
        Health entries, photos, goals, and analysis summaries are not affected.
        Cloud copies of messages embedded in sync ZIPs are not deleted.
      </p>
      <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);">
        <button class="btn btn-secondary btn-block" id="cch-cancel">Cancel</button>
        <button class="btn btn-danger btn-block" id="cch-confirm">Clear History</button>
      </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    document.getElementById('cch-close').addEventListener('click', closeModal);
    document.getElementById('cch-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('cch-confirm').addEventListener('click', async () => {
      const btn = document.getElementById('cch-confirm');
      btn.disabled = true;
      btn.textContent = 'Clearing...';

      try {
        await DB.clearCoachHistory();
        overlay.remove();
        UI.toast('Coach chat history cleared');
        // Refresh coach tab if it is currently visible
        const coachContainer = document.getElementById('coach-inbox');
        if (coachContainer) {
          coachContainer.innerHTML = await CoachChat.render(App.selectedDate);
          CoachChat.bindEvents(App.selectedDate);
        }
      } catch (err) {
        console.error('Clear coach history failed:', err);
        UI.toast('Clear failed — try again', 'error');
        btn.disabled = false;
        btn.textContent = 'Clear History';
      }
    });
  },

  async deleteAllData() {
    // Step 1: show confirmation modal with DELETE typed confirmation
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');
    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title" style="color:var(--color-danger,#f85149);">Delete All Data</span>
        <button class="modal-close" id="dad-close" aria-label="Close">&times;</button>
      </div>
      <p style="font-size:var(--text-sm);color:var(--text-primary);margin-bottom:var(--space-sm);">
        This will permanently delete <strong>everything</strong> stored on this device:
      </p>
      <ul style="font-size:var(--text-xs);color:var(--text-secondary);margin:0 0 var(--space-md) var(--space-md);padding:0;line-height:1.8;">
        <li>All food, workout, and supplement entries</li>
        <li>All photos (meal and body progress)</li>
        <li>Analysis, meal plans, and coach data</li>
        <li>Goals, profile, and sync configuration</li>
        <li>Service worker caches</li>
      </ul>
      <div style="display:flex; align-items:center; gap:var(--space-sm); margin-bottom:var(--space-md); font-size:var(--text-xs); color:var(--text-muted);">
        <label class="s-toggle" style="flex-shrink:0;">
          <input type="checkbox" id="dad-relay-too">
          <span class="s-toggle-track"></span>
        </label>
        <span>Also delete data from cloud relay (otherwise you can re-sync later)</span>
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md);">
        <label class="form-label" style="color:var(--color-danger,#f85149);">Type DELETE to confirm</label>
        <input type="text" class="form-input" id="dad-confirm-input" placeholder="DELETE" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <button class="btn btn-danger btn-block btn-lg" id="dad-confirm-btn" disabled style="opacity:0.4;cursor:not-allowed;">Delete All Data</button>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    document.getElementById('dad-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    const confirmInput = document.getElementById('dad-confirm-input');
    const confirmBtn = document.getElementById('dad-confirm-btn');

    confirmInput.addEventListener('input', () => {
      const ready = confirmInput.value === 'DELETE';
      confirmBtn.disabled = !ready;
      confirmBtn.style.opacity = ready ? '1' : '0.4';
      confirmBtn.style.cursor = ready ? '' : 'not-allowed';
    });

    confirmBtn.addEventListener('click', async () => {
      if (confirmInput.value !== 'DELETE') return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting...';

      try {
        // 1. Clear all IndexedDB stores, then delete the database entirely
        const db = await DB.openDB();
        const storeNames = Array.from(db.objectStoreNames);
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeNames, 'readwrite');
          storeNames.forEach(name => tx.objectStore(name).clear());
          tx.oncomplete = resolve;
          tx.onerror = (e) => reject(e.target.error);
        });
        db.close();
        await new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('health-tracker');
          req.onsuccess = resolve;
          req.onerror = resolve; // best-effort
          req.onblocked = resolve;
        });

        // 2. Delete from relay if checkbox was checked
        const deleteRelay = document.getElementById('dad-relay-too')?.checked;
        if (deleteRelay) {
          try { await CloudRelay.deleteAllFromRelay(); } catch (e) { console.warn('Relay delete failed:', e); }
        }

        // 3. Clear localStorage (relay config and anything else)
        localStorage.clear();

        // 3. Clear all service worker caches
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        } catch { /* ignore if caches API unavailable */ }

        overlay.remove();
        UI.toast('All data deleted');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        console.error('Delete all data failed:', err);
        UI.toast('Delete failed — try again', 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete All Data';
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = '';
      }
    });
  },

  _updateBound: false,
  initUpdateButton() {
    if (Settings._updateBound) return;
    Settings._updateBound = true;
    document.getElementById('update-app-btn')?.addEventListener('click', async () => {
      // Clear version text immediately to prevent stale version flash on reload
      const versionEl = document.getElementById('app-version');
      if (versionEl) versionEl.textContent = '';
      UI.toast('Updating...');
      try {
        // Clear all SW caches
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        // Unregister SW so it re-installs fresh
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        // Reload the page
        window.location.reload();
      } catch (err) {
        console.error('Update failed:', err);
        UI.toast('Update failed — try reloading manually', 'error');
      }
    });
  },
};

// --- Period Tracker ---
const Period = {
  async getState() {
    return await DB.getProfile('period') || { active: false, startDate: null, history: [] };
  },

  async start() {
    const state = await Period.getState();
    if (state.active) {
      UI.toast('Period already tracking');
      return;
    }
    const date = App.selectedDate;
    state.active = true;
    state.startDate = date;
    await DB.setProfile('period', state);
    UI.toast('Period started');
    CloudRelay.queueUpload(date);
    App.loadDayView();
  },

  async end() {
    const state = await Period.getState();
    if (!state.active) return;
    const today = App.selectedDate;
    state.history = state.history || [];
    state.history.push({ start: state.startDate, end: today });
    state.active = false;
    state.startDate = null;
    await DB.setProfile('period', state);
    UI.toast('Period ended');
    CloudRelay.queueUpload(today);
    App.loadDayView();
  },

  // Check if a given date falls within any period (active or historical)
  // Returns { startDate, dayNum, canEnd } or null
  getPeriodOnDate(state, dateStr) {
    // Check active period
    if (state.active && state.startDate && dateStr >= state.startDate) {
      const dayNum = Math.floor((new Date(dateStr + 'T12:00:00') - new Date(state.startDate + 'T12:00:00')) / 86400000) + 1;
      return { startDate: state.startDate, dayNum, canEnd: true };
    }
    // Check history
    if (state.history) {
      for (const p of state.history) {
        if (dateStr >= p.start && dateStr <= p.end) {
          const dayNum = Math.floor((new Date(dateStr + 'T12:00:00') - new Date(p.start + 'T12:00:00')) / 86400000) + 1;
          return { startDate: p.start, dayNum, canEnd: false };
        }
      }
    }
    return null;
  },

  // Render a period banner card in the entry list if period covers this date
  async renderBanner(date, entryList) {
    const state = await Period.getState();
    const info = Period.getPeriodOnDate(state, date);
    if (!info) return;

    const dayNum = info.dayNum;
    const isToday = date === UI.today() && info.canEnd;

    const banner = UI.createElement('div', 'entry-item');
    banner.style.borderLeftColor = 'var(--color-period)';
    banner.innerHTML = `
      <div class="entry-icon" style="color: var(--color-period);">${UI.svg.period}</div>
      <div class="entry-body">
        <div class="entry-type" style="color: var(--color-period);">Period</div>
        <div class="entry-notes">Day ${dayNum}${dayNum === 1 ? ' — started' : ''}</div>
      </div>
      ${isToday ? `<button class="btn btn-ghost period-end-btn" style="font-size: var(--text-xs); color: var(--color-period); white-space: nowrap;">Mark ended</button>` : ''}
    `;

    // Insert at the top of the entry list
    entryList.insertBefore(banner, entryList.firstChild);

    // Bind end button
    banner.querySelector('.period-end-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      Period.end();
    });
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
