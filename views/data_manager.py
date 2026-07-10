import zipfile
from datetime import date, datetime
from io import BytesIO

import pandas as pd
import streamlit as st

from config.constants import SUPABASE_TABLE_SCHEMAS
from data.supabase_client import supabase_enabled
from data.sb_ops import clear_data_cache, sb_insert, sb_select
from ui.components import page_hero

EXPORT_TABLES = list(SUPABASE_TABLE_SCHEMAS.keys())


def _export_table(table):
    """Return (DataFrame, error). Supabase is the only source of truth."""
    data, err = sb_select(table)
    if err:
        return pd.DataFrame(), err
    return pd.DataFrame(data or []), None


def render():
    page_hero("Data Manager", "Backups and Supabase diagnostics.", "System")

    st.subheader("Supabase Status")
    if supabase_enabled():
        st.success("Supabase connected — it is the only store. Nothing is written to local disk.")
    else:
        st.error("Supabase not connected. Check SUPABASE_URL and SUPABASE_KEY in Streamlit Secrets.")
        return

    if st.session_state.get("last_supabase_write"):
        st.success(st.session_state.get("last_supabase_write"))
    if st.session_state.get("last_supabase_error"):
        st.error(st.session_state.get("last_supabase_error"))

    st.subheader("Performance")
    if st.button("Clear App Cache / Refresh Data", type="secondary"):
        clear_data_cache()
        st.session_state.pop("achievements_checked_this_session", None)
        st.session_state.pop("_fast_snapshot", None)
        st.success("Cache cleared. Fresh data will load now.")
        st.rerun()

    st.divider()
    st.subheader("Export Backup")
    st.caption("Every table is read from Supabase and packaged as CSV in memory. No file is written to the server.")

    if st.button("Build Backup ZIP", type="primary"):
        zip_buffer = BytesIO()
        manifest = []
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for table in EXPORT_TABLES:
                df, err = _export_table(table)
                manifest.append({"table": table, "rows": len(df), "error": err or ""})
                if err:
                    continue
                zip_file.writestr(f"{table}.csv", df.to_csv(index=False))
            zip_file.writestr("backup_manifest.csv", pd.DataFrame(manifest).to_csv(index=False))

        zip_buffer.seek(0)
        st.session_state["_backup_zip"] = zip_buffer.getvalue()
        st.session_state["_backup_manifest"] = manifest

    if st.session_state.get("_backup_zip"):
        st.dataframe(pd.DataFrame(st.session_state["_backup_manifest"]), width="stretch")
        st.download_button(
            label="Download Training Backup ZIP",
            data=st.session_state["_backup_zip"],
            file_name=f"evoforge_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
            mime="application/zip",
            key="download_full_backup_zip",
        )

    st.divider()
    st.subheader("Export a Single Table")
    export_table = st.selectbox("Table", EXPORT_TABLES, key="export_table_select")
    export_df, export_err = _export_table(export_table)
    if export_err:
        st.error(f"Could not read {export_table}: {export_err}")
    elif export_df.empty:
        st.info(f"{export_table} has no rows yet.")
    else:
        st.caption(f"Showing the last 50 of {len(export_df)} rows.")
        st.dataframe(export_df.tail(50), width="stretch")
        st.download_button(
            label=f"Download {export_table}.csv",
            data=export_df.to_csv(index=False),
            file_name=f"{export_table}.csv",
            mime="text/csv",
            key=f"download_{export_table}",
        )

    st.divider()
    st.subheader("Supabase Diagnostics")
    st.caption("Writes a throwaway row to check the table schema matches what the app sends.")

    sample_rows = {
        "workout_log": {"date": str(date.today()), "workout": "Supabase Test", "exercise": "Connection Test", "muscle": "Test", "set": 1, "weight": 1, "reps": 1, "estimated_1rm": 1, "volume": 1, "notes": "test insert", "timestamp": datetime.now().isoformat(timespec="seconds")},
        "bodyweight_log": {"date": str(date.today()), "bodyweight": 77.0, "timestamp": datetime.now().isoformat(timespec="seconds")},
        "cardio_log": {"date": str(date.today()), "type": "Test", "minutes": 1, "distance_km": 0.1, "incline": 0, "speed": 1, "calories": 1, "notes": "test insert", "timestamp": datetime.now().isoformat(timespec="seconds")},
        "bodyfat_log": {"date": str(date.today()), "method": "Test", "bodyweight": 77.0, "height_cm": 183.5, "waist_cm": 0, "neck_cm": 0, "bf_low": 12, "bf_high": 14, "bf_mid": 13, "confidence": "test", "notes": "test insert", "timestamp": datetime.now().isoformat(timespec="seconds")},
        "measurements": {"date": str(date.today()), "bodyweight": 77.0, "wrist_cm": 0, "forearm_cm": 0, "bicep_cm": 0, "chest_cm": 0, "waist_cm": 0, "hips_cm": 0, "thigh_cm": 0, "calf_cm": 0, "shoulders_cm": 0, "neck_cm": 0, "notes": "test insert", "timestamp": datetime.now().isoformat(timespec="seconds")},
        "physique_ratings": {"date": str(date.today()), "physique_score": 1, "leanness_score": 1, "symmetry_score": 1, "muscularity_score": 1, "confidence": "test", "weak_points": ["test"], "improvements": ["test"], "summary": "test insert", "timestamp": datetime.now().isoformat(timespec="seconds")},
        "custom_workout_plan": {"plan_name": "Test Plan", "workout": "Test Day", "exercise": "Test Exercise", "sets": 1, "reps": "1", "muscle": "Test", "reason": "test insert", "day_goal": "test", "timestamp": datetime.now().isoformat(timespec="seconds")},
        "achievements": {"achievement_id": "test_" + datetime.now().strftime("%H%M%S"), "name": "Test Achievement", "description": "test insert", "date_unlocked": datetime.now().isoformat(timespec="seconds")},
        "targets": {"target_type": "Test", "name": "Test Target " + datetime.now().strftime("%H%M%S"), "target_value": 1, "unit": "test", "created_at": datetime.now().isoformat(timespec="seconds"), "notes": "test insert"},
        "profile": {"height_cm": 183.5, "bodyweight_kg": 77.0, "bench_e1rm": 100, "squat_e1rm": 140, "training_years": 3, "physique_score": 10, "leanness_score": 10, "base_level": 42, "created_at": datetime.now().isoformat(timespec="seconds")},
        "avatar_progression": {"date": str(date.today()), "level": 42, "rank": "Aesthetic Tier", "character_class": "Aesthetic Hybrid", "build_type": "Athletic Frame", "strength_score": 70, "size_score": 60, "leanness_score": 65, "conditioning_score": 40, "aesthetic_score": 68, "weak_point_focus": "Side delts", "ai_summary": "Test avatar row", "timestamp": datetime.now().isoformat(timespec="seconds")},
    }

    selected_test_table = st.selectbox("Supabase table to test", list(sample_rows.keys()))
    col_a, col_b = st.columns(2)
    with col_a:
        if st.button("Test Selected Table Insert"):
            sb_insert(selected_test_table, sample_rows[selected_test_table], show_error=True)
    with col_b:
        if st.button("Read Selected Table Rows"):
            data, err = sb_select(selected_test_table)
            if err:
                st.error(err)
            else:
                st.write(f"Rows found in Supabase {selected_test_table}: {len(data)}")
                if data:
                    st.dataframe(pd.DataFrame(data).tail(10), width="stretch")

    if st.button("Run All Supabase Insert Tests"):
        results = []
        for table, row in sample_rows.items():
            ok, err = sb_insert(table, row)
            results.append({"table": table, "ok": ok, "error": err or ""})
        st.dataframe(pd.DataFrame(results), width="stretch")
