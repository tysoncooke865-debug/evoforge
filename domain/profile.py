from datetime import datetime

import pandas as pd

from config.constants import PROFILE_FILE
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result


def load_profile():
    columns = ["height_cm", "bodyweight_kg", "bench_e1rm", "squat_e1rm", "training_years", "physique_score", "leanness_score", "base_level", "created_at"]
    return df_from_supabase("profile", PROFILE_FILE, columns)


def save_profile(height_cm, bodyweight_kg, bench_e1rm, squat_e1rm, training_years, physique_score, leanness_score):
    base_level = calculate_starting_level(bench_e1rm, squat_e1rm, training_years, physique_score, leanness_score)
    row = {
        "height_cm": height_cm,
        "bodyweight_kg": bodyweight_kg,
        "bench_e1rm": bench_e1rm,
        "squat_e1rm": squat_e1rm,
        "training_years": training_years,
        "physique_score": physique_score,
        "leanness_score": leanness_score,
        "base_level": base_level,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    ok, err = sb_insert("profile", row)
    store_supabase_result("profile", ok, err)
    pd.DataFrame([row]).to_csv(PROFILE_FILE, index=False)
    return base_level


def get_base_level():
    profile = load_profile()
    if profile.empty:
        return 1
    try:
        return int(float(profile.iloc[-1]["base_level"]))
    except Exception:
        return 1


def calculate_starting_level(bench_e1rm, squat_e1rm, training_years, physique_score, leanness_score):
    level = 1

    # Bench strength points
    if bench_e1rm >= 120:
        level += 28
    elif bench_e1rm >= 100:
        level += 22
    elif bench_e1rm >= 90:
        level += 18
    elif bench_e1rm >= 80:
        level += 14
    elif bench_e1rm >= 60:
        level += 8

    # Squat strength points
    if squat_e1rm >= 180:
        level += 18
    elif squat_e1rm >= 140:
        level += 14
    elif squat_e1rm >= 100:
        level += 9

    # Training age
    if training_years >= 5:
        level += 16
    elif training_years >= 3:
        level += 12
    elif training_years >= 1:
        level += 7

    # Physique/leanness self-ratings
    level += int(physique_score)
    level += int(leanness_score)

    return max(1, min(int(level), 100))


def rank_name(level):
    level = int(level)
    if level >= 100:
        return "☀️ True Adam"
    if level >= 90:
        return "👑 Chad"
    if level >= 75:
        return "🗿 Chad-Lite"
    if level >= 60:
        return "⚡ Elite Physique"
    if level >= 40:
        return "💎 Aesthetic Tier"
    if level >= 25:
        return "🦾 Athlete"
    if level >= 10:
        return "⚔️ Trainee"
    return "🌱 Rookie"
