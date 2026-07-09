from datetime import date, datetime
from pathlib import Path

import pandas as pd

from config.constants import AVATAR_FILE
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result
from data.csv_store import save_csv_backup
from domain.profile import rank_name
from domain.physique_ratings import safe_num, score_0_100, latest_physique_rating_values
from domain.workouts import (
    load_log, workout_summary, muscle_heat_map, current_exercise_best_1rm,
)
from domain.bodyweight import latest_bodyweight_value
from domain.bodyfat import latest_bodyfat_mid
from domain.cardio import get_cardio_stats
from ui.avatar_images import AVATAR_ASSETS


def get_avatar_stage(level):
    level = int(level)
    if level >= 75:
        return 4
    if level >= 50:
        return 3
    if level >= 25:
        return 2
    return 1


def get_branch_stage(branch, level):
    level = int(level)
    branch = str(branch).lower()
    if branch == "aesthetic":
        return get_avatar_stage(level)
    if level >= 75:
        return 3
    if level >= 50:
        return 2
    return 1


def determine_avatar_branch(stats):
    strength = safe_num(stats.get("strength_score"), 0)
    size = safe_num(stats.get("size_score"), 0)
    conditioning = safe_num(stats.get("conditioning_score"), 0)
    aesthetic = safe_num(stats.get("aesthetic_score"), 0)

    if size >= max(aesthetic, conditioning) and strength >= 55 and size >= 55:
        return "mass"
    if conditioning >= 55 and strength >= 45:
        return "hybrid"
    return "aesthetic"


def branch_display_name(branch):
    return {
        "aesthetic": "💎 Aesthetic",
        "mass": "🦍 Mass Monster",
        "hybrid": "⚡ Hybrid Athlete",
    }.get(str(branch).lower(), "💎 Aesthetic")


def avatar_rarity(level):
    level = int(level)
    if level >= 100:
        return "MYTHIC", "🌌", "#c084fc"
    if level >= 75:
        return "LEGENDARY", "👑", "#facc15"
    if level >= 50:
        return "EPIC", "🔥", "#38bdf8"
    if level >= 25:
        return "RARE", "💎", "#7dd3fc"
    return "COMMON", "⚡", "#94a3b8"


def rarity_badge_html(level):
    name, icon, colour = avatar_rarity(level)
    return f'<span class="rarity-badge" style="--rarity-colour:{colour};">{icon} {name} FORM</span>'


def evolution_name(branch, level):
    level = int(level)
    branch = str(branch).lower()
    if branch == "mass":
        if level >= 75: return "Titan Form"
        if level >= 50: return "Mass Monster"
        if level >= 25: return "Iron Bulk"
        return "Cyber Recruit"
    if branch == "hybrid":
        if level >= 75: return "Apex Hybrid"
        if level >= 50: return "Tactical Athlete"
        if level >= 25: return "Hybrid Rookie"
        return "Cyber Recruit"
    if level >= 90: return "True Adam"
    if level >= 75: return "Chad-Lite"
    if level >= 50: return "Elite Aesthetic"
    if level >= 25: return "Rising Aesthetic"
    return "Cyber Recruit"


def avatar_asset_for_stats(stats):
    branch = determine_avatar_branch(stats)
    level = int(stats.get("level", 1))
    stage = get_branch_stage(branch, level)
    path = AVATAR_ASSETS.get(branch, {}).get(stage)
    if path is None or not Path(path).exists():
        path = AVATAR_ASSETS["aesthetic"][1]
    return branch, stage, path


def next_evolution_info(branch, stats):
    level = int(stats.get("level", 1))
    bench = safe_num(stats.get("bench_e1rm"), 0)
    bf = stats.get("bf_mid", None)
    bf_val = safe_num(bf, 99) if bf is not None else None
    total_sets = int(workout_summary(load_log()).get("total_sets", 0))

    if level < 25:
        target_level, target_name = 25, "First Evolution"
    elif level < 50:
        target_level, target_name = 50, "Elite Form"
    elif level < 75:
        target_level, target_name = 75, "Advanced Form"
    elif level < 90:
        target_level, target_name = 90, "Legendary Form"
    else:
        target_level, target_name = 100, "True Final Form"

    reqs = [("Level", level, target_level, level >= target_level)]
    if branch == "mass":
        target_bench = 120 if level >= 75 else 100
        target_sets = 250 if level >= 75 else 100
        reqs += [("Bench", bench, target_bench, bench >= target_bench), ("Total Sets", total_sets, target_sets, total_sets >= target_sets)]
    elif branch == "hybrid":
        cardio = get_cardio_stats()
        minutes = safe_num(cardio.get("minutes", 0), 0)
        target_bench = 100 if level >= 50 else 90
        target_minutes = 300 if level >= 50 else 100
        reqs += [("Bench", bench, target_bench, bench >= target_bench), ("Cardio Minutes", minutes, target_minutes, minutes >= target_minutes)]
    else:
        target_bench = 100 if level < 75 else 110
        target_bf = 12 if level < 75 else 10
        reqs.append(("Bench", bench, target_bench, bench >= target_bench))
        reqs.append(("Body Fat", bf_val or 0, target_bf, (bf_val is not None and bf_val <= target_bf)))
    return target_name, target_level, reqs


def load_avatar_progression():
    columns = [
        "date", "level", "rank", "character_class", "build_type",
        "strength_score", "size_score", "leanness_score", "conditioning_score",
        "aesthetic_score", "weak_point_focus", "ai_summary", "timestamp"
    ]
    return df_from_supabase("avatar_progression", AVATAR_FILE, columns)


def save_avatar_snapshot(row):
    ok, err = sb_insert("avatar_progression", row)
    store_supabase_result("avatar_progression", ok, err)
    save_csv_backup(
        AVATAR_FILE,
        [
            "date", "level", "rank", "character_class", "build_type",
            "strength_score", "size_score", "leanness_score", "conditioning_score",
            "aesthetic_score", "weak_point_focus", "ai_summary", "timestamp"
        ],
        row=row,
    )


def calculate_avatar_stats():
    df = load_log()
    summary = workout_summary(df)
    heat = muscle_heat_map(df)

    latest_bw = latest_bodyweight_value() or summary.get("latest_bw", 0) or 0
    bf_mid = latest_bodyfat_mid()
    physique = latest_physique_rating_values()
    cardio = get_cardio_stats()

    bench = current_exercise_best_1rm("Barbell Bench Press (Strength)")
    if bench <= 0:
        bench = max(
            current_exercise_best_1rm("Barbell Bench Press"),
            current_exercise_best_1rm("Paused Barbell Bench Press"),
        )

    squat = current_exercise_best_1rm("Barbell Back Squat")
    bodyweight = latest_bw if latest_bw and latest_bw > 0 else 77.0

    bench_ratio = bench / bodyweight if bodyweight else 0
    squat_ratio = squat / bodyweight if bodyweight else 0

    # Strength: based on relative e1RM. 1.5x bench + 2x squat is around 100.
    strength_score = int(max(0, min((bench_ratio / 1.5) * 55 + (squat_ratio / 2.0) * 45, 100)))

    # Logged muscle sets are useful, but should not make size look 2/100 just because
    # the app has limited history. Blend actual logs, strength, bodyweight and AI physique rating.
    muscle_sets = 0
    if not heat.empty and "sets" in heat.columns:
        muscle_sets = int(pd.to_numeric(heat["sets"], errors="coerce").fillna(0).sum())

    volume_size_component = max(0, min(int(muscle_sets / 4), 100))  # faster ramp than old /12
    strength_size_component = int(max(0, min(strength_score * 0.85, 100)))

    ai_muscularity = safe_num(physique.get("muscularity_score"), None)
    ai_physique = safe_num(physique.get("physique_score"), None)

    if ai_muscularity is not None:
        ai_size_component = int(max(0, min((ai_muscularity / 15) * 100, 100)))
    elif ai_physique is not None:
        ai_size_component = int(max(0, min((ai_physique / 15) * 100, 100)))
    else:
        # Conservative baseline based on your strength/bodyweight, not a beginner score.
        ai_size_component = 55 if bench_ratio >= 1.0 else 45

    bodyweight_component = score_0_100(bodyweight, 65, 88)

    size_score = int(max(
        25,  # minimum baseline so the avatar does not look broken
        min(
            (ai_size_component * 0.35) +
            (strength_size_component * 0.30) +
            (bodyweight_component * 0.20) +
            (volume_size_component * 0.15),
            100
        )
    ))

    if bf_mid is not None and safe_num(bf_mid, 0) > 0:
        leanness_score = int(max(0, min(100, 100 - ((safe_num(bf_mid) - 8) * 6.5))))
    else:
        ai_lean = physique.get("leanness_score")
        leanness_score = int(safe_num(ai_lean, 7.5) / 15 * 100)

    # Conditioning: no cardio logs should mean "unlogged", not 0/100.
    # Give a baseline, then increase from minutes/distance.
    total_cardio_minutes = safe_num(cardio.get("minutes", 0), 0)
    total_distance = safe_num(cardio.get("distance", 0), 0)

    if total_cardio_minutes <= 0 and total_distance <= 0:
        conditioning_score = 35
    else:
        conditioning_score = int(max(25, min(
            30 + (total_cardio_minutes / 1000) * 45 + (total_distance / 100) * 25,
            100
        )))

    ai_phys_score = safe_num(physique.get("physique_score"), 8.0) / 15 * 100
    symmetry_score = safe_num(physique.get("symmetry_score"), 8.0) / 15 * 100

    aesthetic_score = int(max(0, min((leanness_score * 0.35) + (size_score * 0.25) + (symmetry_score * 0.20) + (ai_phys_score * 0.20), 100)))

    level = int(summary.get("level", 1))
    rank = str(summary.get("rank", rank_name(level)))

    if strength_score >= 75 and aesthetic_score >= 70:
        character_class = "Aesthetic Hybrid"
    elif leanness_score >= 80:
        character_class = "Shredded Assassin"
    elif strength_score >= 80:
        character_class = "Strength Titan"
    elif size_score >= 70:
        character_class = "Mass Builder"
    elif conditioning_score >= 70:
        character_class = "Combat Athlete"
    else:
        character_class = "Rising Aesthetic"

    if bodyweight >= 85:
        build_type = "Heavy Frame"
    elif bodyweight >= 78:
        build_type = "Athletic Frame"
    elif bodyweight >= 72:
        build_type = "Lean Frame"
    else:
        build_type = "Cutting Frame"

    weak_focus = "Balanced"
    if not heat.empty and "muscle" in heat.columns and "sets" in heat.columns:
        heat_dict = dict(zip(heat["muscle"], heat["sets"]))
        priority_order = [
            ("Upper Chest", "Upper chest"),
            ("Side Delts", "Side delts"),
            ("Back Width", "Lat width"),
            ("Rear Delts", "Rear delts"),
            ("Abs", "Core/abs"),
            ("Quads", "Legs"),
        ]
        lowest = None
        for muscle, label in priority_order:
            val = int(heat_dict.get(muscle, 0))
            if lowest is None or val < lowest[0]:
                lowest = (val, label)
        if lowest:
            weak_focus = lowest[1]

    return {
        "date": str(date.today()),
        "level": int(level),
        "rank": str(rank),
        "character_class": character_class,
        "build_type": build_type,
        "strength_score": int(strength_score),
        "size_score": int(size_score),
        "leanness_score": int(leanness_score),
        "conditioning_score": int(conditioning_score),
        "aesthetic_score": int(aesthetic_score),
        "weak_point_focus": weak_focus,
        "ai_summary": "",
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "bench_e1rm": float(bench),
        "squat_e1rm": float(squat),
        "bodyweight": float(bodyweight),
        "bf_mid": bf_mid,
        "avatar_branch": determine_avatar_branch({"strength_score": int(strength_score), "size_score": int(size_score), "conditioning_score": int(conditioning_score), "aesthetic_score": int(aesthetic_score)}),
    }


def default_avatar_summary(stats):
    return (
        f"{stats['character_class']} build at {stats['rank']}. "
        f"Main focus: {stats['weak_point_focus']}. "
        f"Current profile leans strength {stats['strength_score']}/100, "
        f"aesthetic {stats['aesthetic_score']}/100, leanness {stats['leanness_score']}/100."
    )
