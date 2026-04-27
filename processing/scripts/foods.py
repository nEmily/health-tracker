"""
Shared food database for meal planning scripts.
Single source of truth — edit here, not in plan_today.py or meal_optimizer.py.

Schema per entry:
  cal            — calories (per 100g if unit=g, per serving if unit=serving)
  protein        — total protein (label value)
  protein_useful — bioavailable protein (same as protein for most foods;
                   collagen is discounted 50% — hydroxyproline doesn't count for muscle)
  carbs, fat, fiber — per 100g or per serving
  unit           — "g" or "serving"
                   "g"      — food is weighed; optimizer treats as continuous (powders, raw/cooked meat, veg)
                   "serving" — indivisible whole-unit items only (tuna can, suja shot, konjac jelly)
                   NOTE: protein powder, collagen, psyllium are stored per-gram even though
                   they have a "standard serving" — they CAN be split by weight.
  serving_g      — grams per serving (reference only, not used by optimizer for g-unit foods)
  max_amount     — optimizer upper bound (grams or servings)
  sodium_mg      — sodium (mg) per 100g or per serving
  calcium_mg     — calcium (mg) per 100g or per serving
  iron_mg        — iron (mg) per 100g or per serving
  potassium_mg   — potassium (mg) per 100g or per serving
  (micronutrients are optional — omitted = unknown, not zero)

DV reference (women 19-50):
  calcium    1000 mg/day
  iron         18 mg/day  (higher during menstruation)
  potassium  2600 mg/day
  sodium     2300 mg/day  (upper limit)

Sources: USDA FoodData Central / label values. Cooked weights unless noted.

When a nutrition label photo is processed, update the matching entry here with exact label values.
If the food doesn't exist yet, append it following this schema.
"""

import json
from pathlib import Path

# DATA_DIR: the user's coach data directory.
# Scripts must be run from that directory — cd there before running.
DATA_DIR = Path.cwd()

_prefs   = json.loads((DATA_DIR / "profile" / "preferences.json").read_text())
_staples = _prefs["dailyStaples"]

FOODS = {
    # ── Daily staples — powders, weighed by gram (divisible) ─────────────────
    # Values are PER 100g. serving_g is for display reference only.

    # protein_shake = Orgain Plant Protein powder; 40g/serving → 160 cal, 21g P
    # micronutrients estimated from Orgain label (per 40g serving → scaled to /100g)
    "protein_shake":    {"cal": _staples["proteinShake"]["cal"] / 40 * 100,          # 400 cal/100g
                         "protein": _staples["proteinShake"]["protein"] / 40 * 100,  # 52.5g P/100g
                         "protein_useful": _staples["proteinShake"]["protein"] / 40 * 100,
                         "carbs": 37.5, "fat": 10.0, "fiber": 7.5,
                         "sodium_mg": 450, "calcium_mg": 875, "iron_mg": 10.0, "potassium_mg": 750,
                         "unit": "g", "serving_g": 40, "max_amount": 120},           # 3 servings max

    # lunar_lifts = Lunar Lifts Taro Boba Tea / Ube whey isolate powder (weighable)
    # 30g scoop → 125 cal, 26g P, 4g carbs, 1g fat (label Apr 2026)
    # micronutrients per scoop: 70mg Na, 119mg Ca, 2mg Fe, 147mg K → scaled to /100g
    "lunar_lifts_shake":{"cal": 417, "protein": 87.0, "protein_useful": 87.0,
                         "carbs": 13.3, "fat": 3.3, "fiber": 0,
                         "sodium_mg": 233, "calcium_mg": 397, "iron_mg": 6.7, "potassium_mg": 490,
                         "unit": "g", "serving_g": 30, "max_amount": 90},            # 3 scoops max

    # collagen: 20g/serving → 80 cal, 20g label / 10g useful per serving
    "collagen":         {"cal": _staples["collagen"]["cal"] / 20 * 100,              # 400 cal/100g
                         "protein": _staples["collagen"]["protein"] / 20 * 100,
                         "protein_useful": _staples["collagen"]["protein_useful"] / 20 * 100,
                         "carbs": 0, "fat": 0, "fiber": 0,
                         "sodium_mg": 350, "calcium_mg": 0, "iron_mg": 0, "potassium_mg": 0,
                         "unit": "g", "serving_g": 20, "max_amount": 40},            # 2 servings max

    # psyllium: 10g/serving → 30 cal, 6g fiber per serving
    "psyllium_husk":    {"cal": _staples["fiber"]["cal"] / 10 * 100,                 # 300 cal/100g
                         "protein": 0, "protein_useful": 0,
                         "carbs": 80, "fat": 0, "fiber": 60,
                         "sodium_mg": 50, "calcium_mg": 200, "iron_mg": 9.0, "potassium_mg": 200,
                         "unit": "g", "serving_g": 10, "max_amount": 30},            # 3 servings max

    # ── Indivisible serving-unit items — whole or nothing ────────────────────

    # flimeal = Korean pre-packaged liquid protein pouch; can't be split
    # Flavors vary slightly; using conservative higher-cal estimate. Update with label when available.
    "flimeal_shake":    {"cal": 160, "protein": 20.0, "protein_useful": 20.0,
                         "carbs": 20.0, "fat": 3.5, "fiber": 1.0,
                         "unit": "serving", "serving_g": 200, "max_amount": 2},

    "suja_shot":        {"cal": _staples["wellnessShot"]["cal"],
                         "protein": 0, "protein_useful": 0,
                         "carbs": 6, "fat": 0, "fiber": 0,
                         "sodium_mg": 35, "calcium_mg": 0, "iron_mg": 0, "potassium_mg": 100,
                         "unit": "serving", "serving_g": 60, "max_amount": 1},

    # ── Proteins ──────────────────────────────────────────────────────────────

    "salmon_sashimi":   {"cal": 167, "protein": 25.4, "protein_useful": 25.4,
                         "carbs": 0, "fat": 7.3, "fiber": 0,
                         "sodium_mg": 59, "calcium_mg": 13, "iron_mg": 0.3, "potassium_mg": 490,
                         "unit": "g", "max_amount": 300},

    "shrimp_raw":       {"cal": 99,  "protein": 20.1, "protein_useful": 20.1,
                         "carbs": 0.9, "fat": 0.3, "fiber": 0,
                         "sodium_mg": 119, "calcium_mg": 64, "iron_mg": 0.5, "potassium_mg": 259,
                         "unit": "g", "max_amount": 300},

    "chicken_thigh_cooked": {"cal": 177, "protein": 26.0, "protein_useful": 26.0,
                         "carbs": 0, "fat": 8.2, "fiber": 0,
                         "sodium_mg": 88, "calcium_mg": 11, "iron_mg": 1.1, "potassium_mg": 220,
                         "unit": "g", "max_amount": 300},   # skin-on, pan-cooked, USDA 05179

    "tuna_can":         {"cal": 110, "protein": 25.0, "protein_useful": 25.0,       # indivisible — whole can (113g) only
                         "carbs": 0, "fat": 1.0, "fiber": 0,
                         "sodium_mg": 200, "calcium_mg": 15, "iron_mg": 0.8, "potassium_mg": 200,
                         "unit": "serving", "serving_g": 113, "max_amount": 2},

    "egg_whites_carton":{"cal": 52,  "protein": 11.0, "protein_useful": 11.0,
                         "carbs": 0.7, "fat": 0.2, "fiber": 0,
                         "sodium_mg": 166, "calcium_mg": 7, "iron_mg": 0.1, "potassium_mg": 163,
                         "unit": "g", "max_amount": 400},

    "spam":             {"cal": 300, "protein": 13.0, "protein_useful": 13.0,
                         "carbs": 4.0, "fat": 26.0, "fiber": 0,
                         "sodium_mg": 1370, "calcium_mg": 7, "iron_mg": 0.8, "potassium_mg": 214,
                         "unit": "g", "max_amount": 150},   # classic Spam, label per 100g

    "ribeye_steak_cooked": {"cal": 260, "protein": 26.0, "protein_useful": 26.0,
                         "carbs": 0, "fat": 17.0, "fiber": 0,
                         "sodium_mg": 65, "calcium_mg": 11, "iron_mg": 2.0, "potassium_mg": 318,
                         "unit": "g", "max_amount": 300},   # cooked weight

    "chicken_wings_breaded": {"cal": 250, "protein": 20.0, "protein_useful": 20.0,
                         "carbs": 12.0, "fat": 14.0, "fiber": 0.5,
                         "sodium_mg": 500, "calcium_mg": 15, "iron_mg": 0.8, "potassium_mg": 180,
                         "unit": "g", "max_amount": 200},   # lightly breaded, USDA approx

    # ── Dairy ─────────────────────────────────────────────────────────────────

    "oikos_triple_zero":{"cal": 60,  "protein": 10.0, "protein_useful": 10.0,
                         "carbs": 6, "fat": 0, "fiber": 0,
                         "sodium_mg": 60, "calcium_mg": 140, "iron_mg": 0, "potassium_mg": 170,
                         "unit": "g", "max_amount": 300},   # per 100g

    # ── Vegetables / frozen ───────────────────────────────────────────────────

    "cauliflower_rice_frozen": {"cal": 25, "protein": 1.9, "protein_useful": 1.9,
                         "carbs": 5, "fat": 0.3, "fiber": 2.0,
                         "sodium_mg": 30, "calcium_mg": 22, "iron_mg": 0.4, "potassium_mg": 300,
                         "unit": "g", "max_amount": 300},

    "edamame_frozen":   {"cal": 120, "protein": 11.0, "protein_useful": 9.9,
                         "carbs": 10, "fat": 5.2, "fiber": 5.0,
                         "sodium_mg": 6, "calcium_mg": 63, "iron_mg": 2.3, "potassium_mg": 436,
                         "unit": "g", "max_amount": 200},   # shelled weight

    "artichoke_frozen": {"cal": 50,  "protein": 3.5, "protein_useful": 3.5,
                         "carbs": 10, "fat": 0.2, "fiber": 5.0,
                         "sodium_mg": 60, "calcium_mg": 44, "iron_mg": 1.3, "potassium_mg": 370,
                         "unit": "g", "max_amount": 200},

    "spinach_raw":      {"cal": 23,  "protein": 2.9, "protein_useful": 2.9,
                         "carbs": 3.6, "fat": 0.4, "fiber": 2.2,
                         "sodium_mg": 79, "calcium_mg": 99, "iron_mg": 2.7, "potassium_mg": 558,
                         "unit": "g", "max_amount": 200},

    "broccoli_raw":     {"cal": 34,  "protein": 2.8, "protein_useful": 2.8,
                         "carbs": 6.6, "fat": 0.4, "fiber": 2.6,
                         "sodium_mg": 33, "calcium_mg": 47, "iron_mg": 0.7, "potassium_mg": 316,
                         "unit": "g", "max_amount": 300},

    # ── Pantry / condiments ───────────────────────────────────────────────────

    "avocado":          {"cal": 160, "protein": 2.0, "protein_useful": 2.0,
                         "carbs": 8.5, "fat": 14.7, "fiber": 6.7,
                         "sodium_mg": 7, "calcium_mg": 12, "iron_mg": 0.6, "potassium_mg": 485,
                         "unit": "g", "max_amount": 150},   # Kirkland cup ≈ 57g

    "chia_seeds":       {"cal": 486, "protein": 16.5, "protein_useful": 14.9,
                         "carbs": 42, "fat": 31, "fiber": 34.4,
                         "sodium_mg": 16, "calcium_mg": 631, "iron_mg": 7.7, "potassium_mg": 407,
                         "unit": "g", "max_amount": 30},    # 1 tbsp ≈ 12g

    "light_mayo":       {"cal": 350, "protein": 0, "protein_useful": 0,
                         "carbs": 2, "fat": 37, "fiber": 0,
                         "sodium_mg": 600, "calcium_mg": 10, "iron_mg": 0.2, "potassium_mg": 20,
                         "unit": "g", "max_amount": 30},    # 1 tbsp ≈ 14g ≈ 49 cal

    # ── Snacks ────────────────────────────────────────────────────────────────

    "konjac_jelly":     {"cal": 5,   "protein": 0, "protein_useful": 0,            # indivisible — 150ml pouch only
                         "carbs": 6, "fat": 0, "fiber": 1,
                         "sodium_mg": 20, "calcium_mg": 0, "iron_mg": 0, "potassium_mg": 0,
                         "unit": "serving", "serving_g": 150, "max_amount": 6},
                         # 150ml pouch, 4g erythritol sugar alcohol + 1g fiber + 1g sugar
                         # Erythritol not counted toward net carbs; essentially a free snack
}
