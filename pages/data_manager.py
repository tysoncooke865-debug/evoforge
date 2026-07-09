import zipfile
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st

from config.constants import (
    LOG_FILE, BODYWEIGHT_FILE, CARDIO_FILE, BODYFAT_FILE, MEASUREMENTS_FILE,
    PHYSIQUE_RATING_FILE, CUSTOM_PLAN_FILE, TARGETS_FILE, PROFILE_FILE,
    ACHIEVEMENT_FILE, AVATAR_FILE, ACHIEVEMENTS,
)
from data.supabase_client import supabase_enabled, get_supabase_client
from data.sb_ops import clear_data_cache, sb_insert, sb_select, json_safe_records
from domain.achievements import load_achievements, achievement_count
from domain.cardio import save_cardio_row
from ui.components import page_hero

CSV_PATHS = {
    "workout_log.csv": LOG_FILE,
    "bodyweight_log.csv": BODYWEIGHT_FILE,
    "bodyfat_log.csv": BODYFAT_FILE,
    "measurements.csv": MEASUREMENTS_FILE,
    "physique_ratings.csv": PHYSIQUE_RATING_FILE,
    "custom_workout_plan.csv": CUSTOM_PLAN_FILE,
    "targets.csv": TARGETS_FILE,
    "achievements.csv": ACHIEVEMENT_FILE,
    "cardio_log.csv": CARDIO_FILE,
    "profile.csv": PROFILE_FILE,
}

MIGRATION_PATHS = {
    **CSV_PATHS,
    "avatar_progression.csv": AVATAR_FILE,
}


def render():
    page_hero("Data Manager", "Backups, Supabase diagnostics, CSV restore and migration.", "System")
    st.info("Download backups of your workout data. Supabase is used first when connected, with CSV as backup.")

    st.subheader("Supabase Status")
    if supabase_enabled():
        st.success("Supabase connected — data loads/saves to cloud database first.")
    else:
        st.warning("Supabase not connected — using CSV files only.")

    csv_files = list(CSV_PATHS.keys())

    st.subheader("Achievement Counter Fix")
    st.caption("If the achievement counter looks wrong after CSV/Supabase migration, this removes duplicate achievement IDs from the local CSV view. Supabase reads will also be de-duplicated automatically.")

    if st.button("Rebuild Achievement Counter", type="secondary"):
        ach_fix = load_achievements()
        ach_fix.to_csv(ACHIEVEMENT_FILE, index=False)
        st.success(f"Achievement counter rebuilt: {achievement_count()}/{len(ACHIEVEMENTS)} unlocked.")
        st.rerun()

    st.subheader("Performance")
    if st.button("Clear App Cache / Refresh Data", type="secondary"):
        clear_data_cache()
        st.session_state.pop("achievements_checked_this_session", None)
        st.success("Cache cleared. Fresh data will load now.")
        st.rerun()

    st.subheader("Supabase Diagnostics")
    if supabase_enabled():
        st.success("Supabase client configured.")
    else:
        st.error("Supabase client not configured. Check Streamlit Secrets.")

    if st.session_state.get("last_supabase_write"):
        st.success(st.session_state.get("last_supabase_write"))
    if st.session_state.get("last_supabase_error"):
        st.error(st.session_state.get("last_supabase_error"))

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
        if st.button("Test Selected Table Insert", type="primary"):
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

    if st.button("Test Cardio Insert With type/cardio_type Fallback"):
        test_cardio = {
            "date": str(date.today()),
            "type": "Test",
            "minutes": 1.0,
            "distance_km": 0.1,
            "incline": 0.0,
            "speed": 1.0,
            "calories": 1.0,
            "notes": "cardio fallback test",
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }
        save_cardio_row(test_cardio)
        if st.session_state.get("last_supabase_error"):
            st.error(st.session_state.get("last_supabase_error"))
        else:
            st.success("Cardio insert worked.")

    if st.button("Run All Supabase Insert Tests"):
        results = []
        for table, row in sample_rows.items():
            ok, err = sb_insert(table, row)
            results.append({"table": table, "ok": ok, "error": err or ""})
        st.dataframe(pd.DataFrame(results), width="stretch")

    st.subheader("Detected Data Files")

    file_rows = []
    for file in csv_files:
        path = CSV_PATHS[file]
        if path.exists():
            try:
                size_kb = path.stat().st_size / 1024
                modified = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                file_rows.append({
                    "file": file,
                    "exists": "Yes",
                    "size_kb": round(size_kb, 2),
                    "last_modified": modified,
                })
            except Exception:
                file_rows.append({
                    "file": file,
                    "exists": "Yes",
                    "size_kb": "",
                    "last_modified": "",
                })
        else:
            file_rows.append({
                "file": file,
                "exists": "No",
                "size_kb": "",
                "last_modified": "",
            })

    st.dataframe(pd.DataFrame(file_rows), width="stretch")

    st.subheader("Download Individual CSV Files")

    any_file = False
    for file in csv_files:
        path = CSV_PATHS[file]
        if path.exists():
            any_file = True
            with open(path, "rb") as f:
                st.download_button(
                    label=f"⬇️ Download {file}",
                    data=f,
                    file_name=file,
                    mime="text/csv",
                    key=f"download_{file}",
                )

    if not any_file:
        st.warning("No CSV data files exist yet. Log a workout/cardio/bodyweight entry first, then come back here.")

    st.subheader("Full Backup ZIP")

    zip_buffer = BytesIO()
    files_added = 0

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file in csv_files:
            path = CSV_PATHS[file]
            if path.exists():
                zip_file.write(path, arcname=file)
                files_added += 1

        # include a small backup manifest
        manifest = pd.DataFrame(file_rows).to_csv(index=False)
        zip_file.writestr("backup_manifest.csv", manifest)
        files_added += 1

    zip_buffer.seek(0)

    st.download_button(
        label="🔥 Download Full Training Backup ZIP",
        data=zip_buffer,
        file_name=f"tyson_training_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
        mime="application/zip",
        disabled=(files_added <= 1),
        key="download_full_backup_zip",
    )

    st.divider()

    st.subheader("Restore / Import CSV Files")
    st.warning("Importing a CSV with the same name will replace the existing server file. Download a backup first.")

    uploaded_files = st.file_uploader(
        "Upload CSV files to restore",
        type=["csv"],
        accept_multiple_files=True,
        help="Upload files like workout_log.csv, bodyfat_log.csv, achievements.csv, etc.",
    )

    allowed_files = set(csv_files)

    if uploaded_files:
        st.write("Files ready to import:")
        for uploaded in uploaded_files:
            if uploaded.name in allowed_files:
                st.write(f"✅ {uploaded.name}")
            else:
                st.write(f"⚠️ {uploaded.name} — ignored because it is not a recognised app data file.")

        confirm_restore = st.checkbox("I understand this will replace matching CSV files on the app server.")

        if st.button("Restore Uploaded CSV Files", type="primary"):
            if not confirm_restore:
                st.error("Tick the confirmation box first.")
            else:
                restored = []
                ignored = []
                for uploaded in uploaded_files:
                    if uploaded.name not in allowed_files:
                        ignored.append(uploaded.name)
                        continue
                    data = uploaded.getvalue()
                    CSV_PATHS[uploaded.name].write_bytes(data)
                    restored.append(uploaded.name)

                if restored:
                    st.success("Restored: " + ", ".join(restored))
                if ignored:
                    st.warning("Ignored: " + ", ".join(ignored))
                st.session_state.just_saved_message = "DATA RESTORE COMPLETE"
                st.rerun()

    st.divider()
    st.subheader("CSV → Supabase Migration")
    st.caption("Use this once if you already have CSV data and want to push it into Supabase.")
    if st.button("Upload Existing CSV Backups to Supabase", type="secondary"):
        if not supabase_enabled():
            st.error("Supabase is not connected.")
        else:
            migration_map = {
                "workout_log.csv": "workout_log",
                "bodyweight_log.csv": "bodyweight_log",
                "bodyfat_log.csv": "bodyfat_log",
                "measurements.csv": "measurements",
                "physique_ratings.csv": "physique_ratings",
                "custom_workout_plan.csv": "custom_workout_plan",
                "targets.csv": "targets",
                "achievements.csv": "achievements",
                "cardio_log.csv": "cardio_log",
                "profile.csv": "profile",
                "avatar_progression.csv": "avatar_progression",
            }
            migrated = []
            for file, table in migration_map.items():
                path = MIGRATION_PATHS[file]
                if not path.exists():
                    continue
                try:
                    df_mig = pd.read_csv(path)
                    if df_mig.empty:
                        continue
                    df_mig = df_mig.replace([float("inf"), float("-inf")], None)
                    df_mig = df_mig.where(pd.notnull(df_mig), None)
                    records = json_safe_records(df_mig.to_dict(orient="records"))
                    get_supabase_client().table(table).insert(records).execute()
                    migrated.append(f"{file} → {table} ({len(records)} rows)")
                except Exception as e:
                    st.warning(f"Could not migrate {file}: {e}")
            if migrated:
                st.success("Migrated: " + " | ".join(migrated))
            else:
                st.info("No CSV rows found to migrate.")

    st.subheader("Quick Preview")
    preview_file = st.selectbox("Preview CSV", csv_files)
    preview_path = CSV_PATHS[preview_file]

    if preview_path.exists():
        try:
            preview_df = pd.read_csv(preview_path)
            st.caption(f"Showing last 50 rows from {preview_file}")
            st.dataframe(preview_df.tail(50), width="stretch")
        except Exception as e:
            st.error(f"Could not preview {preview_file}: {e}")
    else:
        st.info(f"{preview_file} does not exist yet.")
