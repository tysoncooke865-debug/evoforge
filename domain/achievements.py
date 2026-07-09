from datetime import datetime

import pandas as pd

from config.constants import ACHIEVEMENT_FILE, ACHIEVEMENTS
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result
from data.csv_store import save_csv_backup
from domain.workouts import (
    load_log, workout_summary, muscle_heat_map, unique_training_days,
    logged_all_ppppla_days, muscle_sets_count, estimated_1rm,
)
from domain.bodyweight import get_bodyweight_stats
from domain.bodyfat import get_bodyfat_stats
from domain.cardio import get_cardio_stats
from domain.targets import get_target


def load_achievements():
    df = df_from_supabase("achievements", ACHIEVEMENT_FILE, ["achievement_id", "name", "description", "date_unlocked"])

    if df.empty:
        return df

    for col in ["achievement_id", "name", "description", "date_unlocked"]:
        if col not in df.columns:
            df[col] = ""

    df["achievement_id"] = df["achievement_id"].astype(str)

    # Migration/testing can create duplicate achievement rows.
    # Keep only one row per achievement_id so Forge Core counter is correct.
    if "date_unlocked" in df.columns:
        df = df.sort_values("date_unlocked", ascending=True)

    df = df.drop_duplicates(subset=["achievement_id"], keep="last").reset_index(drop=True)

    return df[["achievement_id", "name", "description", "date_unlocked"]]


def save_achievement(achievement_id):
    ach = load_achievements()
    if achievement_id in ach["achievement_id"].astype(str).tolist():
        return False
    name, desc = ACHIEVEMENTS[achievement_id]
    row = {
        "achievement_id": achievement_id,
        "name": name,
        "description": desc,
        "date_unlocked": datetime.now().isoformat(timespec="seconds"),
    }
    ok, err = sb_insert("achievements", row)
    store_supabase_result("achievements", ok, err)
    save_csv_backup(ACHIEVEMENT_FILE, ["achievement_id", "name", "description", "date_unlocked"], row=row)
    return True


def achievement_count():
    ach = load_achievements()
    if ach.empty or "achievement_id" not in ach.columns:
        return 0
    return ach["achievement_id"].astype(str).nunique()


def check_achievements():
    df = load_log()
    summary = workout_summary(df)
    heat = muscle_heat_map(df)
    bw = get_bodyweight_stats()
    bf = get_bodyfat_stats()
    cardio = get_cardio_stats()

    unlocked = []

    def unlock(key):
        if key in ACHIEVEMENTS and save_achievement(key):
            unlocked.append(ACHIEVEMENTS[key][0])

    # Basic logging
    if summary["total_sets"] >= 1: unlock("first_set")
    if summary["total_sets"] >= 10: unlock("first_workout")
    if summary["total_sets"] >= 100: unlock("hundred_sets")
    if summary["total_sets"] >= 500: unlock("five_hundred_sets")
    if summary["total_sets"] >= 1000: unlock("thousand_sets")

    # Consistency
    days = unique_training_days(df)
    if days >= 3: unlock("three_day_streak")
    if days >= 7: unlock("seven_day_streak")
    if days >= 14: unlock("fourteen_day_streak")
    if days >= 30: unlock("thirty_day_streak")
    if logged_all_ppppla_days(df): unlock("full_ppppla_week")

    # Strength - bench
    if summary["best_bench_1rm"] >= 100: unlock("bench_100_est")
    if summary["best_bench_1rm"] >= 120: unlock("bench_120_est")

    if bw["latest"]:
        if summary["best_bench_1rm"] >= bw["latest"]: unlock("bench_bw")
        if summary["best_bench_1rm"] >= bw["latest"] * 1.25: unlock("bench_1_25_bw")
        if summary["best_bench_1rm"] >= bw["latest"] * 1.5: unlock("bench_1_5_bw")

    bench = df[df["exercise"] == "Barbell Bench Press (Strength)"].copy() if not df.empty else pd.DataFrame()
    if not bench.empty:
        bench["weight"] = pd.to_numeric(bench["weight"], errors="coerce").fillna(0)
        max_bench = bench["weight"].max()
        if max_bench >= 60: unlock("bench_60")
        if max_bench >= 80: unlock("bench_80")
        if max_bench >= 90: unlock("bench_90")
        if max_bench >= 100: unlock("bench_100")
        if max_bench >= 110: unlock("bench_110")
        if max_bench >= 120: unlock("bench_120")

    # Strength - squat
    squat = df[df["exercise"] == "Barbell Back Squat"].copy() if not df.empty else pd.DataFrame()
    squat_e1rm = 0
    if not squat.empty:
        squat["weight"] = pd.to_numeric(squat["weight"], errors="coerce").fillna(0)
        squat["reps"] = pd.to_numeric(squat["reps"], errors="coerce").fillna(0)
        squat["estimated_1rm"] = squat.apply(lambda x: estimated_1rm(float(x["weight"]), int(x["reps"])), axis=1)
        squat_e1rm = float(squat["estimated_1rm"].max())
        max_squat = squat["weight"].max()
        if max_squat >= 100: unlock("squat_100")
        if max_squat >= 140: unlock("squat_140")
        if max_squat >= 160: unlock("squat_160")
        if max_squat >= 180: unlock("squat_180")
        if max_squat >= 200: unlock("squat_200")

    if bw["latest"] and squat_e1rm:
        if squat_e1rm >= bw["latest"] * 1.5: unlock("squat_1_5_bw")
        if squat_e1rm >= bw["latest"] * 2: unlock("squat_2_bw")

    # Bodyweight / cut / bulk
    if bw["count"] >= 1: unlock("first_bw_log")
    if bw["latest"] and bw["latest"] <= 75: unlock("bw_75")
    if bw["latest"] and bw["latest"] >= 80: unlock("bw_80")
    if bw["latest"] and bw["latest"] >= 85: unlock("bw_85")
    if bw["min"] is not None and bw["latest"] is not None:
        if bw["latest"] - bw["min"] >= 2: unlock("bulk_2kg")
        if bw["latest"] - bw["min"] >= 5: unlock("bulk_5kg")
    if bw["max"] is not None and bw["latest"] is not None:
        if bw["max"] - bw["latest"] >= 2: unlock("cut_2kg")
        if bw["max"] - bw["latest"] >= 5: unlock("cut_5kg")

    # Body fat
    if bf["count"] >= 1: unlock("first_bf_log")
    if bf["latest"] and bf["latest"] < 15: unlock("bf_under_15")
    if bf["latest"] and bf["latest"] < 13: unlock("bf_under_13")
    if bf["latest"] and bf["latest"] < 12: unlock("bf_under_12")
    if bf["latest"] and bf["latest"] <= 10: unlock("bf_under_10")
    bf_target = get_target("Body Fat", "Body Fat %")
    if bf["latest"] and bf_target and bf["latest"] <= bf_target:
        unlock("bf_target_hit")

    # Cardio
    if cardio["count"] >= 1: unlock("first_cardio")
    if cardio["minutes"] >= 100: unlock("cardio_100")
    if cardio["minutes"] >= 300: unlock("cardio_300")
    if cardio["minutes"] >= 1000: unlock("cardio_1000")
    if cardio["distance"] >= 5: unlock("cardio_5k_total")
    if cardio["distance"] >= 25: unlock("cardio_25k_total")
    if cardio["distance"] >= 100: unlock("cardio_100k_total")
    if "Boxing" in cardio["types"]: unlock("boxing_logged")

    # Muscle heat map / volume
    if muscle_sets_count(heat, ["Chest", "Upper Chest"]) >= 50: unlock("chest_50")
    if muscle_sets_count(heat, ["Chest", "Upper Chest"]) >= 150: unlock("chest_150")
    if muscle_sets_count(heat, ["Back", "Back Width", "Back Thickness"]) >= 50: unlock("back_50")
    if muscle_sets_count(heat, ["Back", "Back Width", "Back Thickness"]) >= 150: unlock("back_150")
    delt_sets = muscle_sets_count(heat, ["Delts", "Side Delts", "Rear Delts"])
    if delt_sets >= 50: unlock("delts_50")
    if delt_sets >= 150: unlock("delts_150")
    if muscle_sets_count(heat, ["Biceps", "Triceps"]) >= 100: unlock("arms_100")
    if muscle_sets_count(heat, ["Legs", "Quads", "Hamstrings", "Glutes", "Adductors", "Calves"]) >= 100: unlock("legs_100")
    if muscle_sets_count(heat, ["Abs"]) >= 50: unlock("abs_50")

    # Rank achievements
    if summary["level"] >= 40: unlock("aesthetic_tier")
    if summary["level"] >= 60: unlock("elite_physique")
    if summary["level"] >= 75: unlock("chad_lite")
    if summary["level"] >= 90: unlock("chad")
    if summary["level"] >= 100: unlock("true_adam")

    return unlocked
