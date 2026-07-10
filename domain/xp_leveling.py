"""Streamlit-facing XP helpers.

The XP *contract* lives in `domain/xp.py` and is pure. This module only adapts it
to the UI: reading a summary dict, and setting the session_state flags the +XP
toast reads. Keep it that way -- a leaderboard must never import Streamlit.
"""

import streamlit as st

from domain.xp import XP_PER_SET, level_and_progress, xp_for_level
from domain.workouts import load_log, workout_summary


def xp_to_next_level(level):
    """XP to advance from `level`. Re-exported from domain/xp.py."""
    return xp_for_level(level)


def current_level_xp(summary=None):
    """(level, xp_into_level, xp_needed) for the progress bar.

    Reads what `workout_summary()` already computed. It does NOT recompute, and
    there is no fallback formula: the old `sets*35 + reps*2` estimate produced a
    different XP total than the one that granted the level, so the bar measured
    progress toward a level-up that would never arrive.
    """
    if summary is None:
        summary = workout_summary(load_log())

    level = summary.get("level")
    into = summary.get("xp_into_level")
    needed = summary.get("xp_needed")

    if level is None or into is None or not needed:
        # Older/partial summaries: derive from the same single source of truth.
        return level_and_progress(summary.get("base_level", 1), summary.get("xp", 0))

    return int(level), int(into), int(needed)


def avatar_stage_rows(branch, current_level):
    branch = str(branch).lower()
    current_level = int(current_level)

    if branch == "mass":
        rows = [
            (1, "Cyber Recruit", 1),
            (25, "Iron Bulk", 1),
            (50, "Mass Monster", 2),
            (75, "Titan Form", 3),
            (100, "Titan Prime", 3),
        ]
    elif branch == "hybrid":
        rows = [
            (1, "Cyber Recruit", 1),
            (25, "Hybrid Rookie", 1),
            (50, "Tactical Athlete", 2),
            (75, "Apex Hybrid", 3),
            (100, "Legendary Hybrid", 3),
        ]
    else:
        rows = [
            (1, "Cyber Recruit", 1),
            (25, "Rising Aesthetic", 2),
            (50, "Elite Aesthetic", 3),
            (75, "Chad-Lite", 4),
            (100, "True Adam", 4),
        ]

    out = []
    for unlock_level, name, stage in rows:
        out.append({
            "level": unlock_level,
            "name": name,
            "stage": stage,
            "unlocked": current_level >= unlock_level,
            "current": current_level >= unlock_level and (
                unlock_level == max([r[0] for r in rows if current_level >= r[0]])
            )
        })
    return out


def mark_xp_gain(gain=XP_PER_SET, title="QUEST COMPLETE", subtitle="Workout logged successfully"):
    """Flag the +XP burst. `gain` must be XP the athlete actually earned.

    It used to default to 450 and be called with 75 for a set worth 10. A toast
    announcing XP that never lands is the same class of bug as a bar that never
    fills -- the UI telling a story the model does not support.
    """
    st.session_state["last_xp_gain"] = int(gain)
    st.session_state["last_xp_title"] = title
    st.session_state["last_xp_subtitle"] = subtitle
    st.session_state["show_xp_toast"] = True
