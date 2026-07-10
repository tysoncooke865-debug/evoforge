import pandas as pd
import streamlit as st

from domain.workouts import load_log, normalise_workout_log, e1rm_series
from domain.targets import get_target
from ui.nav import route_button
from ui.components import page_hero, render_target_bar


def render():
    page_hero("Progress Scanner", "Review your lifting history and trend data.", "Analytics")
    pqa1, pqa2, pqa3 = st.columns(3)
    with pqa1:
        route_button("Update Measurements →", "Measurements", key="qol_progress_measurements")
    with pqa2:
        route_button("Log Body Fat →", "Body Fat", key="qol_progress_bodyfat")
    with pqa3:
        route_button("Set Targets →", "Goals", key="qol_progress_goals")

    df = load_log()
    if df.empty:
        st.info("No workouts logged yet.")
    else:
        exercise = st.selectbox("Exercise", sorted(df["exercise"].dropna().unique()))
        ex = df[df["exercise"] == exercise].copy()
        ex = normalise_workout_log(ex)
        ex["weight"] = pd.to_numeric(ex["weight"], errors="coerce").fillna(0)
        ex["reps"] = pd.to_numeric(ex["reps"], errors="coerce").fillna(0)
        ex["estimated_1rm"] = e1rm_series(ex["weight"], ex["reps"])
        c1, c2 = st.columns(2)
        c1.metric("Best weight", f"{ex['weight'].max():g} kg")
        c2.metric("Best estimated 1RM", f"{ex['estimated_1rm'].max():.1f} kg")
        daily = ex.groupby("date", as_index=False)["estimated_1rm"].max()
        st.line_chart(daily, x="date", y="estimated_1rm")
        target = get_target("1RM", exercise)
        if target:
            render_target_bar(f"{exercise.upper()} 1RM TARGET", float(ex["estimated_1rm"].max()), target, "kg", lower_is_better=False, action_label="Adjust Strength Target →", action_page="Goals", action_key=f"qol_progress_target_{exercise}")
        st.dataframe(ex.sort_values(["date", "set"], ascending=False), width="stretch")
