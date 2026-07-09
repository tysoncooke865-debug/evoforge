import re
from datetime import date

import pandas as pd
import streamlit as st

from config.constants import ROUTINE
from domain.custom_plan import load_custom_plan, filter_out_test_custom_plans, custom_plan_display_name
from domain.workouts import load_log, get_last_sets, suggest_weight, save_set_auto
from domain.achievements import check_achievements
from ui.nav import route_button
from ui.components import page_hero, completed_sets_for_day_unique


def render():
    try:
        _plan_check = load_custom_plan()
        with st.expander("Custom Plan Sync Status", expanded=False):
            st.write(f"Custom plan rows loaded: {len(_plan_check)}")
            st.caption(f"Plan source: {st.session_state.get('last_custom_plan_source', 'unknown')}")
            if not _plan_check.empty:
                st.dataframe(_plan_check.head(20), width="stretch")
            if st.session_state.get("last_supabase_error"):
                st.warning(st.session_state.get("last_supabase_error"))
    except Exception as e:
        st.warning(f"Custom plan sync check failed: {e}")

    page_hero("Today’s Workout", "Choose your plan, log sets, chase PRs.", "Auto-save")
    tqa1, tqa2, tqa3 = st.columns(3)
    with tqa1:
        route_button("Generate Custom Plan →", "Physique", key="qol_today_custom_plan")
    with tqa2:
        route_button("View Progress →", "Progress", key="qol_today_progress")
    with tqa3:
        route_button("Set Quest Targets →", "Goals", key="qol_today_targets")

    if st.session_state.get("last_supabase_error"):
        st.error(st.session_state.get("last_supabase_error"))

    workout_source = st.radio(
        "Workout plan",
        ["PPPPLA Split", "AI Custom Workout Plan"],
        horizontal=True,
    )

    custom_plan_df = load_custom_plan()

    if workout_source == "AI Custom Workout Plan":
        if custom_plan_df.empty:
            st.warning("No AI custom workout plan found yet. Go to Physique → Generate AI Custom Plan first.")
            active_routine = ROUTINE
            workout_source = "PPPPLA Split"
        else:
            custom_plan_df = filter_out_test_custom_plans(custom_plan_df)
            custom_plan_df["sets"] = pd.to_numeric(custom_plan_df["sets"], errors="coerce").fillna(0).astype(int)

            plan_ids = custom_plan_df["plan_id"].dropna().astype(str).unique().tolist() if "plan_id" in custom_plan_df.columns else ["default_plan"]
            if not plan_ids:
                plan_ids = ["default_plan"]

            plan_options = {
                custom_plan_display_name(custom_plan_df, pid): pid
                for pid in plan_ids
            }

            selected_plan_label = st.selectbox(
                "Choose AI custom plan",
                list(plan_options.keys()),
                index=0,
                key="selected_ai_custom_plan",
            )
            selected_plan_id = plan_options[selected_plan_label]
            custom_plan_df = custom_plan_df[custom_plan_df["plan_id"].astype(str) == str(selected_plan_id)].copy()

            with st.expander("Available AI Custom Plans", expanded=False):
                overview_cols = [c for c in ["plan_id", "plan_name", "goal", "timestamp", "created_at", "workout", "exercise"] if c in load_custom_plan().columns]
                overview = load_custom_plan()[overview_cols].copy() if overview_cols else load_custom_plan().copy()
                st.dataframe(overview, width="stretch")

            active_routine = {}
            for workout_name in custom_plan_df["workout"].dropna().astype(str).unique():
                day_df = custom_plan_df[custom_plan_df["workout"].astype(str) == workout_name].copy()

                keep_cols = [c for c in ["exercise", "sets", "reps"] if c in day_df.columns]
                if keep_cols:
                    day_df = day_df.drop_duplicates(subset=keep_cols, keep="last")

                exercises_for_day = []
                for _, row in day_df.iterrows():
                    ex_name = str(row.get("exercise", "")).strip()
                    if not ex_name:
                        continue

                    set_count = int(row.get("sets", 3)) if pd.notna(row.get("sets", 3)) else 3
                    set_count = max(1, min(set_count, 6))

                    exercises_for_day.append((ex_name, set_count, str(row.get("reps", "8-12"))))

                seen_ex = set()
                clean_exercises = []
                for ex_name, set_count, reps in exercises_for_day:
                    sig = ex_name.lower().strip()
                    if sig in seen_ex:
                        continue
                    seen_ex.add(sig)
                    clean_exercises.append((ex_name, set_count, reps))

                active_routine[workout_name] = clean_exercises

            plan_name = custom_plan_display_name(custom_plan_df, selected_plan_id)
            st.success(f"Using AI plan: {plan_name}")
    else:
        active_routine = ROUTINE

    workout = st.selectbox("Workout", list(active_routine.keys()), key=f"mission_workout_select_{workout_source}_{st.session_state.get('selected_ai_custom_plan', '')}")
    workout_date = st.date_input("Date", value=date.today(), key=f"mission_workout_date_{workout_source}")

    if workout == "Rest":
        st.info("Rest day. Walk, stretch, eat protein, sleep.")
    else:
        total_sets = sum(ex[1] for ex in active_routine[workout])
        completed_sets = completed_sets_for_day_unique(load_log(), workout_date, workout)
        percent = 0 if total_sets == 0 else min((completed_sets / total_sets) * 100, 100)
        if total_sets > 40:
            st.warning(f"Target volume looks too high ({total_sets} sets). The plan has been capped/deduplicated, but check the AI plan rows in Supabase.")
        st.caption(f"Target volume: {total_sets} working sets")
        st.markdown(f"""<div class="mission-card"><div class="mission-title">MISSION PROGRESS</div><div class="progress-track"><div class="progress-fill" style="--progress: {percent:.1f}%;"></div></div><div class="progress-label">{completed_sets}/{total_sets} sets complete — {percent:.1f}%</div></div>""", unsafe_allow_html=True)

        for exercise_index, (exercise, sets, reps_target) in enumerate(active_routine[workout]):
            safe_exercise_key = re.sub(r"[^a-zA-Z0-9_]+", "_", str(exercise)).strip("_")[:60]
            base_input_key = f"{workout_source}_{workout}_{exercise_index}_{safe_exercise_key}_{workout_date}_{st.session_state.get('selected_ai_custom_plan', '')}"
            with st.expander(f"⚡ {exercise}", expanded=True):
                st.markdown(f"""<div class="nw-exercise-card"><div class="nw-card-title">{exercise}</div><div class="nw-small">{sets} sets × {reps_target}</div></div>""", unsafe_allow_html=True)

                if exercise in ["Barbell Bench Press (Strength)", "Barbell Bench Press"]:
                    st.markdown("""<div class="nw-note"><b>Strength bench:</b> heavy top set of 3-5 reps, then back-off work. Rest 3-5 minutes.</div>""", unsafe_allow_html=True)
                if exercise == "Paused Barbell Bench Press":
                    st.markdown("""<div class="nw-note"><b>Paused bench:</b> lighter bench with a 1-2 second dead stop on the chest. No bounce.</div>""", unsafe_allow_html=True)

                if workout_source == "AI Custom Workout Plan" and not custom_plan_df.empty and "reason" in custom_plan_df.columns:
                    reason_rows = custom_plan_df[
                        (custom_plan_df["workout"].astype(str) == str(workout)) &
                        (custom_plan_df["exercise"].astype(str) == str(exercise))
                    ]
                    if not reason_rows.empty:
                        reason = str(reason_rows.iloc[0].get("reason", ""))
                        if reason and reason.lower() != "nan":
                            st.caption(f"AI reason: {reason}")

                last = get_last_sets(load_log(), exercise)
                if last is not None:
                    last_text = ", ".join(f"{float(r.weight):g}kg × {int(r.reps)}" for r in last.itertuples())
                    st.caption(f"Last session: {last_text}")
                st.caption(f"Suggestion: {suggest_weight(load_log(), exercise)}")

                for set_no in range(1, sets + 1):
                    col1, col2 = st.columns(2)
                    with col1:
                        weight = st.number_input(f"{exercise} set {set_no} kg", min_value=0.0, step=2.5, key=f"{base_input_key}_set_{set_no}_w", placeholder="kg")
                    with col2:
                        reps = st.number_input(f"{exercise} set {set_no} reps", min_value=0, step=1, key=f"{base_input_key}_set_{set_no}_r", placeholder="reps")

                    if weight > 0 and reps > 0:
                        changed, is_pr, current_1rm, previous_best = save_set_auto(workout_date, workout, exercise, set_no, weight, reps)
                        if changed:
                            st.session_state.just_saved_message = f"{exercise} SET {set_no} AUTO-SAVED"
                            if is_pr:
                                st.session_state.pr_message = f"{exercise}: {current_1rm:.1f}kg e1RM"
                            unlocked = check_achievements()
                            if unlocked:
                                st.session_state.achievement_message = " • ".join(unlocked)
                            st.rerun()

        st.caption("Sets auto-save once both weight and reps are entered. Edit the number to overwrite that set.")
