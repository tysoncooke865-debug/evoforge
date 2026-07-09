from pathlib import Path

APP_TITLE = "Tyson Training"
CACHE_TTL_SECONDS = 45
CUSTOM_PLAN_TABLE = "custom_workout_plan"

BASE_DIR = Path(__file__).resolve().parent.parent

LOG_FILE = BASE_DIR / "workout_log.csv"
BODYWEIGHT_FILE = BASE_DIR / "bodyweight_log.csv"
CARDIO_FILE = BASE_DIR / "cardio_log.csv"
BODYFAT_FILE = BASE_DIR / "bodyfat_log.csv"
MEASUREMENTS_FILE = BASE_DIR / "measurements.csv"
PHYSIQUE_RATING_FILE = BASE_DIR / "physique_ratings.csv"
CUSTOM_PLAN_FILE = BASE_DIR / "custom_workout_plan.csv"
TARGETS_FILE = BASE_DIR / "targets.csv"
PROFILE_FILE = BASE_DIR / "profile.csv"
ACHIEVEMENT_FILE = BASE_DIR / "achievements.csv"
AVATAR_FILE = BASE_DIR / "avatar_progression.csv"

SUPABASE_TABLE_SCHEMAS = {
    "workout_log": ["date", "workout", "exercise", "muscle", "set", "weight", "reps", "estimated_1rm", "volume", "notes", "timestamp"],
    "bodyweight_log": ["date", "bodyweight", "timestamp"],
    "cardio_log": ["date", "type", "cardio_type", "minutes", "distance_km", "incline", "speed", "calories", "notes", "timestamp"],
    "bodyfat_log": ["date", "method", "bodyweight", "height_cm", "waist_cm", "neck_cm", "bf_low", "bf_high", "bf_mid", "confidence", "notes", "timestamp"],
    "measurements": ["date", "bodyweight", "wrist_cm", "forearm_cm", "bicep_cm", "chest_cm", "waist_cm", "hips_cm", "thigh_cm", "calf_cm", "shoulders_cm", "neck_cm", "notes", "timestamp"],
    "physique_ratings": ["date", "physique_score", "leanness_score", "symmetry_score", "muscularity_score", "confidence", "weak_points", "improvements", "summary", "timestamp"],
    "custom_workout_plan": ["plan_name", "workout", "exercise", "sets", "reps", "muscle", "reason", "day_goal", "timestamp"],
    "achievements": ["achievement_id", "name", "description", "date_unlocked"],
    "targets": ["target_type", "name", "target_value", "unit", "created_at", "notes"],
    "profile": ["height_cm", "bodyweight_kg", "bench_e1rm", "squat_e1rm", "training_years", "physique_score", "leanness_score", "base_level", "created_at"],
    "avatar_progression": ["date", "level", "rank", "character_class", "build_type", "strength_score", "size_score", "leanness_score", "conditioning_score", "aesthetic_score", "weak_point_focus", "ai_summary", "timestamp"],
}

ROUTINE = {
    "Push 1 - Strength": [
        ("Barbell Bench Press (Strength)", 4, "Top set 3-5 + 3 back-off sets 5-8"),
        ("Dumbbell Flat Bench Press", 3, "8-12"),
        ("Pec Deck Machine Fly", 3, "10-15"),
        ("Cable Lateral Raise", 4, "12-20"),
        ("Cable Triceps Pushdown", 4, "10-15"),
        ("Decline Push-Up", 2, "AMRAP"),
    ],
    "Pull 1 - Back Thickness": [
        ("Chest-Supported Machine Row", 4, "6-10"),
        ("Lat Pulldown", 4, "8-12"),
        ("Chest-Supported Dumbbell Row", 3, "8-12"),
        ("Reverse Pec Deck (Rear Delt Fly)", 4, "15-25"),
        ("EZ-Bar Curl", 4, "8-12"),
        ("Dumbbell Biceps Curl", 3, "10-15"),
    ],
    "Push 2 - Hypertrophy": [
        ("Paused Barbell Bench Press", 3, "5-8"),
        ("Dumbbell Flat Bench Press", 3, "8-12"),
        ("Pec Deck Machine Fly", 4, "12-20"),
        ("Dumbbell Lateral Raise", 5, "15-25"),
        ("Cable Lateral Raise", 3, "15-25"),
        ("Cable Triceps Pushdown", 4, "12-20"),
    ],
    "Pull 2 - Width / V-Taper": [
        ("Lat Pulldown", 4, "10-15"),
        ("Cable Lat Pullover (Straight-Arm Pulldown)", 4, "12-20"),
        ("Chest-Supported Machine Row", 3, "8-12"),
        ("Face Pull", 3, "15-25"),
        ("Reverse Pec Deck (Rear Delt Fly)", 3, "15-25"),
        ("EZ-Bar Curl", 3, "10-15"),
    ],
    "Legs": [
        ("Barbell Back Squat", 3, "5-8"),
        ("Hack Squat Machine", 4, "8-12"),
        ("Seated/Lying Leg Curl", 4, "10-15"),
        ("Leg Extension", 4, "12-20"),
        ("Seated Calf Raise", 5, "10-20"),
        ("Hip Adduction Machine", 3, "12-20"),
    ],
    "Aesthetics": [
        ("Cable Lateral Raise", 5, "15-25"),
        ("Cable Lat Pullover (Straight-Arm Pulldown)", 3, "12-20"),
        ("Pec Deck Machine Fly", 4, "12-20"),
        ("Reverse Pec Deck (Rear Delt Fly)", 4, "15-25"),
        ("Dumbbell Biceps Curl", 3, "10-15"),
        ("Cable Triceps Pushdown", 3, "10-15"),
        ("Machine Ab Crunch", 3, "10-20"),
        ("Lying Leg Raise", 3, "12-20"),
        ("Weighted Sit-Up", 2, "10-15"),
    ],
    "Rest": [],
}

EXERCISE_LIBRARY = {
    "Upper Chest": [
        "Incline Barbell Bench Press",
        "Incline Dumbbell Bench Press",
        "Low-to-High Cable Fly",
        "Incline Smith Machine Press",
        "Incline Machine Chest Press",
    ],
    "Mid Chest": [
        "Barbell Bench Press",
        "Dumbbell Flat Bench Press",
        "Machine Chest Press",
        "Pec Deck Machine Fly",
        "Cable Chest Fly",
        "Decline Push-Up",
    ],
    "Side Delts": [
        "Cable Lateral Raise",
        "Dumbbell Lateral Raise",
        "Machine Lateral Raise",
        "Lean-Away Cable Lateral Raise",
        "Behind-the-Back Cable Lateral Raise",
    ],
    "Rear Delts": [
        "Reverse Pec Deck (Rear Delt Fly)",
        "Cable Rear Delt Fly",
        "Face Pull",
        "Chest-Supported Rear Delt Row",
    ],
    "Back Width": [
        "Lat Pulldown",
        "Neutral-Grip Lat Pulldown",
        "Assisted Pull-Up",
        "Cable Lat Pullover (Straight-Arm Pulldown)",
        "Single-Arm Cable Lat Pulldown",
    ],
    "Back Thickness": [
        "Chest-Supported Machine Row",
        "Chest-Supported Dumbbell Row",
        "Seated Cable Row",
        "T-Bar Row",
        "Machine High Row",
    ],
    "Biceps": [
        "EZ-Bar Curl",
        "Dumbbell Biceps Curl",
        "Incline Dumbbell Curl",
        "Cable Curl",
        "Preacher Curl Machine",
        "Hammer Curl",
    ],
    "Triceps": [
        "Cable Triceps Pushdown",
        "Overhead Cable Triceps Extension",
        "Machine Dip",
        "Close-Grip Bench Press",
        "Single-Arm Cable Triceps Extension",
    ],
    "Quads": [
        "Barbell Back Squat",
        "Hack Squat Machine",
        "Leg Press",
        "Bulgarian Split Squat",
        "Leg Extension",
        "Smith Machine Squat",
    ],
    "Hamstrings": [
        "Seated/Lying Leg Curl",
        "Romanian Deadlift",
        "Seated Leg Curl",
        "Lying Leg Curl",
        "Back Extension",
    ],
    "Glutes/Adductors": [
        "Hip Adduction Machine",
        "Hip Abduction Machine",
        "Cable Kickback",
        "Hip Thrust Machine",
    ],
    "Calves": [
        "Seated Calf Raise",
        "Standing Calf Raise",
        "Leg Press Calf Raise",
    ],
    "Abs": [
        "Machine Ab Crunch",
        "Lying Leg Raise",
        "Hanging Knee Raise",
        "Cable Crunch",
        "Weighted Sit-Up",
        "Decline Sit-Up",
    ],
    "Forearms/Grip": [
        "Wrist Curl",
        "Reverse Curl",
        "Farmer Carry",
        "Cable Wrist Curl",
    ],
}

FALLBACK_AESTHETIC_PLAN = {
    "Push 1 - Strength Bias": [
        ("Barbell Bench Press", 4, "3-6"),
        ("Incline Dumbbell Bench Press", 3, "8-12"),
        ("Machine Chest Press", 3, "8-12"),
        ("Lean-Away Cable Lateral Raise", 4, "15-25"),
        ("Overhead Cable Triceps Extension", 3, "10-15"),
        ("Cable Triceps Pushdown", 3, "12-20"),
    ],
    "Pull 1 - Width Bias": [
        ("Neutral-Grip Lat Pulldown", 4, "8-12"),
        ("Single-Arm Cable Lat Pulldown", 3, "10-15"),
        ("Chest-Supported Machine Row", 3, "8-12"),
        ("Cable Rear Delt Fly", 4, "15-25"),
        ("Incline Dumbbell Curl", 3, "10-15"),
        ("Hammer Curl", 3, "10-15"),
    ],
    "Push 2 - Upper Chest / Delts": [
        ("Incline Smith Machine Press", 4, "6-10"),
        ("Low-to-High Cable Fly", 3, "12-20"),
        ("Machine Lateral Raise", 5, "12-25"),
        ("Behind-the-Back Cable Lateral Raise", 3, "15-25"),
        ("Machine Dip", 3, "8-12"),
        ("Single-Arm Cable Triceps Extension", 3, "12-20"),
    ],
    "Pull 2 - Thickness / Rear Delts": [
        ("T-Bar Row", 4, "6-10"),
        ("Machine High Row", 3, "8-12"),
        ("Cable Lat Pullover (Straight-Arm Pulldown)", 3, "12-20"),
        ("Reverse Pec Deck (Rear Delt Fly)", 4, "15-25"),
        ("Preacher Curl Machine", 3, "8-12"),
        ("Cable Curl", 3, "12-20"),
    ],
    "Legs": [
        ("Hack Squat Machine", 4, "6-10"),
        ("Romanian Deadlift", 3, "8-12"),
        ("Leg Press", 3, "10-15"),
        ("Leg Extension", 3, "12-20"),
        ("Seated Leg Curl", 3, "10-15"),
        ("Standing Calf Raise", 4, "10-20"),
    ],
    "Aesthetic Weakpoint Day": [
        ("Machine Lateral Raise", 5, "15-25"),
        ("Low-to-High Cable Fly", 4, "12-20"),
        ("Single-Arm Cable Lat Pulldown", 3, "12-15"),
        ("Cable Rear Delt Fly", 4, "15-25"),
        ("Cable Crunch", 3, "10-15"),
        ("Hanging Knee Raise", 3, "10-20"),
    ],
}

MUSCLE_MAP = {
    # Chest / pressing
    "Barbell Bench Press (Strength)": "Chest",
    "Barbell Bench Press": "Chest",
    "Paused Barbell Bench Press": "Chest",
    "Dumbbell Flat Bench Press": "Chest",
    "Machine Chest Press": "Chest",
    "Incline Barbell Bench Press": "Upper Chest",
    "Incline Dumbbell Bench Press": "Upper Chest",
    "Incline Smith Machine Press": "Upper Chest",
    "Incline Machine Chest Press": "Upper Chest",
    "Pec Deck Machine Fly": "Chest",
    "Cable Chest Fly": "Chest",
    "Low-to-High Cable Fly": "Upper Chest",
    "Decline Push-Up": "Chest",
    "Machine Dip": "Triceps",

    # Delts / shoulders
    "Cable Lateral Raise": "Side Delts",
    "Dumbbell Lateral Raise": "Side Delts",
    "Machine Lateral Raise": "Side Delts",
    "Lean-Away Cable Lateral Raise": "Side Delts",
    "Behind-the-Back Cable Lateral Raise": "Side Delts",
    "Reverse Pec Deck (Rear Delt Fly)": "Rear Delts",
    "Cable Rear Delt Fly": "Rear Delts",
    "Face Pull": "Rear Delts",
    "Chest-Supported Rear Delt Row": "Rear Delts",

    # Back
    "Lat Pulldown": "Back Width",
    "Neutral-Grip Lat Pulldown": "Back Width",
    "Assisted Pull-Up": "Back Width",
    "Cable Lat Pullover (Straight-Arm Pulldown)": "Back Width",
    "Single-Arm Cable Lat Pulldown": "Back Width",
    "Chest-Supported Machine Row": "Back Thickness",
    "Chest-Supported Dumbbell Row": "Back Thickness",
    "Seated Cable Row": "Back Thickness",
    "T-Bar Row": "Back Thickness",
    "Machine High Row": "Back Thickness",

    # Biceps / forearms
    "EZ-Bar Curl": "Biceps",
    "Dumbbell Biceps Curl": "Biceps",
    "Incline Dumbbell Curl": "Biceps",
    "Cable Curl": "Biceps",
    "Preacher Curl Machine": "Biceps",
    "Hammer Curl": "Biceps",
    "Reverse Curl": "Forearms",
    "Wrist Curl": "Forearms",
    "Cable Wrist Curl": "Forearms",
    "Farmer Carry": "Forearms",

    # Triceps
    "Cable Triceps Pushdown": "Triceps",
    "Overhead Cable Triceps Extension": "Triceps",
    "Close-Grip Bench Press": "Triceps",
    "Single-Arm Cable Triceps Extension": "Triceps",

    # Legs
    "Barbell Back Squat": "Quads",
    "Hack Squat Machine": "Quads",
    "Leg Press": "Quads",
    "Bulgarian Split Squat": "Quads",
    "Leg Extension": "Quads",
    "Smith Machine Squat": "Quads",
    "Seated/Lying Leg Curl": "Hamstrings",
    "Romanian Deadlift": "Hamstrings",
    "Seated Leg Curl": "Hamstrings",
    "Lying Leg Curl": "Hamstrings",
    "Back Extension": "Hamstrings",
    "Hip Adduction Machine": "Adductors",
    "Hip Abduction Machine": "Glutes",
    "Cable Kickback": "Glutes",
    "Hip Thrust Machine": "Glutes",
    "Seated Calf Raise": "Calves",
    "Standing Calf Raise": "Calves",
    "Leg Press Calf Raise": "Calves",

    # Abs
    "Machine Ab Crunch": "Abs",
    "Lying Leg Raise": "Abs",
    "Hanging Knee Raise": "Abs",
    "Cable Crunch": "Abs",
    "Weighted Sit-Up": "Abs",
    "Decline Sit-Up": "Abs",
}

ACHIEVEMENTS = {
    # App / logging
    "first_set": ("⚡ First Signal", "Logged your first set."),
    "first_workout": ("🦇 Patrol Started", "Logged 10 total sets."),
    "hundred_sets": ("🔥 100 Set Streak", "Logged 100 total working sets."),
    "five_hundred_sets": ("⚔️ 500 Set Veteran", "Logged 500 total working sets."),
    "thousand_sets": ("👑 1000 Set Machine", "Logged 1000 total working sets."),

    # Consistency
    "three_day_streak": ("🔥 3 Day Streak", "Logged workouts on 3 different days."),
    "seven_day_streak": ("⚡ 7 Day Streak", "Logged workouts on 7 different days."),
    "fourteen_day_streak": ("🦾 14 Day Discipline", "Logged workouts on 14 different days."),
    "thirty_day_streak": ("🗿 30 Day Weapon", "Logged workouts on 30 different days."),
    "full_ppppla_week": ("💎 Full PPPPLA Week", "Logged all 6 training days at least once."),

    # Bench milestones
    "bench_60": ("🏋️ 1 Plate Bench", "Logged a 60kg+ bench press."),
    "bench_80": ("⚡ 80kg Bench", "Logged an 80kg+ bench press."),
    "bench_90": ("💪 90kg Bench Signal", "Logged 90kg or more on bench."),
    "bench_100": ("🏆 100kg Bench Club", "Logged a 100kg+ bench press."),
    "bench_110": ("🦾 110kg Bench", "Logged a 110kg+ bench press."),
    "bench_120": ("👑 120kg Bench", "Logged a 120kg+ bench press."),
    "bench_100_est": ("🏆 100kg Bench Quest", "Estimated 1RM reached 100kg."),
    "bench_120_est": ("👑 120kg Bench Quest", "Estimated 1RM reached 120kg."),
    "bench_bw": ("⚖️ Bodyweight Bench", "Estimated bench 1RM reached bodyweight."),
    "bench_1_25_bw": ("🦇 1.25× BW Bench", "Estimated bench 1RM reached 1.25× bodyweight."),
    "bench_1_5_bw": ("☀️ 1.5× BW Bench", "Estimated bench 1RM reached 1.5× bodyweight."),

    # Squat milestones
    "squat_100": ("🦵 100kg Squat", "Logged a 100kg+ squat."),
    "squat_140": ("⚔️ 2 Plate Squat", "Logged a 140kg+ squat."),
    "squat_160": ("🦾 160kg Squat", "Logged a 160kg+ squat."),
    "squat_180": ("🗿 180kg Squat", "Logged a 180kg+ squat."),
    "squat_200": ("👑 200kg Squat", "Logged a 200kg+ squat."),
    "squat_1_5_bw": ("⚖️ 1.5× BW Squat", "Estimated squat 1RM reached 1.5× bodyweight."),
    "squat_2_bw": ("☀️ 2× BW Squat", "Estimated squat 1RM reached 2× bodyweight."),

    # Bodyweight / bulking / cutting
    "first_bw_log": ("⚖️ Scale Online", "Logged bodyweight for the first time."),
    "bw_75": ("🏃 75kg Checkpoint", "Logged bodyweight at or below 75kg."),
    "bw_80": ("🦾 80kg Frame", "Logged bodyweight at or above 80kg."),
    "bw_85": ("🗿 85kg Bulk Mode", "Logged bodyweight at or above 85kg."),
    "bulk_2kg": ("📈 Lean Bulk Started", "Gained 2kg from your lowest logged bodyweight."),
    "bulk_5kg": ("🦾 5kg Bulk Arc", "Gained 5kg from your lowest logged bodyweight."),
    "cut_2kg": ("✂️ Cut Started", "Dropped 2kg from your highest logged bodyweight."),
    "cut_5kg": ("🔥 5kg Cut Arc", "Dropped 5kg from your highest logged bodyweight."),

    # Body fat
    "first_bf_log": ("📸 Body Fat Scan", "Saved your first body fat estimate."),
    "bf_under_15": ("💎 Under 15%", "Body fat estimate reached under 15%."),
    "bf_under_13": ("🦇 Under 13%", "Body fat estimate reached under 13%."),
    "bf_under_12": ("⚡ Under 12%", "Body fat estimate reached under 12%."),
    "bf_under_10": ("☀️ 10% Club", "Body fat estimate reached 10% or lower."),
    "bf_target_hit": ("🎯 Body Fat Target Hit", "Reached your saved body fat target."),

    # Cardio
    "first_cardio": ("🫀 Engine Started", "Logged your first cardio session."),
    "cardio_100": ("🫀 Engine Built", "Logged 100 total cardio minutes."),
    "cardio_300": ("🏃 300 Minute Engine", "Logged 300 total cardio minutes."),
    "cardio_1000": ("⚡ 1000 Minute Engine", "Logged 1000 total cardio minutes."),
    "cardio_5k_total": ("🛣️ 5km Total", "Logged 5km total cardio distance."),
    "cardio_25k_total": ("🛣️ 25km Total", "Logged 25km total cardio distance."),
    "cardio_100k_total": ("🌏 100km Total", "Logged 100km total cardio distance."),
    "boxing_logged": ("🥊 Sparring Logged", "Logged a boxing cardio session."),

    # Muscle group volume
    "chest_50": ("🛡️ 50 Chest Sets", "Logged 50 chest sets."),
    "chest_150": ("🛡️ Chest Built", "Logged 150 chest sets."),
    "back_50": ("🪽 50 Back Sets", "Logged 50 back sets."),
    "back_150": ("🪽 V-Taper Built", "Logged 150 back sets."),
    "delts_50": ("🪽 Wing Build", "Logged 50 delt/rear-delt sets."),
    "delts_150": ("💎 Capped Delts", "Logged 150 delt/rear-delt sets."),
    "arms_100": ("💪 Arm Arc", "Logged 100 biceps/triceps sets."),
    "legs_100": ("🦵 Leg Foundation", "Logged 100 leg/calf sets."),
    "abs_50": ("腹 Core Signal", "Logged 50 ab sets."),

    # Rank milestones
    "aesthetic_tier": ("💎 Aesthetic Tier", "Reached level 40."),
    "elite_physique": ("⚡ Elite Physique", "Reached level 60."),
    "chad_lite": ("🗿 Chad-Lite", "Reached level 75."),
    "chad": ("👑 Chad", "Reached level 90."),
    "true_adam": ("☀️ True Adam", "Reached level 100."),
}
