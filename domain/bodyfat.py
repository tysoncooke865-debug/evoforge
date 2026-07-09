import math

import pandas as pd

from config.constants import BODYFAT_FILE
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result
from data.csv_store import save_csv_backup


def navy_body_fat_male(height_cm, waist_cm, neck_cm):
    """US Navy male body fat estimate. Uses inches internally. Returns None for invalid inputs."""
    try:
        height_in = float(height_cm) / 2.54
        waist_in = float(waist_cm) / 2.54
        neck_in = float(neck_cm) / 2.54
        if height_in <= 0 or neck_in <= 0 or waist_in <= neck_in:
            return None
        return 86.010 * math.log10(waist_in - neck_in) - 70.041 * math.log10(height_in) + 36.76
    except Exception:
        return None


def load_bodyfat_log():
    columns = [
        "date", "method", "bodyweight", "height_cm", "waist_cm", "neck_cm",
        "bf_low", "bf_high", "bf_mid", "confidence", "notes", "timestamp"
    ]
    return df_from_supabase("bodyfat_log", BODYFAT_FILE, columns)


def save_bodyfat_estimate(row):
    ok, err = sb_insert("bodyfat_log", row)
    store_supabase_result("bodyfat_log", ok, err)
    save_csv_backup(
        BODYFAT_FILE,
        [
            "date", "method", "bodyweight", "height_cm", "waist_cm", "neck_cm",
            "bf_low", "bf_high", "bf_mid", "confidence", "notes", "timestamp"
        ],
        row=row,
    )


def bodyfat_outputs(weight_kg, bf_percent, target_bf=10.0):
    try:
        weight_kg = float(weight_kg)
        bf_percent = float(bf_percent)
        target_bf = float(target_bf)
        if weight_kg <= 0 or bf_percent <= 0 or target_bf <= 0 or target_bf >= 100:
            return None, None, None, None
        fat_mass = weight_kg * (bf_percent / 100)
        lean_mass = weight_kg - fat_mass
        target_weight = lean_mass / (1 - target_bf / 100)
        fat_to_lose = max(weight_kg - target_weight, 0)
        return fat_mass, lean_mass, target_weight, fat_to_lose
    except Exception:
        return None, None, None, None


def safe_kg(value):
    if value is None:
        return "No data"
    try:
        return f"{float(value):.1f}kg"
    except Exception:
        return "No data"


def get_bodyfat_stats():
    bf_df = load_bodyfat_log()
    if bf_df.empty:
        return {"latest": None, "min": None, "count": 0}
    bf_df["bf_mid"] = pd.to_numeric(bf_df["bf_mid"], errors="coerce").fillna(0)
    valid = bf_df[bf_df["bf_mid"] > 0]
    if valid.empty:
        return {"latest": None, "min": None, "count": 0}
    return {
        "latest": float(valid.iloc[-1]["bf_mid"]),
        "min": float(valid["bf_mid"].min()),
        "count": len(valid),
    }


def latest_bodyfat_mid():
    bf_df = load_bodyfat_log()
    if bf_df.empty:
        return None
    bf_df["bf_mid"] = pd.to_numeric(bf_df["bf_mid"], errors="coerce").fillna(0)
    valid = bf_df[bf_df["bf_mid"] > 0]
    if valid.empty:
        return None
    return float(valid.iloc[-1]["bf_mid"])
