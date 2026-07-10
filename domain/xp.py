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

XP is still DERIVED from `workout_log` + `cardio_log` on every render, not
stored. That makes it idempotent but gives no timestamps and no anti-cheat.
`migrations/002_xp_events.sql` adds the append-only ledger that fixes both. It
has not been applied. Until it is, do not build leaderboards on this.
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
