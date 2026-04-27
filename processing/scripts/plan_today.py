"""
Plan builder — verify exact macros for a specific meal plan.
Edit the options at the bottom for your day, then run.

Usage (run from your coach data directory):
  python /path/to/processing/scripts/plan_today.py

See meal_optimizer.py for finding the math-optimal plan automatically.
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path.cwd()

# Add this script's directory to path so `from foods import FOODS` works
sys.path.insert(0, str(Path(__file__).parent))
from foods import FOODS

goals_json = json.loads((DATA_DIR / "profile" / "goals.json").read_text())


def scale(food_key, amount_g=None, servings=1):
    """
    Return macros for a food at a given amount.
    - For unit=g foods (meat, veg, powders): pass amount_g in grams.
    - For unit=serving foods (tuna can, suja shot, konjac jelly): pass servings.
    Note: protein_shake, collagen, psyllium are unit=g — use amount_g, not servings.
      e.g. scale("protein_shake", amount_g=40)   # 1 serving = 40g
           scale("collagen",      amount_g=20)   # 1 serving = 20g
           scale("psyllium_husk", amount_g=10)   # 1 serving = 10g
    """
    f = FOODS[food_key]
    if f["unit"] == "serving":
        factor = servings
        grams = f.get("serving_g", 0) * servings
    else:
        if amount_g is None:
            raise ValueError(f"{food_key} is unit=g — pass amount_g= (e.g. amount_g={f.get('serving_g', 100)})")
        factor = amount_g / 100
        grams = amount_g
    return {
        "food": food_key,
        "grams": round(grams),
        "cal": round(f["cal"] * factor),
        "protein": round(f["protein"] * factor, 1),
        "protein_useful": round(f["protein_useful"] * factor, 1),
        "carbs": round(f["carbs"] * factor, 1),
        "fat": round(f["fat"] * factor, 1),
        "fiber": round(f["fiber"] * factor, 1),
    }


def total(items):
    """Sum a list of scaled food items."""
    out = {"cal": 0, "protein": 0, "protein_useful": 0,
           "carbs": 0, "fat": 0, "fiber": 0}
    for it in items:
        for k in out:
            out[k] += it[k]
    out = {k: round(v, 1) for k, v in out.items()}
    return out


def print_plan(label, items, goals):
    t = total(items)
    print(f"\n{'='*55}")
    print(f"  {label}")
    print(f"{'='*55}")
    for it in items:
        g_str = f"{it['grams']}g" if it["grams"] else ""
        print(f"  {it['food']:<28} {g_str:<6}  {it['cal']:>4} cal  "
              f"P {it['protein_useful']:>5}g  F {it['fiber']:>4}g")
    print(f"  {'-'*51}")
    print(f"  {'TOTAL':<34}  {t['cal']:>4} cal  "
          f"P {t['protein_useful']:>5}g  F {t['fiber']:>4}g")
    print()
    cal_target   = goals["calories"]["daily"]
    prot_floor   = goals["macros"]["protein"]["floor"]
    prot_target  = goals["macros"]["protein"]["target"]
    fiber_target = goals["fiber"]["daily_g"]
    print(f"  Cal:    {t['cal']} / {cal_target}  (remaining: {cal_target - t['cal']})")
    print(f"  Protein (useful): {t['protein_useful']}g  "
          f"[floor {prot_floor}g | target {prot_target}g]  "
          f"{'[OK] floor' if t['protein_useful'] >= prot_floor else '[FAIL] BELOW FLOOR'}"
          f"  {'[OK] target' if t['protein_useful'] >= prot_target else ''}")
    fiber_remaining = fiber_target - t['fiber']
    print(f"  Fiber:  {t['fiber']}g / {fiber_target}g  "
          f"{'[OK]' if t['fiber'] >= fiber_target else f'[SHORT] {fiber_remaining}g'}")
    print(f"{'='*55}\n")


# ── Edit below this line for your day ────────────────────────────────────────
# Powders use amount_g. Serving-unit items (tuna can, suja shot) use servings=N.
# Standard serving sizes:
#   protein_shake: 40g/serving
#   lunar_lifts_shake: 30g/serving (1 scoop)
#   collagen: 20g/serving
#   psyllium_husk: 10g/serving

base = [
    scale("protein_shake", amount_g=40),     # 1 serving Orgain
    scale("collagen",      amount_g=20),     # 1 serving collagen
    scale("psyllium_husk", amount_g=10),     # 1 serving psyllium
    scale("suja_shot",     servings=1),
]

option_a = base + [
    scale("chicken_thigh_cooked", amount_g=100),
    scale("cauliflower_rice_frozen", amount_g=150),
    scale("edamame_frozen", amount_g=80),
    scale("artichoke_frozen", amount_g=70),
]

option_b = base + [
    scale("tuna_can", servings=1),
    scale("edamame_frozen", amount_g=80),
    scale("spinach_raw", amount_g=100),
    scale("chia_seeds", amount_g=12),
]

option_c = base + [
    scale("salmon_sashimi", amount_g=150),
    scale("cauliflower_rice_frozen", amount_g=150),
    scale("edamame_frozen", amount_g=80),
    scale("avocado", amount_g=57),
]

print_plan("BASE (shake + collagen + psyllium + suja)", base, goals_json)
print_plan("OPTION A  chicken thigh bowl", option_a, goals_json)
print_plan("OPTION B  tuna + spinach + chia", option_b, goals_json)
print_plan("OPTION C  salmon sashimi bowl", option_c, goals_json)
