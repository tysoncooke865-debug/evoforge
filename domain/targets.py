from datetime import datetime

import pandas as pd

from config.constants import TARGETS_FILE
from data.sb_ops import df_from_supabase, sb_insert, sb_delete_matching, store_supabase_result


def load_targets():
    columns = ["target_type", "name", "target_value", "unit", "created_at", "notes"]
    return df_from_supabase("targets", TARGETS_FILE, columns)


def save_or_update_target(target_type, name, target_value, unit, notes=""):
    df = load_targets()
    if not df.empty:
        df["target_type"] = df["target_type"].astype(str)
        df["name"] = df["name"].astype(str)
        df = df.loc[~((df["target_type"] == str(target_type)) & (df["name"] == str(name)))].copy()

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
    pd.concat([df, pd.DataFrame([new_row])], ignore_index=True).to_csv(TARGETS_FILE, index=False)


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
