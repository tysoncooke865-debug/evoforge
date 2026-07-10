from datetime import datetime
from functools import lru_cache

import pandas as pd

from config.constants import MUSCLE_MAP
from data.sb_ops import (
    df_from_supabase, sb_insert_returning, sb_update_by_id, sb_delete_matching,
    store_supabase_result,
)
from domain.xp import XP_PER_SET, activity_xp, level_and_progress, resolve_xp
from domain.xp_ledger import ledger_xp, record_set_event
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
    # Project the read: workout_log also has muscle, volume, estimated_1rm and notes,
    # and NONE of them is read from this frame (muscle is recomputed by
    # infer_muscle_group, e1RM by e1rm_series). `id` IS needed -- save_set_auto()
    # updates a set in place by its id -- so it stays in the wire projection even
    # though it is not a display column. Verified valid PostgREST against the live
    # API (`set` and `timestamp` are SQL keywords but PostgREST accepts them).
    select_cols = "id,date,workout,exercise,set,weight,reps,timestamp"
    return normalise_workout_log(df_from_supabase("workout_log", columns, select_cols=select_cols))


def estimated_1rm(weight, reps):
    """Epley. One set's estimated one-rep max. Scalar; for a Series use `e1rm_series`."""
    return weight * (1 + reps / 30) if reps > 0 else 0


def e1rm_series(weight, reps):
    """`estimated_1rm` over two Series, vectorised.

    Four call sites used `df.apply(lambda x: estimated_1rm(...), axis=1)`, which
    walks the frame row by row in Python -- up to 2500 rows, several times per
    render. `verify_xp.py` and `verify_ordering.py` pin the numbers this produces,
    so a divergence between this and the scalar form goes red.
    """
    weight = pd.to_numeric(weight, errors="coerce").fillna(0)
    reps = pd.to_numeric(reps, errors="coerce").fillna(0)
    return (weight * (1 + reps / 30)).where(reps > 0, 0)


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
    return float(e1rm_series(ex["weight"], ex["reps"]).max())


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
    """Save one set. Returns `(changed, is_pr, current_1rm, previous_best, unlocked)`.

    `unlocked` is the achievement sweep's result, which this function already paid
    for. `views/today.py` used to call `check_achievements()` again straight after
    -- a second full sweep of the log, summary, heat map, bodyweight, body fat and
    cardio -- and then `st.rerun()`, so every logged set ran the sweep twice and the
    whole script three times.
    """
    from domain.achievements import check_achievements
    from domain.xp_leveling import mark_xp_gain

    if weight <= 0 or reps <= 0:
        return False, False, 0, 0, []

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

    supabase_row = {
        "date": str(workout_date),
        "workout": str(workout),
        "exercise": str(exercise),
        "set": int(set_no),
        "weight": float(weight),
        "reps": int(reps),
        "timestamp": timestamp,
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
            same_weight, same_reps = False, False

        if same_weight and same_reps:
            return False, False, current_1rm, previous_best, []

        # EDIT, not a new set. Update in place so `workout_log.id` survives.
        #
        # This used to delete the row and insert a replacement, minting a fresh
        # uuid. A set is worth a flat XP_PER_SET whatever the weight and reps, so
        # an edit must not grant XP twice -- but xp_events keys each grant to
        # `workout_log.id` and RLS forbids deleting the old grant. A new id would
        # either double the set's XP or strand its grant against a deleted row,
        # and migrations/002 STEP 4 would stop reconciling. Same id, same grant.
        old_id = old.get("id")
        if old_id:
            ok, err = sb_update_by_id("workout_log", old_id, supabase_row)
            store_supabase_result("workout_log", ok, err)
            unlocked = check_achievements()
            # No mark_xp_gain: correcting a set earns nothing. It never did; the
            # old code announced XP here anyway, while the derived total stayed put.
            return True, is_pr, current_1rm, previous_best, unlocked

        # No id to update (a row written before `id` was selected). Fall back to
        # the old delete-and-insert and let the ledger grant a fresh event below.
        sb_delete_matching("workout_log", {
            "date": str(workout_date),
            "workout": str(workout),
            "exercise": str(exercise),
            "set": int(set_no),
        })

    stored, err = sb_insert_returning("workout_log", supabase_row)
    store_supabase_result("workout_log", stored is not None, err)

    # Append the grant only for a genuinely new set, and only once. The unique
    # index on (user_id, source_table, source_id) makes a retry a no-op. A failed
    # grant must never fail the save: the set happened. STEP 3's backfill is
    # re-runnable and will collect any orphan.
    if stored and stored.get("id"):
        if not record_set_event(stored["id"], stored.get("timestamp")):
            # Never silent. A dropped grant leaves the ledger behind the derived
            # total; `resolve_xp` keeps the user's XP intact, but somebody has to
            # know to re-run migrations/002 STEP 3.
            store_supabase_result("xp_events", False, "XP grant failed for this set")

    unlocked = check_achievements()
    # The real value of a set. Announcing +75 for 10 XP is a lie the bar exposes.
    mark_xp_gain(XP_PER_SET, "QUEST COMPLETE", "Set logged successfully")
    return True, is_pr, current_1rm, previous_best, unlocked


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
        base = get_base_level()
        level, xp_into_level, xp_needed = level_and_progress(base, 0)
        return {
            "total_sets": 0, "total_reps": 0, "best_bench_1rm": 0, "latest_bw": 0,
            "xp": 0, "level": level, "rank": rank_name(level), "base_level": base,
            "xp_into_level": xp_into_level, "xp_needed": xp_needed,
            "xp_source": "derived", "xp_derived": 0, "xp_drift": 0,
        }

    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(0)
    df["reps"] = pd.to_numeric(df["reps"], errors="coerce").fillna(0)

    valid_sets = df[(df["weight"] > 0) & (df["reps"] > 0)].copy()
    valid_sets = valid_sets.drop_duplicates(subset=["date", "workout", "exercise", "set"], keep="last")

    total_sets = len(valid_sets)
    total_reps = int(valid_sets["reps"].sum()) if not valid_sets.empty else 0

    bench = valid_sets[valid_sets["exercise"] == "Barbell Bench Press (Strength)"].copy()
    if not bench.empty:
        bench["estimated_1rm"] = e1rm_series(bench["weight"], bench["reps"])
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

    # One curve, one place: domain/xp.py. `xp_into_level` and `xp_needed` come
    # from the SAME function that decides the level, so the bar reaches exactly
    # 100% when the level is granted. Previously they were computed by three
    # different formulas and the bar could never fill.
    #
    # The derived total is always computed, even when the ledger answers, because
    # it is the only oracle that can catch the ledger drifting. `resolve_xp` prefers
    # the ledger and reports the difference; before migrations/002 is applied
    # `ledger_xp()` returns None and the derived number is used unchanged.
    derived_xp = activity_xp(total_sets, cardio_minutes)
    xp, xp_source, xp_drift = resolve_xp(derived_xp, ledger_xp())
    base_level = get_base_level()
    level, xp_into_level, xp_needed = level_and_progress(base_level, xp)

    bw_df = load_bodyweight_log()
    latest_bw = 0
    if not bw_df.empty:
        bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
        latest_bw = float(bw_df.iloc[-1]["bodyweight"])

    return {
        "total_sets": total_sets, "total_reps": total_reps, "best_bench_1rm": best_bench_1rm,
        "latest_bw": latest_bw, "xp": xp, "level": level, "rank": rank_name(level), "base_level": base_level,
        "xp_into_level": xp_into_level, "xp_needed": xp_needed,
        # Provenance, so a leaderboard can refuse to rank an unreconciled account.
        "xp_source": xp_source, "xp_derived": derived_xp, "xp_drift": xp_drift,
    }


@lru_cache(maxsize=None)
def infer_muscle_group(exercise):
    """Map an exercise name to a muscle group.

    Pure `str -> str` with no user data in the result, so a process-global memo is
    safe. It walks ~15 substring tests per call and `muscle_heat_map()` applies it
    to every row of the log on every render; the exercise vocabulary is small and
    bounded, so the cache saturates on the first page.
    """
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
