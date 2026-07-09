import streamlit as st

from domain.physique_ratings import safe_num
from domain.workouts import load_log, workout_summary


def xp_to_next_level(level):
    try:
        level = int(level)
    except Exception:
        level = 1
    return 500 + max(0, level - 1) * 25


def current_level_xp(summary=None):
    if summary is None:
        summary = workout_summary(load_log())
    level = int(summary.get("level", 1))
    total_xp = int(summary.get("xp", 0) or summary.get("total_xp", 0) or 0)

    # If the app summary does not expose total XP, estimate from level progress safely.
    needed = xp_to_next_level(level)
    if total_xp <= 0:
        total_sets = int(summary.get("total_sets", 0) or 0)
        total_reps = int(summary.get("total_reps", 0) or 0)
        total_xp = (total_sets * 35) + (total_reps * 2)

    xp_this_level = total_xp % needed
    return level, xp_this_level, needed


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


def estimate_workout_xp_from_row(row=None):
    try:
        # Conservative default for a completed session/set save.
        if row is None:
            return 75
        reps = safe_num(row.get("reps", 0), 0)
        weight = safe_num(row.get("weight", 0), 0)
        return int(max(50, min(250, 50 + reps * 3 + weight * 0.25)))
    except Exception:
        return 75


def mark_xp_gain(gain=450, title="QUEST COMPLETE", subtitle="Workout logged successfully"):
    st.session_state["last_xp_gain"] = int(gain)
    st.session_state["last_xp_title"] = title
    st.session_state["last_xp_subtitle"] = subtitle
    st.session_state["show_xp_toast"] = True
