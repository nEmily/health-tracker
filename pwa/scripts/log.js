// log.js — Entry logging UI

const Log = {
  selectedType: null,
  selectedSubtype: null,

  init() {
    Log.selectedType = null;
    Log.selectedSubtype = null;
    Log.renderTypeSelector();
    Log.hideForm();
  },

  // --- Type Selection ---
  renderTypeSelector() {
    const grid = document.getElementById('log-type-grid');
    if (!grid) return;

    const types = [
      { type: 'meal', icon: '\u{1F37D}\uFE0F', label: 'Meal', color: 'var(--color-meal)' },
      { type: 'snack', icon: '\u{1F36A}', label: 'Snack', color: 'var(--color-snack)' },
      { type: 'drink', icon: '\u{1F964}', label: 'Drink', color: 'var(--color-drink)' },
      { type: 'workout', icon: '\u{1F4AA}', label: 'Workout', color: 'var(--color-workout)' },
      { type: 'water', icon: '\u{1F4A7}', label: 'Water', color: 'var(--color-water)' },
      { type: 'weight', icon: '\u{2696}\uFE0F', label: 'Weight', color: 'var(--color-weight)' },
    ];

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

    // Highlight selected
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === type);
    });

    Log.showForm(type);
  },

  // --- Form Rendering ---
  showForm(type) {
    const form = document.getElementById('log-form');
    if (!form) return;
    form.style.display = 'block';

    const formContent = document.getElementById('log-form-content');
    UI.clearChildren(formContent);

    switch (type) {
      case 'meal':
        formContent.appendChild(Log.buildMealForm());
        break;
      case 'snack':
      case 'drink':
        formContent.appendChild(Log.buildSimpleNoteForm(type));
        break;
      case 'workout':
        formContent.appendChild(Log.buildWorkoutForm());
        break;
      case 'water':
        formContent.appendChild(Log.buildWaterForm());
        break;
      case 'weight':
        formContent.appendChild(Log.buildWeightForm());
        break;
    }
  },

  hideForm() {
    const form = document.getElementById('log-form');
    if (form) form.style.display = 'none';
  },

  // --- Meal Form ---
  buildMealForm() {
    const frag = document.createDocumentFragment();

    // Subtype selector
    const subtypeRow = UI.createElement('div', 'subtype-row');
    ['breakfast', 'lunch', 'dinner'].forEach(sub => {
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

    // Photo placeholder (Phase 2)
    const photoArea = UI.createElement('div', 'form-group');
    photoArea.innerHTML = `
      <button class="btn btn-secondary btn-block" id="log-photo-btn" disabled style="opacity:0.5">
        \u{1F4F7} Add Photo (coming soon)
      </button>
    `;
    frag.appendChild(photoArea);

    // Notes
    frag.appendChild(Log.buildNotesField('What did you eat?'));

    // Save button
    frag.appendChild(Log.buildSaveButton());

    return frag;
  },

  // --- Simple Note Form (snack, drink) ---
  buildSimpleNoteForm(type) {
    const frag = document.createDocumentFragment();
    const placeholder = type === 'snack' ? 'What did you have?' : 'What did you drink?';

    // Photo placeholder (Phase 2)
    const photoArea = UI.createElement('div', 'form-group');
    photoArea.innerHTML = `
      <button class="btn btn-secondary btn-block" disabled style="opacity:0.5">
        \u{1F4F7} Add Photo (coming soon)
      </button>
    `;
    frag.appendChild(photoArea);

    frag.appendChild(Log.buildNotesField(placeholder));
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

  // --- Water Form ---
  buildWaterForm() {
    const frag = document.createDocumentFragment();

    const container = UI.createElement('div', 'slider-container');

    // We need to load current value
    DB.getDailySummary(App.selectedDate).then(summary => {
      const currentOz = summary.water_oz || 0;

      container.innerHTML = `
        <div class="slider-value"><span id="water-display">${currentOz}</span> <span class="unit">oz</span></div>
        <input type="range" id="water-slider" min="0" max="160" step="4" value="${currentOz}">
        <div style="display:flex; justify-content:space-between; color:var(--text-muted); font-size:var(--text-xs); margin-top:var(--space-xs);">
          <span>0 oz</span>
          <span>160 oz</span>
        </div>
      `;
      frag.appendChild(container);

      // Quick-add buttons
      const quickRow = UI.createElement('div', 'subtype-row');
      quickRow.style.justifyContent = 'center';
      quickRow.style.marginTop = 'var(--space-md)';
      [8, 12, 16, 24].forEach(oz => {
        const chip = UI.createElement('button', 'subtype-chip');
        chip.textContent = `+${oz} oz`;
        chip.addEventListener('click', () => {
          const slider = document.getElementById('water-slider');
          const display = document.getElementById('water-display');
          const newVal = Math.min(160, parseInt(slider.value) + oz);
          slider.value = newVal;
          display.textContent = newVal;
        });
        quickRow.appendChild(chip);
      });
      frag.appendChild(quickRow);

      // Save button
      const saveArea = UI.createElement('div', 'form-group');
      saveArea.style.marginTop = 'var(--space-lg)';
      const saveBtn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
      saveBtn.textContent = 'Save Water Intake';
      saveBtn.addEventListener('click', () => Log.saveWater());
      saveArea.appendChild(saveBtn);
      frag.appendChild(saveArea);

      // Attach slider event after DOM is updated
      requestAnimationFrame(() => {
        const slider = document.getElementById('water-slider');
        const display = document.getElementById('water-display');
        if (slider && display) {
          slider.addEventListener('input', () => {
            display.textContent = slider.value;
          });
        }
      });
    });

    return frag;
  },

  // --- Weight Form ---
  buildWeightForm() {
    const frag = document.createDocumentFragment();

    DB.getDailySummary(App.selectedDate).then(summary => {
      const currentWeight = summary.weight ? summary.weight.value : '';

      const group = UI.createElement('div', 'form-group');
      group.innerHTML = `
        <label class="form-label">Today's Weight</label>
        <div class="number-input" style="justify-content:center;">
          <button class="btn btn-secondary" id="weight-minus">\u2212</button>
          <input type="number" class="form-input" id="log-weight" value="${currentWeight}" placeholder="135.0" step="0.1" inputmode="decimal">
          <button class="btn btn-secondary" id="weight-plus">+</button>
        </div>
        <div style="text-align:center; color:var(--text-muted); font-size:var(--text-sm); margin-top:var(--space-xs);">lbs</div>
      `;
      frag.appendChild(group);

      // Save button
      const saveArea = UI.createElement('div', 'form-group');
      saveArea.style.marginTop = 'var(--space-lg)';
      const saveBtn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
      saveBtn.textContent = 'Save Weight';
      saveBtn.addEventListener('click', () => Log.saveWeight());
      saveArea.appendChild(saveBtn);
      frag.appendChild(saveArea);

      // +/- buttons
      requestAnimationFrame(() => {
        const input = document.getElementById('log-weight');
        const minus = document.getElementById('weight-minus');
        const plus = document.getElementById('weight-plus');
        if (minus) minus.addEventListener('click', () => {
          input.value = (parseFloat(input.value || 0) - 0.1).toFixed(1);
        });
        if (plus) plus.addEventListener('click', () => {
          input.value = (parseFloat(input.value || 0) + 0.1).toFixed(1);
        });
      });
    });

    return frag;
  },

  // --- Shared Form Pieces ---
  buildNotesField(placeholder) {
    const group = UI.createElement('div', 'form-group');
    group.innerHTML = `
      <label class="form-label">Notes</label>
      <textarea class="form-input" id="log-notes" placeholder="${placeholder}" rows="3"></textarea>
    `;
    return group;
  },

  buildSaveButton() {
    const group = UI.createElement('div', 'form-group');
    group.style.marginTop = 'var(--space-md)';
    const btn = UI.createElement('button', 'btn btn-primary btn-block btn-lg');
    btn.textContent = 'Save Entry';
    btn.addEventListener('click', () => Log.saveEntry());
    group.appendChild(btn);
    return group;
  },

  // --- Save Handlers ---
  async saveEntry() {
    if (!Log.selectedType) return;

    if (Log.selectedType === 'meal' && !Log.selectedSubtype) {
      UI.toast('Pick a meal type', 'error');
      return;
    }

    const notes = document.getElementById('log-notes')?.value?.trim() || '';

    const entry = {
      id: UI.generateId(Log.selectedType),
      type: Log.selectedType,
      subtype: Log.selectedSubtype || null,
      date: App.selectedDate,
      timestamp: new Date().toISOString(),
      notes,
      photo: null,
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

    try {
      await DB.addEntry(entry);
      UI.toast(`${UI.entryLabel(entry.type, entry.subtype)} logged`);
      Log.init(); // Reset form
      // Switch to today view to see the entry
      window.location.hash = '';
    } catch (err) {
      console.error('Save failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },

  async saveWater() {
    const slider = document.getElementById('water-slider');
    if (!slider) return;

    const oz = parseInt(slider.value);
    try {
      await DB.updateDailySummary(App.selectedDate, { water_oz: oz });
      UI.toast(`Water: ${oz} oz saved`);
      window.location.hash = '';
    } catch (err) {
      console.error('Save water failed:', err);
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
      await DB.updateDailySummary(App.selectedDate, {
        weight: { value, unit: 'lbs' },
      });
      UI.toast(`Weight: ${value} lbs saved`);
      window.location.hash = '';
    } catch (err) {
      console.error('Save weight failed:', err);
      UI.toast('Failed to save', 'error');
    }
  },
};
