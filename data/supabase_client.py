import os

import streamlit as st
from supabase import create_client

_SESSION_CLIENT_KEY = "_sb_client"


def _credentials():
    try:
        url = st.secrets.get("SUPABASE_URL", None)
        key = st.secrets.get("SUPABASE_KEY", None)
    except Exception:
        url, key = None, None

    return url or os.getenv("SUPABASE_URL"), key or os.getenv("SUPABASE_KEY")


def _new_client():
    url, key = _credentials()
    if not url or not key:
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


def get_supabase_client():
    """Return this browser session's Supabase client, creating it on first use.

    The signed-in user's JWT lives ON the client instance: `Client.postgrest`
    builds every request with `session.access_token if session else
    self.supabase_key`. So only the client that called `sign_in_with_password`
    runs queries as that user, and RLS policies keyed on `auth.uid()` only bite
    when we hand that same client to every later query in the session.

    NEVER wrap this in `@st.cache_resource`. That cache is process-global and
    would hand one user's JWT to the next visitor.
    """
    try:
        client = st.session_state.get(_SESSION_CLIENT_KEY)
        if client is not None:
            return client
        client = _new_client()
        if client is not None:
            st.session_state[_SESSION_CLIENT_KEY] = client
        return client
    except Exception:
        # No ScriptRunContext (bare mode, scripts, tests): fall back to an
        # unshared client rather than crashing.
        return _new_client()


def reset_supabase_client():
    """Drop the session's client so the next call builds a fresh anonymous one.

    Called on sign-out. Signing out on the old client is not enough by itself:
    a stale instance in session_state would keep serving the previous identity.
    """
    try:
        st.session_state.pop(_SESSION_CLIENT_KEY, None)
    except Exception:
        pass


def supabase_enabled():
    return get_supabase_client() is not None
