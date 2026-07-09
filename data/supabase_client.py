import os

import streamlit as st
from supabase import create_client


def get_supabase_client():
    try:
        url = st.secrets.get("SUPABASE_URL", None)
        key = st.secrets.get("SUPABASE_KEY", None)
    except Exception:
        url, key = None, None

    url = url or os.getenv("SUPABASE_URL")
    key = key or os.getenv("SUPABASE_KEY")

    if not url or not key:
        return None

    try:
        return create_client(url, key)
    except Exception:
        return None


def supabase_enabled():
    return get_supabase_client() is not None
