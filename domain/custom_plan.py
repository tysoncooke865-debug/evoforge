import json
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st

from config.constants import CUSTOM_PLAN_FILE, CUSTOM_PLAN_TABLE
from data.sb_ops import sb_select, sb_insert, sb_delete_all, store_supabase_result
from data.supabase_client import get_supabase_client
from data.csv_store import _cache_key_for_path, cached_read_csv_file


def infer_custom_plan_id(row_or_dict):
    try:
        r = row_or_dict
        for key in ["plan_id", "plan_name", "created_at", "timestamp", "date", "goal"]:
            val = r.get(key) if hasattr(r, "get") else None
            if val is not None and str(val).strip() and str(val).lower() != "nan":
                return str(val).strip()
    except Exception:
        pass
    return "default_plan"


def custom_plan_display_name(df, plan_id):
    try:
        part = df[df["plan_id"].astype(str) == str(plan_id)].copy()
        if part.empty:
            return str(plan_id)
        if "plan_name" in part.columns:
            names = part["plan_name"].dropna().astype(str)
            names = names[names.str.strip() != ""]
            if not names.empty:
                return names.iloc[-1]
        if "goal" in part.columns:
            goals = part["goal"].dropna().astype(str)
            goals = goals[goals.str.strip() != ""]
            if not goals.empty:
                return f"{goals.iloc[-1]} · {str(plan_id)[-10:]}"
        return str(plan_id)
    except Exception:
        return str(plan_id)


def filter_out_test_custom_plans(df):
    try:
        if df is None or df.empty:
            return df
        df = df.copy()
        text_cols = [c for c in ["plan_id", "plan_name", "goal", "source", "notes", "workout", "exercise"] if c in df.columns]
        if not text_cols:
            return df
        joined = df[text_cols].fillna("").astype(str).agg(" ".join, axis=1).str.lower()
        test_mask = joined.str.contains(r"\btest\b|dummy|sample|debug", regex=True, na=False)
        # Only remove test rows if doing so doesn't wipe every available plan.
        if test_mask.any() and (~test_mask).any():
            return df[~test_mask].reset_index(drop=True)
        return df
    except Exception:
        return df


def normalise_custom_plan_df(df):
    """
    Make custom training plan rows usable no matter whether they came from:
    - local custom_workout_plan.csv
    - Supabase row-per-exercise schema
    - Supabase JSON plan_data schema
    Keeps plan_id/plan_name so the user can choose between multiple plans.
    """
    try:
        if df is None:
            return pd.DataFrame()

        # sb_select can return (data, err). Accept it defensively.
        if isinstance(df, tuple) and len(df) >= 1:
            df = df[0]

        if isinstance(df, list):
            df = pd.DataFrame(df)

        if df.empty:
            return pd.DataFrame()

        df = df.copy()

        json_cols = [c for c in ["plan_data", "plan_json", "exercises", "data"] if c in df.columns]
        expanded = []
        for col in json_cols:
            for _, row in df.iterrows():
                payload = row.get(col)
                if payload is None or (isinstance(payload, float) and pd.isna(payload)):
                    continue
                try:
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    if isinstance(payload, dict):
                        if "plan" in payload:
                            payload = payload["plan"]
                        elif "days" in payload:
                            # AI format: {"days": [{"workout": "...", "exercises": [...]}]}
                            days = payload["days"]
                            payload = []
                            for day in days:
                                workout_name = day.get("workout") or day.get("day") or day.get("session") or "Custom"
                                for ex in day.get("exercises", []):
                                    if isinstance(ex, dict):
                                        item = dict(ex)
                                        item["workout"] = item.get("workout", workout_name)
                                        payload.append(item)
                        elif "exercises" in payload:
                            payload = payload["exercises"]
                        else:
                            payload = [payload]

                    if isinstance(payload, list):
                        parent_plan_id = row.get("plan_id") if "plan_id" in df.columns else None
                        if parent_plan_id is None or str(parent_plan_id).lower() == "nan":
                            parent_plan_id = infer_custom_plan_id(row)
                        for item in payload:
                            if isinstance(item, dict):
                                merged = dict(item)
                                for meta_col in ["plan_id", "plan_name", "date", "created_at", "timestamp", "goal", "source"]:
                                    if meta_col in df.columns and meta_col not in merged:
                                        merged[meta_col] = row.get(meta_col)
                                merged["plan_id"] = merged.get("plan_id") or parent_plan_id
                                expanded.append(merged)
                except Exception:
                    continue

        if expanded:
            df = pd.DataFrame(expanded)

        rename_map = {
            "day": "workout",
            "session": "workout",
            "workout_name": "workout",
            "movement": "exercise",
            "exercise_name": "exercise",
            "target_sets": "sets",
            "target_reps": "reps",
            "rep_range": "reps",
        }
        df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

        required_defaults = {
            "workout": "Custom",
            "exercise": "",
            "sets": 3,
            "reps": "8-12",
            "notes": "",
        }
        for col, default in required_defaults.items():
            if col not in df.columns:
                df[col] = default

        if "plan_id" not in df.columns:
            df["plan_id"] = ""
        if "plan_name" not in df.columns:
            df["plan_name"] = ""

        # Create plan_id for rows that don't have one.
        for i, row in df.iterrows():
            if not str(df.at[i, "plan_id"]).strip() or str(df.at[i, "plan_id"]).lower() == "nan":
                df.at[i, "plan_id"] = infer_custom_plan_id(row)
            if not str(df.at[i, "plan_name"]).strip() or str(df.at[i, "plan_name"]).lower() == "nan":
                # Keep display name clean.
                if "goal" in df.columns and str(row.get("goal", "")).strip() and str(row.get("goal", "")).lower() != "nan":
                    df.at[i, "plan_name"] = str(row.get("goal"))
                else:
                    df.at[i, "plan_name"] = f"Custom Plan {str(df.at[i, 'plan_id'])[-10:]}"

        df["workout"] = df["workout"].fillna("Custom").astype(str)
        df["exercise"] = df["exercise"].fillna("").astype(str)
        df["sets"] = pd.to_numeric(df["sets"], errors="coerce").fillna(3).astype(int)
        df["reps"] = df["reps"].fillna("8-12").astype(str)
        df["notes"] = df["notes"].fillna("").astype(str)
        df["plan_id"] = df["plan_id"].fillna("default_plan").astype(str)
        df["plan_name"] = df["plan_name"].fillna("AI Custom Plan").astype(str)

        df = df[df["exercise"].str.strip() != ""].copy()

        for ts_col in ["created_at", "timestamp", "date"]:
            if ts_col in df.columns:
                try:
                    df["_sort_ts"] = pd.to_datetime(df[ts_col], errors="coerce")
                    df = df.sort_values("_sort_ts", ascending=True).drop(columns=["_sort_ts"])
                    break
                except Exception:
                    pass

        return df.reset_index(drop=True)
    except Exception:
        return pd.DataFrame()


def load_custom_plan():
    """
    Supabase-first loader for the AI custom training plan.

    Fixes:
    - sb_select(table_name) returns (data, err)
    - sb_select does not accept limit=
    - this app saves AI plans to custom_workout_plan, not custom_plan
    """
    try:
        old_err = str(st.session_state.get("last_supabase_error", ""))
        if "sb_select() got an unexpected keyword argument 'limit'" in old_err:
            st.session_state["last_supabase_error"] = ""
    except Exception:
        pass

    table_candidates = []
    for t in [CUSTOM_PLAN_TABLE, "custom_workout_plan", "custom_plan"]:
        if t not in table_candidates:
            table_candidates.append(t)

    # 1. Supabase helper first. This app's sb_select only accepts table_name.
    for table_name in table_candidates:
        try:
            data, err = sb_select(table_name)

            if err:
                st.session_state["last_custom_plan_source"] = f"{table_name} helper error: {err}"
            elif data is not None:
                sb_df = normalise_custom_plan_df(pd.DataFrame(data))
                if not sb_df.empty:
                    st.session_state["last_custom_plan_source"] = f"Supabase: {table_name}"
                    st.session_state["last_supabase_error"] = ""
                    return sb_df
        except Exception as e:
            st.session_state["last_custom_plan_source"] = f"{table_name} helper exception: {e}"

    # 2. Direct Supabase client fallback.
    for table_name in table_candidates:
        try:
            sb = get_supabase_client()
            if sb is not None:
                res = sb.table(table_name).select("*").limit(1000).execute()
                data = getattr(res, "data", None) or []
                sb_df = normalise_custom_plan_df(pd.DataFrame(data))
                if not sb_df.empty:
                    st.session_state["last_custom_plan_source"] = f"Supabase direct: {table_name}"
                    st.session_state["last_supabase_error"] = ""
                    return sb_df
        except Exception as e:
            st.session_state["last_custom_plan_source"] = f"{table_name} direct error: {e}"

    # 3. Local CSV backup last.
    try:
        path = Path(CUSTOM_PLAN_FILE)
        key = _cache_key_for_path(path)
        local_df = cached_read_csv_file(str(path), key)
        local_df = normalise_custom_plan_df(local_df)
        if not local_df.empty:
            st.session_state["last_custom_plan_source"] = "CSV backup"
            return local_df
    except Exception:
        pass

    st.session_state["last_custom_plan_source"] = "No custom plan found"
    return pd.DataFrame()


def save_custom_plan(df):
    """
    Save custom plan to CSV backup and Supabase.
    Replaces old plan so reloads pull the latest complete plan.
    """
    try:
        df = normalise_custom_plan_df(df)
        if df.empty:
            return False

        # CSV backup
        try:
            df.to_csv(CUSTOM_PLAN_FILE, index=False)
        except Exception:
            pass

        # Supabase write: clear previous rows then insert current full plan.
        try:
            sb_delete_all(CUSTOM_PLAN_TABLE)
            now = datetime.now().isoformat(timespec="seconds")
            plan_id = f"ai_plan_{now}"
            all_ok = True
            last_err = None
            for _, r in df.iterrows():
                row = {}
                for col in df.columns:
                    val = r.get(col)
                    if pd.isna(val):
                        val = None
                    row[col] = val
                row["timestamp"] = row.get("timestamp") or now
                row["plan_id"] = row.get("plan_id") or plan_id
                row["plan_name"] = row.get("plan_name") or f"AI Custom Plan {now}"
                ok, err = sb_insert(CUSTOM_PLAN_TABLE, row)
                all_ok = all_ok and ok
                last_err = last_err or err
            store_supabase_result(CUSTOM_PLAN_TABLE, all_ok, last_err)
        except Exception as e:
            st.session_state["last_supabase_error"] = f"Could not save custom plan to Supabase: {e}"

        return True
    except Exception as e:
        st.session_state["last_supabase_error"] = f"Could not save custom plan: {e}"
        return False


def generate_custom_plan_from_data(weak_points=None, priorities=None, goal="Aesthetic / lean bulk"):
    weak_points = weak_points or []
    priorities = priorities or []

    priority_text = " ".join([str(x).lower() for x in weak_points + priorities])

    extra_side_delts = "delt" in priority_text or "shoulder" in priority_text or "width" in priority_text
    extra_chest = "chest" in priority_text or "pec" in priority_text
    extra_back = "back" in priority_text or "lat" in priority_text or "v-taper" in priority_text
    extra_arms = "arm" in priority_text or "bicep" in priority_text or "tricep" in priority_text
    extra_legs = "leg" in priority_text or "quad" in priority_text or "hamstring" in priority_text

    plan = {
        "Push 1 - Strength": [
            ("Barbell Bench Press (Strength)", 4, "Top set 3-5 + 3 back-off sets 5-8"),
            ("Dumbbell Flat Bench Press", 3 + int(extra_chest), "8-12"),
            ("Pec Deck Machine Fly", 3 + int(extra_chest), "10-15"),
            ("Cable Lateral Raise", 4 + int(extra_side_delts), "12-20"),
            ("Cable Triceps Pushdown", 4, "10-15"),
            ("Decline Push-Up", 2, "AMRAP"),
        ],
        "Pull 1 - Back Thickness": [
            ("Chest-Supported Machine Row", 4, "6-10"),
            ("Lat Pulldown", 4 + int(extra_back), "8-12"),
            ("Chest-Supported Dumbbell Row", 3, "8-12"),
            ("Reverse Pec Deck (Rear Delt Fly)", 4 + int(extra_side_delts), "15-25"),
            ("EZ-Bar Curl", 4 + int(extra_arms), "8-12"),
            ("Dumbbell Biceps Curl", 3, "10-15"),
        ],
        "Push 2 - Hypertrophy": [
            ("Paused Barbell Bench Press", 3, "5-8"),
            ("Dumbbell Flat Bench Press", 3 + int(extra_chest), "8-12"),
            ("Pec Deck Machine Fly", 4, "12-20"),
            ("Dumbbell Lateral Raise", 5 + int(extra_side_delts), "15-25"),
            ("Cable Lateral Raise", 3, "15-25"),
            ("Cable Triceps Pushdown", 4 + int(extra_arms), "12-20"),
        ],
        "Pull 2 - Width / V-Taper": [
            ("Lat Pulldown", 4 + int(extra_back), "10-15"),
            ("Cable Lat Pullover (Straight-Arm Pulldown)", 4 + int(extra_back), "12-20"),
            ("Chest-Supported Machine Row", 3, "8-12"),
            ("Face Pull", 3, "15-25"),
            ("Reverse Pec Deck (Rear Delt Fly)", 3, "15-25"),
            ("EZ-Bar Curl", 3 + int(extra_arms), "10-15"),
        ],
        "Legs": [
            ("Barbell Back Squat", 3, "5-8"),
            ("Hack Squat Machine", 4 + int(extra_legs), "8-12"),
            ("Seated/Lying Leg Curl", 4, "10-15"),
            ("Leg Extension", 4 + int(extra_legs), "12-20"),
            ("Seated Calf Raise", 5, "10-20"),
            ("Hip Adduction Machine", 3, "12-20"),
        ],
        "Aesthetics": [
            ("Cable Lateral Raise", 5 + int(extra_side_delts), "15-25"),
            ("Cable Lat Pullover (Straight-Arm Pulldown)", 3 + int(extra_back), "12-20"),
            ("Pec Deck Machine Fly", 4 + int(extra_chest), "12-20"),
            ("Reverse Pec Deck (Rear Delt Fly)", 4, "15-25"),
            ("Dumbbell Biceps Curl", 3 + int(extra_arms), "10-15"),
            ("Cable Triceps Pushdown", 3 + int(extra_arms), "10-15"),
            ("Machine Ab Crunch", 3, "10-20"),
            ("Lying Leg Raise", 3, "12-20"),
            ("Weighted Sit-Up", 2, "10-15"),
        ],
    }

    return plan


def save_ai_custom_plan(ai_plan):
    rows = []
    for day in ai_plan.get("days", []):
        for ex in day.get("exercises", []):
            rows.append({
                "workout": day.get("day", ""),
                "exercise": ex.get("exercise", ""),
                "sets": ex.get("sets", ""),
                "reps": ex.get("reps", ""),
                "reason": ex.get("reason", ""),
                "day_goal": day.get("goal", ""),
                "plan_name": ai_plan.get("plan_name", "AI Custom Plan"),
                "timestamp": datetime.now().isoformat(timespec="seconds"),
            })
    if not rows:
        return False
    pd.DataFrame(rows).to_csv(CUSTOM_PLAN_FILE, index=False)
    for row in rows:
        ok, err = sb_insert(CUSTOM_PLAN_TABLE, row)
        store_supabase_result(CUSTOM_PLAN_TABLE, ok, err)
    return True


def save_fallback_custom_plan(plan):
    rows = []
    for workout, exercises in plan.items():
        for exercise, sets, reps in exercises:
            rows.append({
                "workout": workout,
                "exercise": exercise,
                "sets": sets,
                "reps": reps,
                "reason": "Fallback weak-point aesthetic plan",
                "day_goal": "Aesthetic development",
                "plan_name": "Fallback Aesthetic Weakpoint Plan",
                "timestamp": datetime.now().isoformat(timespec="seconds"),
            })
    pd.DataFrame(rows).to_csv(CUSTOM_PLAN_FILE, index=False)
    for row in rows:
        ok, err = sb_insert(CUSTOM_PLAN_TABLE, row)
        store_supabase_result(CUSTOM_PLAN_TABLE, ok, err)
