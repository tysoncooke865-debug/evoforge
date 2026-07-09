import pandas as pd

from config.constants import BODYWEIGHT_FILE
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result
from data.csv_store import save_csv_backup


def load_bodyweight_log():
    return df_from_supabase("bodyweight_log", BODYWEIGHT_FILE, ["date", "bodyweight", "timestamp"])


def save_bodyweight_row(row):
    ok, err = sb_insert("bodyweight_log", row)
    store_supabase_result("bodyweight_log", ok, err)
    save_csv_backup(BODYWEIGHT_FILE, ["date", "bodyweight", "timestamp"], row=row)


def latest_bodyweight_value():
    bw_df = load_bodyweight_log()
    if bw_df.empty:
        return None
    bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
    valid = bw_df[bw_df["bodyweight"] > 0]
    if valid.empty:
        return None
    return float(valid.iloc[-1]["bodyweight"])


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
