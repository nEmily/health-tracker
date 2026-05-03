// goals-resolver.js — Canonical goal normalization for both narrow and rich schema shapes.
// Narrow shape: { calories: 1200, protein: 85, fiber: 25, water_oz: 64 }
// Rich shape:   { calories: { daily: 1200 }, macros: { protein: { floor, target, ceiling } }, ... }
// Returns a resolved object supporting BOTH access patterns.

const Goals = {
  _n(val, def) {
    if (val == null) return def;
    const n = typeof val === 'number' ? val : parseFloat(val);
    return isNaN(n) ? def : n;
  },

  resolve(raw) {
    if (!raw || typeof raw !== 'object') return Goals.resolve({});

    // Calories
    const calories = Goals._n(
      (raw.calories && typeof raw.calories === 'object') ? raw.calories.daily : raw.calories,
      2000
    );

    // Protein: check already-resolved fields first, then rich shape, then narrow
    const proteinTarget = Goals._n(
      raw.proteinTarget
        ?? ((raw.protein && typeof raw.protein === 'object') ? raw.protein.target : null)
        ?? raw.macros?.protein?.target
        ?? raw.macros?.protein?.grams
        ?? (typeof raw.protein === 'number' ? raw.protein : null),
      100
    );
    const proteinFloor = Goals._n(
      raw.proteinFloor
        ?? raw.protein_floor
        ?? ((raw.protein && typeof raw.protein === 'object') ? raw.protein.floor : null)
        ?? raw.macros?.protein?.floor,
      null
    );
    const proteinCeiling = Goals._n(
      raw.proteinCeiling
        ?? raw.protein_ceiling
        ?? ((raw.protein && typeof raw.protein === 'object') ? raw.protein.ceiling : null)
        ?? raw.macros?.protein?.ceiling,
      null
    );

    // Fat
    const fatFloor = Goals._n(
      raw.fatFloor
        ?? ((raw.fat && typeof raw.fat === 'object') ? raw.fat.floor : null)
        ?? raw.macros?.fat?.floor,
      null
    );

    // Fiber
    const fiberTarget = Goals._n(
      raw.fiberTarget
        ?? raw.fiber_g
        ?? ((raw.fiber && typeof raw.fiber === 'object') ? raw.fiber.daily_g : null)
        ?? (typeof raw.fiber === 'number' ? raw.fiber : null),
      25
    );
    const fiberFloor = Goals._n(
      raw.fiberFloor
        ?? raw.fiber_floor_g
        ?? ((raw.fiber && typeof raw.fiber === 'object') ? raw.fiber.floor_g : null),
      null
    );
    const fiberCeiling = Goals._n(
      raw.fiberCeiling
        ?? raw.fiber_ceiling_g
        ?? ((raw.fiber && typeof raw.fiber === 'object') ? raw.fiber.ceiling_g : null),
      null
    );
    const fiberTrackSplit = !!(
      raw.fiberTrackSplit
        ?? raw.fiber_trackSplit
        ?? ((raw.fiber && typeof raw.fiber === 'object') ? raw.fiber.trackSplit : undefined)
    );

    // Water
    const waterTarget = Goals._n(
      raw.waterTarget
        ?? raw.water_oz
        ?? ((raw.water && typeof raw.water === 'object') ? raw.water.daily_oz : null),
      64
    );
    const waterFloor = Goals._n(
      raw.waterFloor
        ?? raw.water_floor_oz
        ?? ((raw.water && typeof raw.water === 'object') ? raw.water.floor_oz : null),
      null
    );

    // Weight
    const weightCurrent = Goals._n(
      raw.weightCurrent
        ?? ((raw.weight && typeof raw.weight === 'object') ? raw.weight.current : null),
      null
    );
    const weightGoal = Goals._n(
      raw.weightGoal
        ?? ((raw.weight && typeof raw.weight === 'object') ? raw.weight.goal : null),
      null
    );
    const weightFloor = Goals._n(
      raw.weightFloor
        ?? ((raw.weight && typeof raw.weight === 'object') ? raw.weight.floor : null),
      null
    );

    // Carbs
    const carbsTracked = !!(
      raw.carbsTracked
        ?? ((raw.carbs && typeof raw.carbs === 'object') ? raw.carbs.tracked : undefined)
    );

    // Pass-through fields
    const bodyComp = raw.bodyComp ?? raw.bodyComposition ?? null;
    const transit = raw.transit ?? null;
    const hardcore = raw.hardcore ?? null;
    const adaptive = raw.adaptive ?? null;
    const timeline = raw.timeline ?? null;

    return {
      // Narrow-shape backward compat (existing consumers keep working)
      calories,
      protein: proteinTarget,
      fiber: fiberTarget,
      water_oz: waterTarget,

      // Rich-shape fields
      proteinTarget,
      proteinFloor,
      proteinCeiling,
      fatFloor,
      fiberFloor,
      fiberCeiling,
      fiberTrackSplit,
      waterFloor,
      waterTarget,
      weightCurrent,
      weightGoal,
      weightFloor,
      carbsTracked,
      bodyComp,
      transit,
      hardcore,
      adaptive,
      timeline,
    };
  },

  // 'low' | 'on_track' | 'high'
  proteinStatus(actual, resolved) {
    const floor = resolved.proteinFloor != null ? resolved.proteinFloor : resolved.proteinTarget;
    const target = resolved.proteinTarget;
    if (actual >= target) return 'high';
    if (actual >= floor) return 'on_track';
    return 'low';
  },

  // 'low' | 'on_track' | 'high'
  fiberStatus(actual, resolved) {
    const floor = resolved.fiberFloor;
    const ceiling = resolved.fiberCeiling;
    if (ceiling != null && actual > ceiling) return 'high';
    if (floor != null && actual < floor) return 'low';
    return 'on_track';
  },

  // 'under' | 'on_track' | 'over'
  caloriesStatus(actual, resolved) {
    const target = resolved.calories;
    if (actual < target - 150) return 'under';
    if (actual > target + 150) return 'over';
    return 'on_track';
  },

  // 'under' | 'on_track' | 'high'
  waterStatus(actualOz, resolved) {
    const floor = resolved.waterFloor;
    const target = resolved.water_oz;
    if (actualOz >= target) return 'high';
    if (floor != null && actualOz < floor) return 'under';
    return 'on_track';
  },
};

window.Goals = Goals;
