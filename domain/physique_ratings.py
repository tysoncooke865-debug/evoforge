import json
import math

import pandas as pd

from config.constants import PHYSIQUE_RATING_FILE
from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result
from data.csv_store import save_csv_backup


def score_0_100(value, low, high):
    try:
        value = float(value)
        if high <= low:
            return 0
        return int(max(0, min(((value - low) / (high - low)) * 100, 100)))
    except Exception:
        return 0


def safe_num(value, default=0.0):
    try:
        if value is None:
            return default
        value = float(value)
        if math.isnan(value) or math.isinf(value):
            return default
        return value
    except Exception:
        return default


def _as_display_text(value):
    """Flatten a weak_points/improvements cell to a single string.

    Supabase returns these jsonb columns as Python lists; the CSV fallback
    stores them as JSON strings. Mixing both in one column makes pyarrow
    (and therefore st.dataframe) raise. Normalise on read.
    """
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return value
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value)


def load_physique_ratings():
    columns = ["date", "physique_score", "leanness_score", "symmetry_score",
               "muscularity_score", "confidence", "weak_points", "improvements",
               "summary", "timestamp"]
    df = df_from_supabase("physique_ratings", PHYSIQUE_RATING_FILE, columns)
    for col in ("weak_points", "improvements"):
        if col in df.columns:
            df[col] = df[col].map(_as_display_text)
    return df


def save_physique_rating(row):
    ok, err = sb_insert("physique_ratings", row)
    store_supabase_result("physique_ratings", ok, err)
    save_csv_backup(
        PHYSIQUE_RATING_FILE,
        ["date", "physique_score", "leanness_score", "symmetry_score",
         "muscularity_score", "confidence", "weak_points", "improvements",
         "summary", "timestamp"],
        row=row,
    )


def latest_physique_rating_values():
    ratings = load_physique_ratings()
    if ratings.empty:
        return {"physique_score": None, "leanness_score": None, "symmetry_score": None, "muscularity_score": None}
    row = ratings.iloc[-1]
    out = {}
    for key in ["physique_score", "leanness_score", "symmetry_score", "muscularity_score"]:
        try:
            val = pd.to_numeric(row.get(key, None), errors="coerce")
            if pd.isna(val):
                val = None
        except Exception:
            val = None
        out[key] = val
    return out
