import pandas as pd
import streamlit as st

from config.constants import (
    LOG_FILE, CARDIO_FILE, BODYFAT_FILE, BODYWEIGHT_FILE, MEASUREMENTS_FILE,
    PHYSIQUE_RATING_FILE, CUSTOM_PLAN_FILE, TARGETS_FILE, PROFILE_FILE, ACHIEVEMENT_FILE,
)
from data.csv_store import load_csv
from domain.workouts import normalise_workout_log
from ui.components import page_hero


def render():
    page_hero("Delete Logged Data", "Remove accidental entries from any log.", "Admin")
    st.warning("Use this to remove accidental entries. This permanently edits the CSV file.")
    log_type = st.selectbox("Choose log", ["Workout", "Cardio", "Body Fat", "Bodyweight", "Measurements", "Physique Ratings", "Custom Plan", "Targets", "Profile", "Achievements"])
    if log_type == "Workout":
        path, columns = LOG_FILE, ["date", "workout", "exercise", "set", "weight", "reps", "timestamp"]
    elif log_type == "Cardio":
        path, columns = CARDIO_FILE, ["date", "type", "minutes", "distance_km", "incline", "speed", "calories", "notes", "timestamp"]
    elif log_type == "Body Fat":
        path, columns = BODYFAT_FILE, ["date", "method", "bodyweight", "height_cm", "waist_cm", "neck_cm", "bf_low", "bf_high", "bf_mid", "confidence", "notes", "timestamp"]
    elif log_type == "Bodyweight":
        path, columns = BODYWEIGHT_FILE, ["date", "bodyweight", "timestamp"]
    elif log_type == "Measurements":
        path, columns = MEASUREMENTS_FILE, ["date", "bodyweight", "wrist_cm", "forearm_cm", "bicep_cm", "chest_cm", "waist_cm", "hips_cm", "thigh_cm", "calf_cm", "shoulders_cm", "neck_cm", "notes", "timestamp"]
    elif log_type == "Physique Ratings":
        path, columns = PHYSIQUE_RATING_FILE, ["date", "physique_score", "leanness_score", "symmetry_score", "muscularity_score", "confidence", "weak_points", "improvements", "summary", "timestamp"]
    elif log_type == "Custom Plan":
        path, columns = CUSTOM_PLAN_FILE, ["workout", "exercise", "sets", "reps", "reason", "day_goal", "plan_name", "timestamp"]
    elif log_type == "Targets":
        path, columns = TARGETS_FILE, ["target_type", "name", "target_value", "unit", "created_at", "notes"]
    elif log_type == "Profile":
        path, columns = PROFILE_FILE, ["height_cm", "bodyweight_kg", "bench_e1rm", "squat_e1rm", "training_years", "physique_score", "leanness_score", "base_level", "created_at"]
    else:
        path, columns = ACHIEVEMENT_FILE, ["achievement_id", "name", "description", "date_unlocked"]

    data = load_csv(path, columns)
    if log_type == "Workout":
        data = normalise_workout_log(data)

    if data.empty:
        st.info(f"No {log_type.lower()} data found.")
    else:
        data = data.reset_index(drop=True)
        data.insert(0, "delete_id", data.index)
        st.dataframe(data, use_container_width=True)
        delete_ids_text = st.text_input("Enter delete_id numbers to delete", placeholder="Example: 0, 4, 7")
        if st.button("Delete Selected Rows", type="primary"):
            if delete_ids_text.strip():
                try:
                    ids_to_delete = [int(x.strip()) for x in delete_ids_text.split(",") if x.strip()]
                    original = load_csv(path, columns).reset_index(drop=True)
                    if log_type == "Workout":
                        original = normalise_workout_log(original)
                    valid_ids = [i for i in ids_to_delete if 0 <= i < len(original)]
                    updated = original.drop(index=valid_ids).reset_index(drop=True)
                    updated.to_csv(path, index=False)
                    st.session_state.just_saved_message = f"DELETED {len(valid_ids)} ROW(S)"
                    st.rerun()
                except ValueError:
                    st.error("Use numbers separated by commas only.")
        st.divider()
        confirm_text = f"DELETE {log_type.upper()}"
        confirm = st.text_input(f"Type {confirm_text} to clear all {log_type.lower()} data")
        if st.button(f"Clear All {log_type} Data"):
            if confirm == confirm_text:
                pd.DataFrame(columns=columns).to_csv(path, index=False)
                st.session_state.just_saved_message = f"ALL {log_type.upper()} DATA CLEARED"
                st.rerun()
            else:
                st.error(f"Confirmation did not match. Type: {confirm_text}")
