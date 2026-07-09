from datetime import datetime

import pandas as pd

from config.constants import LOG_FILE, MUSCLE_MAP
from data.sb_ops import df_from_supabase, sb_insert, sb_delete_matching, store_supabase_result
from domain.profile import get_base_level, rank_name
from domain.bodyweight import load_bodyweight_log
from domain.cardio import load_cardio_log


def normalise_workout_log(df):
    if "set" not in df.columns and "set_number" in df.columns:
        df = df.rename(columns={"set_number": "set"})

    for col in ["date", "workout", "exercise", "set", "weight", "reps", "timestamp"]:
        if col not in df.columns:
            df[col] = ""

    df["set"] = pd.to_numeric(df["set"], errors="coerce").fillna(0).astype(int)

    if not df.empty:
        df = df.sort_values("timestamp", ascending=True)
        df = df.drop_duplicates(
            subset=["date", "workout", "exercise", "set"],
            keep="last"
        ).reset_index(drop=True)

    return df


def load_log():
    columns = ["date", "workout", "exercise", "set", "weight", "reps", "timestamp"]
    return normalise_workout_log(df_from_supabase("workout_log", LOG_FILE, columns))


def estimated_1rm(weight, reps):
    return weight * (1 + reps / 30) if reps > 0 else 0


def get_last_sets(df, exercise):
    if df.empty or "exercise" not in df.columns:
        return None
    previous = df[df["exercise"] == exercise]
    if previous.empty:
        return None
    last_date = previous["date"].max()
    return previous[previous["date"] == last_date]


def get_previous_best_1rm(df, exercise, exclude_date=None, exclude_set=None):
    if df.empty:
        return 0
    ex = df[df["exercise"] == exercise].copy()
    if exclude_date is not None and exclude_set is not None:
        ex["set"] = pd.to_numeric(ex["set"], errors="coerce").fillna(0).astype(int)
        ex = ex[~((ex["date"].astype(str) == str(exclude_date)) & (ex["set"] == int(exclude_set)))]
    if ex.empty:
        return 0
    ex["weight"] = pd.to_numeric(ex["weight"], errors="coerce").fillna(0)
    ex["reps"] = pd.to_numeric(ex["reps"], errors="coerce").fillna(0)
    ex["estimated_1rm"] = ex.apply(lambda x: estimated_1rm(float(x["weight"]), int(x["reps"])), axis=1)
    return float(ex["estimated_1rm"].max())


def suggest_weight(df, exercise):
    last = get_last_sets(df, exercise)
    if last is None or last.empty:
        return "No previous data yet"
    last = last.copy()
    last["weight"] = pd.to_numeric(last["weight"], errors="coerce").fillna(0)
    last["reps"] = pd.to_numeric(last["reps"], errors="coerce").fillna(0)
    best = last.sort_values(["weight", "reps"], ascending=False).iloc[0]
    weight = float(best["weight"])
    reps = int(best["reps"])
    if exercise == "Barbell Bench Press (Strength)":
        return f"Try {weight + 2.5:.1f} kg next top set" if reps >= 5 else f"Repeat {weight:.1f} kg and beat reps"
    if exercise == "Paused Barbell Bench Press":
        return f"Try {weight + 2.5:.1f} kg" if reps >= 8 else f"Repeat {weight:.1f} kg with a clean pause"
    return f"Try {weight + 2.5:.1f} kg if form was clean" if reps >= 15 else f"Repeat {weight:.1f} kg and beat reps"


def completed_sets_for_day(df, workout_date, workout):
    """
    Count completed sets, not completed exercises.
    One set = one unique date + workout + exercise + set number with weight and reps.
    """
    if df is None or df.empty:
        return 0

    df = normalise_workout_log(df)
    today = df[
        (df["date"].astype(str) == str(workout_date)) &
        (df["workout"].astype(str) == str(workout))
    ].copy()

    if today.empty:
        return 0

    today["set"] = pd.to_numeric(today["set"], errors="coerce").fillna(0).astype(int)
    today["weight"] = pd.to_numeric(today["weight"], errors="coerce").fillna(0)
    today["reps"] = pd.to_numeric(today["reps"], errors="coerce").fillna(0)

    today = today[(today["set"] > 0) & (today["weight"] > 0) & (today["reps"] > 0)]
    today = today.drop_duplicates(subset=["date", "workout", "exercise", "set"], keep="last")
    return int(len(today))


def save_set_auto(workout_date, workout, exercise, set_no, weight, reps):
    from domain.achievements import check_achievements
    from domain.xp_leveling import mark_xp_gain

    if weight <= 0 or reps <= 0:
        return False, False, 0, 0

    df_before = load_log()
    previous_best = get_previous_best_1rm(df_before, exercise, exclude_date=workout_date, exclude_set=set_no)
    current_1rm = estimated_1rm(float(weight), int(reps))
    is_pr = current_1rm > previous_best and previous_best > 0

    df = normalise_workout_log(df_before)
    df["date"] = df["date"].astype(str)
    df["workout"] = df["workout"].astype(str)
    df["exercise"] = df["exercise"].astype(str)
    df["set"] = pd.to_numeric(df["set"], errors="coerce").fillna(0).astype(int)

    mask = (
        (df["date"] == str(workout_date)) &
        (df["workout"] == str(workout)) &
        (df["exercise"] == str(exercise)) &
        (df["set"] == int(set_no))
    )

    timestamp = datetime.now().isoformat(timespec="seconds")
    muscle = infer_muscle_group(exercise) if "infer_muscle_group" in globals() else MUSCLE_MAP.get(exercise, "Other")

    csv_row = {
        "date": str(workout_date),
        "workout": str(workout),
        "exercise": str(exercise),
        "set": int(set_no),
        "weight": float(weight),
        "reps": int(reps),
        "timestamp": timestamp,
    }

    supabase_row = {
        **csv_row,
        "muscle": str(muscle),
        "estimated_1rm": float(current_1rm),
        "volume": float(weight) * int(reps),
        "notes": "",
    }

    if mask.any():
        old = df.loc[mask].iloc[-1]
        try:
            same_weight = float(old["weight"]) == float(weight)
            same_reps = int(float(old["reps"])) == int(reps)
        except Exception:
            same_weight = False, False

        if same_weight and same_reps:
            return False, False, current_1rm, previous_best

        df = df.loc[~mask].copy()
        sb_delete_matching("workout_log", {
            "date": str(workout_date),
            "workout": str(workout),
            "exercise": str(exercise),
            "set": int(set_no),
        })

    df = pd.concat([df, pd.DataFrame([csv_row])], ignore_index=True)
    df.to_csv(LOG_FILE, index=False)

    ok, err = sb_insert("workout_log", supabase_row)
    store_supabase_result("workout_log", ok, err)

    check_achievements()
    mark_xp_gain(75, "QUEST COMPLETE", "Set logged successfully")
    return True, is_pr, current_1rm, previous_best


def current_exercise_best_1rm(exercise_name):
    df = load_log()
    if df.empty:
        return 0
    df = normalise_workout_log(df)
    ex = df[df["exercise"].astype(str) == str(exercise_name)].copy()
    if ex.empty:
        return 0
    ex["weight"] = pd.to_numeric(ex["weight"], errors="coerce").fillna(0)
    ex["reps"] = pd.to_numeric(ex["reps"], errors="coerce").fillna(0)
    ex["estimated_1rm"] = ex.apply(
        lambda x: estimated_1rm(float(x["weight"]), int(x["reps"])),
        axis=1,
    )
    return float(ex["estimated_1rm"].max())


def workout_summary(df):
    df = normalise_workout_log(df.copy())
    if df.empty:
        return {
            "total_sets": 0, "total_reps": 0, "best_bench_1rm": 0, "latest_bw": 0,
            "xp": 0, "level": get_base_level(), "rank": rank_name(get_base_level()), "base_level": get_base_level(),
            "xp_into_level": 0, "xp_needed": 500
        }

    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(0)
    df["reps"] = pd.to_numeric(df["reps"], errors="coerce").fillna(0)

    valid_sets = df[(df["weight"] > 0) & (df["reps"] > 0)].copy()
    valid_sets = valid_sets.drop_duplicates(subset=["date", "workout", "exercise", "set"], keep="last")

    total_sets = len(valid_sets)
    total_reps = int(valid_sets["reps"].sum()) if not valid_sets.empty else 0

    bench = valid_sets[valid_sets["exercise"] == "Barbell Bench Press (Strength)"].copy()
    if not bench.empty:
        bench["estimated_1rm"] = bench.apply(lambda x: estimated_1rm(float(x["weight"]), int(x["reps"])), axis=1)
        best_bench_1rm = float(bench["estimated_1rm"].max())
    else:
        best_bench_1rm = 0

    cardio = load_cardio_log()
    if not cardio.empty:
        cardio = cardio.drop_duplicates(subset=[c for c in ["date", "type", "cardio_type", "minutes", "distance_km", "timestamp"] if c in cardio.columns], keep="last")
        cardio["minutes"] = pd.to_numeric(cardio.get("minutes", 0), errors="coerce").fillna(0)
        cardio_minutes = float(cardio["minutes"].sum())
    else:
        cardio_minutes = 0

    xp = int(total_sets * 10 + cardio_minutes * 2)
    base_level = get_base_level()
    earned_levels = xp // 500
    level = max(1, min(base_level + earned_levels, 100))
    xp_into_level = xp % 500

    bw_df = load_bodyweight_log()
    latest_bw = 0
    if not bw_df.empty:
        bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
        latest_bw = float(bw_df.iloc[-1]["bodyweight"])

    return {
        "total_sets": total_sets, "total_reps": total_reps, "best_bench_1rm": best_bench_1rm,
        "latest_bw": latest_bw, "xp": xp, "level": level, "rank": rank_name(level), "base_level": base_level,
        "xp_into_level": xp_into_level, "xp_needed": 500
    }


def infer_muscle_group(exercise):
    name = str(exercise).strip()
    if name in MUSCLE_MAP:
        return MUSCLE_MAP[name]

    lower = name.lower()

    if any(x in lower for x in ["incline", "upper chest", "low-to-high"]):
        if any(x in lower for x in ["press", "bench", "fly", "chest"]):
            return "Upper Chest"

    if any(x in lower for x in ["bench", "pec", "chest", "fly", "push-up", "push up"]):
        return "Chest"

    if any(x in lower for x in ["lateral raise", "side delt", "machine lateral", "lean-away"]):
        return "Side Delts"

    if any(x in lower for x in ["rear delt", "reverse pec", "face pull"]):
        return "Rear Delts"

    if any(x in lower for x in ["pulldown", "pull-up", "pull up", "lat pullover", "straight-arm", "straight arm", "lat"]):
        return "Back Width"

    if any(x in lower for x in ["row", "t-bar", "machine high row", "high row"]):
        return "Back Thickness"

    if any(x in lower for x in ["curl", "bicep", "preacher", "hammer"]):
        if any(x in lower for x in ["wrist", "reverse", "farmer"]):
            return "Forearms"
        return "Biceps"

    if any(x in lower for x in ["tricep", "pushdown", "overhead extension", "close-grip", "dip"]):
        return "Triceps"

    if any(x in lower for x in ["squat", "leg press", "leg extension", "quad", "bulgarian"]):
        return "Quads"

    if any(x in lower for x in ["leg curl", "hamstring", "romanian", "rdl", "back extension"]):
        return "Hamstrings"

    if "calf" in lower:
        return "Calves"

    if any(x in lower for x in ["adduction", "adductor"]):
        return "Adductors"

    if any(x in lower for x in ["abduction", "kickback", "hip thrust", "glute"]):
        return "Glutes"

    if any(x in lower for x in ["crunch", "sit-up", "sit up", "leg raise", "knee raise", "abs"]):
        return "Abs"

    return "Other"


def muscle_heat_map(df):
    df = normalise_workout_log(df.copy())
    if df.empty:
        return pd.DataFrame(columns=["muscle", "sets"])
    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(0)
    df["reps"] = pd.to_numeric(df["reps"], errors="coerce").fillna(0)
    df = df[(df["weight"] > 0) & (df["reps"] > 0)]
    if df.empty:
        return pd.DataFrame(columns=["muscle", "sets"])
    df = df.drop_duplicates(subset=["date", "workout", "exercise", "set"], keep="last")
    df["muscle"] = df["exercise"].apply(infer_muscle_group)
    return (
        df.groupby("muscle", as_index=False)
        .size()
        .rename(columns={"size": "sets"})
        .sort_values("sets", ascending=False)
    )


def unique_training_days(df):
    if df.empty or "date" not in df.columns:
        return 0
    return df["date"].dropna().astype(str).nunique()


def logged_all_ppppla_days(df):
    if df.empty or "workout" not in df.columns:
        return False
    required = {
        "Push 1 - Strength",
        "Pull 1 - Back Thickness",
        "Push 2 - Hypertrophy",
        "Pull 2 - Width / V-Taper",
        "Legs",
        "Aesthetics",
    }
    logged = set(df["workout"].dropna().astype(str).unique())
    return required.issubset(logged)


def muscle_sets_count(heat, names):
    if heat.empty:
        return 0
    return int(heat[heat["muscle"].isin(names)]["sets"].sum())
