#!/usr/bin/env node
// build-conversations.js — Aggregates all coach chat messages into conversations.md
// Run after processing to keep the conversation history current.
// Reads from: analysis/*.json (coachResponses) + extracted log.json (coachChat)

const fs = require('fs');
const path = require('path');

const coachDir = process.env.COACH_DIR || path.join(require('os').homedir(), 'Coach');
const analysisDir = path.join(coachDir, 'analysis');
// Daily data may be in a separate dir (set via HEALTH_DATA_DIR)
// or in the same dir as Coach (default). Check both.
const dataDir = process.env.HEALTH_DATA_DIR || coachDir;
const outPath = path.join(coachDir, 'conversations.md');

// Collect all conversations from analysis files and daily exports
const conversations = [];

// Read analysis files for coach responses
if (fs.existsSync(analysisDir)) {
  const files = fs.readdirSync(analysisDir).filter(f => f.endsWith('.json')).sort();
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(analysisDir, file), 'utf8'));
      const date = file.replace('.json', '');
      const responses = data.coachResponses || [];
      if (responses.length > 0) {
        conversations.push({ date, type: 'responses', messages: responses });
      }
    } catch (e) { /* skip corrupt files */ }
  }
}

// Read daily exports for user messages (coachChat in log.json)
const dailyDir = path.join(dataDir, 'daily');
if (fs.existsSync(dailyDir)) {
  const dateDirs = fs.readdirSync(dailyDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const date of dateDirs) {
    const logPath = path.join(dailyDir, date, 'log.json');
    if (fs.existsSync(logPath)) {
      try {
        const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        const chat = (log.coachChat || []).filter(m => m.role === 'user');
        if (chat.length > 0) {
          conversations.push({ date, type: 'user', messages: chat });
        }
      } catch (e) { /* skip */ }
    }
  }
}

// Also check extracted ZIPs in the data dir
const extractedDir = path.join(dataDir, 'incoming');
if (fs.existsSync(extractedDir)) {
  // Look for log.json in extracted subdirectories
  const findLogs = (dir) => {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isFile() && item.name === 'log.json') {
          try {
            const log = JSON.parse(fs.readFileSync(path.join(dir, item.name), 'utf8'));
            const chat = (log.coachChat || []).filter(m => m.role === 'user');
            if (chat.length > 0 && log.date) {
              conversations.push({ date: log.date, type: 'user', messages: chat });
            }
          } catch (e) { /* skip */ }
        } else if (item.isDirectory()) {
          findLogs(path.join(dir, item.name));
        }
      }
    } catch (e) { /* skip */ }
  };
  findLogs(extractedDir);
}

// Deduplicate by message ID and merge into timeline
const allMessages = new Map(); // id -> { date, role, text, timestamp }
let autoId = 0; // fallback counter for messages with no ID or timestamp

for (const conv of conversations) {
  for (const msg of conv.messages) {
    if (conv.type === 'user') {
      // User messages from coachChat — always role: user
      const id = msg.id || `${conv.date}_user_${msg.timestamp || autoId++}`;
      allMessages.set(id, {
        date: conv.date,
        role: 'user',
        text: msg.text,
        timestamp: msg.timestamp || 0,
        id,
      });
    } else if (conv.type === 'responses') {
      // Coach responses from analysis — always role: coach
      const rId = `reply_${msg.replyTo || `${conv.date}_coach_${msg.timestamp || autoId++}`}`;
      allMessages.set(rId, {
        date: conv.date,
        role: 'coach',
        text: msg.text,
        timestamp: msg.timestamp || 0,
        replyTo: msg.replyTo,
      });
    }
  }
}

// Sort by date then timestamp
const sorted = [...allMessages.values()].sort((a, b) => {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.timestamp || 0) - (b.timestamp || 0);
});

// Group by date and write markdown
let md = '# Conversations\n\nChat history from the Coach app (auto-generated, do not edit).\n\n';

let currentDate = null;
for (const msg of sorted) {
  if (msg.date !== currentDate) {
    currentDate = msg.date;
    const d = new Date(msg.date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    md += `## ${label}\n\n`;
  }

  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const prefix = msg.role === 'user' ? '**You**' : '**Coach**';
  // Sanitize text: collapse newlines to spaces, strip markdown headings
  const safeText = (msg.text || '').replace(/\n+/g, ' ').replace(/^#{1,6}\s/gm, '');
  md += `${prefix}${time ? ` (${time})` : ''}: ${safeText}\n\n`;
}

if (sorted.length === 0) {
  md += '_No conversations yet. Send a message from the Coach app to start._\n';
}

fs.writeFileSync(outPath, md);
console.log(`Built conversations.md: ${sorted.length} messages across ${new Set(sorted.map(m => m.date)).size} days`);
