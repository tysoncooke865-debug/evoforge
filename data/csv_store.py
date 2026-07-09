from pathlib import Path

import pandas as pd
import streamlit as st

from config.constants import CACHE_TTL_SECONDS


def _cache_key_for_path(path):
    try:
        p = Path(path)
        if p.exists():
            return f"{p}:{p.stat().st_mtime_ns}:{p.stat().st_size}"
        return f"{p}:missing"
    except Exception:
        return str(path)


@st.cache_data(ttl=CACHE_TTL_SECONDS, show_spinner=False)
def cached_read_csv_file(path, key=None):
    try:
        p = Path(path)
        if p.exists():
            return pd.read_csv(p)
    except Exception:
        pass
    return pd.DataFrame()


@st.cache_data(ttl=20, show_spinner=False)
def cached_csv_read(path_str, columns_tuple, modified_time):
    path = Path(path_str)
    columns = list(columns_tuple)
    if path.exists():
        try:
            df = pd.read_csv(path)
            for col in columns:
                if col not in df.columns:
                    df[col] = ""
            return df
        except Exception:
            return pd.DataFrame(columns=columns)
    return pd.DataFrame(columns=columns)


def load_csv(path, columns):
    try:
        modified_time = path.stat().st_mtime if path.exists() else 0
    except Exception:
        modified_time = 0
    return cached_csv_read(str(path), tuple(columns), modified_time).copy()


def save_csv_backup(path, columns, row=None, df=None):
    from data.sb_ops import clear_data_cache

    current = load_csv(path, columns)
    if df is not None:
        df.to_csv(path, index=False)
        clear_data_cache()
        return
    if row is not None:
        pd.concat([current, pd.DataFrame([row])], ignore_index=True).to_csv(path, index=False)
        clear_data_cache()
