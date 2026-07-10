"""The XP contract. One curve, one place.

This module is the single source of truth for how experience becomes levels.
It is pure: no `streamlit`, no `pandas`, no database. That is deliberate — it is
the thing a leaderboard, a season and an anti-cheat check must all agree on, and
it must be trivially testable and portable to a FastAPI backend.

Three formulas used to exist, and they contradicted each other:

  * `workout_summary()`   granted one level per flat 500 XP.
  * `xp_to_next_level()`  claimed a level costs `500 + (level-1)*25`.
  * `current_level_xp()`  fell back to `sets*35 + reps*2` when XP was zero.

So the progress bar divided by a different number than the one that granted the
level. It could not reach 100% at level-up, and it could exceed it. You cannot
rank users on that, and fixing it after a leaderboard exists invalidates every
historic rank. Hence: fix it before there are ranks.

THE CURVE
    Advancing FROM level L costs `500 + (L-1) * 25` XP.
    Level 1 -> 2 costs 500. Level 42 -> 43 costs 1525. Level 99 -> 100 costs 2950.

    Levels get more expensive, which is what an RPG wants, and the cost of the
    level you are ON is the number the progress bar divides by. Those are now the
    same number by construction.

EARNING
    A working set is worth 10 XP. A minute of cardio is worth 2.
    XP accumulates from `base_level`, which comes from the athlete's profile.
    A character does not start at level 1 with 0 XP; it starts at `base_level`
    with 0 XP toward the next.

TWO SOURCES, ONE CURVE
    XP now has two possible inputs, and this module treats them identically:

      * DERIVED   -- recount `workout_log` + `cardio_log` on every render.
                     Idempotent, but no timestamps and no anti-cheat: the score is
                     a pure function of rows the user can insert at will.
      * LEDGER    -- sum `xp_events`, the append-only table in migrations/002.
                     Server-granted, timestamped, once per source row.

    `resolve_xp()` picks between them. The ledger wins when it is available; the
    derived number is still computed, because it is the ONLY thing that can detect
    that the ledger has drifted. Keep it. A leaderboard built on a number nothing
    cross-checks is a number nobody can defend.

    Until `migrations/002` is applied, `xp_events` does not exist and the ledger
    reads as absent -- `resolve_xp` falls back to derived and nothing breaks. The
    app is correct on both sides of that migration, in either deploy order.
"""

XP_PER_SET = 10
XP_PER_CARDIO_MINUTE = 2

FIRST_LEVEL_COST = 500
LEVEL_COST_STEP = 25

MIN_LEVEL = 1
MAX_LEVEL = 100


def _clamp_level(level):
    try:
        level = int(level)
    except (TypeError, ValueError):
        return MIN_LEVEL
    return max(MIN_LEVEL, min(level, MAX_LEVEL))


def activity_xp(total_sets=0, cardio_minutes=0):
    """Total XP earned from logged activity. The only place XP is minted."""
    try:
        sets = max(0, int(total_sets))
    except (TypeError, ValueError):
        sets = 0
    try:
        minutes = max(0.0, float(cardio_minutes))
    except (TypeError, ValueError):
        minutes = 0.0
    return int(sets * XP_PER_SET + minutes * XP_PER_CARDIO_MINUTE)


def xp_for_level(level):
    """XP needed to advance FROM `level` to `level + 1`.

    At MAX_LEVEL there is no next level, but callers divide by this to draw a
    progress bar, so it must never be 0. Returns the cost of the final level.
    """
    level = _clamp_level(level)
    if level >= MAX_LEVEL:
        level = MAX_LEVEL - 1
    return FIRST_LEVEL_COST + (level - 1) * LEVEL_COST_STEP


def xp_to_next_level(level):
    """Kept for the name used across the UI. Same number as `xp_for_level`."""
    return xp_for_level(level)


def cumulative_xp(from_level, to_level):
    """Total XP to get from `from_level` all the way to `to_level`."""
    from_level, to_level = _clamp_level(from_level), _clamp_level(to_level)
    return sum(xp_for_level(lv) for lv in range(from_level, to_level))


def level_and_progress(base_level, total_xp):
    """Resolve (level, xp_into_level, xp_needed) from a base level and total XP.

    `xp_into_level < xp_needed` always, below MAX_LEVEL — so the bar fills to
    exactly 100% at the instant the level is granted, and never past it. At
    MAX_LEVEL the bar pins full: `xp_into_level == xp_needed`.
    """
    level = _clamp_level(base_level)
    try:
        remaining = max(0, int(total_xp))
    except (TypeError, ValueError):
        remaining = 0

    while level < MAX_LEVEL:
        cost = xp_for_level(level)
        if remaining < cost:
            return level, remaining, cost
        remaining -= cost
        level += 1

    needed = xp_for_level(MAX_LEVEL)
    return MAX_LEVEL, needed, needed


def level_from_ledger(base_level, ledger_sum):
    """Resolve (level, xp_into_level, xp_needed) from the xp_events sum.

    The same curve as `level_and_progress`, fed a different number. It exists as a
    named function so the ledger path is greppable and so `tools/verify_xp.py` can
    pin that the two agree: if a ledger sum and a derived total are equal, they
    must produce the identical level, or the migration's STEP 4 reconciliation
    means nothing.
    """
    return level_and_progress(base_level, ledger_sum)


def resolve_xp(derived_xp, ledger_xp):
    """Choose which XP total to DISPLAY, and report any disagreement.

    Returns `(xp, source, drift)`, where `drift = ledger_xp - derived_xp`.

      * `ledger_xp is None` -- unreadable, or `migrations/002` is not applied.
        Use derived. Nothing to compare, so `drift` is 0.
      * `ledger_xp < derived_xp` -- grants are MISSING. Use derived, report the
        negative drift.
      * otherwise -- the ledger is the source of truth. Use it.

    **The ledger floors at the derived total; it never drags a user below it.**
    The first version of this preferred the ledger unconditionally, so a single
    failed grant turned a real 10 XP into a displayed 0 -- the user's level fell
    for logging a workout. An append-only ledger cannot be repaired by the app
    (RLS grants no update or delete), so a lost grant would have been permanent
    until someone re-ran the backfill. Losing XP a user earned is worse than
    briefly over-crediting one who has not been reconciled yet.

    Ranking is a different question from display. A leaderboard must read the
    LEDGER, not this number, and must refuse to rank any account whose `drift` is
    non-zero. `migrations/002` STEP 4 says which side is wrong: a positive drift
    means a set was double-granted or a granted row was deleted; a negative drift
    means grants failed or the backfill is stale, and STEP 3 is re-runnable.
    """
    try:
        derived = max(0, int(derived_xp))
    except (TypeError, ValueError):
        derived = 0

    if ledger_xp is None:
        return derived, "derived", 0

    try:
        ledger = max(0, int(ledger_xp))
    except (TypeError, ValueError):
        return derived, "derived", 0

    drift = ledger - derived
    if drift < 0:
        # Grants are missing. Show what they earned, and say the ledger is behind.
        return derived, "derived (ledger behind)", drift

    return ledger, "ledger", drift


def progress_percent(xp_into_level, xp_needed):
    """0.0 - 100.0, never NaN, never above 100, never dividing by zero."""
    try:
        needed = int(xp_needed)
        into = int(xp_into_level)
    except (TypeError, ValueError):
        return 0.0
    if needed <= 0:
        return 100.0
    return max(0.0, min(100.0, (into / needed) * 100.0))
