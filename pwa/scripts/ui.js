// ui.js — Shared UI utilities

const UI = {
  // --- Date Helpers ---
  today() {
    const d = new Date();
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

  formatRelativeDate(dateStr) {
    const today = UI.today();
    if (dateStr === today) return 'Today';
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    if (dateStr === yesterday) return 'Yesterday';
    return UI.formatDate(dateStr);
  },

  // --- ID Generation ---
  generateId(prefix) {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 6);
    return `${prefix}_${ts}_${rand}`;
  },

  // --- Toast Notifications ---
  toast(message, type = 'success', duration = 2500) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove());
    }, duration);
  },

  // --- Entry Icons & Labels ---
  entryIcon(type, subtype) {
    const icons = {
      meal: { breakfast: '\u{1F373}', lunch: '\u{1F96A}', dinner: '\u{1F35D}', default: '\u{1F37D}\uFE0F' },
      snack: '\u{1F36A}',
      drink: '\u{1F964}',
      workout: { strength: '\u{1F4AA}', cardio: '\u{1F3C3}', flexibility: '\u{1F9D8}', default: '\u{1F3CB}\uFE0F' },
      water: '\u{1F4A7}',
      weight: '\u{2696}\uFE0F',
      bodyPhoto: '\u{1F4F7}',
      sleep: '\u{1F634}',
    };
    const icon = icons[type];
    if (typeof icon === 'object') return icon[subtype] || icon.default;
    return icon || '\u{1F4CB}';
  },

  entryLabel(type, subtype) {
    if (subtype) {
      return subtype.charAt(0).toUpperCase() + subtype.slice(1);
    }
    const labels = {
      meal: 'Meal', snack: 'Snack', drink: 'Drink',
      workout: 'Workout', water: 'Water', weight: 'Weight',
      bodyPhoto: 'Body Photo', sleep: 'Sleep',
    };
    return labels[type] || type;
  },

  // --- Text Escaping ---
  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // --- DOM Helpers ---
  $(selector) {
    return document.querySelector(selector);
  },

  $$(selector) {
    return document.querySelectorAll(selector);
  },

  createElement(tag, className, innerHTML) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
  },

  clearChildren(el) {
    // Revoke any object URLs in child images to prevent memory leaks
    el.querySelectorAll?.('img[src^="blob:"]')?.forEach(img => URL.revokeObjectURL(img.src));
    while (el.firstChild) el.removeChild(el.firstChild);
  },

  // --- Render an entry item ---
  renderEntryItem(entry) {
    const div = UI.createElement('div', 'entry-item');

    const icon = UI.createElement('div', 'entry-icon');
    icon.textContent = UI.entryIcon(entry.type, entry.subtype);

    const body = UI.createElement('div', 'entry-body');

    const typeLabel = UI.createElement('div', 'entry-type');
    typeLabel.textContent = UI.entryLabel(entry.type, entry.subtype);

    body.appendChild(typeLabel);

    if (entry.notes) {
      const notes = UI.createElement('div', 'entry-notes');
      notes.textContent = entry.notes;
      body.appendChild(notes);
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

    // Load photo thumbnail if entry has a photo
    if (entry.photo) {
      if (entry.type === 'bodyPhoto') {
        // Body photos are private — show lock icon, tap to reveal
        const lock = UI.createElement('div', 'entry-photo-thumb entry-photo-locked');
        lock.textContent = '\u{1F512}';
        let currentPhotoUrl = null;
        const hideLock = () => {
          lock.classList.remove('revealed');
          lock.textContent = '\u{1F512}';
          lock.style.backgroundImage = '';
          if (currentPhotoUrl) { URL.revokeObjectURL(currentPhotoUrl); currentPhotoUrl = null; }
        };
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          if (lock.classList.contains('revealed')) { hideLock(); return; }
          DB.getPhotos(entry.id).then(photos => {
            if (photos.length > 0 && photos[0].blob) {
              currentPhotoUrl = URL.createObjectURL(photos[0].blob);
              lock.textContent = '';
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
        const thumb = UI.createElement('img', 'entry-photo-thumb');
        thumb.alt = '';
        thumb.loading = 'lazy';
        DB.getPhotos(entry.id).then(photos => {
          if (photos.length > 0 && photos[0].blob) {
            thumb.src = URL.createObjectURL(photos[0].blob);
          }
        });
        div.appendChild(thumb);
      }
    }

    return div;
  },
};
