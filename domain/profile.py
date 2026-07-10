from datetime import datetime

from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result


def load_profile():
    columns = ["height_cm", "bodyweight_kg", "bench_e1rm", "squat_e1rm", "training_years", "physique_score", "leanness_score", "base_level", "created_at"]
    return df_from_supabase("profile", columns)


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


# The rank ladder, highest first. ONE source of truth: `rank_name()` reads it and
# `rank_ladder()` derives the bands from it. `views/profile.py` used to restate the
# whole thing as eight `st.write` lines, free to drift from the function that
# actually decides what an athlete is called.
RANK_TIERS = [
    (100, "☀️ True Adam"),
    (90, "👑 Chad"),
    (75, "🗿 Chad-Lite"),
    (60, "⚡ Elite Physique"),
    (40, "💎 Aesthetic Tier"),
    (25, "🦾 Athlete"),
    (10, "⚔️ Trainee"),
    (1, "🌱 Rookie"),
]

MAX_RANK_LEVEL = 100


def rank_name(level):
    level = int(level)
    for threshold, name in RANK_TIERS:
        if level >= threshold:
            return name
    return RANK_TIERS[-1][1]


def rank_ladder():
    """`(low, high, name)` for every rank, ascending. Derived, never restated.

    The top tier is a single level, so its band is `(100, 100)`.
    """
    ascending = sorted(RANK_TIERS)
    bands = []
    for index, (low, name) in enumerate(ascending):
        high = ascending[index + 1][0] - 1 if index + 1 < len(ascending) else MAX_RANK_LEVEL
        bands.append((low, high, name))
    return bands
