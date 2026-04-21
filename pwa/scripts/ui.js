// ui.js — Shared UI utilities

const UI = {
  // --- Day Boundary ---
  // Hours to subtract from current time to get the "effective date."
  // 0 = midnight (default), 4 = day starts at 4 AM (entries at 2 AM count as previous day).
  _dayBoundaryHours: 0,

  // --- Date Helpers ---
  today() {
    const d = new Date(Date.now() - UI._dayBoundaryHours * 3600000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

  formatTime(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  },

  yesterday(dateStr) {
    const d = new Date((dateStr || UI.today()) + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  formatRelativeDate(dateStr) {
    const today = UI.today();
    if (dateStr === today) return 'Today';
    if (dateStr === UI.yesterday()) return 'Yesterday';
    return UI.formatDate(dateStr);
  },

  // --- ID Generation ---
  generateId(prefix) {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 6);
    return `${prefix}_${ts}_${rand}`;
  },

  // --- Toast Notifications ---
  toast(message, type = 'success', opts) {
    // opts can be a number (legacy duration) or { action, onAction, duration }
    const options = typeof opts === 'number' ? { duration: opts } : (opts || {});
    const duration = options.duration || 2500;

    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    // Limit to 3 visible toasts — remove oldest
    while (container.children.length >= 3) {
      container.firstChild.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    if (options.action) {
      const textSpan = document.createElement('span');
      textSpan.textContent = message;
      const actionBtn = document.createElement('button');
      actionBtn.className = 'toast-action';
      actionBtn.textContent = options.action;
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (options.onAction) options.onAction();
        toast.remove();
      });
      toast.appendChild(textSpan);
      toast.appendChild(actionBtn);
    } else {
      toast.textContent = message;
    }

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      const fallback = setTimeout(() => toast.remove(), 500);
      toast.addEventListener('animationend', () => {
        clearTimeout(fallback);
        toast.remove();
      });
    }, duration);
  },

  // --- SVG Icon Library ---
  // Minimal inline SVGs: viewBox 0 0 24 24, stroke-based, use currentColor or theme vars.
  svg: {
    meal: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-meal)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="14" rx="9" ry="5"/><path d="M3 14c0-4 4-9 9-9s9 5 9 9"/></svg>`,
    workout: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-workout)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5L4 4M17.5 6.5L20 4"/><rect x="7" y="9" width="2" height="10" rx="1"/><rect x="15" y="9" width="2" height="10" rx="1"/><path d="M9 14h6"/><path d="M5 11v6M19 11v6"/></svg>`,
    strength: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-workout)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="9" width="2" height="10" rx="1"/><rect x="15" y="9" width="2" height="10" rx="1"/><path d="M9 14h6"/><path d="M5 11v6M19 11v6"/></svg>`,
    cardio: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-workout)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M15 22l-3-8-3 4-3-3"/><path d="M9 14l3-4 4 2"/></svg>`,
    flexibility: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-workout)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M8 22l4-10 4 10"/><path d="M6 12c2-2 4-2 6-2s4 0 6 2"/></svg>`,
    water: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-water)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c0 0-6 7-6 12a6 6 0 0012 0c0-5-6-12-6-12z"/></svg>`,
    weight: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-weight)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="10" rx="2"/><path d="M8 10V8a4 4 0 018 0v2"/><circle cx="12" cy="15" r="1.5"/></svg>`,
    bodyPhoto: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-body-photo)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="16" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8.5 5L9.5 3h5l1 2"/></svg>`,
    vice: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 22h8"/><path d="M12 18v4"/><path d="M5 2l2 8c0 3.3 2.2 6 5 6s5-2.7 5-6l2-8"/></svg>`,
    get custom() { return this.vice; },
    sleep: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-sleep)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
    supplement: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="16" rx="6"/><line x1="6" y1="12" x2="18" y2="12"/></svg>`,
    clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>`,
    logging: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><polyline points="9 12 11 14 15 10"/></svg>`,
    target: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-orange)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    flame: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4 0-7-3-7-7 0-3 2-5 4-7 1-1 2-2 2-4 1 2 3 3 4 5 .5-1 1-2 1-3 2 2 3 4 3 6 0 4-3 10-7 10z"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="16" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8.5 5L9.5 3h5l1 2"/></svg>`,
    gallery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    period: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-period)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`,
    mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/></svg>`,
  },

  // --- Entry Icons & Labels ---
  entryIcon(type, subtype) {
    if (type === 'workout' && subtype) {
      return UI.svg[subtype] || UI.svg.workout;
    }
    return UI.svg[type] || UI.svg.clipboard;
  },

  entryLabel(type, subtype) {
    // Workout subtypes still display as their subtype name
    if (type === 'workout' && subtype) {
      return subtype.charAt(0).toUpperCase() + subtype.slice(1);
    }
    const labels = {
      meal: 'Food', snack: 'Food', drink: 'Food',
      workout: 'Workout', water: 'Water', weight: 'Weight',
      bodyPhoto: 'Body Photo', custom: 'Alcohol', vice: 'Alcohol', sleep: 'Sleep',
      supplement: 'Supplement',
    };
    return labels[type] || type;
  },

  // --- Text Escaping ---
  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // Render a structured ingredient list from a meal.ingredients[] array.
  // Each ingredient: { name, grams, cups?, tsp?, tbsp?, oz?, count?, cal?, protein?, fiber?, fat? }
  // Format: "100g salmon sashimi (1/2 cup) · 200 cal, 22g P, 0g F"
  // Returns '' when ingredients is missing or empty (legacy meals degrade gracefully).
  renderIngredientList(ingredients) {
    if (!Array.isArray(ingredients) || ingredients.length === 0) return '';

    const prettyFraction = (n) => {
      if (n === 0.25) return '1/4';
      if (n === 0.5) return '1/2';
      if (n === 0.75) return '3/4';
      if (n === 1) return '1';
      if (n === 1.25) return '1 1/4';
      if (n === 1.5) return '1 1/2';
      if (n === 1.75) return '1 3/4';
      if (n === 2) return '2';
      return String(n);
    };
    const fmtVolume = (ing) => {
      if (ing.cups != null && ing.cups > 0) return `${prettyFraction(ing.cups)} cup`;
      if (ing.tsp != null && ing.tsp > 0) return `${prettyFraction(ing.tsp)} tsp`;
      if (ing.tbsp != null && ing.tbsp > 0) return `${prettyFraction(ing.tbsp)} tbsp`;
      if (ing.oz != null && ing.oz > 0) return `${prettyFraction(ing.oz)} oz`;
      if (ing.count) return ing.count;
      return '';
    };

    const rows = ingredients.map(ing => {
      const name = UI.escapeHtml(ing.name || '');
      const grams = ing.grams != null ? `${ing.grams}g` : '';
      const vol = fmtVolume(ing);
      const volPart = vol ? ` <span style="color:var(--text-muted);">(${UI.escapeHtml(vol)})</span>` : '';
      const macroParts = [];
      if (ing.cal != null) macroParts.push(`${ing.cal} cal`);
      if (ing.protein) macroParts.push(`${ing.protein}g P`);
      if (ing.fiber) macroParts.push(`${ing.fiber}g F`);
      const macros = macroParts.length ? ` <span style="color:var(--text-muted);">· ${macroParts.join(', ')}</span>` : '';
      return `<div style="padding:3px 0; font-size:var(--text-xs);"><span style="color:var(--text-secondary); font-weight:500;">${grams}</span> ${name}${volPart}${macros}</div>`;
    }).join('');

    return `<div style="margin:var(--space-xs) 0; padding:var(--space-xs) var(--space-sm); background:var(--bg-elevated); border-radius:var(--radius-sm);">${rows}</div>`;
  },

  // --- Auto-resize textarea to fit content ---
  autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';
    el.style.overflowY = 'hidden';
  },

  // Close any open modal before opening a new one (prevents stacking)
  dismissModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  },

  // Scroll focused input into view when mobile keyboard opens
  initKeyboardScroll() {
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        setTimeout(() => {
          // If inside a modal, scroll within the modal sheet
          const sheet = el.closest('.modal-sheet');
          if (sheet) {
            sheet.scrollTop = el.offsetTop - sheet.clientHeight / 3;
          }
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    });

    // Adjust modals when virtual keyboard opens (iOS)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
          const sheet = focused.closest('.modal-sheet');
          if (sheet) {
            // Shrink modal to fit above keyboard
            const vvh = window.visualViewport.height;
            sheet.style.maxHeight = (vvh - 20) + 'px';
            setTimeout(() => focused.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
          }
        }
      });
    }
  },

  // --- DOM Helpers ---
  $(selector) {
    return document.querySelector(selector);
  },

  $$(selector) {
    return document.querySelectorAll(selector);
  },

  createElement(tag, className, innerHTML) {
    // Dismiss existing modals before creating a new one (prevents stacking)
    if (className === 'modal-overlay') UI.dismissModals();
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
  },

  clearChildren(el) {
    // Revoke any object URLs in child images to prevent memory leaks
    el.querySelectorAll?.('img[src^="blob:"]')?.forEach(img => URL.revokeObjectURL(img.src));
    // Revoke blob URLs used as background-image (e.g. body photo lock thumbnails)
    el.querySelectorAll?.('[style*="blob:"]')?.forEach(node => {
      const bg = node.style.backgroundImage;
      const match = bg && bg.match(/url\("?(blob:[^"')]+)"?\)/);
      if (match) URL.revokeObjectURL(match[1]);
    });
    while (el.firstChild) el.removeChild(el.firstChild);
  },

  // --- Render an entry item ---
  renderEntryItem(entry, analysisEntry) {
    // Wrapper for swipe-to-delete positioning
    const wrapper = UI.createElement('div', 'entry-swipe-wrap');
    const div = UI.createElement('div', 'entry-item');
    div.dataset.type = entry.type;

    const icon = UI.createElement('div', 'entry-icon');
    icon.innerHTML = UI.entryIcon(entry.type, entry.subtype);

    const body = UI.createElement('div', 'entry-body');

    const typeLabel = UI.createElement('div', 'entry-type');
    // Check if entry was edited after analysis was imported (stale)
    const isFood = ['meal', 'snack', 'drink'].includes(entry.type);
    const entryUpdatedAt = entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0;
    const isStale = analysisEntry && analysisEntry._importedAt && entryUpdatedAt > analysisEntry._importedAt;
    const showAnalysis = analysisEntry && !isStale;

    // Show AI calories inline with type label if analyzed and not stale
    if (showAnalysis && isFood && analysisEntry.calories != null) {
      typeLabel.textContent = `${UI.entryLabel(entry.type, entry.subtype)} · ${analysisEntry.calories} cal`;
      if (analysisEntry.protein) typeLabel.textContent += ` · ${analysisEntry.protein}g protein`;
      if (analysisEntry.fiber) typeLabel.textContent += ` · ${analysisEntry.fiber}g fiber`;
    } else {
      typeLabel.textContent = UI.entryLabel(entry.type, entry.subtype);
    }

    body.appendChild(typeLabel);

    if (entry.notes) {
      const notes = UI.createElement('div', 'entry-notes');
      notes.textContent = entry.notes;
      body.appendChild(notes);
    }

    // Show AI description if analyzed, not stale, and different from user notes
    if (showAnalysis && analysisEntry.description && analysisEntry.description !== entry.notes) {
      const aiDesc = UI.createElement('div', 'entry-analysis');
      aiDesc.textContent = analysisEntry.description;
      body.appendChild(aiDesc);
    }

    // Pending upload badge — shown when entry was saved after last successful upload for that date
    const entryTs = new Date(entry.timestamp).getTime();
    const lastSync = (typeof CloudRelay !== 'undefined') ? CloudRelay.getLastSyncTime(entry.date) : 0;
    if (entryTs > lastSync) {
      const unsynced = UI.createElement('div', 'entry-unsynced');
      unsynced.textContent = 'Pending upload';
      body.appendChild(unsynced);
    }

    // Pending/stale analysis indicator
    const showPending = isFood || entry.type === 'workout' || entry.type === 'supplement' || entry.type === 'custom';
    if (!analysisEntry && showPending) {
      const pending = UI.createElement('div', 'entry-pending');
      pending.textContent = 'Pending analysis';
      body.appendChild(pending);
    } else if (isStale && showPending) {
      const stale = UI.createElement('div', 'entry-pending');
      stale.textContent = 'Updated · pending re-analysis';
      body.appendChild(stale);
    }

    if (entry.type === 'workout' && entry.duration_minutes) {
      const dur = UI.createElement('div', 'entry-notes');
      dur.textContent = `${entry.duration_minutes} min`;
      dur.style.color = 'var(--text-muted)';
      body.appendChild(dur);
    }

    const time = UI.createElement('div', 'entry-time');
    time.textContent = UI.formatTime(entry.timestamp);
    body.appendChild(time);

    div.appendChild(icon);
    div.appendChild(body);

    // Tap entry to open edit modal (only if not mid-swipe)
    div.addEventListener('click', () => {
      if (div.classList.contains('swiped')) return;
      UI.showEditModal(entry);
    });

    // Load photo thumbnail if entry has a photo
    if (entry.photo) {
      if (entry.type === 'bodyPhoto') {
        // Body photos are private — show lock icon, tap to reveal
        const lock = UI.createElement('div', 'entry-photo-thumb entry-photo-locked');
        lock.innerHTML = UI.svg.lock;
        let currentPhotoUrl = null;
        const hideLock = () => {
          lock.classList.remove('revealed');
          lock.innerHTML = UI.svg.lock;
          lock.style.backgroundImage = '';
          if (currentPhotoUrl) { URL.revokeObjectURL(currentPhotoUrl); currentPhotoUrl = null; }
        };
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          if (lock.classList.contains('revealed')) { hideLock(); return; }
          DB.getPhotos(entry.id).then(photos => {
            if (photos.length > 0 && photos[0].blob) {
              currentPhotoUrl = URL.createObjectURL(photos[0].blob);
              lock.innerHTML = '';
              lock.style.backgroundImage = `url(${currentPhotoUrl})`;
              lock.style.backgroundSize = 'cover';
              lock.style.backgroundPosition = 'center';
              lock.classList.add('revealed');
              setTimeout(() => { if (lock.classList.contains('revealed')) hideLock(); }, 5000);
            }
          });
        });
        div.appendChild(lock);
      } else {
        const thumbWrap = UI.createElement('div', 'entry-photo-thumbs');
        thumbWrap.style.display = 'none';
        DB.getPhotos(entry.id).then(photos => {
          const validPhotos = photos.filter(p => p.blob);
          if (validPhotos.length === 0) { thumbWrap.remove(); return; }

          const first = validPhotos[0];
          const blobUrl = URL.createObjectURL(first.blob);
          if (!thumbWrap.isConnected) { URL.revokeObjectURL(blobUrl); return; }

          const thumb = UI.createElement('img', 'entry-photo-thumb');
          thumb.alt = '';
          thumb.loading = 'lazy';
          thumb.src = blobUrl;
          thumbWrap.appendChild(thumb);

          // Show count badge if multiple photos
          if (validPhotos.length > 1) {
            const badge = UI.createElement('span', 'photo-count-badge');
            badge.textContent = validPhotos.length;
            thumbWrap.appendChild(badge);
          }

          thumbWrap.style.display = '';
        });
        div.appendChild(thumbWrap);
      }
    }

    // Swipe-to-delete setup
    UI._setupSwipeDelete(wrapper, div, entry);
    wrapper.appendChild(div);
    return wrapper;
  },

  // Render an entry from analysis data (recovery mode — IndexedDB entries missing)
  // Tapping creates a real entry from the analysis data so it becomes fully editable.
  renderAnalysisEntry(ae) {
    const wrapper = UI.createElement('div', 'entry-swipe-wrap');
    const div = UI.createElement('div', 'entry-item');
    div.dataset.type = ae.type;

    const icon = UI.createElement('div', 'entry-icon');
    icon.innerHTML = UI.entryIcon(ae.type, ae.subtype);

    const body = UI.createElement('div', 'entry-body');

    const typeLabel = UI.createElement('div', 'entry-type');
    const cal = ae.type === 'workout' ? ((ae.calories_burned || ae.calories) ? `${ae.calories_burned || Math.abs(ae.calories)} cal burned` : '') : (ae.calories ? `${ae.calories} cal` : '');
    typeLabel.textContent = UI.entryLabel(ae.type, ae.subtype) + (cal ? ` · ${cal}` : '');

    body.appendChild(typeLabel);

    if (ae.description) {
      const desc = UI.createElement('div', 'entry-notes');
      desc.textContent = ae.description;
      body.appendChild(desc);
    }

    if (ae.type === 'workout' && ae.duration_minutes) {
      const dur = UI.createElement('div', 'entry-notes');
      dur.textContent = `${ae.duration_minutes} min`;
      dur.style.color = 'var(--text-muted)';
      body.appendChild(dur);
    }

    const time = UI.createElement('div', 'entry-time');
    if (ae.timestamp) time.textContent = UI.formatTime(ae.timestamp);
    body.appendChild(time);

    div.appendChild(icon);
    div.appendChild(body);

    // Tap to re-create as a real entry and open edit modal
    div.addEventListener('click', async () => {
      const entry = {
        id: ae.id || UI.generateId(ae.type),
        type: ae.type,
        subtype: ae.subtype || null,
        date: ae.date || App.selectedDate,
        timestamp: ae.timestamp || new Date().toISOString(),
        notes: ae.description || ae.notes || '',
        photo: null,
        duration_minutes: ae.duration_minutes || null,
        weight_value: ae.weight_value || null,
        weight_unit: ae.weight_unit || null,
      };
      // Persist to IndexedDB so it becomes a real editable entry
      try {
        await DB.addEntry(entry);
      } catch (e) {
        // Entry may already exist if tapped twice — ignore duplicate key errors
      }
      UI.showEditModal(entry);
    });

    wrapper.appendChild(div);
    return wrapper;
  },

  // --- Edit Entry Modal ---
  async showEditModal(entry) {
    const overlay = UI.createElement('div', 'modal-overlay');
    const sheet = UI.createElement('div', 'modal-sheet');

    // Load photos if exist
    let photoUrls = [];
    if (entry.photo) {
      const photos = await DB.getPhotos(entry.id);
      for (const p of photos) {
        if (p.blob) photoUrls.push(URL.createObjectURL(p.blob));
      }
    }

    const isBodyPhoto = entry.type === 'bodyPhoto';
    const isFoodEntry = ['meal', 'snack', 'drink'].includes(entry.type);

    // Build hour picker options for food entries
    let hourPickerHtml = '';
    if (isFoodEntry) {
      const entryDate = new Date(entry.timestamp);
      const currentHour = entryDate.getHours();
      const hourOptions = [];
      for (let h = 0; h < 24; h++) {
        const ampm = h < 12 ? 'AM' : 'PM';
        const display = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
        const selected = h === currentHour ? ' selected' : '';
        hourOptions.push(`<option value="${h}"${selected}>${display}</option>`);
      }
      hourPickerHtml = `
        <div class="form-group" style="margin-bottom: var(--space-md);">
          <label class="form-label">Time eaten</label>
          <select class="form-input" id="edit-hour" style="min-height:44px; font-size:var(--text-base);">
            ${hourOptions.join('')}
          </select>
        </div>
      `;
    }

    let photoHtml = '';
    if (photoUrls.length > 0) {
      if (isBodyPhoto) {
        photoHtml = `<div class="ql-photo-preview edit-photo-locked" id="edit-photo-lock">
            <div class="edit-photo-lock-overlay">${UI.svg.lock}<span>Tap to reveal</span></div>
            <img src="${photoUrls[0]}" alt="" class="edit-photo-blurred">
          </div>`;
      } else if (photoUrls.length === 1) {
        photoHtml = `<div class="ql-photo-preview"><img src="${photoUrls[0]}" alt=""></div>`;
      } else {
        photoHtml = `<div class="edit-photo-grid" id="edit-photo-grid">${photoUrls.map((url, i) =>
          `<div class="ql-photo-preview edit-photo-grid-item" data-photo-idx="${i}"><img src="${url}" alt=""></div>`
        ).join('')}</div>`;
      }
    }

    // "Add Photo" actions for non-body entries (meal, workout, custom, etc.)
    const canAddPhotos = !isBodyPhoto && entry.type !== 'weight' && entry.type !== 'water';
    const addPhotoHtml = canAddPhotos ? `
      <div class="edit-add-photo-actions" id="edit-add-photo-section">
        <button class="btn btn-secondary btn-sm" id="edit-add-photo-capture"><span class="btn-icon">${UI.svg.camera}</span> Add Photo</button>
        <button class="btn btn-ghost btn-sm" id="edit-add-photo-pick"><span class="btn-icon">${UI.svg.gallery}</span> From Library</button>
        <span class="edit-photo-count" id="edit-photo-count">${photoUrls.length > 0 ? photoUrls.length + ' photo' + (photoUrls.length > 1 ? 's' : '') : ''}</span>
      </div>
    ` : '';

    // Body photo entries are locked by default to prevent accidental edits/deletions
    const lockBarHtml = isBodyPhoto ? `
      <div class="edit-lock-bar" id="edit-lock-bar">
        <span class="edit-lock-bar-icon">${UI.svg.lock}</span>
        <span class="edit-lock-bar-text">Entry locked</span>
        <button class="edit-lock-toggle" id="edit-lock-toggle">Unlock to edit</button>
      </div>
    ` : '';

    sheet.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Edit ${UI.entryLabel(entry.type, entry.subtype)}</span>
        <button class="modal-close" id="edit-close" aria-label="Close">&times;</button>
      </div>
      ${photoHtml}
      ${addPhotoHtml}
      ${lockBarHtml}
      <div class="form-group" style="margin-bottom: var(--space-md);">
        <label class="form-label" style="font-size: var(--text-xs); color: var(--text-muted);">
          ${UI.formatTime(entry.timestamp)} &mdash; <span id="edit-date-display">${UI.formatDate(entry.date)}</span>
        </label>
        <div style="display:flex; align-items:center; gap:var(--space-sm); margin-top:var(--space-xs);">
          <input type="date" class="form-input" id="edit-date" value="${entry.date}" style="flex:1;"${isBodyPhoto ? ' disabled' : ''}>
        </div>
      </div>
      ${hourPickerHtml}
      ${entry.type === 'weight' ? `
        <div class="form-group" style="margin-bottom: var(--space-md);">
          <label class="form-label">Weight (${entry.weight_unit || 'lbs'})</label>
          <input type="number" class="form-input" id="edit-weight-value" value="${entry.weight_value || ''}" step="0.1" inputmode="decimal" style="min-height:44px; font-size: var(--text-lg);">
        </div>
      ` : ''}
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="edit-notes" placeholder="Add notes" rows="1"${isBodyPhoto ? ' disabled' : ''}>${UI.escapeHtml(entry.notes || '')}</textarea>
      </div>
      ${entry.type === 'workout' ? `
        <div class="form-group">
          <label class="form-label">Duration (minutes)</label>
          <input type="number" class="form-input" id="edit-duration" value="${entry.duration_minutes || ''}" placeholder="30" inputmode="numeric">
        </div>
      ` : ''}
      <button class="btn btn-primary btn-block btn-lg${isBodyPhoto ? ' btn-locked' : ''}" id="edit-save"${isBodyPhoto ? ' disabled' : ''}>Save Changes</button>
      <button class="btn btn-ghost btn-block${isBodyPhoto ? ' btn-locked' : ''}" id="edit-delete" style="margin-top: var(--space-sm); color: var(--accent-red);"${isBodyPhoto ? ' disabled' : ''}>Delete Entry</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeModal = () => {
      for (const url of photoUrls) URL.revokeObjectURL(url);
      // Also close any open photo viewer (it's on document.body, not inside the modal)
      document.querySelector('.photo-viewer-overlay')?.remove();
      overlay.remove();
    };

    document.getElementById('edit-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Body photo: tap 1 = reveal, tap 2 = open viewer (no re-lock toggle)
    const photoLock = document.getElementById('edit-photo-lock');
    if (photoLock) {
      photoLock.addEventListener('click', () => {
        if (!photoLock.classList.contains('revealed')) {
          // First tap: reveal the photo
          photoLock.classList.add('revealed');
        } else if (photoUrls[0]) {
          // Already revealed: open full-screen viewer
          UI.showPhotoViewer(photoUrls[0], entry);
        }
      });
    }

    // Photo expand for non-body photos — tap preview to open viewer
    if (photoUrls.length > 0 && !isBodyPhoto) {
      sheet.querySelectorAll('.ql-photo-preview').forEach(previewEl => {
        previewEl.style.cursor = 'pointer';
        const idx = previewEl.dataset.photoIdx != null ? parseInt(previewEl.dataset.photoIdx) : 0;
        previewEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (photoUrls[idx]) UI.showPhotoViewer(photoUrls[idx], entry);
        });
      });
    }

    // Add Photo buttons in edit modal
    const addPhotoCaptureBtn = document.getElementById('edit-add-photo-capture');
    const addPhotoPickBtn = document.getElementById('edit-add-photo-pick');

    const handleAddPhotoToEntry = async (useCamera) => {
      const result = useCamera ? await Camera.capture('meal') : await Camera.pick('meal');
      if (!result) return;

      try {
        const totalPhotos = await DB.addPhotosToEntry(entry.id, [result.blob], entry);
        // Update entry.photo flag in-memory for consistency
        entry.photo = true;

        // Add the new photo URL to tracking array
        const newUrl = URL.createObjectURL(result.blob);
        photoUrls.push(newUrl);

        // Update photo count display
        const countEl = document.getElementById('edit-photo-count');
        if (countEl) {
          countEl.textContent = photoUrls.length + ' photo' + (photoUrls.length > 1 ? 's' : '');
        }

        // Rebuild the photo display area
        const existingGrid = sheet.querySelector('.edit-photo-grid');
        const existingSingle = sheet.querySelector('.ql-photo-preview:not(.edit-photo-grid-item):not(.edit-photo-locked)');

        if (existingGrid) {
          // Already a grid — add new item
          const newItem = document.createElement('div');
          newItem.className = 'ql-photo-preview edit-photo-grid-item';
          newItem.dataset.photoIdx = photoUrls.length - 1;
          newItem.innerHTML = `<img src="${newUrl}" alt="">`;
          newItem.style.cursor = 'pointer';
          newItem.addEventListener('click', (e) => {
            e.stopPropagation();
            UI.showPhotoViewer(newUrl, entry);
          });
          existingGrid.appendChild(newItem);
        } else if (existingSingle) {
          // Was a single photo — convert to grid
          const grid = document.createElement('div');
          grid.className = 'edit-photo-grid';
          grid.id = 'edit-photo-grid';

          for (let i = 0; i < photoUrls.length; i++) {
            const item = document.createElement('div');
            item.className = 'ql-photo-preview edit-photo-grid-item';
            item.dataset.photoIdx = i;
            item.innerHTML = `<img src="${photoUrls[i]}" alt="">`;
            item.style.cursor = 'pointer';
            const url = photoUrls[i];
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              UI.showPhotoViewer(url, entry);
            });
            grid.appendChild(item);
          }

          existingSingle.replaceWith(grid);
        } else {
          // No existing photos — insert single preview before the add photo section
          const addSection = document.getElementById('edit-add-photo-section');
          if (addSection) {
            const preview = document.createElement('div');
            preview.className = 'ql-photo-preview';
            preview.innerHTML = `<img src="${newUrl}" alt="">`;
            preview.style.cursor = 'pointer';
            preview.addEventListener('click', (e) => {
              e.stopPropagation();
              UI.showPhotoViewer(newUrl, entry);
            });
            addSection.insertAdjacentElement('beforebegin', preview);
          }
        }

        // Mark for re-upload and request re-analysis (new photo changes the nutrition estimate)
        entry.updatedAt = new Date().toISOString();
        entry._reanalyzeRequested = true;
        await DB.updateEntry(entry);
        CloudRelay.queueUpload(entry.date);
        UI.toast(`Photo added (${photoUrls.length} total)`);
      } catch (err) {
        console.error('Add photo failed:', err);
        UI.toast('Failed to add photo', 'error');
      }
    };

    if (addPhotoCaptureBtn) {
      addPhotoCaptureBtn.addEventListener('click', () => handleAddPhotoToEntry(true));
    }
    if (addPhotoPickBtn) {
      addPhotoPickBtn.addEventListener('click', () => handleAddPhotoToEntry(false));
    }

    // Entry lock toggle (for enabling edit/delete)
    const lockToggle = document.getElementById('edit-lock-toggle');
    if (lockToggle) {
      lockToggle.addEventListener('click', () => {
        const bar = document.getElementById('edit-lock-bar');
        const isLocked = !bar.classList.contains('unlocked');
        bar.classList.toggle('unlocked');

        const saveBtn = document.getElementById('edit-save');
        const deleteBtn = document.getElementById('edit-delete');
        const notesEl = document.getElementById('edit-notes');

        const dateEl = document.getElementById('edit-date');
        if (isLocked) {
          // Unlock
          saveBtn.disabled = false;
          saveBtn.classList.remove('btn-locked');
          deleteBtn.disabled = false;
          deleteBtn.classList.remove('btn-locked');
          if (notesEl) notesEl.disabled = false;
          if (dateEl) dateEl.disabled = false;
          lockToggle.textContent = 'Lock';
          bar.querySelector('.edit-lock-bar-text').textContent = 'Entry unlocked';
        } else {
          // Re-lock
          saveBtn.disabled = true;
          saveBtn.classList.add('btn-locked');
          deleteBtn.disabled = true;
          deleteBtn.classList.add('btn-locked');
          if (notesEl) notesEl.disabled = true;
          if (dateEl) dateEl.disabled = true;
          lockToggle.textContent = 'Unlock to edit';
          bar.querySelector('.edit-lock-bar-text').textContent = 'Entry locked';
        }
      });
    }

    const editNotes = document.getElementById('edit-notes');
    if (editNotes) {
      UI.autoResize(editNotes);
      editNotes.addEventListener('input', () => UI.autoResize(editNotes));
      editNotes.addEventListener('focus', () => {
        // When keyboard opens, scroll textarea into view within the modal
        setTimeout(() => editNotes.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
      });
    }

    // Save
    document.getElementById('edit-save').addEventListener('click', async () => {
      const notes = document.getElementById('edit-notes')?.value?.trim() || '';
      const newDate = document.getElementById('edit-date')?.value || entry.date;
      const oldDate = entry.date;
      const updated = { ...entry, notes, date: newDate };
      if (entry.type === 'workout') {
        const dur = document.getElementById('edit-duration')?.value;
        updated.duration_minutes = dur ? parseInt(dur) : null;
      }
      if (entry.type === 'weight') {
        const weightInput = document.getElementById('edit-weight-value');
        if (weightInput) {
          const newWeight = parseFloat(weightInput.value);
          if (!isNaN(newWeight) && newWeight > 0) {
            updated.weight_value = newWeight;
            updated.notes = `${newWeight} ${entry.weight_unit || 'lbs'}`;
          }
        }
      }
      // Hour picker for food entries — update the hour portion of the timestamp
      let hourChanged = false;
      const hourSelect = document.getElementById('edit-hour');
      if (hourSelect) {
        const newHour = parseInt(hourSelect.value);
        const ts = new Date(entry.timestamp);
        if (newHour !== ts.getHours()) {
          ts.setHours(newHour);
          updated.timestamp = ts.toISOString();
          hourChanged = true;
        }
      }
      // Only set updatedAt if something actually changed
      const notesChanged = notes !== (entry.notes || '');
      const changed = notesChanged || newDate !== oldDate || hourChanged
        || (entry.type === 'workout' && updated.duration_minutes !== entry.duration_minutes)
        || (entry.type === 'weight' && updated.weight_value !== entry.weight_value);
      if (changed) {
        updated.updatedAt = new Date().toISOString();
      }
      // Signal re-analysis only when nutrition-affecting fields changed.
      // Notes feed directly into the food analysis prompt, so changes must re-run the estimate.
      // Timestamp/date/subtype changes alone do not alter the food itself -- skip re-analysis.
      // Photo replacement is NOT a current edit path (handleAddPhotoToEntry only adds photos;
      // that flow sets _reanalyzeRequested separately). If photo replacement is ever added,
      // include it here.
      if (notesChanged) {
        updated._reanalyzeRequested = true;
      }
      try {
        await DB.updateEntry(updated);
        // Update dailySummary weight when a weight entry is edited
        if (updated.type === 'weight' && updated.weight_value) {
          const summary = await DB.getDailySummary(updated.date) || {};
          summary.weight = { value: updated.weight_value, unit: updated.weight_unit || 'lbs', timestamp: Date.now() };
          if (summary.weightLog) {
            const logEntry = summary.weightLog.find(w => Math.abs(w.timestamp - new Date(entry.timestamp).getTime()) < 60000);
            if (logEntry) logEntry.value = updated.weight_value;
          }
          await DB.updateDailySummary(updated.date, summary);
        }
        // Sync both old and new dates if the entry moved
        CloudRelay.queueUpload(newDate);
        if (newDate !== oldDate) CloudRelay.queueUpload(oldDate);
        const movedNote = newDate !== oldDate ? ` (moved to ${UI.formatRelativeDate(newDate)})` : '';
        UI.toast(`Entry updated${movedNote}`);
        closeModal();
        App.loadDayView();
      } catch (err) {
        console.error('Update failed:', err);
        UI.toast('Failed to update', 'error');
      }
    });

    // Delete
    document.getElementById('edit-delete').addEventListener('click', async () => {
      if (!confirm(`Delete this ${UI.entryLabel(entry.type, entry.subtype).toLowerCase()} entry?`)) return;
      try {
        await DB.deleteEntry(entry.id);
        UI.toast('Entry deleted');
        // Offer to delete from relay too
        const configured = await CloudRelay.isConfigured();
        if (configured && confirm('Also delete this day from the cloud relay?')) {
          await CloudRelay.deleteDayFromRelay(entry.date);
        }
        closeModal();
        App.loadDayView();
      } catch (err) {
        console.error('Delete failed:', err);
        UI.toast('Failed to delete', 'error');
      }
    });
  },

  // --- Full-screen photo viewer ---
  showPhotoViewer(photoUrl, entry) {
    // Remove any existing photo viewer first
    document.querySelector('.photo-viewer-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'photo-viewer-overlay';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'photo-viewer-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');

    const imgWrap = document.createElement('div');
    imgWrap.className = 'photo-viewer-img-wrap';

    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = '';
    imgWrap.appendChild(img);

    const actions = document.createElement('div');
    actions.className = 'photo-viewer-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'photo-viewer-download';
    downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Save to Photos`;

    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = document.createElement('a');
      a.href = photoUrl;
      const dateStr = entry.date || 'photo';
      const typeStr = entry.type || 'entry';
      a.download = `coach-${typeStr}-${dateStr}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      UI.toast('Photo saved');
    });

    actions.appendChild(downloadBtn);

    overlay.appendChild(closeBtn);
    overlay.appendChild(imgWrap);
    overlay.appendChild(actions);

    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === imgWrap) close(); });
    img.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
  },

  // --- Swipe-to-delete on entry cards ---
  _setupSwipeDelete(wrapper, card, entry) {
    let startX = 0, startY = 0, currentX = 0, swiping = false;
    const THRESHOLD = 80;

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'entry-delete-bg';
    deleteBtn.textContent = 'Delete';
    wrapper.appendChild(deleteBtn);

    card.addEventListener('touchstart', (e) => {
      // Reset any other swiped entries first
      document.querySelectorAll('.entry-item.swiped').forEach(other => {
        if (other !== card) { other.style.transform = ''; other.classList.remove('swiped'); }
      });
      // If this card is already swiped, reset it on new touch
      if (card.classList.contains('swiped')) {
        card.style.transition = 'transform 0.2s ease';
        card.style.transform = '';
        card.classList.remove('swiped');
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = 0;
      swiping = false;
      card.style.transition = 'none';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        swiping = true;
        wrapper.classList.add('swiping');
      }
      if (!swiping) return;
      currentX = Math.min(0, dx);
      card.style.transform = `translateX(${currentX}px)`;
    }, { passive: true });

    card.addEventListener('touchend', () => {
      card.style.transition = 'transform 0.2s ease';
      if (!card.classList.contains('swiped')) wrapper.classList.remove('swiping');
      if (currentX < -THRESHOLD) {
        card.style.transform = `translateX(-${THRESHOLD}px)`;
        card.classList.add('swiped');
      } else {
        card.style.transform = '';
        card.classList.remove('swiped');
      }
      swiping = false;
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Slide out
      card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      card.style.transform = 'translateX(-100%)';
      card.style.opacity = '0';
      deleteBtn.style.opacity = '0';

      let undone = false;
      const timer = setTimeout(() => {
        if (undone) return;
        undone = true; // Prevent undo after timer fires
        DB.deleteEntry(entry.id).then(() => {
          wrapper.remove();
          CloudRelay.queueUpload(entry.date);
        }).catch(err => {
          console.error('Delete failed:', err);
          UI.toast('Failed to delete', 'error');
        });
      }, 4000);

      UI.toast(`Deleted ${UI.entryLabel(entry.type, entry.subtype).toLowerCase()}`, 'info', {
        action: 'Undo',
        onAction: () => {
          if (undone) return; // Timer already fired
          undone = true;
          clearTimeout(timer);
          card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
          card.style.transform = '';
          card.style.opacity = '';
          deleteBtn.style.opacity = '';
          card.classList.remove('swiped');
        },
        duration: 4000,
      });
    });
  },
};
