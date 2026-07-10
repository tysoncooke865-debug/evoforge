"""Compute the expensive derived stats once per render, not once per caller.

`domain/avatar_stats.py :: calculate_avatar_stats()` reads the whole workout log,
summarises it, builds a muscle heat map and resolves four 1RMs -- roughly eleven
DataFrame rebuilds. It was called TWICE on every page: once by the sidebar
(`ui/nav.py`) and once by the page body, each discarding the other's answer.

The memo lives in `st.session_state`, NOT in `st.cache_data`.

    #########################################################################
    #  st.cache_data and st.cache_resource are PROCESS-GLOBAL, and          #
    #  Streamlit Cloud multiplexes every browser session into one process.  #
    #  A global cache of one athlete's level, branch and body scores is a   #
    #  cross-user leak. See tools/verify_isolation.py.                      #
    #########################################################################

Session state is per-session, so there is nothing to key and nothing to leak. The
memo is dropped by `data/sb_ops.py :: clear_data_cache()` (every write) and by
`auth/session.py :: _clear_cached_data()` (sign-out). Miss the second and the next
person to sign in on this browser inherits the previous user's character.

This module lives in `ui/` on purpose: `domain/` must stay free of `streamlit`
imports (task T6, the seam a future FastAPI backend reuses).
"""
import streamlit as st

from domain.avatar_stats import calculate_avatar_stats

SNAPSHOT_KEY = "_avatar_stats_snapshot"


def avatar_stats():
    """This render's avatar stats. Computed on first call, reused after.

    Returns a SHALLOW COPY: `views/avatar.py` overwrites `character_class`,
    `build_type`, `weak_point_focus` and `ai_summary` in place after an AI run. A
    caller mutating the memo would poison every later reader in the same render.

    Falls back to a direct computation when there is no Streamlit runtime, so the
    bare-mode tools (`tools/verify_ordering.py`) keep working. Same shape as
    `data/supabase_client.py :: get_supabase_client()`.
    """
    try:
        cached = st.session_state.get(SNAPSHOT_KEY)
        if cached is not None:
            return dict(cached)

        stats = calculate_avatar_stats()
        st.session_state[SNAPSHOT_KEY] = stats
        return dict(stats)
    except Exception:
        # No ScriptRunContext (scripts, tests). Compute, do not cache.
        return calculate_avatar_stats()
