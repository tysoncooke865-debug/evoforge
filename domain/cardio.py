import math
from datetime import date, datetime

import pandas as pd

from config.constants import CARDIO_FILE
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result
from data.csv_store import save_csv_backup


def load_cardio_log():
    return df_from_supabase("cardio_log", CARDIO_FILE, ["date", "type", "minutes", "distance_km", "incline", "speed", "calories", "notes", "timestamp"])


def safe_float(value, default=0.0):
    try:
        if value is None:
            return default
        if isinstance(value, str) and value.strip() == "":
            return default
        value = float(value)
        if math.isnan(value) or math.isinf(value):
            return default
        return value
    except Exception:
        return default


def save_cardio_row(row):
    clean_row = {
        "date": str(row.get("date", date.today())),
        "type": str(row.get("type", row.get("cardio_type", "")) or ""),
        "minutes": safe_float(row.get("minutes", 0)),
        "distance_km": safe_float(row.get("distance_km", 0)),
        "incline": safe_float(row.get("incline", 0)),
        "speed": safe_float(row.get("speed", 0)),
        "calories": safe_float(row.get("calories", 0)),
        "notes": str(row.get("notes", "") or ""),
        "timestamp": str(row.get("timestamp", datetime.now().isoformat(timespec="seconds"))),
    }

    ok, err = sb_insert("cardio_log", clean_row)

    # If your Supabase table uses cardio_type instead of type, retry automatically.
    if not ok and ("type" in str(err).lower() or "column" in str(err).lower() or "schema cache" in str(err).lower()):
        retry_row = clean_row.copy()
        retry_row["cardio_type"] = retry_row.pop("type")
        ok, err = sb_insert("cardio_log", retry_row)

    store_supabase_result("cardio_log", ok, err)
    save_csv_backup(
        CARDIO_FILE,
        ["date", "type", "minutes", "distance_km", "incline", "speed", "calories", "notes", "timestamp"],
        row=clean_row
    )


def get_cardio_stats():
    cardio = load_cardio_log()
    if cardio.empty:
        return {"minutes": 0, "distance": 0, "count": 0, "types": set()}
    cardio["minutes"] = pd.to_numeric(cardio.get("minutes", 0), errors="coerce").fillna(0)
    cardio["distance_km"] = pd.to_numeric(cardio.get("distance_km", 0), errors="coerce").fillna(0)
    return {
        "minutes": float(cardio["minutes"].sum()),
        "distance": float(cardio["distance_km"].sum()),
        "count": len(cardio),
        "types": set(cardio.get("type", pd.Series(dtype=str)).dropna().astype(str).tolist()),
    }
