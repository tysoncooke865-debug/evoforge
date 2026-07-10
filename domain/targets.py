from datetime import datetime

from data.sb_ops import df_from_supabase, sb_insert, sb_delete_matching, store_supabase_result


def load_targets():
    columns = ["target_type", "name", "target_value", "unit", "created_at", "notes"]
    return df_from_supabase("targets", columns)


def save_or_update_target(target_type, name, target_value, unit, notes=""):
    new_row = {
        "target_type": target_type,
        "name": name,
        "target_value": float(target_value),
        "unit": unit,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "notes": notes,
    }
    sb_delete_matching("targets", {"target_type": str(target_type), "name": str(name)})
    ok, err = sb_insert("targets", new_row)
    store_supabase_result("targets", ok, err)


def get_target(target_type, name):
    df = load_targets()
    if df.empty:
        return None
    matches = df[
        (df["target_type"].astype(str) == str(target_type)) &
        (df["name"].astype(str) == str(name))
    ]
    if matches.empty:
        return None
    try:
        return float(matches.iloc[-1]["target_value"])
    except Exception:
        return None


def get_target_created_at(target_type, name):
    """When this target was set. The baseline for a journey bar is measured there."""
    df = load_targets()
    if df.empty:
        return None
    matches = df[
        (df["target_type"].astype(str) == str(target_type)) &
        (df["name"].astype(str) == str(name))
    ]
    if matches.empty or "created_at" not in matches.columns:
        return None
    value = matches.iloc[-1]["created_at"]
    return str(value) if value else None


def journey_percent(baseline, current, target):
    """How far along the road from `baseline` to `target` you are, 0-100.

    Pure. No pandas, no database, no streamlit.

    A RATIO cannot express a goal that moves downward. `current / target` reports
    107% for an athlete cutting from 85kg toward 75kg who is standing at 80kg --
    clamped to 100%, the bar reads COMPLETE with five kilos still to lose. Flipping
    to `target / current` breaks the athlete who is bulking. The direction is not a
    property of the metric; it is a property of where they started.

    So measure the distance travelled as a fraction of the distance to travel:

        (current - baseline) / (target - baseline)

    Cutting 85 -> 75, standing at 80: (80-85)/(75-85) = 0.5 -> 50%.
    Bulking 70 -> 80, standing at 75: (75-70)/(80-70) = 0.5 -> 50%.
    Overshooting the target clamps to 100. Moving the wrong way clamps to 0.

    Returns None when the numbers cannot support an answer -- the caller shows
    "set a target" rather than a bar that means nothing.
    """
    try:
        baseline = float(baseline)
        current = float(current)
        target = float(target)
    except (TypeError, ValueError):
        return None

    span = target - baseline
    if span == 0:
        # Already standing on the target when it was set. Done, or never started.
        return 100.0 if current == target else 0.0

    percent = ((current - baseline) / span) * 100.0
    return max(0.0, min(100.0, percent))
