// log.js — Entry logging UI

const Log = {
  selectedType: null,
  selectedSubtype: null,
  pendingPhotos: [], // [{ blob, url, takenAt }] from Camera

  // Container IDs (can be overridden for inline mode)
  _gridId: 'log-type-grid',
  _formId: 'log-form',
  _formContentId: 'log-form-content',

  init(gridId, formContentId) {
    Log.selectedType = null;
    Log.selectedSubtype = null;
    Log.clearPendingPhotos();
    if (gridId) {
      Log._gridId = gridId;
      Log._formId = null; // inline mode has no wrapper
      Log._formContentId = formContentId || gridId;
    } else {
      Log._gridId = 'log-type-grid';
      Log._formId = 'log-form';
      Log._formContentId = 'log-form-content';
    }
    Log.renderTypeSelector();
    Log.hideForm();
  },

  clearPendingPhotos() {
    for (const p of Log.pendingPhotos) {
      Camera.revokeURL(p.url);
    }
    Log.pendingPhotos = [];
  },

  // --- Type Selection ---
  async renderTypeSelector() {
    const grid = document.getElementById(Log._gridId);
    if (!grid) return;

    const types = [
      { type: 'meal', icon: UI.svg.meal, label: 'Food', color: 'var(--color-meal)' },
      { type: 'workout', icon: UI.svg.workout, label: 'Workout', color: 'var(--color-workout)' },
      { type: 'water', icon: UI.svg.water, label: 'Water', color: 'var(--color-water)' },
      { type: 'custom', icon: UI.svg.custom, label: 'Alcohol', color: 'var(--accent-red)' },
      { type: 'weight', icon: UI.svg.weight, label: 'Weight', color: 'var(--color-weight)' },
      { type: 'bodyPhoto', icon: UI.svg.bodyPhoto, label: 'Body Photo', color: 'var(--color-body-photo)' },
    ];

    // Optional tracking — gated on Settings toggles
    const prefs = await DB.getProfile('preferences') || {};
    if (prefs.trackBM) {
      types.push({ type: 'bm', icon: UI.svg.bm, label: 'BM', color: 'var(--color-bm)' });
    }

    grid.innerHTML = types.map(t => `
      <button class="type-btn" data-type="${t.type}" style="--type-color: ${t.color}">
        <span class="type-icon">${t.icon}</span>
        <span class="type-label">${t.label}</span>
      </button>
    `).join('');

    grid.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        Log.selectType(type);
      });
    });
  },

  selectType(type) {
    Log.selectedType = type;
    Log.selectedSubtype = null;
    Log.clearPendingPhotos();
    // Also clear body photo previews
    if (Log._pendingBodyPhotos && typeof Log._pendingBodyPhotos === 'object') {
      for (const photos of Object.values(Log._pendingBodyPhotos)) {
        if (Array.isArray(photos)) photos.forEach(p => Camera.revokeURL(p.url));
      }
    }
    Log._pendingBodyPhotos = {};

    // Highlight selected
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === type);
    });

    Log.showForm(type);
  },

  // --- Form Rendering ---
  showForm(type) {
    // In inline mode (_formId is null), show the form content container directly
    if (Log._formId) {
      const form = document.getElementById(Log._formId);
      if (!form) return;
      form.style.display = 'block';
    } else {
      // Inline mode: show the inline form wrapper
      const inlineForm = document.getElementById('log-form-inline');
      if (inlineForm) inlineForm.style.display = 'block';
    }

    const formContent = document.getElementById(Log._formContentId);
    if (!formContent) return;
    UI.clearChildren(formContent);

    // Water and weight use the same modals as quick actions (no duplicate forms)
    if (type === 'water') { Log.hideForm(); QuickLog.showWaterPicker(); return; }
    if (type === 'weight') { Log.hideForm(); QuickLog.showWeightEntry(); return; }
    // BM is a one-tap log — no form, just save immediately
    if (type === 'bm') { Log.hideForm(); Log.saveBM(); return; }

    switch (type) {
      case 'meal':
        formContent.appendChild(Log.buildFoodForm());
        break;
      case 'workout':
        formContent.appendChild(Log.buildWorkoutForm());
        break;
      case 'bodyPhoto':
        formContent.appendChild(Log.buildBodyPhotoForm());
        break;
      case 'custom':
        formContent.appendChild(Log.buildCustomForm());
        break;
    }

    // Update panel height so form content isn't clipped by overflow:hidden on .today-panels
    if (typeof App !== 'undefined' && App._updatePanelHeight) App._updatePanelHeight();

    // Auto-scroll form into view (especially important in inline mode)
    requestAnimationFrame(() => formContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  },

  hideForm() {
    if (Log._formId) {
      const form = document.getElementById(Log._formId);
      if (form) form.style.display = 'none';
    } else {
      const inlineForm = document.getElementById('log-form-inline');
      if (inlineForm) inlineForm.style.display = 'none';
    }
  },

  // After saving in inline mode, refresh the day view instead of navigating
  _afterSave() {
    if (!Log._formId) {
      // Inline mode — refresh day view, collapse the form
      const logGrid = document.getElementById(Log._gridId);
      if (logGrid) logGrid.style.display = 'none';
      Log.hideForm();
      App.loadDayView();
    } else {
      Log.init();
      window.location.hash = '';
    }
  },

  // --- Photo Button (shared by meal/snack/drink/workout forms) ---
  buildPhotoButton(preset = 'meal') {
    const group = UI.createElement('div', 'form-group');
    group.innerHTML = `
      <div class="photo-actions">
        <button class="btn btn-secondary" id="log-photo-capture"><span class="btn-icon">${UI.svg.camera}</span> Take Photo</button>
        <button class="btn btn-ghost" id="log-photo-pick"><span class="btn-icon">${UI.svg.gallery}</span> Add Photos</button>
      </div>
      <p class="form-hint" style="font-size:var(--text-xs); color:var(--text-muted); margin:4px 0 0;">Tap "Add Photos" to attach multiple pics (dish + label + receipt) to this single entry. Tap "Take Photo" again to add another.</p>
      <div id="log-photo-preview-area" class="multi-photo-grid"></div>
    `;

    requestAnimationFrame(() => {
      const captureBtn = document.getElementById('log-photo-capture');
      const pickBtn = document.getElementById('log-photo-pick');

      if (captureBtn) {
        captureBtn.addEventListener('click', () => Log.handlePhotoCapture(preset));
      }
      if (pickBtn) {
        pickBtn.addEventListener('click', () => Log.handlePhotoPick(preset));
      }
    });

    return group;
  },

  async handlePhotoCapture(preset) {
    const result = await Camera.capture(preset);
    if (result) Log.addPendingPhoto(result);
  },

  async handlePhotoPick(preset) {
    // Multi-select: ALL photos picked here attach to the SAME meal entry.
    // For batch-mode (one-photo-per-entry) the user uses App.batchPhotos
    // from the Today tab instead.
    const results = await Camera.pickMultiple(preset);
    for (const photo of results) Log.addPendingPhoto(photo);
  },

  addPendingPhoto(photo) {
    Log.pendingPhotos.push(photo);
    Log._renderPendingPhotos();

    // Inform user which date the entry will land on
    const targetDate = Log._getEntryDate();
    if (targetDate !== App.selectedDate) {
      UI.toast(`Will log to ${UI.formatRelativeDate(targetDate)} (photo time)`, 'info', 3000);
    } else if (!photo.takenAt && App.selectedDate !== UI.today()) {
      UI.toast(`Will log to ${UI.formatRelativeDate(App.selectedDate)}`, 'info', 3000);
    }
  },

  _renderPendingPhotos() {
    const area = document.getElementById('log-photo-preview-area');
    if (!area) return;
    UI.clearChildren(area);

    for (const photo of Log.pendingPhotos) {
      const preview = Camera.createPreview(photo.url, () => {
        const i = Log.pendingPhotos.indexOf(photo);
        if (i >= 0) {
          Camera.revokeURL(photo.url);
          Log.pendingPhotos.splice(i, 1);
        }
        Log._renderPendingPhotos();
      });
      area.appendChild(preview);
    }

    if (typeof App !== 'undefined' && App._updatePanelHeight) App._updatePanelHeight();
  },

  // --- Food Form (no subtype needed) ---
  buildFoodForm() {
    const frag = document.createDocumentFragment();

    // Photo
    frag.appendChild(Log.buildPhotoButton('meal'));

    // Notes
    frag.appendChild(Log.buildNotesField('What did you eat or drink?'));

    // Save button
    frag.appendChild(Log.buildSaveButton());

    return frag;
  },

  // --- Workout Form ---
  buildWorkoutForm() {
    const frag = document.createDocumentFragment();

    // Subtype
    const subtypeRow = UI.createElement('div', 'subtype-row');
    ['strength', 'cardio', 'flexibility'].forEach(sub => {
      const chip = UI.createElement('button', 'subtype-chip');
      chip.textContent = sub.charAt(0).toUpperCase() + sub.slice(1);
      chip.addEventListener('click', () => {
        Log.selectedSubtype = sub;
        subtypeRow.querySelectorAll('.subtype-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
      subtypeRow.appendChild(chip);
    });
    frag.appendChild(subtypeRow);

    // Photo (gym screen, etc.)
    frag.appendChild(Log.buildPhotoButton('meal'));

    // Duration
    const durGroup = UI.createElement('div', 'form-group');
    durGroup.innerHTML = `
      <label class="form-label">Duration</label>
      <div class="duration-input">
        <input type="number" class="form-input" id="log-duration" placeholder="30" min="1" max="300" inputmode="numeric">
        <span class="unit-label">minutes</span>
      </div>
    `;
    frag.appendChild(durGroup);

    // Notes
    frag.appendChild(Log.buildNotesField('What did you do?'));

    // Save
    frag.appendChild(Log.buildSaveButton());
    return frag;
  },

  // --- Body Photo Form (configurable photo types) ---
  buildBodyPhotoForm() {
    const frag = document.createDocumentFragment();

    const info = UI.createElement('p', '', 'Take progress photos. You can take multiple of each type.');
    info.style.cssText = 'font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--space-md);';
    frag.appendChild(info);

    // Load configured photo types (or default)
    const container = UI.createElement('div');
    container.id = 'body-photo-types-container';
    frag.appendChild(container);

    // Notes
    frag.appendChild(Log.buildNotesField('Any notes about today?'));

    // Save
    const saveGroup = UI.createElement('div', 'form-group');
    saveGroup.style.marginTop = 'var(--space-md)';
    const saveBtn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
    saveBtn.textContent = 'Save Progress Photos';
    saveBtn.addEventListener('click', () => Log.saveBodyPhotos());
    saveGroup.appendChild(saveBtn);
    frag.appendChild(saveGroup);

    // Load types async and render (auto-detect existing subtypes on first use)
    requestAnimationFrame(async () => {
      let types = await DB.getProfile('bodyPhotoTypes');
      if (!types) {
        // First time — detect existing body photo subtypes so nothing is orphaned
        types = [{ key: 'body', name: 'Body' }];
        try {
          const allEntries = await DB.getEntriesByType('bodyPhoto');
          const existing = new Set(allEntries.map(e => e.subtype).filter(Boolean));
          for (const sub of existing) {
            if (!types.some(t => t.key === sub)) {
              types.push({ key: sub, name: sub.charAt(0).toUpperCase() + sub.slice(1) });
            }
          }
        } catch (e) { /* ignore */ }
        await DB.setProfile('bodyPhotoTypes', types);
      }
      Log._bodyPhotoTypes = types;
      Log._renderBodyPhotoTypes();
    });

    return frag;
  },

  _pendingBodyPhotos: {},
  _bodyPhotoTypes: [],

  _renderBodyPhotoTypes() {
    const typesContainer = document.getElementById('body-photo-types-container');
    if (!typesContainer) return;

    typesContainer.innerHTML = '';
    Log._pendingBodyPhotos = Log._pendingBodyPhotos || {};

    for (const pt of Log._bodyPhotoTypes) {
      if (!Log._pendingBodyPhotos[pt.key]) Log._pendingBodyPhotos[pt.key] = [];
      const group = UI.createElement('div', 'form-group');
      group.innerHTML = `
        <label class="form-label">${UI.escapeHtml(pt.name)}</label>
        <div class="photo-actions">
          <button class="btn btn-secondary" data-bp-capture="${pt.key}">Take Photo</button>
          <button class="btn btn-ghost" data-bp-pick="${pt.key}">Library</button>
        </div>
        <div id="log-bp-preview-${pt.key}" class="body-photo-grid"></div>
      `;
      typesContainer.appendChild(group);

      // Re-render existing pending previews
      const area = group.querySelector(`#log-bp-preview-${pt.key}`);
      for (const photo of Log._pendingBodyPhotos[pt.key]) {
        area.appendChild(Camera.createPreview(photo.url, () => {
          const i = Log._pendingBodyPhotos[pt.key].indexOf(photo);
          if (i >= 0) { Camera.revokeURL(photo.url); Log._pendingBodyPhotos[pt.key].splice(i, 1); }
        }));
      }
    }

    // Add new type row
    const addRow = UI.createElement('div', 'form-group');
    addRow.style.cssText = 'display:flex; gap:var(--space-sm); align-items:center;';
    addRow.innerHTML = `
      <input type="text" class="form-input" id="bp-new-type-name" placeholder="Add type (e.g. Arms, Abs)" maxlength="30" style="flex:1;">
      <button class="btn btn-secondary" id="bp-add-type-btn" style="flex-shrink:0;">+ Add</button>
    `;
    typesContainer.appendChild(addRow);

    // Bind all events
    typesContainer.querySelectorAll('[data-bp-capture]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const result = await Camera.capture('body');
        if (result) Log.addBodyPhoto(btn.dataset.bpCapture, result);
      });
    });
    typesContainer.querySelectorAll('[data-bp-pick]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const result = await Camera.pick('body');
        if (result) Log.addBodyPhoto(btn.dataset.bpPick, result);
      });
    });

    document.getElementById('bp-add-type-btn')?.addEventListener('click', async () => {
      const input = document.getElementById('bp-new-type-name');
      const name = input?.value?.trim();
      if (!name) { UI.toast('Enter a name', 'error'); return; }
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      if (Log._bodyPhotoTypes.some(t => t.key === key)) { UI.toast('Already exists', 'error'); return; }
      Log._bodyPhotoTypes.push({ key, name });
      await DB.setProfile('bodyPhotoTypes', Log._bodyPhotoTypes);
      Log._renderBodyPhotoTypes();
    });

    // Update panel height after rendering types (runs async, changes content size)
    if (typeof App !== 'undefined' && App._updatePanelHeight) App._updatePanelHeight();
  },

  addBodyPhoto(typeKey, photo) {
    if (!Log._pendingBodyPhotos[typeKey]) Log._pendingBodyPhotos[typeKey] = [];
    const list = Log._pendingBodyPhotos[typeKey];
    const area = document.getElementById(`log-bp-preview-${typeKey}`);
    if (!area) return;

    list.push(photo);

    const preview = Camera.createPreview(photo.url, () => {
      const i = list.indexOf(photo);
      if (i >= 0) { Camera.revokeURL(photo.url); list.splice(i, 1); }
      // Update panel height after removing a photo
      if (typeof App !== 'undefined' && App._updatePanelHeight) App._updatePanelHeight();
    });
    area.appendChild(preview);

    // Update panel height so new content isn't clipped by overflow:hidden on .today-panels
    if (typeof App !== 'undefined' && App._updatePanelHeight) App._updatePanelHeight();
  },

  // --- Water Form (visual container picker) ---
  buildWaterForm() {
    const wrapper = UI.createElement('div');

    const containers = [
      { label: 'Small cup', oz: 6, desc: 'Coffee cup, juice glass' },
      { label: 'Glass', oz: 10, desc: 'Standard drinking glass' },
      { label: 'Can / small bottle', oz: 12, desc: 'Soda can, La Croix' },
      { label: 'Tall glass', oz: 16, desc: 'Pint glass, tall tumbler' },
      { label: 'Water bottle', oz: 24, desc: 'Standard reusable bottle' },
      { label: 'Large bottle', oz: 32, desc: 'Nalgene, large tumbler' },
      { label: 'Big jug', oz: 40, desc: '40oz Stanley, Hydroflask' },
    ];

    Promise.all([DB.getDailySummary(App.selectedDate), DB.getProfile('goals')]).then(([summary, goals]) => {
      const currentOz = summary.water_oz || 0;
      const waterGoal = Goals.resolve(goals || {}).water_oz;

      const status = UI.createElement('div');
      status.style.cssText = 'text-align: center; margin-bottom: var(--space-md); font-size: var(--text-sm);';
      status.innerHTML = `Today: <strong id="water-total" style="color: var(--color-water)">${currentOz} oz</strong> of ${waterGoal} oz goal`;
      wrapper.appendChild(status);

      const grid = UI.createElement('div', 'water-picker-grid');
      containers.forEach(c => {
        const btn = UI.createElement('button', 'water-pick');
        btn.dataset.oz = c.oz;
        btn.innerHTML = `
          <div class="water-pick-oz">${c.oz} oz</div>
          <div class="water-pick-label">${c.label}</div>
        `;
        btn.addEventListener('click', async () => {
          try {
            const fresh = await DB.getDailySummary(App.selectedDate);
            const newTotal = (fresh.water_oz || 0) + c.oz;
            await DB.updateDailySummary(App.selectedDate, { water_oz: newTotal });
            const totalEl = document.getElementById('water-total');
            if (totalEl) totalEl.textContent = `${newTotal} oz`;
            UI.toast(`Water: ${newTotal} oz (+${c.oz})`);
            CloudRelay.queueUpload(App.selectedDate);
          } catch (err) {
            console.error('Save water failed:', err);
            UI.toast('Failed to save', 'error');
          }
        });
        grid.appendChild(btn);
      });
      wrapper.appendChild(grid);
    });

    return wrapper;
  },

  // --- Weight Form ---
  buildWeightForm() {
    // Use a persistent div (not DocumentFragment) so async content appends work
    const wrapper = UI.createElement('div');

    Promise.all([DB.getDailySummary(App.selectedDate), DB.getProfile('preferences')]).then(([summary, prefs]) => {
      const currentWeight = summary.weight ? summary.weight.value : '';
      const weightUnit = (prefs && prefs.weightUnit) || 'lbs';

      const group = UI.createElement('div', 'form-group');
      group.innerHTML = `
        <label class="form-label">Today's Weight</label>
        <div class="number-input" style="justify-content:center;">
          <button class="btn btn-secondary" id="weight-minus">\u2212</button>
          <input type="number" class="form-input" id="log-weight" value="${currentWeight}" placeholder="${weightUnit === 'kg' ? '60.0' : '135.0'}" step="0.1" inputmode="decimal">
          <button class="btn btn-secondary" id="weight-plus">+</button>
        </div>
        <div style="text-align:center; color:var(--text-muted); font-size:var(--text-sm); margin-top:var(--space-xs);">${weightUnit}</div>
      `;
      wrapper.appendChild(group);

      const saveArea = UI.createElement('div', 'form-group');
      saveArea.style.marginTop = 'var(--space-lg)';
      const saveBtn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
      saveBtn.textContent = 'Save Weight';
      saveBtn.addEventListener('click', () => Log.saveWeight());
      saveArea.appendChild(saveBtn);
      wrapper.appendChild(saveArea);

      // Attach +/- buttons (elements are in the DOM now via wrapper)
      const input = document.getElementById('log-weight');
      const minus = document.getElementById('weight-minus');
      const plus = document.getElementById('weight-plus');
      if (minus) minus.addEventListener('click', () => {
        input.value = Math.max(0, parseFloat(input.value || 0) - 0.1).toFixed(1);
      });
      if (plus) plus.addEventListener('click', () => {
        input.value = (parseFloat(input.value || 0) + 0.1).toFixed(1);
      });
    });

    return wrapper;
  },

  // --- Custom/Alcohol Form ---
  buildCustomForm() {
    const wrapper = UI.createElement('div');

    const drinks = [
      { label: 'Beer', cal: 150, oz: 12 },
      { label: 'Wine', cal: 125, oz: 5 },
      { label: 'Cocktail', cal: 200, oz: 6 },
      { label: 'Shot', cal: 100, oz: 1.5 },
      { label: 'Hard seltzer', cal: 100, oz: 12 },
      { label: 'Other', cal: 150, oz: 0 },
    ];

    let html = '<div class="supplement-grid">';
    for (const d of drinks) {
      html += `<button class="supplement-pick" data-drink="${d.label}" data-cal="${d.cal}">${d.label}<br><span style="font-size:var(--text-xs);color:var(--text-muted)">~${d.cal} cal</span></button>`;
    }
    html += '</div>';

    const group = UI.createElement('div', 'form-group');
    group.innerHTML = html;
    wrapper.appendChild(group);

    // Quantity
    const qtyGroup = UI.createElement('div', 'form-group');
    qtyGroup.innerHTML = `
      <label class="form-label">How many?</label>
      <div class="number-input" style="justify-content:center;">
        <button class="btn btn-secondary" id="custom-minus">\u2212</button>
        <input type="number" class="form-input" id="custom-qty" value="1" min="1" max="10" inputmode="numeric" style="text-align:center; max-width:80px;">
        <button class="btn btn-secondary" id="custom-plus">+</button>
      </div>
    `;
    wrapper.appendChild(qtyGroup);

    // Notes
    wrapper.appendChild(Log.buildNotesField('Any notes?'));

    // Save
    const saveArea = UI.createElement('div', 'form-group');
    saveArea.style.marginTop = 'var(--space-md)';
    const saveBtn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
    saveBtn.textContent = 'Log Drink';
    saveBtn.addEventListener('click', () => Log.saveCustom());
    saveArea.appendChild(saveBtn);
    wrapper.appendChild(saveArea);

    // Wire up buttons
    requestAnimationFrame(() => {
      let selectedDrink = null;
      wrapper.querySelectorAll('.supplement-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          wrapper.querySelectorAll('.supplement-pick').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedDrink = { label: btn.dataset.drink, cal: parseInt(btn.dataset.cal) };
          Log._pendingCustom = selectedDrink;
        });
      });

      const qtyInput = document.getElementById('custom-qty');
      document.getElementById('custom-minus')?.addEventListener('click', () => {
        qtyInput.value = Math.max(1, parseInt(qtyInput.value || 1) - 1);
      });
      document.getElementById('custom-plus')?.addEventListener('click', () => {
        qtyInput.value = Math.min(10, parseInt(qtyInput.value || 1) + 1);
      });
    });

    return wrapper;
  },

  _pendingCustom: null,

  async saveCustom() {
    const item = Log._pendingCustom;
    if (!item) {
      UI.toast('Select a drink type', 'error');
      return;
    }

    const qty = parseInt(document.getElementById('custom-qty')?.value) || 1;
    const notes = document.getElementById('log-notes')?.value?.trim() || '';
    const date = App.selectedDate;

    const entry = {
      id: UI.generateId('custom'),
      type: 'custom',
      subtype: item.label.toLowerCase(),
      date,
      timestamp: new Date().toISOString(),
      notes: notes || `${qty}x ${item.label}`,
      quantity: qty,
      calories_est: item.cal * qty,
      photo: false,
      duration_minutes: null,
    };

    try {
      await DB.addEntry(entry);
      UI.toast(`${qty}x ${item.label} logged (~${item.cal * qty} cal)`);
      CloudRelay.queueUpload(date);
      Log._pendingCustom = null;
      Log._afterSave();
    } catch (err) {
      console.error('Save custom failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },

  // --- Shared Form Pieces ---
  buildNotesField(placeholder) {
    const group = UI.createElement('div', 'form-group');
    group.innerHTML = `
      <label class="form-label">Notes</label>
      <textarea class="form-input" id="log-notes" placeholder="${placeholder}" rows="1"></textarea>
    `;
    const ta = group.querySelector('textarea');
    ta.addEventListener('input', () => UI.autoResize(ta));
    return group;
  },

  buildSaveButton() {
    const group = UI.createElement('div', 'form-group');
    group.style.marginTop = 'var(--space-md)';

    const btn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
    btn.textContent = 'Save Entry';
    btn.addEventListener('click', () => Log.saveEntry());
    group.appendChild(btn);

    const btn2 = UI.createElement('button', 'btn btn-ghost btn-block');
    btn2.textContent = 'Save & Log Another';
    btn2.style.marginTop = 'var(--space-sm)';
    btn2.addEventListener('click', () => Log.saveEntry(true));
    group.appendChild(btn2);

    return group;
  },

  // For camera captures: use first photo's actual timestamp (real time the pic was taken)
  // For gallery picks / no photo: use current time
  _getEntryTimestamp() {
    const firstPhoto = Log.pendingPhotos[0];
    if (firstPhoto?.takenAt) return firstPhoto.takenAt;
    return new Date().toISOString();
  },

  // Camera captures log to the boundary-adjusted date of the photo timestamp.
  // (e.g. a photo taken at 1 AM with a 4 AM boundary goes to the previous day)
  // Gallery picks and non-photo entries log to the selected date.
  _getEntryDate() {
    const firstPhoto = Log.pendingPhotos[0];
    if (firstPhoto?.takenAt) {
      const d = new Date(new Date(firstPhoto.takenAt).getTime() - UI._dayBoundaryHours * 3600000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return App.selectedDate;
  },

  // --- Save Handlers ---
  _saveBusy: false,
  async saveEntry(stayOnLog = false) {
    if (!Log.selectedType || Log._saveBusy) return;

    const notes = document.getElementById('log-notes')?.value?.trim() || '';

    const entryDate = Log._getEntryDate();
    const entry = {
      id: UI.generateId(Log.selectedType),
      type: Log.selectedType,
      subtype: Log.selectedSubtype || null,
      date: entryDate,
      timestamp: Log._getEntryTimestamp(),
      notes,
      photo: Log.pendingPhotos.length > 0 ? true : null,
      duration_minutes: null,
    };

    if (Log.selectedType === 'workout') {
      const dur = document.getElementById('log-duration')?.value;
      entry.duration_minutes = dur ? parseInt(dur) : null;
      if (!Log.selectedSubtype) {
        UI.toast('Pick a workout type', 'error');
        return;
      }
    }

    Log._saveBusy = true;
    try {
      const photoBlobs = Log.pendingPhotos.map(p => p.blob);
      await DB.addEntry(entry, photoBlobs.length > 0 ? photoBlobs : null);
      // Show which date the entry was logged to (helpful when it differs from selected)
      const dateNote = entryDate !== App.selectedDate ? ` on ${UI.formatRelativeDate(entryDate)}` : '';
      UI.toast(`${UI.entryLabel(entry.type, entry.subtype)} logged${dateNote}`);
      CloudRelay.queueUpload(entry.date);
      Log.pendingPhotos = []; // Don't revoke — blobs are now in DB

      if (stayOnLog) {
        // Reset form but stay on log screen with same type selected
        const prevType = Log.selectedType;
        Log.init(Log._formId ? null : Log._gridId, Log._formId ? null : Log._formContentId);
        Log.selectType(prevType);
      } else {
        Log._afterSave();
      }
    } catch (err) {
      console.error('Save failed:', err);
      UI.toast('Failed to save', 'error');
    } finally {
      Log._saveBusy = false;
    }
  },

  async saveBodyPhotos() {
    const allPhotos = Log._pendingBodyPhotos;
    const totalCount = Object.values(allPhotos).reduce((s, list) => s + list.length, 0);

    if (totalCount === 0) {
      UI.toast('Take at least one photo', 'error');
      return;
    }

    const notes = document.getElementById('log-notes')?.value?.trim() || '';
    const date = App.selectedDate;
    const timestamp = new Date().toISOString();
    let count = 0;

    try {
      for (const [typeKey, photos] of Object.entries(allPhotos)) {
        for (const photo of photos) {
          const entry = {
            id: UI.generateId(`bodyPhoto_${typeKey}`),
            type: 'bodyPhoto',
            subtype: typeKey,
            date,
            timestamp,
            notes: count === 0 ? notes : '',
            photo: true,
            duration_minutes: null,
          };
          await DB.addEntry(entry, photo.blob);
          count++;
        }
      }

      UI.toast(`${count} progress photo${count > 1 ? 's' : ''} saved`);
      CloudRelay.queueUpload(date);
      Log._pendingBodyPhotos = {};
      Log._afterSave();
    } catch (err) {
      console.error('Save body photos failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },

  async saveBM() {
    try {
      const date = App.selectedDate;
      const entry = {
        id: UI.generateId('bm'),
        type: 'bm',
        subtype: null,
        date,
        timestamp: new Date().toISOString(),
        notes: 'Logged',
        photo: false,
        duration_minutes: null,
      };
      await DB.addEntry(entry);
      UI.toast('BM logged');
      CloudRelay.queueUpload(date);
      Log._afterSave();
    } catch (err) {
      console.error('Save BM failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },

  async saveWeight() {
    const input = document.getElementById('log-weight');
    if (!input || !input.value) {
      UI.toast('Enter a weight', 'error');
      return;
    }

    const value = parseFloat(input.value);
    if (isNaN(value) || value <= 0) {
      UI.toast('Enter a valid weight', 'error');
      return;
    }

    try {
      const prefs = await DB.getProfile('preferences') || {};
      const weightUnit = prefs.weightUnit || 'lbs';
      const ts = Date.now();
      const isoTs = new Date(ts).toISOString();
      const date = App.selectedDate;
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
      Log._afterSave();
    } catch (err) {
      console.error('Save weight failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },
};
