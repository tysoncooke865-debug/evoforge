import pandas as pd
import streamlit as st

from config.constants import ROUTINE
from domain.targets import load_targets, save_or_update_target, get_target
from domain.bodyweight import latest_bodyweight_value
from domain.bodyfat import latest_bodyfat_mid
from domain.workouts import current_exercise_best_1rm
from ui.nav import route_button
from ui.components import page_hero, render_target_bar


def render():
    page_hero("Targets", "Set body-composition and strength goals, then track progress toward them.", "Quests")
    gqa1, gqa2, gqa3 = st.columns(3)
    with gqa1:
        route_button("Get AI Body Fat Estimate →", "Body Fat", key="qol_goals_bodyfat_page")
    with gqa2:
        route_button("Log Bodyweight →", "Bodyweight", key="qol_goals_bodyweight_page")
    with gqa3:
        route_button("Open Analytics →", "Progress", key="qol_goals_progress_page")
    st.info("Set body composition and strength targets. These will show on the Home dashboard and update as you log data.")

    st.subheader("Set Body Targets")
    c1, c2 = st.columns(2)
    with c1:
        bf_target = st.number_input("Body fat % target", min_value=3.0, max_value=30.0, step=0.5, value=float(get_target("Body Fat", "Body Fat %") or 10.0))
        if st.button("Save Body Fat Target", type="primary"):
            save_or_update_target("Body Fat", "Body Fat %", bf_target, "%", "Target body fat percentage")
            st.session_state.just_saved_message = "BODY FAT TARGET SAVED"
            st.rerun()
    with c2:
        bw_default = get_target("Bodyweight", "Bodyweight") or latest_bodyweight_value() or 76.0
        bw_target = st.number_input("Bodyweight target kg", min_value=30.0, max_value=200.0, step=0.1, value=float(bw_default))
        if st.button("Save Bodyweight Target", type="primary"):
            save_or_update_target("Bodyweight", "Bodyweight", bw_target, "kg", "Target scale weight")
            st.session_state.just_saved_message = "BODYWEIGHT TARGET SAVED"
            st.rerun()

    st.subheader("Set 1RM Targets")
    all_exercises = sorted({exercise for workout in ROUTINE.values() for exercise, _, _ in workout})
    default_exercise = "Barbell Bench Press (Strength)" if "Barbell Bench Press (Strength)" in all_exercises else all_exercises[0]
    exercise_target = st.selectbox("Exercise", all_exercises, index=all_exercises.index(default_exercise))

    current_best = current_exercise_best_1rm(exercise_target)
    existing_target = get_target("1RM", exercise_target)
    sensible_default = existing_target or (100.0 if exercise_target == "Barbell Bench Press (Strength)" else max(current_best + 10, 50))

    c3, c4 = st.columns(2)
    with c3:
        st.metric("Current estimated 1RM", f"{current_best:.1f}kg" if current_best else "No data")
    with c4:
        target_1rm = st.number_input("Target estimated 1RM kg", min_value=1.0, max_value=400.0, step=2.5, value=float(sensible_default))

    if st.button("Save 1RM Target", type="primary"):
        save_or_update_target("1RM", exercise_target, target_1rm, "kg", "Target estimated one rep max")
        st.session_state.just_saved_message = f"{exercise_target} TARGET SAVED"
        st.rerun()

    st.subheader("Target Progress")
    render_target_bar("BODY FAT TARGET", latest_bodyfat_mid(), get_target("Body Fat", "Body Fat %"), "%", lower_is_better=True)
    render_target_bar("BODYWEIGHT TARGET", latest_bodyweight_value(), get_target("Bodyweight", "Bodyweight"), "kg", lower_is_better=False)

    targets = load_targets()
    one_rm_targets = targets[targets["target_type"].astype(str) == "1RM"] if not targets.empty else pd.DataFrame()
    if not one_rm_targets.empty:
        for _, row in one_rm_targets.iterrows():
            name = str(row["name"])
            target = float(row["target_value"])
            render_target_bar(f"{name.upper()} TARGET", current_exercise_best_1rm(name), target, "kg", lower_is_better=False)

    st.subheader("Saved Targets")
    targets = load_targets()
    if targets.empty:
        st.info("No targets saved yet.")
    else:
        st.dataframe(targets, use_container_width=True)
