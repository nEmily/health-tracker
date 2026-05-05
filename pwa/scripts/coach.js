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

  async render(date) {
    const summary = await DB.getDailySummary(date);
    const analysis = await DB.getAnalysis(date);
    const isToday = date === UI.today();

    // Merge user messages from dailySummary with coach responses from analysis
    const userMessages = (summary.coachChat || []).filter(m => m.role === 'user');
    const rawCoachMessages = (analysis?.coachResponses || []);

    // Normalize respondsTo: prefer array field, fall back to [replyTo] for old entries
    const coachMessages = rawCoachMessages.map(cm => ({
      ...cm,
      respondsTo: Array.isArray(cm.respondsTo) ? cm.respondsTo : (cm.replyTo ? [cm.replyTo] : []),
    }));

    // Determine which user messages have a coach reply
    const answeredIds = new Set();
    for (const cm of coachMessages) {
      for (const id of cm.respondsTo) answeredIds.add(id);
    }
    const hasUnanswered = userMessages.some(m => !answeredIds.has(m.id));

    // Build conversation-order timeline: a coach response appears immediately
    // after the last user message it answers, not 30 min later when the cron
    // actually generated it. This produces back-and-forth flow that reads like
    // a real conversation.
    //
    // sortKey:
    //   - user message: own timestamp
    //   - coach response: max(respondsTo timestamps) + 1 ms (so it sits right
    //     after the message-cluster it answers). Falls back to own timestamp
    //     if respondsTo is empty (unsolicited replies / legacy data).
    const userTsMap = new Map();
    for (const m of userMessages) userTsMap.set(m.id, m.timestamp || 0);

    const timeline = [];
    for (const msg of userMessages) {
      timeline.push({
        role: 'user',
        text: msg.text || msg.content,
        timestamp: msg.timestamp || 0,
        sortKey: msg.timestamp || 0,
      });
    }
    for (const cm of coachMessages) {
      const ownTs = cm.timestamp || 0;
      const refTs = (cm.respondsTo || []).reduce(
        (max, id) => Math.max(max, userTsMap.get(id) || 0), 0
      );
      // +1 ms places coach reply right after the user message it answers.
      // If no respondsTo refs found, fall back to own timestamp.
      const sortKey = refTs > 0 ? refTs + 1 : ownTs;
      timeline.push({
        role: 'coach',
        text: cm.text || cm.content,
        timestamp: ownTs,
        sortKey,
      });
      if (cm.settingUpdates) {
        timeline.push({
          role: 'settings',
          updates: cm.settingUpdates,
          timestamp: ownTs,
          sortKey: sortKey + 0.5,
        });
      }
    }
    timeline.sort((a, b) => a.sortKey - b.sortKey);

    let html = '<div class="coach-chat">';

    // Messages area — always rendered, takes flex space
    html += '<div class="coach-messages" id="coach-messages">';

    if (timeline.length === 0) {
      // Empty state: friendly explanation of how this works
      html += `
        <div class="coach-empty-state">
          <div class="coach-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <p class="coach-empty-title">Your coach is here</p>
          <p class="coach-empty-sub">Ask about your diet, workouts, or goals. ${isToday ? 'Send a message below — your coach checks in every ~30 min.' : 'No messages for this day.'}</p>
        </div>
      `;
    } else {
      for (const msg of timeline) {
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
      if (hasUnanswered) {
        html += '<div class="chat-waiting">Coach is reviewing your message...</div>';
      }
    }

    html += '</div>'; // end .coach-messages

    // Input bar (only for today) — anchored at bottom of chat area
    if (isToday) {
      html += `
        <div class="coach-input-bar">
          <textarea class="coach-input" id="coach-input" placeholder="Ask your coach..." rows="1"></textarea>
          <button class="coach-send" id="coach-send" aria-label="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div class="coach-reply-hint">~30 min reply via sync</div>
      `;
    }

    html += '</div>';
    return html;
  },

  bindEvents(date) {
    const input = document.getElementById('coach-input');
    const sendBtn = document.getElementById('coach-send');
    if (!input || !sendBtn) return;

    const send = async () => {
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      input.disabled = true;
      sendBtn.disabled = true;

      try {
        const summary = await DB.getDailySummary(date);
        const chat = summary.coachChat || [];
        const msg = {
          id: `coach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text,
          timestamp: Date.now(),
        };
        chat.push(msg);
        await DB.updateDailySummary(date, { coachChat: chat });

        // Trigger cloud relay upload so the processing script sees the message
        if (await CloudRelay.isConfigured()) {
          CloudRelay.queueUpload(date);
        }

        // Re-render chat
        const container = document.getElementById('coach-inbox');
        if (container) {
          container.innerHTML = await CoachChat.render(date);
          CoachChat.bindEvents(date);
          const messages = document.getElementById('coach-messages');
          if (messages) messages.scrollTop = messages.scrollHeight;
        }
      } catch (err) {
        console.error('Coach send failed:', err);
        UI.toast('Failed to send message', 'error');
      }

      // Re-target fresh DOM elements (old ones may be detached after re-render)
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
