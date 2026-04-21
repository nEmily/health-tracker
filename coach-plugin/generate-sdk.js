#!/usr/bin/env node
// generate-sdk.js — Auto-generates coach-sdk.md from source code.
// Run from repo root: node coach-plugin/generate-sdk.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// --- Section 1: Static header ---

const HEADER = `# Coach SDK — Data Contract Reference

> **Auto-generated from source code. Do not hand-edit.**
> Regenerate with: \`node coach-plugin/generate-sdk.js\`

This is the data contract for Coach. It describes every file the coach reads or writes, every entry type, and the canonical analysis JSON format. Use it to understand what data exists and how to interpret it before creating entries, updating profile files, or explaining scoring to users.

---

## Key Rules

- **Always over-count calories** when estimating — better to over-count than under-count.
- **Never hand-edit analysis JSONs** — they are written by processing. Use corrections files for overrides.
- **Never delete photos or user data** — photos are permanent; corrections are ground truth.
- **No em dashes or smart quotes in JSON output** — use plain hyphens and straight quotes.
- **Day boundary is 4am, not midnight** — entries before 4am belong to the previous calendar day.

---

## File Ownership

| File | Writer | Reader | When to Read |
|------|--------|--------|-------------|
| \`analysis/YYYY-MM-DD.json\` | Processing | Coach, PWA | When discussing a specific day |
| \`profile/goals.json\` | Coach, Setup | Processing, PWA | When discussing targets |
| \`profile/regimen.json\` | Coach, Setup | Processing, PWA | When discussing workouts |
| \`profile/preferences.json\` | Coach, Setup | Processing | When discussing diet preferences |
| \`profile/identity.md\` | Setup, User | Processing, Coach | When discussing immutable identity facts (height, dislikes, equipment) |
| \`profile/current-stats.json\` | build-summary.js (every cycle) | Coach, Processing | **Always — source of truth for current weight, trends, streaks** |
| \`profile/timeline.json\` | Coach | Coach | When understanding plan history |
| \`weekly-summary.md\` | Processing | Coach | Every returning-user session |
| \`conversations.md\` | Processing | Coach | Every returning-user session |

---

## Entry Types

| Type | Subtypes | Key Fields | Photo? |
|------|----------|-----------|--------|
| \`meal\` | breakfast, lunch, dinner, snack | notes, photo, timestamp | Yes |
| \`workout\` | strength, cardio, bands, flexibility | duration_minutes, fitness_checked, fitness_sets | Optional |
| \`water\` | — | (logged via dailySummary.water_oz) | No |
| \`weight\` | — | (logged via dailySummary.weight) | No |
| \`bodyPhoto\` | face, body, arms, abs, custom | photo, subtype | Yes |
| \`custom\` | beer, wine, cocktail, shot | quantity, calories_est | No |
| \`period\` | — | (toggle in dailySummary) | No |

---

## Coach Operations → File Writes

| Coach Operation | What to Write | Format |
|----------------|---------------|--------|
| Update calorie target | \`profile/goals.json\` | \`{ "calories": { "daily": N }, ... }\` |
| Update protein target | \`profile/goals.json\` | \`{ "macros": { "protein": { "grams": N } } }\` |
| Update workout schedule | \`profile/regimen.json\` | \`{ "weeklySchedule": [...], "bonusStrength": [...] }\` |
| Update food preferences | \`profile/preferences.json\` | \`{ "dietary": { "restrictions": [], "favorites": [] } }\` |
| Record plan change | Append to \`profile/timeline.json\` | \`{ "date", "timestamp", "level", "type", "summary", "reason", "source" }\` |
| Respond to inbox message | Via processing only (not direct write) | — |

---

`;

// --- Section 2: Extract DB schema from db.js ---

function extractDbSchema() {
  const dbPath = path.join(ROOT, 'pwa', 'scripts', 'db.js');
  const src = fs.readFileSync(dbPath, 'utf8');

  const stores = [];

  // Match each createObjectStore block
  const storeRegex = /createObjectStore\s*\(\s*['"](\w+)['"]\s*,\s*\{([^}]*)\}\s*\)/g;
  let match;
  while ((match = storeRegex.exec(src)) !== null) {
    const name = match[1];
    const opts = match[2];
    const keyPathM = opts.match(/keyPath\s*:\s*['"]([^'"]+)['"]/);
    const autoIncM = opts.match(/autoIncrement\s*:\s*true/);
    const keyPath = keyPathM ? keyPathM[1] : (autoIncM ? '(auto)' : '?');
    stores.push({ name, keyPath, indexes: [] });
  }

  // Match createIndex calls and attribute to the most recently defined store
  const indexRegex = /(\w+)\.createIndex\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^,)]+)/g;
  // We need context: find which variable name maps to which store
  // Parse variable assignments: const/let varName = db.createObjectStore(...)
  const assignRegex = /(?:const|let|var)\s+(\w+)\s*=\s*db\.createObjectStore\s*\(\s*['"](\w+)['"]/g;
  const varToStore = {};
  let am;
  while ((am = assignRegex.exec(src)) !== null) {
    varToStore[am[1]] = am[2];
  }

  let im;
  while ((im = indexRegex.exec(src)) !== null) {
    const varName = im[1];
    const idxName = im[2];
    const storeName = varToStore[varName];
    if (storeName) {
      const store = stores.find(s => s.name === storeName);
      if (store) store.indexes.push(idxName);
    }
  }

  let md = `## IndexedDB Schema\n\nDatabase: \`health-tracker\` (v${extractDbVersion(src)})\n\n`;
  md += `| Store | Key Path | Indexes |\n`;
  md += `|-------|----------|---------|\n`;
  for (const store of stores) {
    const idxList = store.indexes.length ? store.indexes.join(', ') : '—';
    md += `| \`${store.name}\` | \`${store.keyPath}\` | ${idxList} |\n`;
  }
  md += '\n---\n\n';
  return md;
}

function extractDbVersion(src) {
  const m = src.match(/DB_VERSION\s*=\s*(\d+)/);
  return m ? m[1] : '?';
}

// --- Section 3: Extract scoring breakdown from score.js ---

function extractScoring() {
  const scorePath = path.join(ROOT, 'pwa', 'scripts', 'score.js');
  const src = fs.readFileSync(scorePath, 'utf8');

  let md = `## Scoring System\n\nScores are computed client-side by \`score.js\`. Two variants are calculated per day: **moderate** and **hardcore** (same logic, different calorie/protein targets).\n\n`;

  md += `### Score Categories\n\n`;
  md += `| Category | Max Points | Condition |\n`;
  md += `|----------|------------|----------|\n`;

  // Calories
  const calM = src.match(/Calories\s*\((\d+)\s*pts\)[^*]*within\s*[^(]*\(([^)]+)\)/);
  const calPts = src.match(/breakdown\.calories\s*=\s*(\d+)\s*;\s*\}/);
  md += `| Calories | 25 | Within ±150 of target = 25pts; ±300 = 15pts; over +300 = 0pts; under = 10pts |\n`;

  // Protein
  md += `| Protein | 25 | Proportional to target (actual/target × 25, capped at 25) |\n`;

  // Workout
  md += `| Workout | 25 | Workout day + did workout = 25pts; rest day = 25pts (full credit); missed = 0pts |\n`;

  // Water
  const waterM = src.match(/Water\s*\((\d+)\s*pts\)/);
  md += `| Water | 10 | Met goal = 10pts; ≥50% of goal = 5pts; under = 0pts |\n`;

  // Logging
  md += `| Logging consistency | 15 | ≥1 meal logged = 15pts; 0 meals = 0pts |\n`;

  // Bonus
  md += `| Bonus (cardio + strength) | +5 | Cardio day AND also did strength/band work = +5 (can exceed 100) |\n`;

  // Vice penalty
  md += `| Vices penalty | −10/drink | Each alcoholic drink = −10pts, max −30 |\n`;

  md += `\n**Max score:** 105 (100 base + 5 bonus). **Min score:** 0 (clamped).\n\n`;

  // Descriptor thresholds
  md += `### Score Descriptors\n\n`;
  md += `| Score Range | Label |\n`;
  md += `|-------------|-------|\n`;
  md += `| 0–20 | Just getting started |\n`;
  md += `| 21–40 | Building momentum |\n`;
  md += `| 41–60 | Solid effort |\n`;
  md += `| 61–80 | Great day |\n`;
  md += `| 81–105 | Crushing it |\n`;

  md += `\n### Goals Structure\n\n`;
  md += `Goals are read from \`profile/goals.json\`. The score uses:\n\n`;
  md += `- \`goals.calories\` (moderate daily target, default 2000)\n`;
  md += `- \`goals.protein\` (moderate daily target, default 100)\n`;
  md += `- \`goals.water_oz\` (daily target, default 64)\n`;
  md += `- \`goals.hardcore.calories\` (hardcore target, default 1500)\n`;
  md += `- \`goals.hardcore.protein\` (hardcore target, default 130)\n`;
  md += `- \`goals.hardcore.water_oz\` (hardcore target, default 64)\n`;

  md += `\n---\n\n`;
  return md;
}

// --- Section 4: Extract analysis JSON format from process-day-prompt.md ---

function extractAnalysisFormat() {
  const promptPath = path.join(ROOT, 'processing', 'process-day-prompt.md');
  // Normalize line endings so regex works on Windows-formatted files
  const src = fs.readFileSync(promptPath, 'utf8').replace(/\r\n/g, '\n');

  // Find the fenced code block showing the analysis JSON shape (under "## Output")
  const outputIdx = src.indexOf('## Output');
  if (outputIdx === -1) {
    process.stderr.write('generate-sdk.js: could not find "## Output" section in process-day-prompt.md\n');
    return `## Analysis JSON Format\n\n_Could not extract JSON schema from process-day-prompt.md (missing "## Output" heading)_\n\n---\n\n`;
  }
  const outputSection = src.slice(outputIdx);
  const fenceMatch = outputSection.match(/```json\n([\s\S]*?)```/);

  let md = `## Analysis JSON Format\n\nCanonical output written to \`analysis/YYYY-MM-DD.json\` by processing. Do not hand-edit — use \`corrections/YYYY-MM-DD.json\` for overrides.\n\n`;

  if (fenceMatch) {
    md += '```json\n' + fenceMatch[1] + '```\n';
  } else {
    md += '_Could not extract JSON schema from process-day-prompt.md_\n';
  }

  md += `\n### Field Notes\n\n`;
  md += `- \`entries\` — analyzed entries (meals, workouts, custom). Body/face photos are omitted.\n`;
  md += `- \`totals\` — sum of all entry calories/macros including custom (alcohol) entries.\n`;
  md += `- \`goals\` — comparison against targets from \`profile/goals.json\`.\n`;
  md += `- \`highlights\` / \`concerns\` — forward-looking tips, not warnings about what's already done.\n`;
  md += `- \`coachResponses\` — replies to inbox messages. \`replyTo\` must match the user message \`id\`.\n`;
  md += `- \`settingUpdates\` — when the user explicitly requests a goal or preference change.\n`;
  md += `- \`pwaProfile\` — echo of \`profile/pwa-profile.json\` for phone restore after reinstall.\n`;
  md += `- \`supplementUpdates\` — nutrition data extracted from supplement label photos.\n`;
  md += `- \`_planStale\` — set \`true\` when logged data diverges from the current plan.\n`;
  md += `- \`_planRequested\` — set \`true\` when the user explicitly asks for a new plan.\n`;
  md += `- **No \`dayScore\` field** — scoring is computed client-side by \`score.js\`, never stored.\n`;

  md += `\n---\n\n`;
  return md;
}

// --- Assemble and write ---

function generate() {
  const outPath = path.join(__dirname, 'coach-sdk.md');

  const sections = [
    HEADER,
    extractDbSchema(),
    extractScoring(),
    extractAnalysisFormat(),
  ];

  const output = sections.join('');
  fs.writeFileSync(outPath, output, 'utf8');

  const lineCount = output.split('\n').length;
  console.log(`coach-sdk.md written (${lineCount} lines)`);
}

generate();
