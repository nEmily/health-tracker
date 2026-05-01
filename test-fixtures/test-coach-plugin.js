// test-fixtures/test-coach-plugin.js — Tests for Coach plugin setup + conversations builder
// Usage: node test-fixtures/test-coach-plugin.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

let pass = 0, fail = 0;
const failures = [];

function assert(ok, name, detail) {
  if (ok) { pass++; console.log(`  OK: ${name}`); }
  else { fail++; const m = detail ? `${name} (${detail})` : name; failures.push(m); console.log(`  FAIL: ${m}`); }
}

// Create a temp Coach folder for testing
const tmpDir = path.join(os.tmpdir(), `coach-test-${Date.now()}`);
const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} };

try {
  // ── TEST 1: Plugin templates exist and have key sections ──
  console.log('\n--- Plugin Templates ---');
  const pluginDir = path.join(__dirname, '..', 'coach-plugin');

  const soulPath = path.join(pluginDir, 'SOUL.md');
  const claudePath = path.join(pluginDir, 'CLAUDE.md');
  const convBuilderPath = path.join(pluginDir, 'build-conversations.js');

  assert(fs.existsSync(soulPath), 'SOUL.md exists');
  assert(fs.existsSync(claudePath), 'CLAUDE.md exists');
  assert(fs.existsSync(convBuilderPath), 'build-conversations.js exists');

  if (fs.existsSync(soulPath)) {
    const soul = fs.readFileSync(soulPath, 'utf8');
    assert(soul.includes('Your Essence'), 'SOUL.md has Essence section');
    assert(soul.includes('Core Traits'), 'SOUL.md has Core Traits');
    assert(soul.includes('How You Communicate'), 'SOUL.md has Communication style');
    assert(soul.includes("What You're Not"), 'SOUL.md has anti-patterns');
    assert(soul.includes('On Hard Days'), 'SOUL.md has Hard Days guidance');
    assert(soul.includes('On Wins'), 'SOUL.md has Wins guidance');
    assert(soul.includes('No "nourish your body"') || soul.includes('No corporate wellness'), 'SOUL.md bans wellness-speak');
    assert(soul.includes('over-count') || soul.includes('over-estimate'), 'SOUL.md mentions over-counting');
    assert(soul.includes('shame') || soul.includes('never harsh'), 'SOUL.md has no-shame rule');
  }

  if (fs.existsSync(claudePath)) {
    const claude = fs.readFileSync(claudePath, 'utf8');
    assert(claude.includes('SOUL.md'), 'CLAUDE.md references SOUL.md');
    assert(claude.includes('USER.md'), 'CLAUDE.md references USER.md');
    assert(claude.includes('conversations.md'), 'CLAUDE.md references conversations.md');
    assert(claude.includes('On Session Start'), 'CLAUDE.md has session start instructions');
    assert(claude.includes('analysis/'), 'CLAUDE.md references analysis dir');
    assert(claude.includes('profile/'), 'CLAUDE.md references profile dir');
    assert(claude.includes('USER.md') && claude.includes('Automatically start'), 'CLAUDE.md has auto-start onboarding when USER.md missing');
    assert(claude.includes('real logged data'), 'CLAUDE.md has data-over-plans rule');
  }

  // ── TEST 2: Setup skill exists and has key sections ──
  console.log('\n--- Setup Skill ---');
  const setupPath = path.join(__dirname, '..', '.claude', 'skills', 'setup', 'SKILL.md');
  // Try force-read even if gitignored
  let setupContent = '';
  try { setupContent = fs.readFileSync(setupPath, 'utf8'); } catch (e) {}

  if (setupContent) {
    assert(setupContent.includes('CWD') || setupContent.includes('current') || setupContent.includes('~/Coach'), 'Setup references install directory');
    assert(setupContent.includes('coach alias') || setupContent.includes('function coach'), 'Setup installs alias');
    assert(setupContent.includes('HEALTH_SYNC_URL'), 'Setup configures sync URL');
    assert(setupContent.includes('HEALTH_SYNC_KEY'), 'Setup configures sync key');
    assert(setupContent.includes('onboarding') || setupContent.includes('Onboarding'), 'Setup has onboarding flow');
    assert(setupContent.includes('height') || setupContent.includes('weight'), 'Setup asks about stats');
    assert(setupContent.includes('goals.json'), 'Setup writes goals');
    assert(setupContent.includes('preferences.json'), 'Setup writes preferences');
    assert(setupContent.includes('USER.md'), 'Setup writes USER.md');
    assert(setupContent.includes('scheduled') || setupContent.includes('ScheduledTask') || setupContent.includes('crontab'), 'Setup creates scheduled task');
    assert(setupContent.includes('PowerShell') || setupContent.includes('powershell'), 'Setup supports Windows');
    assert(setupContent.includes('bash') || setupContent.includes('Bash') || setupContent.includes('zsh'), 'Setup supports Mac/Linux');
    assert(!setupContent.includes('fork') || setupContent.includes('No fork'), 'Setup does not require forking');
    assert(!setupContent.includes('wrangler deploy'), 'Setup does not require Cloudflare account');
    assert(setupContent.includes('workers.dev'), 'Setup references the workers.dev relay placeholder');
  } else {
    assert(false, 'Setup skill readable (may be gitignored)');
  }

  // ── TEST 3: Conversations builder — mock data ──
  console.log('\n--- Conversations Builder ---');

  // Create temp Coach folder with mock analysis and daily data
  const mockCoach = tmpDir;
  const mockAnalysis = path.join(mockCoach, 'analysis');
  const mockDaily = path.join(mockCoach, 'daily', '2026-03-20');

  fs.mkdirSync(mockAnalysis, { recursive: true });
  fs.mkdirSync(mockDaily, { recursive: true });

  // Mock analysis with coach responses
  fs.writeFileSync(path.join(mockAnalysis, '2026-03-20.json'), JSON.stringify({
    date: '2026-03-20',
    coachResponses: [
      { replyTo: 'msg_001', text: 'Great question about snacks!', timestamp: 1773290000000 },
      { replyTo: 'msg_002', text: 'Try Greek yogurt for protein.', timestamp: 1773290001000 },
    ],
  }));

  // Mock log.json with user messages
  fs.writeFileSync(path.join(mockDaily, 'log.json'), JSON.stringify({
    date: '2026-03-20',
    coachChat: [
      { id: 'msg_001', role: 'user', text: 'What are good snacks?', timestamp: 1773282647792 },
      { id: 'msg_002', role: 'user', text: 'Need more protein ideas', timestamp: 1773282658558 },
    ],
  }));

  // Run builder with env vars pointing to mock dirs
  const builderSrc = fs.readFileSync(convBuilderPath, 'utf8').replace(/^#!.*[\r\n]+/, '');
  // Write a wrapper that overrides the dirs
  const wrapperPath = path.join(tmpDir, 'run-builder.js');
  fs.writeFileSync(wrapperPath, `
    process.env.COACH_DIR = ${JSON.stringify(mockCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(mockCoach)};
    ${builderSrc}
  `);

  try {
    const output = execSync(`node "${wrapperPath}"`, { encoding: 'utf8', timeout: 10000 });
    assert(output.includes('Built conversations.md'), 'Builder runs successfully');

    const convPath = path.join(mockCoach, 'conversations.md');
    assert(fs.existsSync(convPath), 'conversations.md created');

    if (fs.existsSync(convPath)) {
      const conv = fs.readFileSync(convPath, 'utf8');

      assert(conv.includes('# Conversations'), 'Has title');
      assert(conv.includes('What are good snacks?'), 'Contains user message 1');
      assert(conv.includes('Need more protein ideas'), 'Contains user message 2');
      assert(conv.includes('Great question about snacks!'), 'Contains coach response 1');
      assert(conv.includes('Try Greek yogurt'), 'Contains coach response 2');
      assert(conv.includes('**You**'), 'User messages labeled as You');
      assert(conv.includes('**Coach**'), 'Coach responses labeled as Coach');
      assert(conv.includes('March'), 'Has date header');

      // Check ordering: user messages before coach responses (grouped by time)
      const userIdx = conv.indexOf('What are good snacks?');
      const coachIdx = conv.indexOf('Great question about snacks!');
      assert(userIdx < coachIdx, 'User message appears before coach response');

      // Check both user messages appear in order
      const msg1Idx = conv.indexOf('What are good snacks?');
      const msg2Idx = conv.indexOf('Need more protein ideas');
      assert(msg1Idx < msg2Idx, 'User messages in chronological order');
    }
  } catch (e) {
    assert(false, 'Builder execution', e.message);
  }

  // ── TEST 4: Builder handles empty data gracefully ──
  console.log('\n--- Builder Edge Cases ---');

  const emptyCoach = path.join(tmpDir, 'empty-coach');
  const emptyAnalysis = path.join(emptyCoach, 'analysis');
  fs.mkdirSync(emptyAnalysis, { recursive: true });

  const emptyWrapper = path.join(tmpDir, 'run-builder-empty.js');
  fs.writeFileSync(emptyWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(emptyCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(path.join(tmpDir, 'nonexistent'))};
    ${builderSrc}
  `);

  try {
    execSync(`node "${emptyWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    const emptyConv = fs.readFileSync(path.join(emptyCoach, 'conversations.md'), 'utf8');
    assert(emptyConv.includes('No conversations yet'), 'Empty data shows placeholder');
    assert(!emptyConv.includes('undefined'), 'No undefined in empty output');
    assert(!emptyConv.includes('null'), 'No null in empty output');
  } catch (e) {
    assert(false, 'Builder handles empty data', e.message);
  }

  // ── TEST 5: Builder handles corrupt/malformed files ──
  const corruptCoach = path.join(tmpDir, 'corrupt-coach');
  const corruptAnalysis = path.join(corruptCoach, 'analysis');
  fs.mkdirSync(corruptAnalysis, { recursive: true });

  // Write corrupt JSON
  fs.writeFileSync(path.join(corruptAnalysis, '2026-03-20.json'), 'not json at all{{{');

  const corruptWrapper = path.join(tmpDir, 'run-builder-corrupt.js');
  fs.writeFileSync(corruptWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(corruptCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(path.join(tmpDir, 'nonexistent'))};
    ${builderSrc}
  `);

  try {
    execSync(`node "${corruptWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    assert(true, 'Builder survives corrupt JSON');
  } catch (e) {
    assert(false, 'Builder survives corrupt JSON', e.message);
  }

  // ── TEST 6: Builder deduplicates messages ──
  console.log('\n--- Deduplication ---');

  const dupeCoach = path.join(tmpDir, 'dupe-coach');
  const dupeAnalysis = path.join(dupeCoach, 'analysis');
  const dupeDaily = path.join(dupeCoach, 'daily', '2026-03-20');
  fs.mkdirSync(dupeAnalysis, { recursive: true });
  fs.mkdirSync(dupeDaily, { recursive: true });

  // Same messages in both analysis and daily
  fs.writeFileSync(path.join(dupeAnalysis, '2026-03-20.json'), JSON.stringify({
    date: '2026-03-20',
    coachResponses: [
      { replyTo: 'msg_dup', text: 'Coach says hello', timestamp: 1773290000000 },
    ],
  }));

  fs.writeFileSync(path.join(dupeDaily, 'log.json'), JSON.stringify({
    date: '2026-03-20',
    coachChat: [
      { id: 'msg_dup', role: 'user', text: 'Hello coach', timestamp: 1773282647792 },
      { id: 'msg_dup', role: 'user', text: 'Hello coach', timestamp: 1773282647792 }, // exact duplicate
    ],
  }));

  const dupeWrapper = path.join(tmpDir, 'run-builder-dupe.js');
  fs.writeFileSync(dupeWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(dupeCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(dupeCoach)};
    ${builderSrc}
  `);

  try {
    execSync(`node "${dupeWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    const dupeConv = fs.readFileSync(path.join(dupeCoach, 'conversations.md'), 'utf8');
    const helloCount = (dupeConv.match(/Hello coach/g) || []).length;
    assert(helloCount === 1, `Duplicate messages deduplicated (found ${helloCount})`);
  } catch (e) {
    assert(false, 'Deduplication test', e.message);
  }

  // ── TEST 7: Messages with no ID don't collide ──
  console.log('\n--- No-ID Message Handling ---');

  const noIdCoach = path.join(tmpDir, 'noid-coach');
  const noIdAnalysis = path.join(noIdCoach, 'analysis');
  const noIdDaily = path.join(noIdCoach, 'daily', '2026-03-20');
  fs.mkdirSync(noIdAnalysis, { recursive: true });
  fs.mkdirSync(noIdDaily, { recursive: true });

  fs.writeFileSync(path.join(noIdAnalysis, '2026-03-20.json'), JSON.stringify({
    date: '2026-03-20', coachResponses: [],
  }));
  // Two messages with NO id and NO timestamp — should both survive
  fs.writeFileSync(path.join(noIdDaily, 'log.json'), JSON.stringify({
    date: '2026-03-20',
    coachChat: [
      { role: 'user', text: 'First message no id' },
      { role: 'user', text: 'Second message no id' },
    ],
  }));

  const noIdWrapper = path.join(tmpDir, 'run-builder-noid.js');
  fs.writeFileSync(noIdWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(noIdCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(noIdCoach)};
    ${builderSrc}
  `);
  try {
    execSync(`node "${noIdWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    const conv = fs.readFileSync(path.join(noIdCoach, 'conversations.md'), 'utf8');
    const first = (conv.match(/First message no id/g) || []).length;
    const second = (conv.match(/Second message no id/g) || []).length;
    assert(first === 1, `First no-ID message preserved (found ${first})`);
    assert(second === 1, `Second no-ID message preserved (found ${second})`);
  } catch (e) {
    assert(false, 'No-ID messages', e.message.split('\n')[0]);
  }

  // ── TEST 8: Markdown injection sanitized ──
  console.log('\n--- Markdown Injection ---');

  const injCoach = path.join(tmpDir, 'inj-coach');
  const injAnalysis = path.join(injCoach, 'analysis');
  const injDaily = path.join(injCoach, 'daily', '2026-03-20');
  fs.mkdirSync(injAnalysis, { recursive: true });
  fs.mkdirSync(injDaily, { recursive: true });

  fs.writeFileSync(path.join(injAnalysis, '2026-03-20.json'), JSON.stringify({
    date: '2026-03-20', coachResponses: [],
  }));
  fs.writeFileSync(path.join(injDaily, 'log.json'), JSON.stringify({
    date: '2026-03-20',
    coachChat: [
      { id: 'inj1', role: 'user', text: 'Normal message', timestamp: 1000 },
      { id: 'inj2', role: 'user', text: '## Fake Heading\nSecond line\n### Another heading', timestamp: 2000 },
      { id: 'inj3', role: 'user', text: 'Message with\nnewlines\nin it', timestamp: 3000 },
    ],
  }));

  const injWrapper = path.join(tmpDir, 'run-builder-inj.js');
  fs.writeFileSync(injWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(injCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(injCoach)};
    ${builderSrc}
  `);
  try {
    execSync(`node "${injWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    const conv = fs.readFileSync(path.join(injCoach, 'conversations.md'), 'utf8');
    // Count ## headings — should only be the real date header, not injected ones
    const headings = conv.match(/^## .+$/gm) || [];
    const dateHeadings = headings.filter(h => h.match(/## \w+day,/));
    assert(headings.length === dateHeadings.length, `No injected headings (${headings.length} total, ${dateHeadings.length} date)`);
    // Newlines should be collapsed
    assert(!conv.includes('with\nnewlines'), 'Newlines collapsed in message text');
  } catch (e) {
    assert(false, 'Markdown injection test', e.message.split('\n')[0]);
  }

  // ── TEST 9: User messages with replyTo don't appear as coach responses ──
  console.log('\n--- No Double-Write ---');

  const dwCoach = path.join(tmpDir, 'dw-coach');
  const dwAnalysis = path.join(dwCoach, 'analysis');
  const dwDaily = path.join(dwCoach, 'daily', '2026-03-20');
  fs.mkdirSync(dwAnalysis, { recursive: true });
  fs.mkdirSync(dwDaily, { recursive: true });

  fs.writeFileSync(path.join(dwAnalysis, '2026-03-20.json'), JSON.stringify({
    date: '2026-03-20',
    coachResponses: [
      { replyTo: 'msg_a', text: 'Coach reply to A', timestamp: 5000 },
    ],
  }));
  // User message has replyTo (replying to a coach message) — should only appear as user, not coach
  fs.writeFileSync(path.join(dwDaily, 'log.json'), JSON.stringify({
    date: '2026-03-20',
    coachChat: [
      { id: 'msg_a', role: 'user', text: 'Question A', timestamp: 1000, replyTo: 'some_old_coach_msg' },
    ],
  }));

  const dwWrapper = path.join(tmpDir, 'run-builder-dw.js');
  fs.writeFileSync(dwWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(dwCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(dwCoach)};
    ${builderSrc}
  `);
  try {
    execSync(`node "${dwWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    const conv = fs.readFileSync(path.join(dwCoach, 'conversations.md'), 'utf8');
    const userLines = (conv.match(/\*\*You\*\*/g) || []).length;
    const coachLines = (conv.match(/\*\*Coach\*\*/g) || []).length;
    assert(userLines === 1, `User message appears once as You (got ${userLines})`);
    assert(coachLines === 1, `Only real coach reply appears (got ${coachLines})`);
    // The user's text should NOT appear with Coach prefix
    assert(!conv.includes('**Coach**: Question A'), 'User message not labeled as Coach');
  } catch (e) {
    assert(false, 'Double-write test', e.message.split('\n')[0]);
  }

  // ── TEST 10: CLAUDE.md handles empty analysis ──
  console.log('\n--- Empty Analysis Handling ---');
  const claudeContent = fs.readFileSync(path.join(pluginDir, 'CLAUDE.md'), 'utf8');
  assert(claudeContent.includes('empty') || claudeContent.includes('new user'), 'CLAUDE.md handles empty analysis case');
  assert(claudeContent.includes("don't have") || claudeContent.includes('no messages') || claudeContent.includes('just getting started'), 'CLAUDE.md has new-user greeting guidance');

  // ── TEST 11: Setup skill — silent failure prevention ──
  console.log('\n--- Setup Skill Safety ---');

  if (setupContent) {
    // Scheduled task must repeat (not fire once)
    assert(setupContent.includes('RepetitionDuration') || setupContent.includes('3650'), 'Scheduled task has RepetitionDuration (not one-shot)');

    // Cron must call watcher, not process-day directly
    const cronLines = setupContent.match(/crontab.*\n.*\n?.*echo.*"(.*?)"/s);
    const cronCmd = cronLines ? cronLines[1] : setupContent;
    assert(setupContent.includes('watcher.sh') && setupContent.includes('crontab'), 'Cron invokes watcher.sh (not process-day.sh directly)');

    // Must source .env for cron (cron has no shell RC)
    assert(setupContent.includes('.env') && setupContent.includes('cron'), 'Cron sources .env file');

    // Must create PS profile directory
    assert(setupContent.includes('Split-Path $PROFILE') || setupContent.includes('New-Item'), 'Creates PS profile dir if missing');

    // UUID generation must have empty check
    assert(setupContent.includes('-z "$key"') || setupContent.includes('empty'), 'UUID generation has empty check');

    // Must write to both .bashrc AND .zshrc
    assert(setupContent.includes('.bashrc') && setupContent.includes('.zshrc'), 'Writes alias to both .bashrc and .zshrc');

    // Must have download fallback for scripts
    assert(setupContent.includes('curl') && setupContent.includes('raw.githubusercontent'), 'Has download fallback for processing scripts');

    // Env var values should point to CWD (current directory), not ~/HealthTracker
    // (the note may mention HealthTracker to explain it's NOT used — that's OK)
    const envCommands = setupContent.match(/SetEnvironmentVariable.*HEALTH_DATA_DIR.*"(.*?)"/);
    if (envCommands) {
      assert(!envCommands[1].includes('HealthTracker'), 'Env var value does not point to ~/HealthTracker');
    }

    // Dedup on re-run
    assert(setupContent.includes('sed') || setupContent.includes('Remove old'), 'Re-run removes old env vars before adding new');
  }

  // ── TEST 12: build-conversations.js data dir handling ──
  console.log('\n--- Builder Data Dir ---');
  const builderContent = fs.readFileSync(convBuilderPath, 'utf8');
  // Coach dir should default to ~/Coach
  assert(builderContent.includes("'Coach')"), 'Builder defaults coachDir to ~/Coach');
  // dataDir should fall back to coachDir when HEALTH_DATA_DIR is unset
  assert(builderContent.includes('|| coachDir'), 'Builder: dataDir falls back to coachDir');
  // But should also support HEALTH_DATA_DIR for existing installs
  assert(builderContent.includes('HEALTH_DATA_DIR'), 'Builder: supports separate HEALTH_DATA_DIR');

  // ── TEST 12b: Split-dir scenario (existing installs: Coach ≠ HealthTracker) ──
  console.log('\n--- Split Data Dir ---');

  const splitCoach = path.join(tmpDir, 'split-coach');
  const splitData = path.join(tmpDir, 'split-data');
  fs.mkdirSync(path.join(splitCoach, 'analysis'), { recursive: true });
  fs.mkdirSync(path.join(splitData, 'daily', '2026-03-20'), { recursive: true });

  fs.writeFileSync(path.join(splitCoach, 'analysis', '2026-03-20.json'), JSON.stringify({
    date: '2026-03-20',
    coachResponses: [{ replyTo: 'split_msg', text: 'Coach reply', timestamp: 5000 }],
  }));
  fs.writeFileSync(path.join(splitData, 'daily', '2026-03-20', 'log.json'), JSON.stringify({
    date: '2026-03-20',
    coachChat: [{ id: 'split_msg', role: 'user', text: 'User question', timestamp: 1000 }],
  }));

  const splitWrapper = path.join(tmpDir, 'run-builder-split.js');
  fs.writeFileSync(splitWrapper, `
    process.env.COACH_DIR = ${JSON.stringify(splitCoach)};
    process.env.HEALTH_DATA_DIR = ${JSON.stringify(splitData)};
    ${builderSrc}
  `);
  try {
    execSync(`node "${splitWrapper}"`, { encoding: 'utf8', timeout: 10000 });
    const conv = fs.readFileSync(path.join(splitCoach, 'conversations.md'), 'utf8');
    assert(conv.includes('User question'), 'Split-dir: finds user messages in separate HEALTH_DATA_DIR');
    assert(conv.includes('Coach reply'), 'Split-dir: finds coach responses in COACH_DIR');
  } catch (e) {
    assert(false, 'Split-dir test', e.message.split('\n')[0]);
  }

  // ── TEST 13: Live Coach folder ──
  console.log('\n--- Live Coach Folder ---');
  const liveCoach = path.join(os.homedir(), 'Coach');

  if (fs.existsSync(liveCoach)) {
    assert(fs.existsSync(path.join(liveCoach, 'CLAUDE.md')), 'Live: CLAUDE.md exists');
    assert(fs.existsSync(path.join(liveCoach, 'SOUL.md')), 'Live: SOUL.md exists');
    assert(fs.existsSync(path.join(liveCoach, 'USER.md')), 'Live: USER.md exists');
    assert(fs.existsSync(path.join(liveCoach, 'conversations.md')), 'Live: conversations.md exists');

    const liveConv = fs.readFileSync(path.join(liveCoach, 'conversations.md'), 'utf8');
    assert(liveConv.includes('# Conversations'), 'Live: conversations.md has header');
    assert(!liveConv.includes('undefined'), 'Live: no undefined values');

    // Check profile data exists
    assert(fs.existsSync(path.join(liveCoach, 'profile', 'goals.json')), 'Live: goals.json exists');
    assert(fs.existsSync(path.join(liveCoach, 'profile', 'preferences.json')), 'Live: preferences.json exists');
    assert(fs.existsSync(path.join(liveCoach, 'profile', 'regimen.json')), 'Live: regimen.json exists');

    // Check analysis data exists
    const analysisFiles = fs.readdirSync(path.join(liveCoach, 'analysis')).filter(f => f.endsWith('.json'));
    assert(analysisFiles.length > 0, `Live: has ${analysisFiles.length} analysis files`);

    // Validate a goals.json structure
    try {
      const goals = JSON.parse(fs.readFileSync(path.join(liveCoach, 'profile', 'goals.json'), 'utf8'));
      assert(goals.activePlan, 'Live: goals has activePlan');
      assert(goals.moderate || goals.hardcore, 'Live: goals has plan variants');
    } catch (e) {
      assert(false, 'Live: goals.json valid JSON', e.message);
    }
  } else {
    console.log('  SKIP: ~/Coach not found (not set up on this machine)');
  }

  // ── TEST 8: PowerShell alias check ──
  console.log('\n--- Alias ---');
  try {
    const profile = execSync('powershell -NoProfile -Command "Get-Content $PROFILE"', { encoding: 'utf8' });
    assert(profile.includes('function coach'), 'PowerShell profile has coach function');
    assert(profile.includes('Coach') && profile.includes('claude'), 'Alias cd\'s to Coach and runs claude');
  } catch (e) {
    console.log('  SKIP: PowerShell profile not readable');
  }

} finally {
  cleanup();
}

// ── Results ──
console.log(`\n=== Results: ${pass} pass, ${fail} fail ===`);
if (failures.length) {
  console.log('Failures:');
  failures.forEach(f => console.log(`  - ${f}`));
}
process.exit(fail > 0 ? 1 : 0);
