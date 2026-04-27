"""
Meal plan optimizer — LP-based knapsack solver.
Finds the optimal food combination from your pantry for a given calorie budget.

The LLM layer handles: taste preferences, meal timing, food combos that make sense.
This script handles: the math. Don't use mental math when you have this.

Usage (run from your coach data directory):
  python /path/to/processing/scripts/meal_optimizer.py
  python /path/to/processing/scripts/meal_optimizer.py --budget 850 --top 5
  python /path/to/processing/scripts/meal_optimizer.py --budget 1000 --lock "shrimp_raw:130" --exclude tuna_can

Objective: maximize  PROTEIN_WEIGHT * protein_useful  +  FIBER_WEIGHT * fiber
           subject to: calories <= budget
                        protein_useful >= protein_floor  (hard)
                        each food within [0, max_portion]
"""

import json
import argparse
import sys
from pathlib import Path

# Must be run from the user's coach data directory — cd there before running.
DATA_DIR = Path.cwd()

# Add this script's directory to path so `from foods import FOODS` works
sys.path.insert(0, str(Path(__file__).parent))
from foods import FOODS

try:
    from scipy.optimize import linprog
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

# ── Objective weights ─────────────────────────────────────────────────────────
# Tune these to change what "optimal" means.
# protein_useful is primary goal; fiber is secondary.
# Example: PROTEIN_WEIGHT=1.0, FIBER_WEIGHT=0.3 means
#   1g protein is worth ~3.3g fiber in the optimizer's eyes.
PROTEIN_WEIGHT = 1.0
FIBER_WEIGHT   = 0.8  # raised: once protein target is met, fill with fiber not more protein

# ── Goals ─────────────────────────────────────────────────────────────────────
goals_raw  = json.loads((DATA_DIR / "profile" / "goals.json").read_text())

CAL_BUDGET    = goals_raw["calories"]["daily"]
PROTEIN_FLOOR = goals_raw["macros"]["protein"]["floor"]
PROTEIN_TARGET= goals_raw["macros"]["protein"]["target"]
FIBER_TARGET  = goals_raw["fiber"]["daily_g"]

# ── Helpers ───────────────────────────────────────────────────────────────────

def _per_unit(food_key):
    """Return (cal, protein_useful, fiber) per optimizer unit (1g or 1 serving)."""
    f = FOODS[food_key]
    if f["unit"] == "g":
        return f["cal"] / 100, f["protein_useful"] / 100, f["fiber"] / 100
    else:
        return float(f["cal"]), float(f["protein_useful"]), float(f["fiber"])


def _macros(food_key, amount):
    """Return dict of macros for a food given an optimizer-unit amount."""
    c, p, fi = _per_unit(food_key)
    f = FOODS[food_key]
    grams = amount if f["unit"] == "g" else amount * f.get("serving_g", 0)
    return {
        "food": food_key,
        "amount": amount,
        "grams": round(grams),
        "cal": round(c * amount),
        "protein_useful": round(p * amount, 1),
        "fiber": round(fi * amount, 1),
    }


def totals(items):
    t = {"cal": 0, "protein_useful": 0, "fiber": 0}
    for it in items:
        for k in t:
            t[k] += it[k]
    return {k: round(v, 1) for k, v in t.items()}


def print_plan(label, items, budget, rem_protein_floor=None, rem_fiber=None):
    """Print a plan. When used with --eaten mode, pass rem_* to show correct pass/fail."""
    t = totals(items)
    print(f"\n{'='*58}")
    print(f"  {label}")
    print(f"{'='*58}")
    for it in items:
        f = FOODS[it["food"]]
        if f["unit"] == "g":
            amt_str = f"{it['amount']:.0f}g"
        else:
            amt_str = f"{it['amount']:.1f}srv"
        print(f"  {it['food']:<26} {amt_str:<8} {it['cal']:>4} cal  "
              f"P {it['protein_useful']:>5}g  F {it['fiber']:>4}g")
    print(f"  {'-'*54}")
    print(f"  {'TOTAL':<34} {t['cal']:>4} cal  "
          f"P {t['protein_useful']:>5}g  F {t['fiber']:>4}g")
    print()
    print(f"  Cal: {t['cal']}/{budget}  remaining: {budget - t['cal']}")
    eff_p_floor = rem_protein_floor if rem_protein_floor is not None else PROTEIN_FLOOR
    eff_fiber   = rem_fiber         if rem_fiber         is not None else FIBER_TARGET
    p_ok   = "[OK]" if t["protein_useful"] >= eff_p_floor else "[FAIL] BELOW FLOOR"
    p_tgt  = "[OK] target" if t["protein_useful"] >= PROTEIN_TARGET else ""
    fi_ok  = "[OK]" if t["fiber"] >= eff_fiber else f"[SHORT] {eff_fiber - t['fiber']:.1f}g"
    p_lbl  = f"rem {eff_p_floor}g" if rem_protein_floor is not None else f"floor {PROTEIN_FLOOR}g | target {PROTEIN_TARGET}g"
    fi_lbl = f"rem {eff_fiber}g" if rem_fiber is not None else f"{FIBER_TARGET}g"
    print(f"  Protein: {t['protein_useful']}g  [{p_lbl}]  {p_ok} {p_tgt}")
    print(f"  Fiber:   {t['fiber']}g / {fi_lbl}  {fi_ok}")
    score = PROTEIN_WEIGHT * t["protein_useful"] + FIBER_WEIGHT * t["fiber"]
    print(f"  Score:   {score:.1f}  (protein×{PROTEIN_WEIGHT} + fiber×{FIBER_WEIGHT})")
    print(f"{'='*58}\n")


# ── Optimizer ─────────────────────────────────────────────────────────────────

def optimize_lp(budget, locked, exclude, top_n, protein_floor=None, fiber_target=None):
    """
    LP optimizer via scipy.
    locked: dict of {food_key: fixed_amount} — always included, not optimized
    protein_floor / fiber_target: override globals (used by --eaten mode)
    Returns list of items for the best plan.
    """
    eff_protein_floor = protein_floor if protein_floor is not None else PROTEIN_FLOOR
    eff_fiber_target  = fiber_target  if fiber_target  is not None else FIBER_TARGET

    locked_items = [_macros(k, v) for k, v in locked.items()]
    locked_totals = totals(locked_items)
    rem_cal  = budget - locked_totals["cal"]
    rem_prot = max(0, eff_protein_floor - locked_totals["protein_useful"])

    keys = [k for k in FOODS if k not in locked and k not in exclude]
    n = len(keys)
    if n == 0:
        print_plan("Locked items only", locked_items, budget)
        return locked_items

    c_arr  = [_per_unit(k)[0] for k in keys]
    p_arr  = [_per_unit(k)[1] for k in keys]
    fi_arr = [_per_unit(k)[2] for k in keys]
    maxes  = [FOODS[k]["max_amount"] for k in keys]

    obj = [-(PROTEIN_WEIGHT * p_arr[i] + FIBER_WEIGHT * fi_arr[i]) for i in range(n)]

    A_ub = [c_arr,
            [-p for p in p_arr]]
    b_ub = [rem_cal, -rem_prot]

    bounds = [(0, maxes[i]) for i in range(n)]

    result = linprog(obj, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method="highs")

    if result.status != 0:
        print(f"LP solver: {result.message}")
        return None

    x_opt = result.x
    rounded = []
    for i, k in enumerate(keys):
        f = FOODS[k]
        amt = x_opt[i]
        if f["unit"] == "g":
            amt = round(amt / 5) * 5
        else:
            amt = round(amt * 2) / 2
        if amt > 0:
            rounded.append((k, amt))

    variable_items = [_macros(k, a) for k, a in rounded]
    all_items = locked_items + variable_items
    t = totals(all_items)
    score = PROTEIN_WEIGHT * t["protein_useful"] + FIBER_WEIGHT * t["fiber"]
    print_plan(f"OPTIMAL (LP)  score={score:.1f}", all_items, budget,
               rem_protein_floor=protein_floor, rem_fiber=fiber_target)
    print_review_block(all_items, budget, locked)
    return all_items


def optimize_discrete(budget, locked, exclude, top_n, protein_floor=None, fiber_target=None):
    """
    Discrete enumeration fallback (no scipy).
    Tests a grid of portion sizes for each variable food.
    """
    eff_protein_floor = protein_floor if protein_floor is not None else PROTEIN_FLOOR

    locked_items = [_macros(k, v) for k, v in locked.items()]
    locked_t = totals(locked_items)
    rem_cal  = budget - locked_t["cal"]

    keys = [k for k in FOODS if k not in locked and k not in exclude]

    def portions(k):
        f = FOODS[k]
        mx = min(f["max_amount"], rem_cal / (_per_unit(k)[0] + 1e-9))
        if f["unit"] == "g":
            step = 25
            return [0] + list(range(step, int(mx) + 1, step))
        else:
            return [i * 0.5 for i in range(0, int(f["max_amount"] * 2) + 1)]

    grids = [portions(k) for k in keys]

    candidates = [(0, 0, 0, [])]
    for i, k in enumerate(keys):
        new_candidates = []
        for neg_score, used_cal, neg_prot, choices in candidates:
            for amt in grids[i]:
                c, p, fi = _per_unit(k)
                new_cal  = used_cal + c * amt
                if new_cal > rem_cal:
                    continue
                new_prot = -neg_prot + p * amt
                new_fi   = sum(
                    _per_unit(keys[j])[2] * choices[j] for j in range(len(choices))
                ) + fi * amt
                score = PROTEIN_WEIGHT * new_prot + FIBER_WEIGHT * new_fi
                new_candidates.append((-score, new_cal, -new_prot, choices + [amt]))
        new_candidates.sort()
        candidates = new_candidates[:200]

    best = sorted(candidates)[:top_n]
    best_items = None
    for rank, (neg_score, _, neg_prot, choices) in enumerate(best):
        variable_items = []
        for i, k in enumerate(keys):
            if choices[i] > 0:
                variable_items.append(_macros(k, choices[i]))
        all_items = locked_items + variable_items
        t = totals(all_items)
        ok = t["protein_useful"] >= eff_protein_floor
        if ok:
            print_plan(f"RANK {rank+1}  score={-neg_score:.1f}", all_items, budget,
                       rem_protein_floor=protein_floor, rem_fiber=fiber_target)
            if rank == 0:
                print_review_block(all_items, budget, locked)
                best_items = all_items
    return best_items


# ── LLM Review Layer ─────────────────────────────────────────────────────────

def print_review_block(items, budget, locked):
    """
    Print a structured summary block for the LLM coach to evaluate.
    The optimizer finds the math-optimal plan; the LLM checks whether it's
    actually a coherent, practical meal a human would eat.
    """
    t = totals(items)
    locked_keys = set(locked.keys())
    variable = [it for it in items if it["food"] not in locked_keys]

    print("\n" + "-"*58)
    print("  LLM REVIEW BLOCK -- coach should evaluate before locking in")
    print("-"*58)
    print(f"  Total: {t['cal']} cal | {t['protein_useful']}g protein | {t['fiber']}g fiber")
    p_floor_str = "OK" if t["protein_useful"] >= PROTEIN_FLOOR else "FAIL"
    p_tgt_str   = "OK" if t["protein_useful"] >= PROTEIN_TARGET else "short"
    fi_str      = "OK" if t["fiber"] >= FIBER_TARGET else f"short {FIBER_TARGET - t['fiber']:.0f}g"
    print(f"  Protein floor [{p_floor_str}] | Target [{p_tgt_str}] | Fiber [{fi_str}]")
    print()
    print("  Locked (non-negotiable):")
    for it in items:
        if it["food"] in locked_keys:
            f = FOODS[it["food"]]
            amt = f"{it['amount']:.0f}g" if f["unit"] == "g" else f"{it['amount']:.1f} serving(s)"
            print(f"    {it['food']}: {amt}")
    print()
    print("  Optimizer chose (variable):")
    for it in variable:
        f = FOODS[it["food"]]
        amt = f"{it['amount']:.0f}g" if f["unit"] == "g" else f"{it['amount']:.1f} serving(s)"
        print(f"    {it['food']}: {amt}  ({it['cal']} cal, {it['protein_useful']}g P, {it['fiber']}g F)")
    print()
    protein_sources = [it["food"] for it in items if it["protein_useful"] >= 5]
    fiber_sources   = [it["food"] for it in items if it["fiber"] >= 2]
    print(f"  Protein sources: {protein_sources}")
    print(f"  Fiber sources:   {fiber_sources}")
    print("─"*58)
    print("  Coach: check combos, portions, meal structure, bloat risk.")
    print("-"*58 + "\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_lock(lock_args):
    """Parse 'food_key:amount' pairs."""
    result = {}
    for s in (lock_args or []):
        k, v = s.split(":")
        result[k.strip()] = float(v.strip())
    return result


def output_json(items, budget, date_str=None):
    """
    Print a mealPlan.days[] entry ready to paste into analysis/YYYY-MM-DD.json.
    """
    import datetime
    t = totals(items)
    date_str = date_str or datetime.date.today().isoformat()

    ingredients = []
    for it in items:
        f = FOODS[it["food"]]
        grams = it["amount"] if f["unit"] == "g" else it["amount"] * f.get("serving_g", 0)
        ingredients.append({
            "name": it["food"].replace("_", " "),
            "grams": round(grams, 1),
            "cal": it["cal"],
            "protein": it["protein_useful"],
            "carbs": round(f.get("carbs", 0) * (it["amount"] / (100 if f["unit"] == "g" else 1)), 1),
            "fat":   round(f.get("fat",   0) * (it["amount"] / (100 if f["unit"] == "g" else 1)), 1),
            "fiber": it["fiber"],
        })

    day_entry = {
        "date": date_str,
        "source": "meal-optimizer",
        "meals": [{
            "name": "Optimizer plan",
            "description": f"LP-optimized: {t['cal']} cal, {t['protein_useful']}g protein, {t['fiber']}g fiber",
            "calories": t["cal"],
            "protein":  t["protein_useful"],
            "fiber":    t["fiber"],
            "carbs":    round(sum(i["carbs"] for i in ingredients), 1),
            "fat":      round(sum(i["fat"]   for i in ingredients), 1),
            "ingredients": ingredients,
        }],
        "day_totals": {
            "calories": t["cal"],
            "protein":  t["protein_useful"],
            "fiber":    t["fiber"],
            "carbs":    round(sum(i["carbs"] for i in ingredients), 1),
            "fat":      round(sum(i["fat"]   for i in ingredients), 1),
        },
    }

    print("\n" + "─"*58)
    print("  JSON OUTPUT  (paste into mealPlan.days[])")
    print("─"*58)
    print(json.dumps(day_entry, indent=2))
    print("─"*58 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Meal plan optimizer")
    parser.add_argument("--budget", type=int, default=CAL_BUDGET,
                        help=f"Calorie budget (default: {CAL_BUDGET})")
    parser.add_argument("--lock", nargs="*", metavar="FOOD:AMOUNT",
                        help="Lock a food at a fixed amount, e.g. shrimp_raw:130")
    parser.add_argument("--eaten", nargs="*", metavar="FOOD:AMOUNT",
                        help="Already eaten today — subtracts from budget, shows remaining targets")
    parser.add_argument("--exclude", nargs="*", metavar="FOOD",
                        help="Exclude foods from optimization")
    parser.add_argument("--top", type=int, default=3,
                        help="Number of top plans to show (discrete mode only)")
    parser.add_argument("--list-foods", action="store_true",
                        help="List all available foods and exit")
    parser.add_argument("--output-json", action="store_true",
                        help="Print best plan as mealPlan.days[] JSON ready to paste into analysis JSON")
    parser.add_argument("--date", type=str, default=None,
                        help="Date for --output-json (default: today, YYYY-MM-DD)")
    args = parser.parse_args()

    if args.list_foods:
        print("\nAvailable foods:")
        for k, f in FOODS.items():
            cal_label = f["cal"]
            p_label   = f.get("protein_useful", 0)
            fi_label  = f["fiber"]
            unit = "per 100g" if f["unit"] == "g" else "per serving"
            print(f"  {k:<26}  {cal_label:.0f} cal  P {p_label:.1f}g  F {fi_label:.1f}g  ({unit})"
                  f"  max: {f['max_amount']}{f['unit']}")
        return

    locked  = parse_lock(args.lock)
    exclude = set(args.exclude or [])

    eaten        = parse_lock(args.eaten)
    eaten_items  = [_macros(k, v) for k, v in eaten.items()]
    eaten_t      = totals(eaten_items)

    effective_budget  = args.budget - eaten_t["cal"]
    rem_protein_floor = max(0, PROTEIN_FLOOR - eaten_t["protein_useful"])
    rem_fiber         = max(0, FIBER_TARGET  - eaten_t["fiber"])

    if eaten:
        print(f"\nAlready eaten today:")
        for it in eaten_items:
            f = FOODS[it["food"]]
            amt = f"{it['amount']:.0f}g" if f["unit"] == "g" else f"{it['amount']:.1f} serving(s)"
            print(f"  {it['food']:<26} {amt:<8} {it['cal']:>4} cal  P {it['protein_useful']:>5}g  F {it['fiber']:>4}g")
        print(f"  Eaten totals: {eaten_t['cal']} cal  |  P {eaten_t['protein_useful']}g  |  F {eaten_t['fiber']}g")
        print(f"\nRemaining budget: {effective_budget} cal  |  "
              f"Protein still needed: {rem_protein_floor}g  |  Fiber still needed: {rem_fiber}g")

    print(f"\nObjective: maximize  {PROTEIN_WEIGHT}×protein_useful + {FIBER_WEIGHT}×fiber")
    print(f"Budget: {effective_budget} cal  |  Protein floor: {PROTEIN_FLOOR}g  |  Fiber target: {FIBER_TARGET}g")
    print(f"Locked: {locked or 'none'}  |  Excluded: {exclude or 'none'}")
    print(f"Solver: {'scipy LP' if HAS_SCIPY else 'discrete beam search'}\n")

    best_items = None
    if HAS_SCIPY:
        best_items = optimize_lp(effective_budget, locked, exclude, args.top,
                                 protein_floor=rem_protein_floor, fiber_target=rem_fiber)
    else:
        best_items = optimize_discrete(effective_budget, locked, exclude, args.top,
                                       protein_floor=rem_protein_floor, fiber_target=rem_fiber)

    if args.output_json and best_items:
        output_json(best_items, args.budget, args.date)


if __name__ == "__main__":
    main()
