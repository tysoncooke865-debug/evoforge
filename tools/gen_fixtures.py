"""Generate the cross-language parity fixtures: the keystone of the Expo migration.

MIGRATION_PLAN.md, "Testing", item 1:

    `tools/gen_fixtures.py` runs the *existing Python* `domain/` and writes golden
    JSON to `contracts/fixtures/`. Vitest asserts the TS port reproduces every
    fixture exactly; CI runs both sides (detects Python drift AND port drift).
    No screen work before this is green.

So this file has two jobs, and the second is the one that catches regressions:

    python tools/gen_fixtures.py            # write contracts/fixtures/*.json
    python tools/gen_fixtures.py --check    # regenerate, diff, exit 1 on drift

`--check` is what CI runs. It never writes. If a Python domain rule changes without
the goldens being regenerated on purpose, `--check` goes red on the Python side
before the TS port has a chance to disagree on the other.

DETERMINISM IS THE WHOLE POINT
------------------------------
A fixture file that differs run-to-run cannot detect drift. Therefore:

  * No timestamps, no `date.today()`, no environment, no row counts from Supabase.
    Only pure functions of literal inputs. Nothing here touches the network.
  * `sort_keys=True`, fixed `indent=2`, `ensure_ascii=False`, explicit UTF-8, and
    LF newlines — so the bytes are identical on Windows and Linux CI.
  * Floats go through `json.dump` unrounded. Python's float repr and JavaScript's
    `JSON.parse` are both IEEE-754 shortest-round-trip, so a double written here
    parses to the bit-identical double in Vitest. Rounding would *hide* real drift;
    a tolerance would let a wrong formula pass. Neither is wanted.

WHAT IS AND IS NOT FIXTURED
---------------------------
Only pure functions — ones whose output depends solely on their arguments.

`MIGRATION_PLAN.md` calls `domain/` "the ~14 pure Python domain modules", but that
is not so today: of the 15, only `domain/xp.py` imports nothing from `pandas`,
`data/`, `ui/` or `streamlit`. The rest reach for `data.sb_ops` at module scope.
They all still *import* cleanly without secrets, which is why this generator can
import them at all — but their DB-reading functions (`workout_summary`, `load_log`,
`check_achievements`, `calculate_avatar_stats`) are not fixturable and are excluded.
Porting those is a Phase 3 problem, guarded by TanStack Query tests, not by goldens.

`check_achievements()` in particular is a DB sweep, not a predicate, so what is
pinned here is the achievement *catalog* — the 64 ids and their display strings,
a data contract the TS port must reproduce exactly.

NON-FINITE INPUTS
-----------------
`safe_num` guards NaN and +/-Inf, and those have no JSON literal. Such cases live
in a `specials` array whose `input` is the marker string "NaN", "Infinity" or
"-Infinity". The Vitest side maps those three strings back to the float before
calling. Every other `input` in every fixture is a plain JSON value.
"""

import argparse
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from config.constants import ACHIEVEMENTS, EXERCISE_LIBRARY, MUSCLE_MAP, ROUTINE
from domain.avatar_stats import (
    avatar_rarity,
    branch_display_name,
    determine_avatar_branch,
    evolution_name,
    get_avatar_stage,
    get_branch_stage,
    rarity_slug,
)
from domain.bodyfat import bodyfat_outputs, navy_body_fat_male, safe_kg
from domain.physique_ratings import safe_num, score_0_100
from domain.profile import RANK_TIERS, calculate_starting_level, rank_ladder, rank_name
from domain.workouts import estimated_1rm, infer_muscle_group
from domain.xp import (
    FIRST_LEVEL_COST,
    LEVEL_COST_STEP,
    MAX_LEVEL,
    MIN_LEVEL,
    XP_PER_CARDIO_MINUTE,
    XP_PER_SET,
    activity_xp,
    cumulative_xp,
    level_and_progress,
    level_from_ledger,
    progress_percent,
    resolve_xp,
    xp_for_level,
    xp_to_next_level,
)
from domain.xp_leveling import avatar_stage_rows

FIXTURE_DIR = REPO_ROOT / "contracts" / "fixtures"

BRANCHES = ["aesthetic", "mass", "hybrid"]

# The boundaries every threshold in the codebase turns on, plus one either side.
# 24/25, 49/50, 74/75, 89/90, 99/100 are the rarity, stage and evolution edges.
EDGE_LEVELS = [
    -5, 0, 1, 2, 9, 10, 11, 24, 25, 26, 39, 40, 41, 49, 50, 51, 59, 60, 61,
    74, 75, 76, 89, 90, 91, 98, 99, 100, 101, 150,
]

ALL_LEVELS = list(range(1, MAX_LEVEL + 1))


def _case(inp, out):
    return {"input": inp, "expected": out}


# --------------------------------------------------------------------------
# domain/xp.py -- THE contract. One curve, one place.
# --------------------------------------------------------------------------

def fx_xp_curve():
    return {
        "constants": {
            "XP_PER_SET": XP_PER_SET,
            "XP_PER_CARDIO_MINUTE": XP_PER_CARDIO_MINUTE,
            "FIRST_LEVEL_COST": FIRST_LEVEL_COST,
            "LEVEL_COST_STEP": LEVEL_COST_STEP,
            "MIN_LEVEL": MIN_LEVEL,
            "MAX_LEVEL": MAX_LEVEL,
        },
        # Advancing FROM level L costs 500 + (L-1)*25. L1->2 = 500, L99->100 = 2950.
        # At MAX_LEVEL there is no next level, so it returns the final level's cost
        # rather than 0 -- callers divide by this to draw a progress bar.
        "xp_for_level": [_case(lv, xp_for_level(lv)) for lv in EDGE_LEVELS + ALL_LEVELS],
        # Re-export under the name the UI uses. Must equal xp_for_level, always.
        "xp_to_next_level": [_case(lv, xp_to_next_level(lv)) for lv in EDGE_LEVELS],
        "cumulative_xp": [
            _case({"from_level": a, "to_level": b}, cumulative_xp(a, b))
            for a, b in [
                (1, 1), (1, 2), (1, 10), (1, 25), (1, 50), (1, 75), (1, 100),
                (25, 50), (50, 100), (99, 100), (100, 100),
                (50, 25),   # inverted range -> empty sum
                (0, 5), (1, 101), (-5, 3),
            ]
        ],
        "activity_xp": [
            _case({"total_sets": s, "cardio_minutes": m}, activity_xp(s, m))
            for s, m in [
                (0, 0), (1, 0), (0, 1), (1, 1), (10, 30), (100, 0), (0, 100),
                (3, 2.5), (7, 0.5), (1000, 5000),
                (-1, 0), (0, -1), (-5, -5),        # negatives clamp to 0
                (None, None), ("abc", "xyz"),      # unparseable -> 0
                ("5", "10"),                       # numeric strings do parse
            ]
        ],
    }


def fx_xp_progress():
    totals = [
        0, 1, 499, 500, 501, 999, 1000, 1024, 1025, 1026,
        2000, 5000, 12345, 100000, 1000000,
        -1, -500,
    ]
    bases = [1, 2, 25, 50, 99, 100, 0, -3, 101]

    cases = []
    for base in bases:
        for total in totals:
            level, into, needed = level_and_progress(base, total)
            cases.append(
                _case(
                    {"base_level": base, "total_xp": total},
                    {"level": level, "xp_into_level": into, "xp_needed": needed},
                )
            )

    # Non-numeric total_xp falls back to 0 rather than raising.
    for bad in [None, "abc"]:
        level, into, needed = level_and_progress(1, bad)
        cases.append(
            _case(
                {"base_level": 1, "total_xp": bad},
                {"level": level, "xp_into_level": into, "xp_needed": needed},
            )
        )

    # The bar must reach exactly 100% at the instant the level is granted, and
    # never exceed it. Walk the curve and assert the invariant as data: feeding
    # cumulative_xp(1, L) must land exactly on level L with 0 XP into it.
    exact = []
    for lv in range(1, MAX_LEVEL + 1):
        total = cumulative_xp(1, lv)
        level, into, needed = level_and_progress(1, total)
        exact.append(
            _case(
                {"base_level": 1, "total_xp": total},
                {"level": level, "xp_into_level": into, "xp_needed": needed},
            )
        )

    # level_from_ledger is level_and_progress fed a different number. If a ledger
    # sum equals a derived total they MUST produce the identical level, or
    # migrations/002 STEP 4 reconciliation means nothing.
    ledger = []
    for base in [1, 25, 100]:
        for total in [0, 500, 1025, 12345]:
            lvl, into, needed = level_from_ledger(base, total)
            ledger.append(
                _case(
                    {"base_level": base, "ledger_sum": total},
                    {"level": lvl, "xp_into_level": into, "xp_needed": needed},
                )
            )

    return {
        "level_and_progress": cases,
        "level_and_progress_exact_boundaries": exact,
        "level_from_ledger": ledger,
    }


def fx_xp_resolve():
    pairs = [
        (0, None), (100, None), (0, 0), (100, 100),
        (100, 150),     # ledger ahead -> ledger wins, positive drift
        (100, 50),      # ledger behind -> derived floors it, negative drift
        (100, 0),       # a failed grant must NOT drag the user to 0
        (0, 100),
        (-50, None), (100, -50),
        (100, "abc"),   # unparseable ledger -> derived, drift 0
        ("abc", 100),
        (None, None),
    ]
    cases = []
    for derived, ledger in pairs:
        xp, source, drift = resolve_xp(derived, ledger)
        cases.append(
            _case(
                {"derived_xp": derived, "ledger_xp": ledger},
                {"xp": xp, "source": source, "drift": drift},
            )
        )

    pct = [
        _case({"xp_into_level": i, "xp_needed": n}, progress_percent(i, n))
        for i, n in [
            (0, 500), (250, 500), (500, 500), (499, 500), (1, 3),
            (600, 500),     # clamps to 100, never overfills
            (-10, 500),     # clamps to 0
            (0, 0), (10, 0), (10, -5),   # needed <= 0 -> 100.0, never divide by zero
            (None, 500), ("abc", "def"),
        ]
    ]

    return {"resolve_xp": cases, "progress_percent": pct}


# --------------------------------------------------------------------------
# domain/avatar_stats.py + domain/xp_leveling.py -- rarity, stage, branch, names
# --------------------------------------------------------------------------

def fx_avatar():
    levels = sorted(set(EDGE_LEVELS + ALL_LEVELS))
    valid = [lv for lv in levels if lv >= 0]   # avatar_rarity(int) does not clamp

    rarity = []
    for lv in valid:
        name, icon, colour = avatar_rarity(lv)
        rarity.append(_case(lv, {"name": name, "icon": icon, "colour": colour}))

    # NOTE: these `colour` values are the PYTHON rarity palette, injected inline as
    # --rarity-colour by rarity_badge_html(). They are NOT the same as the CSS
    # :root --common/--rare/--epic/--legendary/--mythic tokens that drive the
    # .rarity-* aura classes on the very same card. Only COMMON agrees. Pinning
    # the Python palette here does not bless it -- it records what ships today.

    branch_grid = []
    axis = [0, 44, 45, 54, 55, 100]     # straddles the >=45 and >=55 thresholds
    for st in axis:
        for si in axis:
            for co in axis:
                for ae in axis:
                    stats = {
                        "strength_score": st,
                        "size_score": si,
                        "conditioning_score": co,
                        "aesthetic_score": ae,
                    }
                    branch_grid.append(_case(stats, determine_avatar_branch(stats)))

    # Missing / unparseable keys default through safe_num to 0.
    branch_grid.append(_case({}, determine_avatar_branch({})))
    branch_grid.append(
        _case(
            {"strength_score": None, "size_score": "abc"},
            determine_avatar_branch({"strength_score": None, "size_score": "abc"}),
        )
    )

    return {
        "avatar_rarity": rarity,
        "rarity_slug": [_case(lv, rarity_slug(lv)) for lv in valid]
        + [_case(v, rarity_slug(v)) for v in [None, "abc"]],
        "get_avatar_stage": [_case(lv, get_avatar_stage(lv)) for lv in valid],
        "get_branch_stage": [
            _case({"branch": b, "level": lv}, get_branch_stage(b, lv))
            for b in BRANCHES + ["AESTHETIC", "unknown"]
            for lv in valid
        ],
        "determine_avatar_branch": branch_grid,
        "branch_display_name": [
            _case(b, branch_display_name(b))
            for b in BRANCHES + ["MASS", "Hybrid", "unknown", ""]
        ],
        # evolution_name and avatar_stage_rows agree at every level: both grant
        # "True Adam" at 100. They disagreed for levels 90-99 until the `>= 90`
        # in evolution_name was corrected. These two fixtures cross-check each other.
        "evolution_name": [
            _case({"branch": b, "level": lv}, evolution_name(b, lv))
            for b in BRANCHES + ["unknown"]
            for lv in valid
        ],
        "avatar_stage_rows": [
            _case({"branch": b, "current_level": lv}, avatar_stage_rows(b, lv))
            for b in BRANCHES + ["unknown"]
            for lv in [1, 24, 25, 49, 50, 74, 75, 89, 90, 99, 100]
        ],
        "rank_tiers": [[t, n] for t, n in RANK_TIERS],
        "rank_name": [_case(lv, rank_name(lv)) for lv in valid],
        "rank_ladder": [[low, high, name] for low, high, name in rank_ladder()],
        # Onboarding's placement formula. Bench/squat/years straddle every band
        # edge; the self-ratings add through int() truncation; the sum clamps
        # to 1..100.
        "calculate_starting_level": [
            _case(
                {
                    "bench_e1rm": b,
                    "squat_e1rm": s,
                    "training_years": y,
                    "physique_score": p,
                    "leanness_score": ln,
                },
                calculate_starting_level(b, s, y, p, ln),
            )
            for b in [0, 59, 60, 79, 80, 89, 90, 99, 100, 119, 120]
            for s, y, p, ln in [
                (0, 0, 0, 0),
                (100, 1, 5, 5),
                (140, 3, 7.5, 7.5),
                (180, 5, 10, 10),
                (99, 0.9, 0.5, 14.5),
            ]
        ]
        + [
            # Clamp ceiling: everything maxed must still be 100.
            _case(
                {"bench_e1rm": 200, "squat_e1rm": 300, "training_years": 20, "physique_score": 15, "leanness_score": 15},
                calculate_starting_level(200, 300, 20, 15, 15),
            )
        ],
    }


# --------------------------------------------------------------------------
# domain/bodyfat.py -- US Navy estimate
# --------------------------------------------------------------------------

def fx_bodyfat():
    navy = []
    samples = [
        (180, 85, 38), (180, 90, 38), (175, 80, 36), (190, 100, 42),
        (165, 70, 33), (183, 84.5, 37.5), (170.2, 79.8, 35.1),
        (180, 38, 38),      # waist == neck -> None
        (180, 30, 38),      # waist <  neck -> None
        (0, 85, 38),        # height 0      -> None
        (180, 85, 0),       # neck 0        -> None
        (-180, 85, 38),
        (None, None, None),
        ("abc", "def", "ghi"),
    ]
    for h, w, n in samples:
        navy.append(
            _case({"height_cm": h, "waist_cm": w, "neck_cm": n}, navy_body_fat_male(h, w, n))
        )

    outputs = []
    for wt, bf, tgt in [
        (80, 20, 10), (80, 15, 10), (80, 10, 10), (80, 8, 10),
        (100, 30, 12), (70.5, 12.25, 8.0),
        (0, 20, 10), (80, 0, 10), (80, 20, 0), (80, 20, 100), (80, 20, 150),
        (None, None, None), ("abc", "def", "ghi"),
    ]:
        fat, lean, target_w, to_lose = bodyfat_outputs(wt, bf, tgt)
        outputs.append(
            _case(
                {"weight_kg": wt, "bf_percent": bf, "target_bf": tgt},
                {
                    "fat_mass": fat,
                    "lean_mass": lean,
                    "target_weight": target_w,
                    "fat_to_lose": to_lose,
                },
            )
        )

    # Default target_bf is 10.0 -- pinned separately so a signature change is caught.
    default_target = [
        _case({"weight_kg": w, "bf_percent": b}, list(bodyfat_outputs(w, b)))
        for w, b in [(80, 20), (90, 25)]
    ]

    return {
        "navy_body_fat_male": navy,
        "bodyfat_outputs": outputs,
        "bodyfat_outputs_default_target": default_target,
        "safe_kg": [
            _case(v, safe_kg(v))
            for v in [None, 0, 1, 80, 80.44, 80.45, 80.55, -3.2, "80", "abc"]
        ],
    }


# --------------------------------------------------------------------------
# Assorted pure helpers the port must agree on
# --------------------------------------------------------------------------

def fx_helpers():
    e1rm = [
        _case({"weight": w, "reps": r}, estimated_1rm(w, r))
        for w, r in [
            (100, 1), (100, 5), (100, 10), (100, 30), (60, 8), (0, 5),
            (100, 0),     # reps 0 -> 0, never a divide or a phantom 1RM
            (100, -1),
            (102.5, 7),
        ]
    ]

    s0100 = [
        _case({"value": v, "low": lo, "high": hi}, score_0_100(v, lo, hi))
        for v, lo, hi in [
            (65, 65, 88), (88, 65, 88), (77, 65, 88), (50, 65, 88), (100, 65, 88),
            (70, 88, 65),   # high <= low -> 0
            (70, 70, 70),
            (None, 0, 10), ("abc", 0, 10),
        ]
    ]

    sn = [
        _case({"value": v, "default": d}, safe_num(v, d))
        for v, d in [
            (1, 0.0), (1.5, 0.0), ("2.5", 0.0), (None, 0.0), (None, 99.0),
            ("abc", 0.0), ("abc", -1.0), (True, 0.0), ([], 0.0),
        ]
    ]

    # NaN / +-Inf have no JSON literal. The Vitest side maps these three marker
    # strings back to real floats before calling. See module docstring.
    sn_specials = [
        {"input": {"value": "NaN", "default": 0.0}, "expected": safe_num(float("nan"), 0.0)},
        {"input": {"value": "Infinity", "default": 0.0}, "expected": safe_num(float("inf"), 0.0)},
        {"input": {"value": "-Infinity", "default": 7.5}, "expected": safe_num(float("-inf"), 7.5)},
    ]

    exercises = sorted({ex for exs in EXERCISE_LIBRARY.values() for ex in exs}) if all(
        isinstance(v, (list, tuple)) for v in EXERCISE_LIBRARY.values()
    ) else sorted(EXERCISE_LIBRARY)

    muscle = [_case(ex, infer_muscle_group(ex)) for ex in exercises]
    muscle += [
        _case(ex, infer_muscle_group(ex))
        for ex in ["Barbell Bench Press (Strength)", "Barbell Back Squat", "Totally Made Up Lift", ""]
    ]

    return {
        "estimated_1rm": e1rm,
        "score_0_100": s0100,
        "safe_num": sn,
        "safe_num_specials": sn_specials,
        "infer_muscle_group": muscle,
    }


# --------------------------------------------------------------------------
# Data contracts: catalogs the TS port must reproduce verbatim
# --------------------------------------------------------------------------

def fx_catalogs():
    # NOTE: 64 achievements, not the 66 quoted by MIGRATION_PLAN.md and CLAUDE.md.
    return {
        "achievements_count": len(ACHIEVEMENTS),
        "achievements": {k: list(v) for k, v in ACHIEVEMENTS.items()},
        "routine": {k: list(v) if isinstance(v, (list, tuple)) else v for k, v in ROUTINE.items()},
        "exercise_library": {
            k: list(v) if isinstance(v, (list, tuple)) else v
            for k, v in EXERCISE_LIBRARY.items()
        },
        "muscle_map_count": len(MUSCLE_MAP),
        "muscle_map": {k: v for k, v in MUSCLE_MAP.items()},
    }


FIXTURES = {
    "xp_curve.json": fx_xp_curve,
    "xp_progress.json": fx_xp_progress,
    "xp_resolve.json": fx_xp_resolve,
    "avatar.json": fx_avatar,
    "bodyfat.json": fx_bodyfat,
    "helpers.json": fx_helpers,
    "catalogs.json": fx_catalogs,
}


def _serialise(payload):
    """Deterministic bytes. Same on Windows and Linux, same run to run."""
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--check",
        action="store_true",
        help="Regenerate in memory and diff against disk. Writes nothing. Exit 1 on drift.",
    )
    args = ap.parse_args()

    if not args.check:
        FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    drift = []
    written = 0
    total_cases = 0

    for filename, build in sorted(FIXTURES.items()):
        payload = build()
        text = _serialise(payload)
        path = FIXTURE_DIR / filename

        # Rough case count, for the "did this actually test anything" line below.
        for value in payload.values():
            if isinstance(value, list):
                total_cases += len(value)

        if args.check:
            if not path.exists():
                drift.append(f"{filename}: MISSING on disk")
                continue
            on_disk = path.read_text(encoding="utf-8")
            if on_disk != text:
                drift.append(f"{filename}: DIFFERS from regenerated output")
        else:
            path.write_text(text, encoding="utf-8", newline="\n")
            written += 1
            print(f"  wrote {path.relative_to(REPO_ROOT)}  ({len(text):,} bytes)")

    # A check that enumerates bad things over a collection must assert the
    # collection is non-empty. An empty FIXTURES dict would otherwise pass.
    # (CLAUDE.md: "a guard that cannot fail is not a guard".)
    if not FIXTURES or total_cases == 0:
        print("FAIL: generator produced no cases at all", file=sys.stderr)
        return 2

    if args.check:
        if drift:
            print("FAIL: fixtures are stale. Python domain changed without regenerating.", file=sys.stderr)
            for d in drift:
                print(f"  {d}", file=sys.stderr)
            print("\n  Run: python tools/gen_fixtures.py", file=sys.stderr)
            return 1
        print(f"OK: {len(FIXTURES)} fixture files match, {total_cases:,} cases")
        return 0

    print(f"\nOK: wrote {written} files, {total_cases:,} cases to {FIXTURE_DIR.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
