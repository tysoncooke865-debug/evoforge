import pandas as pd
import streamlit as st

from config.constants import ACHIEVEMENTS
from domain.workouts import load_log, workout_summary, muscle_heat_map, current_exercise_best_1rm
from domain.xp import progress_percent
from domain.profile import rank_name
from domain.bodyfat import load_bodyfat_log, latest_bodyfat_mid
from domain.bodyweight import latest_bodyweight_value
from domain.targets import get_target
from domain.achievements import load_achievements, achievement_count
from domain.avatar_stats import calculate_avatar_stats
from ui.components import (
    render_forge_signature, render_forge_micro_status, page_hero, get_fast_snapshot,
    render_base_console_panel, render_today_quest_card, render_qol_action_card,
    compact_metric, render_target_bar,
)
from ui.avatar_cards import render_next_evolution_card


def render():
    render_forge_signature()
    render_forge_micro_status()

    page_hero("Forge Core", "Your body is the build — every set upgrades the system.", "Begin Quest")

    try:
        _home_snapshot = get_fast_snapshot()
        df = _home_snapshot.get("df", pd.DataFrame()) if isinstance(_home_snapshot, dict) else load_log()
        summary = _home_snapshot.get("summary", workout_summary(df)) if isinstance(_home_snapshot, dict) else workout_summary(df)
    except Exception:
        df = pd.DataFrame()
        summary = {}
    try:
        home_avatar_stats = calculate_avatar_stats()
        render_base_console_panel(home_avatar_stats)
        render_today_quest_card(home_avatar_stats)
        render_next_evolution_card(home_avatar_stats)
    except Exception:
        pass

    st.markdown("### Quick Actions")
    qa1, qa2, qa3 = st.columns(3)
    with qa1:
        render_qol_action_card(
            "Body Fat Scan",
            "Update the estimate that drives leanness, rarity and target progress.",
            "Get AI Estimate →",
            "Body Fat",
            "qol_home_quick_bodyfat",
            "🔥",
        )
    with qa2:
        render_qol_action_card(
            "Scale Check",
            "Log today's bodyweight so targets and avatar stats stay current.",
            "Log Bodyweight →",
            "Bodyweight",
            "qol_home_quick_bodyweight",
            "⚖️",
        )
    with qa3:
        render_qol_action_card(
            "Start Quest",
            "Jump straight to your current mission and log working sets.",
            "Open Missions →",
            "Today",
            "qol_home_quick_missions",
            "⚔️",
        )

    st.markdown("### Core Readout")
    m1, m2, m3, m4 = st.columns(4)
    with m1:
        compact_metric("Total Sets", summary["total_sets"], "working sets")
    with m2:
        compact_metric("Total Reps", summary["total_reps"], "logged reps")
    with m3:
        compact_metric("Bench e1RM", f'{summary["best_bench_1rm"]:.1f}kg', "best strength bench")
    with m4:
        compact_metric("Achievements", f'{achievement_count()}/{len(ACHIEVEMENTS)}', "unique unlocks")

    # One place decides what the bar reads. Clamps to 0-100, never divides by zero.
    xp_percent = progress_percent(summary["xp_into_level"], summary["xp_needed"])
    bench_percent = min((summary["best_bench_1rm"] / 100) * 100, 100)

    c1, c2, c3 = st.columns(3)
    c1.metric("Level", f"{summary['level']}")
    c2.metric("Rank", summary.get("rank", rank_name(summary["level"])))
    c3.metric("Total Sets", f"{summary['total_sets']}")

    c4, c5, c6 = st.columns(3)
    c4.metric("Bodyweight", f"{summary['latest_bw']:.1f} kg" if summary["latest_bw"] else "No data")
    c5.metric("Best Bench e1RM", f"{summary['best_bench_1rm']:.1f} kg")
    c6.metric("Total Reps", f"{summary['total_reps']}")

    bf_log = load_bodyfat_log()
    if not bf_log.empty:
        bf_log["bf_mid"] = pd.to_numeric(bf_log["bf_mid"], errors="coerce").fillna(0)
        latest_bf = float(bf_log.iloc[-1]["bf_mid"])
        st.metric("Latest BF Estimate", f"{latest_bf:.1f}%")

    st.markdown(f"""
    <div class="mission-card">
        <div class="mission-title">LEVEL {summary['level']} — {summary.get('rank', rank_name(summary['level']))}</div>
        <div class="progress-track"><div class="progress-fill" style="--progress: {xp_percent:.1f}%;"></div></div>
        <div class="progress-label">Base level {summary.get('base_level', 1)} • {summary['xp_into_level']}/{summary['xp_needed']} XP to next level</div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown(f"""
    <div class="mission-card">
        <div class="mission-title">100KG BENCH QUEST</div>
        <div class="progress-track"><div class="progress-fill" style="--progress: {bench_percent:.1f}%;"></div></div>
        <div class="progress-label">{summary['best_bench_1rm']:.1f}kg estimated / 100kg — {bench_percent:.1f}%</div>
    </div>
    """, unsafe_allow_html=True)

    st.subheader("Questline")

    bf_target = get_target("Body Fat", "Body Fat %")
    bw_target = get_target("Bodyweight", "Bodyweight")
    bench_target = get_target("1RM", "Barbell Bench Press (Strength)")
    squat_target = get_target("1RM", "Barbell Back Squat")

    render_target_bar("BODY FAT TARGET", latest_bodyfat_mid(), bf_target, "%", lower_is_better=True, action_label="Get AI Estimate →", action_page="Body Fat", action_key="qol_home_bodyfat_estimate")
    render_target_bar("BODYWEIGHT TARGET", latest_bodyweight_value(), bw_target, "kg", lower_is_better=False, action_label="Log Bodyweight →", action_page="Bodyweight", action_key="qol_home_bodyweight_log")
    render_target_bar("BENCH 1RM TARGET", current_exercise_best_1rm("Barbell Bench Press (Strength)"), bench_target, "kg", lower_is_better=False, action_label="Edit Bench Target →", action_page="Goals", action_key="qol_home_bench_target")
    render_target_bar("SQUAT 1RM TARGET", current_exercise_best_1rm("Barbell Back Squat"), squat_target, "kg", lower_is_better=False, action_label="Edit Squat Target →", action_page="Goals", action_key="qol_home_squat_target")

    st.subheader("Load Matrix")
    heat = muscle_heat_map(df)
    if heat.empty:
        st.info("No muscle volume logged yet.")
    else:
        max_sets = max(int(heat["sets"].max()), 1)
        for _, row in heat.iterrows():
            pct = min((int(row["sets"]) / max_sets) * 100, 100)
            st.markdown(f"""
            <div class="heat-row">
                <div class="heat-label">{row['muscle']} — {int(row['sets'])} sets</div>
                <div class="progress-track"><div class="progress-fill" style="--progress: {pct:.1f}%;"></div></div>
            </div>
            """, unsafe_allow_html=True)

    st.subheader("Relic Vault")
    ach = load_achievements()
    if ach.empty:
        st.info("No achievements unlocked yet. Open the Achievements tab to check requirements.")
    else:
        st.metric("Achievements", f"{achievement_count()}/{len(ACHIEVEMENTS)}")
        for _, row in ach.sort_values("date_unlocked", ascending=False).head(5).iterrows():
            st.markdown(f"""<div class="dashboard-card"><div class="nw-card-title">{row['name']}</div><div class="nw-small">{row['description']}</div></div>""", unsafe_allow_html=True)
        st.caption("Open the Achievements tab to view all locked/unlocked achievements.")
