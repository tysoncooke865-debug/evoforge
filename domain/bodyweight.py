import pandas as pd

from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result


def load_bodyweight_log():
    return df_from_supabase("bodyweight_log", ["date", "bodyweight", "timestamp"])


def save_bodyweight_row(row):
    ok, err = sb_insert("bodyweight_log", row)
    store_supabase_result("bodyweight_log", ok, err)


def latest_bodyweight_value():
    bw_df = load_bodyweight_log()
    if bw_df.empty:
        return None
    bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
    valid = bw_df[bw_df["bodyweight"] > 0]
    if valid.empty:
        return None
    return float(valid.iloc[-1]["bodyweight"])


def bodyweight_at(when=None):
    """Bodyweight as of `when` -- the last reading on or before it.

    This is the baseline a journey bar measures from: what the athlete weighed when
    they set the goal. Falls back to the earliest reading when the target predates
    every weigh-in, because "the first thing we know about you" is the only honest
    starting point available.

    `when` is an ISO string or None. None means "the earliest reading".
    """
    bw_df = load_bodyweight_log()
    if bw_df.empty:
        return None

    bw_df = bw_df.copy()
    bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
    valid = bw_df[bw_df["bodyweight"] > 0]
    if valid.empty:
        return None

    if when:
        # `df_from_supabase` has already sorted ascending, so the last row at or
        # before `when` is the reading that was current when the target was set.
        stamps = valid["timestamp"].astype(str)
        if not stamps.notna().any():
            stamps = valid["date"].astype(str)
        earlier = valid[stamps <= str(when)]
        if not earlier.empty:
            return float(earlier.iloc[-1]["bodyweight"])

    return float(valid.iloc[0]["bodyweight"])


def get_bodyweight_stats():
    bw_df = load_bodyweight_log()
    if bw_df.empty:
        return {"latest": None, "min": None, "max": None, "count": 0}
    bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
    valid = bw_df[bw_df["bodyweight"] > 0]
    if valid.empty:
        return {"latest": None, "min": None, "max": None, "count": 0}
    return {
        "latest": float(valid.iloc[-1]["bodyweight"]),
        "min": float(valid["bodyweight"].min()),
        "max": float(valid["bodyweight"].max()),
        "count": len(valid),
    }
