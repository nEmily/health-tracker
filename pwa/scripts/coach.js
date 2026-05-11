// coach.js — Async coach chat (messages sync via cloud relay, responses arrive within ~30 min)

const CoachChat = {
  formatSettingUpdate(updates) {
    const parts = [];

    if (updates.goals) {
      const goals = updates.goals;
      if (goals.moderate) {
        const mod = goals.moderate;
        if (mod.calories) parts.push(`Moderate calorie goal updated to ${mod.calories}`);
        if (mod.protein) parts.push(`Moderate protein goal updated to ${mod.protein}g`);
        if (mod.water) parts.push(`Moderate water goal updated to ${mod.water}L`);
      }
      if (goals.hardcore) {
        const hard = goals.hardcore;
        if (hard.calories) parts.push(`Hardcore calorie goal updated to ${hard.calories}`);
        if (hard.protein) parts.push(`Hardcore protein goal updated to ${hard.protein}g`);
        if (hard.water) parts.push(`Hardcore water goal updated to ${hard.water}L`);
      }
      // Flat goals (legacy)
      if (goals.calories != null) parts.push(`Calorie goal updated to ${Goals.resolve(goals).calories}`);
      if (goals.protein != null) parts.push(`Protein goal updated to ${Goals.resolve(goals).protein}g`);
      if (goals.water) parts.push(`Water goal updated to ${goals.water}L`);
    }

    if (updates.preferences) {
      const prefs = updates.preferences;
      if (prefs.mealsPerDay) parts.push(`Meals per day updated to ${prefs.mealsPerDay}`);
      if (prefs.sleepTarget) parts.push(`Sleep target updated to ${prefs.sleepTarget}h`);
    }

    if (updates.regimen) {
      const reg = updates.regimen;
      if (reg.phase) parts.push(`Training phase updated to ${reg.phase}`);
      if (reg.focusAreas) parts.push(`Focus areas updated`);
    }

    return parts.join(', ') || 'Settings updated';
  },

  // How many days of history to load by default. Older days are fetched
  // when the user taps "Load older" at the top of the scroll.
  _DEFAULT_WINDOW_DAYS: 7,
  // Increment by this many days when "Load older" is tapped.
  _LOAD_MORE_DAYS: 7,
  // Tracks how many days back from today we're currently rendering.
  _windowDays: 7,

  async render(_unusedDate) {
    // Continuous chat history. Renders messages from the last _windowDays
    // days, with a date separator between each day. Newest at the bottom.
    // Older days fetched on demand via "Load older" button.
    const today = UI.today();
    const days = CoachChat._windowDays;

    // Build the list of dates we want to render, oldest -> newest.
    const dateList = [];
    const todayDate = new Date(today + 'T12:00:00');
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      dateList.push(d.toISOString().slice(0, 10));
    }

    // Walk each date, collect timeline entries with the date attached.
    const buckets = [];
    let hasUnansweredAnywhere = false;
    let totalEvents = 0;
    for (const date of dateList) {
      const events = await CoachChat._eventsForDate(date);
      if (events.unanswered) hasUnansweredAnywhere = true;
      if (events.timeline.length > 0 || date === today) {
        // Always include today's bucket (so empty-state hint shows correctly)
        buckets.push({ date, timeline: events.timeline });
        totalEvents += events.timeline.length;
      }
    }

    let html = '<div class="coach-chat">';
    html += '<div class="coach-messages" id="coach-messages">';

    // "Load older" button at top of scroll. Only render when the user has
    // history to load — on a brand-new account or a session with zero
    // messages anywhere in the window, the button has nothing to do and
    // just confuses the empty-state UI.
    if (totalEvents > 0) {
      html += `
        <div class="coach-load-older-wrap">
          <button class="coach-load-older" id="coach-load-older">Load older messages</button>
        </div>
      `;
    }

    if (totalEvents === 0) {
      // Pure empty state — no messages anywhere in window.
      html += `
        <div class="coach-empty-state">
          <div class="coach-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <p class="coach-empty-title">Your coach is here</p>
          <p class="coach-empty-sub">Ask about your diet, workouts, or goals. Send a message below — your coach checks in every ~30 min.</p>
        </div>
      `;
    } else {
      for (const bucket of buckets) {
        html += CoachChat._renderBucket(bucket, today);
      }
      if (hasUnansweredAnywhere) {
        html += '<div class="chat-waiting">Coach is reviewing your message...</div>';
      }
    }

    html += '</div>'; // end .coach-messages

    // Input bar — always shown (any reply lands on today's bucket bottom)
    html += `
      <div class="coach-input-bar">
        <textarea class="coach-input" id="coach-input" placeholder="Ask your coach..." rows="1"></textarea>
        <button class="coach-send" id="coach-send" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="coach-reply-hint">~30 min reply via sync</div>
    `;
    html += '</div>';
    return html;
  },

  // Build timeline + unanswered-flag for a single date.
  async _eventsForDate(date) {
    const summary = await DB.getDailySummary(date);
    const analysis = await DB.getAnalysis(date);
    const userMessages = (summary?.coachChat || []).filter(m => m.role === 'user');
    const rawCoachMessages = analysis?.coachResponses || [];
    const coachMessages = rawCoachMessages.map(cm => ({
      ...cm,
      respondsTo: Array.isArray(cm.respondsTo) ? cm.respondsTo : (cm.replyTo ? [cm.replyTo] : []),
    }));
    const answeredIds = new Set();
    for (const cm of coachMessages) {
      for (const id of cm.respondsTo) answeredIds.add(id);
    }
    const unanswered = userMessages.some(m => !answeredIds.has(m.id));
    const timeline = [];
    for (const msg of userMessages) {
      timeline.push({
        role: 'user',
        text: msg.text || msg.content,
        timestamp: msg.timestamp || 0,
      });
    }
    for (const cm of coachMessages) {
      const ts = cm.timestamp || 0;
      timeline.push({ role: 'coach', text: cm.text || cm.content, timestamp: ts });
      if (cm.settingUpdates) {
        timeline.push({ role: 'settings', updates: cm.settingUpdates, timestamp: ts + 1 });
      }
    }
    timeline.sort((a, b) => a.timestamp - b.timestamp);
    return { timeline, unanswered };
  },

  _renderBucket(bucket, today) {
    const dt = new Date(bucket.date + 'T12:00:00');
    let label;
    if (bucket.date === today) label = 'Today';
    else {
      const yesterday = new Date(today + 'T12:00:00');
      yesterday.setDate(yesterday.getDate() - 1);
      if (bucket.date === yesterday.toISOString().slice(0, 10)) label = 'Yesterday';
      else label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }
    let html = `<div class="coach-day-sep"><span>${UI.escapeHtml(label)}</span></div>`;
    if (bucket.timeline.length === 0) {
      // Today with no activity — render minimal hint, no bubbles
      return html;
    }
    for (const msg of bucket.timeline) {
      if (msg.role === 'settings') {
        const summary = CoachChat.formatSettingUpdate(msg.updates);
        html += `
          <div class="coach-setting-update">
            <div class="coach-setting-icon">✓</div>
            <div class="coach-setting-text">${UI.escapeHtml(summary)}</div>
          </div>
        `;
      } else {
        const isUser = msg.role === 'user';
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
        html += `
          <div class="chat-bubble ${isUser ? 'chat-user' : 'chat-coach'}">
            <div class="chat-text">${UI.escapeHtml(msg.text)}</div>
            ${time ? `<div class="chat-time">${time}</div>` : ''}
          </div>
        `;
      }
    }
    return html;
  },

  bindEvents() {
    const input = document.getElementById('coach-input');
    const sendBtn = document.getElementById('coach-send');
    const loadOlder = document.getElementById('coach-load-older');

    // Load older messages — extend window. Scroll to the TOP after so the
    // user actually sees the newly-loaded older content (a "preserve scroll
    // position" approach was technically correct but visually nothing seemed
    // to change, which felt broken).
    if (loadOlder) {
      loadOlder.addEventListener('click', async () => {
        CoachChat._windowDays += CoachChat._LOAD_MORE_DAYS;
        const container = document.getElementById('coach-inbox');
        if (container) {
          container.innerHTML = await CoachChat.render();
          CoachChat.bindEvents();
          const messages = document.getElementById('coach-messages');
          if (messages) {
            // Show the newly-prepended older content; user can scroll down
            // to get back to recent.
            messages.scrollTop = 0;
          }
        }
      });
    }

    if (!input || !sendBtn) return;

    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.disabled = true;
      sendBtn.disabled = true;

      // Messages always go to today (where the input lives).
      const today = UI.today();

      try {
        const summary = await DB.getDailySummary(today);
        const chat = summary.coachChat || [];
        const msg = {
          id: `coach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text,
          timestamp: Date.now(),
        };
        chat.push(msg);
        await DB.updateDailySummary(today, { coachChat: chat });

        if (await CloudRelay.isConfigured()) {
          CloudRelay.queueUpload(today);
        }

        const container = document.getElementById('coach-inbox');
        if (container) {
          container.innerHTML = await CoachChat.render();
          CoachChat.bindEvents();
          const messages = document.getElementById('coach-messages');
          if (messages) messages.scrollTop = messages.scrollHeight;
        }
      } catch (err) {
        console.error('Coach send failed:', err);
        UI.toast('Failed to send message', 'error');
      }

      const freshInput = document.getElementById('coach-input');
      const freshBtn = document.getElementById('coach-send');
      if (freshInput) { freshInput.disabled = false; freshInput.focus(); }
      if (freshBtn) freshBtn.disabled = false;
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', () => UI.autoResize(input));
  },
};
