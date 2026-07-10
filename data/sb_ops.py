import json
import math
from datetime import date, datetime

import pandas as pd
import streamlit as st

from config.constants import SUPABASE_TABLE_SCHEMAS
from data.supabase_client import get_supabase_client


def clear_data_cache():
    """Invalidate every read-through cache after a write. Both of them.

    `cached_sb_select` is an `st.cache_data` and clearing it is obvious. The other
    one is not: `ui/components.py :: get_fast_snapshot()` memoises `df` + `summary`
    into `st.session_state["_fast_snapshot"]`, which Home, the sidebar and the
    stat panels all read.

    Nothing invalidated it on write. It was cleared only on sign-out. So logging a
    set stored the row, minted the XP grant -- and then every surface kept rendering
    the summary computed before the set existed. The XP was correct in the database
    and stale on the screen for the rest of the session. Cache invalidation belongs
    where the write is, not where the reader hopes.
    """
    try:
        cached_sb_select.clear()
    except Exception:
        pass

    try:
        st.session_state.pop("_fast_snapshot", None)
    except Exception:
        pass


def is_bad_number(v):
    try:
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return True
    except Exception:
        pass
    return False


def json_safe_value(v):
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass

    if hasattr(v, "item"):
        try:
            v = v.item()
        except Exception:
            pass

    if isinstance(v, (pd.Timestamp, datetime, date)):
        return str(v)

    if is_bad_number(v):
        return None

    if isinstance(v, dict):
        return {str(k): json_safe_value(val) for k, val in v.items() if json_safe_value(val) is not None}

    if isinstance(v, list):
        return [json_safe_value(x) for x in v if json_safe_value(x) is not None]

    return v


def json_safe_record(record):
    clean = {}
    for k, v in dict(record).items():
        safe_v = json_safe_value(v)
        if safe_v is not None:
            clean[k] = safe_v
    return clean


def json_safe_records(records):
    return [json_safe_record(r) for r in records]


def clean_supabase_value(v):
    return json_safe_value(v)


def clean_supabase_row(row, table_name):
    allowed = SUPABASE_TABLE_SCHEMAS.get(table_name, list(row.keys()))
    filtered = {}

    for k in allowed:
        if k not in row:
            continue
        filtered[k] = row.get(k)

    clean = json_safe_record(filtered)

    # jsonb columns: accept stringified JSON or Python lists
    if table_name == "physique_ratings":
        for key in ["weak_points", "improvements"]:
            if isinstance(clean.get(key), str):
                try:
                    clean[key] = json.loads(clean[key])
                except Exception:
                    # Keep as a simple list if Supabase jsonb rejects string
                    clean[key] = [clean[key]]

    return clean


@st.cache_data(ttl=20, show_spinner=False)
def cached_sb_select(_sb, table_name, user_id, limit_rows=2500):
    """Cached table read.

    `st.cache_data` is PROCESS-GLOBAL, shared by every browser session. `user_id`
    is therefore part of the key: without it, one user's rows are served to the
    next. `_sb` is underscore-prefixed so Streamlit excludes it from the hash --
    the client is unhashable and differs per session, but the rows it returns are
    fully determined by (table_name, user_id).

    Row filtering itself is Postgres's job, not this function's: RLS restricts
    the result to `user_id = auth.uid()`. `user_id` here only keys the cache.
    """
    if _sb is None:
        return None, "Supabase not configured"

    try:
        # Most recent rows first where timestamp/created_at exists.
        try:
            res = _sb.table(table_name).select("*").order("timestamp", desc=True).limit(limit_rows).execute()
        except Exception:
            try:
                res = _sb.table(table_name).select("*").order("created_at", desc=True).limit(limit_rows).execute()
            except Exception:
                res = _sb.table(table_name).select("*").limit(limit_rows).execute()
        return res.data or [], None
    except Exception as e:
        return None, str(e)


def sb_select(table_name):
    from auth.session import current_user_id

    return cached_sb_select(get_supabase_client(), table_name, current_user_id())


def sb_insert(table_name, row, show_error=False):
    sb = get_supabase_client()
    if sb is None:
        msg = "Supabase not configured. Check SUPABASE_URL and SUPABASE_KEY in Streamlit Secrets."
        if show_error:
            st.error(msg)
        return False, msg

    clean = clean_supabase_row(row, table_name)

    try:
        res = sb.table(table_name).insert(clean).execute()
        clear_data_cache()
        if show_error:
            st.success(f"✅ Insert succeeded: {table_name}")
            try:
                st.json(res.data)
            except Exception:
                st.write(res)
        return True, None

    except Exception as e:
        msg = str(e)
        if show_error:
            st.error(f"❌ Insert failed: {table_name}")
            st.code(msg)
            st.write("Attempted JSON-safe row:")
            st.json(clean)
        return False, msg


def sb_insert_returning(table_name, row):
    """Insert and hand back the stored row, so the caller can read its `id`.

    `sb_insert` discards `res.data`. The XP ledger needs the new row's primary key
    to use as `xp_events.source_id` -- that is what makes a grant idempotent, via
    the partial unique index on (user_id, source_table, source_id).

    Returns (row_dict, None) or (None, error_message).
    """
    sb = get_supabase_client()
    if sb is None:
        return None, "Supabase not configured"

    clean = clean_supabase_row(row, table_name)
    try:
        res = sb.table(table_name).insert(clean).execute()
        clear_data_cache()
        data = res.data or []
        return (data[0] if data else None), None
    except Exception as e:
        return None, str(e)


def sb_update_by_id(table_name, row_id, patch):
    """Update one row, identified by primary key, leaving its `id` intact.

    Editing a row must not change its identity. `save_set_auto` used to delete and
    re-insert, which minted a fresh uuid; once xp_events keys a grant to
    `workout_log.id`, that would either mint a second grant for the same set or
    strand the first one against a deleted row. Neither survives the migration's
    STEP 4 reconciliation. Update in place instead.

    Under RLS this touches only the caller's own row.
    """
    sb = get_supabase_client()
    if sb is None:
        return False, "Supabase not configured"

    clean = clean_supabase_row(patch, table_name)
    try:
        sb.table(table_name).update(clean).eq("id", row_id).execute()
        clear_data_cache()
        return True, None
    except Exception as e:
        return False, str(e)


def sb_delete_matching(table_name, filters):
    sb = get_supabase_client()
    if sb is None:
        return False, "Supabase not configured"

    try:
        query = sb.table(table_name).delete()
        for k, v in filters.items():
            query = query.eq(k, v)
        query.execute()
        clear_data_cache()
        return True, None
    except Exception as e:
        return False, str(e)


def sb_delete_all(table_name):
    """Delete every row this client is allowed to see.

    PostgREST refuses an unfiltered DELETE, so a match-everything filter is
    required. It must be `id is not null`, not a `neq` against the first schema
    column: that column is `date` or `numeric` on 8 of the 11 tables, and
    comparing it to a sentinel string raises `invalid input syntax for type
    date`. `id` is the primary key on every table, so `not.is.null` matches all
    rows and is type-agnostic.

    Under RLS this deletes only the caller's own rows -- the policy filters the
    DELETE the same way it filters a SELECT.
    """
    sb = get_supabase_client()
    if sb is None:
        return False, "Supabase not configured"

    try:
        sb.table(table_name).delete().not_.is_("id", "null").execute()
        clear_data_cache()
        return True, None
    except Exception as e:
        return False, str(e)


def df_from_supabase(table_name, columns):
    """Read a table into a DataFrame. Supabase is the only source of truth.

    On error, surfaces the message and returns an EMPTY frame with the expected
    columns. It must never fall back to a local file: on Streamlit Cloud the disk
    is ephemeral and shared by every visitor, so stale local rows would be served
    across users.
    """
    data, err = sb_select(table_name)
    if data is None:
        st.session_state["last_supabase_error"] = f"{table_name} read failed: {err}"
        return pd.DataFrame(columns=columns)

    df = pd.DataFrame(data)
    for col in columns:
        if col not in df.columns:
            df[col] = ""

    # cached_sb_select orders DESCENDING (newest first) so that `limit` keeps the
    # most recent rows. But every consumer reads `.iloc[-1]` to mean "the latest
    # record" -- latest_bodyweight_value, get_base_level, latest_measurements,
    # latest_bodyfat_mid, latest_physique_rating_values, views/profile.py ...
    # On a descending frame `.iloc[-1]` is the OLDEST row. Flip to ascending here,
    # once, so `.iloc[-1]` means what all of them already assume it means.
    if not df.empty:
        for sort_col in ("timestamp", "created_at", "date"):
            if sort_col in df.columns and df[sort_col].notna().any():
                df = df.sort_values(sort_col, ascending=True, kind="stable").reset_index(drop=True)
                break

    # For workout logs, de-dupe early to reduce downstream workload.
    if table_name == "workout_log" and not df.empty:
        if "set" in df.columns:
            df["set"] = pd.to_numeric(df["set"], errors="coerce").fillna(0).astype(int)
        possible = [c for c in ["date", "workout", "exercise", "set"] if c in df.columns]
        if len(possible) == 4:
            sort_col = "timestamp" if "timestamp" in df.columns else possible[0]
            df = df.sort_values(sort_col, ascending=True).drop_duplicates(
                subset=possible,
                keep="last"
            ).reset_index(drop=True)
    return df


def store_supabase_result(table_name, ok, err):
    if ok:
        st.session_state["last_supabase_write"] = f"Saved to Supabase: {table_name}"
        st.session_state["last_supabase_error"] = ""
    else:
        st.session_state["last_supabase_error"] = f"{table_name} insert failed: {err}"
