import pandas as pd
import streamlit as st

from data.sb_ops import sb_select, sb_delete_all, sb_delete_matching
from data.supabase_client import supabase_enabled
from ui.components import page_hero

# label -> (supabase table, columns shown when the table is empty)
LOG_TABLES = {
    "Workout": ("workout_log", ["date", "workout", "exercise", "set", "weight", "reps", "timestamp"]),
    "Cardio": ("cardio_log", ["date", "type", "minutes", "distance_km", "incline", "speed", "calories", "notes", "timestamp"]),
    "Body Fat": ("bodyfat_log", ["date", "method", "bodyweight", "height_cm", "waist_cm", "neck_cm", "bf_low", "bf_high", "bf_mid", "confidence", "notes", "timestamp"]),
    "Bodyweight": ("bodyweight_log", ["date", "bodyweight", "timestamp"]),
    "Measurements": ("measurements", ["date", "bodyweight", "wrist_cm", "forearm_cm", "bicep_cm", "chest_cm", "waist_cm", "hips_cm", "thigh_cm", "calf_cm", "shoulders_cm", "neck_cm", "notes", "timestamp"]),
    "Physique Ratings": ("physique_ratings", ["date", "physique_score", "leanness_score", "symmetry_score", "muscularity_score", "confidence", "weak_points", "improvements", "summary", "timestamp"]),
    "Custom Plan": ("custom_workout_plan", ["plan_name", "workout", "exercise", "sets", "reps", "muscle", "reason", "day_goal", "timestamp"]),
    "Targets": ("targets", ["target_type", "name", "target_value", "unit", "created_at", "notes"]),
    "Profile": ("profile", ["height_cm", "bodyweight_kg", "bench_e1rm", "squat_e1rm", "training_years", "physique_score", "leanness_score", "base_level", "created_at"]),
    "Achievements": ("achievements", ["achievement_id", "name", "description", "date_unlocked"]),
}

# Columns that identify a row well enough to delete it when the table has no
# primary key exposed. Values must be scalars — jsonb columns can't be matched
# with .eq(), so they are never used as a filter.
_IDENTITY_COLUMNS = ["date", "timestamp", "created_at", "date_unlocked", "exercise", "set",
                     "achievement_id", "target_type", "name", "plan_name", "workout"]


def _delete_filters(record):
    """Build an .eq() filter set that uniquely identifies one Supabase row.

    Prefers the primary key when the table exposes one. Falls back to the
    scalar identity columns present in the row.
    """
    if record.get("id") is not None:
        return {"id": record["id"]}
    filters = {}
    for col in _IDENTITY_COLUMNS:
        val = record.get(col)
        if val is None or isinstance(val, (list, dict)):
            continue
        if isinstance(val, float) and pd.isna(val):
            continue
        filters[col] = val
    return filters


def render():
    page_hero("Delete Logged Data", "Remove accidental entries from any log.", "Admin")

    if not supabase_enabled():
        st.error("Supabase is not connected. Deletion is unavailable.")
        return

    st.warning("This permanently deletes rows from the database. There is no undo.")

    log_type = st.selectbox("Choose log", list(LOG_TABLES.keys()))
    table, columns = LOG_TABLES[log_type]

    records, err = sb_select(table)
    if err:
        st.error(f"Could not read {table}: {err}")
        return

    records = records or []
    if not records:
        st.info(f"No {log_type.lower()} data found.")
        return

    data = pd.DataFrame(records)
    display = data.copy()
    display.insert(0, "delete_id", range(len(display)))
    st.dataframe(display, width="stretch")

    delete_ids_text = st.text_input("Enter delete_id numbers to delete", placeholder="Example: 0, 4, 7")
    if st.button("Delete Selected Rows", type="primary"):
        if not delete_ids_text.strip():
            st.error("Enter at least one delete_id.")
        else:
            try:
                ids_to_delete = [int(x.strip()) for x in delete_ids_text.split(",") if x.strip()]
            except ValueError:
                st.error("Use numbers separated by commas only.")
                return

            valid_ids = [i for i in ids_to_delete if 0 <= i < len(records)]
            deleted, failures = 0, []
            for i in valid_ids:
                filters = _delete_filters(records[i])
                if not filters:
                    failures.append(f"row {i}: no identifying columns")
                    continue
                ok, del_err = sb_delete_matching(table, filters)
                if ok:
                    deleted += 1
                else:
                    failures.append(f"row {i}: {del_err}")

            if failures:
                st.error("Some rows were not deleted:\n" + "\n".join(failures))
            if deleted:
                st.session_state.just_saved_message = f"DELETED {deleted} ROW(S)"
                st.rerun()

    st.divider()
    confirm_text = f"DELETE {log_type.upper()}"
    confirm = st.text_input(f"Type {confirm_text} to clear all {log_type.lower()} data")
    if st.button(f"Clear All {log_type} Data"):
        if confirm != confirm_text:
            st.error(f"Confirmation did not match. Type: {confirm_text}")
        else:
            ok, del_err = sb_delete_all(table)
            if ok:
                st.session_state.just_saved_message = f"ALL {log_type.upper()} DATA CLEARED"
                st.rerun()
            else:
                st.error(f"Could not clear {table}: {del_err}")
