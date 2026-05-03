// goals-resolver.test.js — node pwa/tests/goals-resolver.test.js

// Inline the module (no window in Node)
global.window = {};
require('../scripts/goals-resolver.js');
const Goals = global.window.Goals;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('\n--- regression: null subfield (typeof null === object pitfall) ---');
{
  // These inputs reproduce the 12 PWA failures we just fixed. Each "container"
  // field is null, but typeof null === 'object' in JS, so the resolver was
  // dereferencing null.X and throwing. Must NOT throw, must return defaults.
  const inputs = [
    { fiber: null }, { fat: null }, { water: null }, { protein: null },
    { weight: null }, { carbs: null }, { calories: null },
    { fiber: null, fat: null, water: null, protein: null, weight: null, carbs: null, calories: null },
  ];
  for (const raw of inputs) {
    let threw = null;
    let r;
    try { r = Goals.resolve(raw); } catch (e) { threw = e.message; }
    assert(threw === null, `null subfield does not throw: ${JSON.stringify(raw)}`);
    if (r) {
      assert(typeof r.calories === 'number', `null-subfield input still resolves calories: ${JSON.stringify(raw)}`);
      assert(typeof r.fiber === 'number', `null-subfield input still resolves fiber: ${JSON.stringify(raw)}`);
    }
  }
  // Status functions on null-subfield resolved must not throw either
  const r = Goals.resolve({ fiber: null, water: null });
  let threw = null;
  try { Goals.fiberStatus(20, r); Goals.waterStatus(50, r); Goals.proteinStatus(80, r); Goals.caloriesStatus(1200, r); }
  catch (e) { threw = e.message; }
  assert(threw === null, 'status functions on null-subfield resolved do not throw');
}

console.log('\n--- narrow shape ---');
{
  const r = Goals.resolve({ calories: 1200, protein: 85, fiber: 20, water_oz: 72, water_floor_oz: 48 });
  assert(r.calories === 1200, 'calories from narrow scalar');
  assert(r.protein === 85, 'protein from narrow scalar');
  assert(r.proteinTarget === 85, 'proteinTarget from narrow scalar');
  assert(r.fiber === 20, 'fiber from narrow scalar');
  assert(r.water_oz === 72, 'water_oz from narrow scalar');
  assert(r.waterFloor === 48, 'waterFloor from water_floor_oz');
  assert(r.proteinFloor === null, 'proteinFloor defaults null');
  assert(r.fiberTrackSplit === false, 'fiberTrackSplit defaults false');
}

console.log('\n--- rich shape (calories.daily + macros) ---');
{
  const r = Goals.resolve({
    calories: { daily: 1000 },
    macros: { protein: { floor: 80, target: 95, ceiling: 120 }, fat: { floor: 30 } },
    fiber: { daily_g: 30, floor_g: 20, ceiling_g: 40, trackSplit: true },
    water: { daily_oz: 80, floor_oz: 56 },
    weight: { current: 101.5, goal: 95, floor: 90 },
    carbs: { tracked: true },
  });
  assert(r.calories === 1000, 'calories from rich shape daily');
  assert(r.protein === 95, 'protein (narrow compat) = proteinTarget');
  assert(r.proteinTarget === 95, 'proteinTarget from macros.protein.target');
  assert(r.proteinFloor === 80, 'proteinFloor from macros.protein.floor');
  assert(r.proteinCeiling === 120, 'proteinCeiling from macros.protein.ceiling');
  assert(r.fatFloor === 30, 'fatFloor from macros.fat.floor');
  assert(r.fiber === 30, 'fiber (narrow compat) = fiberTarget');
  assert(r.fiberFloor === 20, 'fiberFloor from fiber.floor_g');
  assert(r.fiberCeiling === 40, 'fiberCeiling from fiber.ceiling_g');
  assert(r.fiberTrackSplit === true, 'fiberTrackSplit from fiber.trackSplit');
  assert(r.water_oz === 80, 'water_oz (narrow compat) = waterTarget');
  assert(r.waterFloor === 56, 'waterFloor from water.floor_oz');
  assert(r.weightCurrent === 101.5, 'weightCurrent from weight.current');
  assert(r.weightGoal === 95, 'weightGoal from weight.goal');
  assert(r.weightFloor === 90, 'weightFloor from weight.floor');
  assert(r.carbsTracked === true, 'carbsTracked from carbs.tracked');
}

console.log('\n--- defaults on empty input ---');
{
  const r = Goals.resolve({});
  assert(r.calories === 2000, 'calories defaults to 2000');
  assert(r.protein === 100, 'protein defaults to 100');
  assert(r.proteinTarget === 100, 'proteinTarget defaults to 100');
  assert(r.fiber === 25, 'fiber defaults to 25');
  assert(r.water_oz === 64, 'water_oz defaults to 64');
  assert(r.proteinFloor === null, 'proteinFloor defaults null');
  assert(r.fiberFloor === null, 'fiberFloor defaults null');
  assert(r.fiberCeiling === null, 'fiberCeiling defaults null');
  assert(r.waterFloor === null, 'waterFloor defaults null');
  assert(r.carbsTracked === false, 'carbsTracked defaults false');
}

console.log('\n--- idempotency ---');
{
  const inputs = [
    { calories: 850, protein: 90, water_oz: 64 },
    { calories: { daily: 1000 }, macros: { protein: { floor: 80, target: 95 } } },
    {},
    { calories: 1200, protein: 85, fiber: 20, water_floor_oz: 48, fiber_trackSplit: true },
  ];
  for (let i = 0; i < inputs.length; i++) {
    const r1 = Goals.resolve(inputs[i]);
    const r2 = Goals.resolve(r1);
    assert(deepEq(r1, r2), `idempotent input[${i}]`);
  }
}

console.log('\n--- proteinStatus boundaries ---');
{
  const r = Goals.resolve({ protein: 90, protein_floor: 75 });
  // floor=75, target=90
  assert(Goals.proteinStatus(74, r) === 'low', 'protein low below floor');
  assert(Goals.proteinStatus(75, r) === 'on_track', 'protein on_track at floor');
  assert(Goals.proteinStatus(89, r) === 'on_track', 'protein on_track below target');
  assert(Goals.proteinStatus(90, r) === 'high', 'protein high at target');
  assert(Goals.proteinStatus(120, r) === 'high', 'protein high above target');
}
{
  // No floor — treat target as floor
  const r = Goals.resolve({ protein: 90 });
  assert(Goals.proteinStatus(89, r) === 'low', 'protein low when no floor and below target');
  assert(Goals.proteinStatus(90, r) === 'high', 'protein high at target when no floor');
}

console.log('\n--- fiberStatus boundaries ---');
{
  const r = Goals.resolve({ fiber: 25, fiber_floor_g: 15, fiber_ceiling_g: 35 });
  assert(Goals.fiberStatus(14, r) === 'low', 'fiber low below floor');
  assert(Goals.fiberStatus(15, r) === 'on_track', 'fiber on_track at floor');
  assert(Goals.fiberStatus(34, r) === 'on_track', 'fiber on_track below ceiling');
  assert(Goals.fiberStatus(36, r) === 'high', 'fiber high above ceiling');
}
{
  // No floor/ceiling
  const r = Goals.resolve({ fiber: 25 });
  assert(Goals.fiberStatus(5, r) === 'on_track', 'fiber on_track with no bounds');
  assert(Goals.fiberStatus(50, r) === 'on_track', 'fiber on_track with no ceiling');
}

console.log('\n--- caloriesStatus boundaries ---');
{
  const r = Goals.resolve({ calories: 1200 });
  assert(Goals.caloriesStatus(1049, r) === 'under', 'calories under at -151');
  assert(Goals.caloriesStatus(1050, r) === 'on_track', 'calories on_track at -150');
  assert(Goals.caloriesStatus(1200, r) === 'on_track', 'calories on_track at target');
  assert(Goals.caloriesStatus(1350, r) === 'on_track', 'calories on_track at +150');
  assert(Goals.caloriesStatus(1351, r) === 'over', 'calories over at +151');
}

console.log('\n--- waterStatus boundaries ---');
{
  const r = Goals.resolve({ water_oz: 64, water_floor_oz: 32 });
  assert(Goals.waterStatus(31, r) === 'under', 'water under below floor');
  assert(Goals.waterStatus(32, r) === 'on_track', 'water on_track at floor');
  assert(Goals.waterStatus(63, r) === 'on_track', 'water on_track below target');
  assert(Goals.waterStatus(64, r) === 'high', 'water high at target');
  assert(Goals.waterStatus(80, r) === 'high', 'water high above target');
}
{
  // No floor
  const r = Goals.resolve({ water_oz: 64 });
  assert(Goals.waterStatus(10, r) === 'on_track', 'water on_track below target with no floor');
  assert(Goals.waterStatus(64, r) === 'high', 'water high at target with no floor');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
