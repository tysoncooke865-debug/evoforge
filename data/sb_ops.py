import json
import math
from datetime import date, datetime

import pandas as pd
import streamlit as st

from config.constants import SUPABASE_TABLE_SCHEMAS
from data.supabase_client import get_supabase_client


def clear_data_cache():
    """Invalidate every read-through cache after a write. All THREE of them.

    `cached_sb_select` is an `st.cache_data` and clearing it is obvious. The others
    are not, and all live in `st.session_state`:

      * `ui/components.py :: get_fast_snapshot()` -- `df` + `summary`, read by Home,
        the sidebar and the stat panels.
      * `ui/render_memo.py :: avatar_stats()` -- the athlete's level, branch, rarity
        and body scores.
      * `_df_memo` -- every DataFrame built by `df_from_supabase` this render.

    Nothing invalidated the first on write. It was cleared only on sign-out. So
    logging a set stored the row, minted the XP grant -- and then every surface kept
    rendering the summary computed before the set existed. The XP was correct in the
    database and stale on the screen for the rest of the session. Cache invalidation
    belongs where the write is, not where the reader hopes.

    Add a fourth cache and you must clear it here too.
    """
    try:
        cached_sb_select.clear()
    except Exception:
        pass

    for key in ("_fast_snapshot", "_avatar_stats_snapshot", DF_MEMO_KEY):
        try:
            st.session_state.pop(key, None)
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


def sb_rpc(fn_name, params=None):
    """Call a Postgres function (RPC). Returns (data, None) or (None, error).

    The read-only counterpart to `sb_select` for aggregates that must not be paged
    to the client -- `xp_total()` sums a user's whole ledger in Postgres, so a
    million events cost one scalar round trip instead of 2500 rows and a wrong total.

    Like every other seam here it returns `(None, msg)` rather than raising, so a
    caller on the wrong side of a migration (the function does not exist yet) simply
    falls back. `ledger_xp()` depends on that: None means "use derived", never 0.
    """
    sb = get_supabase_client()
    if sb is None:
        return None, "Supabase not configured"
    try:
        res = sb.rpc(fn_name, params or {}).execute()
        return res.data, None
    except Exception as e:
        return None, str(e)


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


def sb_upsert(table_name, row, on_conflict):
    """Insert or update on a conflict column. Returns (True, None) or (False, err).

    `public_profile` is keyed on `user_id` (the PK, filled by DEFAULT auth.uid()), so
    a second save must UPDATE, not INSERT -- a plain insert would violate the PK. No
    upsert helper existed before this; `sb_insert` would fail on the second save.

    `on_conflict` names the conflict target column(s), e.g. "user_id".
    """
    sb = get_supabase_client()
    if sb is None:
        return False, "Supabase not configured"

    clean = clean_supabase_row(row, table_name)
    try:
        sb.table(table_name).upsert(clean, on_conflict=on_conflict).execute()
        clear_data_cache()
        return True, None
    except Exception as e:
        return False, str(e)


def sb_insert_many(table_name, rows):
    """Insert several rows in ONE round trip, then invalidate the caches ONCE.

    `check_achievements()` used to call `sb_insert` per newly-earned achievement,
    and every `sb_insert` calls `clear_data_cache()`. Unlocking three achievements
    on one set meant three inserts, three cache wipes, and -- because the wipe
    happened *inside* the loop -- a fresh network read of the achievements table
    between each one.

    `user_id` is absent from every row: Postgres fills it from `DEFAULT auth.uid()`.
    """
    if not rows:
        return True, None

    sb = get_supabase_client()
    if sb is None:
        return False, "Supabase not configured"

    clean = [clean_supabase_row(row, table_name) for row in rows]
    try:
        sb.table(table_name).insert(clean).execute()
        clear_data_cache()
        return True, None
    except Exception as e:
        return False, str(e)


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


DF_MEMO_KEY = "_df_memo"


def _df_memo_get(key):
    """A built DataFrame from this render, or None.

    `cached_sb_select` caches the ROWS, so the network is cheap. Nothing cached the
    FRAME, so every caller paid `pd.DataFrame(...)` + sort + drop_duplicates again.
    One Home render rebuilt the workout log ten times over.

    ###################################################################
    #  This memo lives in st.session_state -- PER SESSION.            #
    #  Never move it to st.cache_data: that cache is process-global    #
    #  and Streamlit Cloud multiplexes users into one process. It      #
    #  would serve one athlete's rows to the next. verify_isolation.py #
    ###################################################################

    Returns None outside a Streamlit runtime (bare-mode scripts and tools), where
    there is no session to scope a memo to.
    """
    try:
        return st.session_state.get(DF_MEMO_KEY, {}).get(key)
    except Exception:
        return None


def _df_memo_put(key, df):
    try:
        st.session_state.setdefault(DF_MEMO_KEY, {})[key] = df
    except Exception:
        pass


def df_from_supabase(table_name, columns):
    """Read a table into a DataFrame. Supabase is the only source of truth.

    On error, surfaces the message and returns an EMPTY frame with the expected
    columns. It must never fall back to a local file: on Streamlit Cloud the disk
    is ephemeral and shared by every visitor, so stale local rows would be served
    across users.

    Memoised for the duration of a render. Callers mutate what they get back
    (`normalise_workout_log` assigns columns, `workout_summary` coerces dtypes), so
    the memo hands out a `.copy()` -- copying a frame is far cheaper than rebuilding,
    sorting and de-duplicating it, and a shared frame would let one caller's
    coercion corrupt the next caller's read.
    """
    memo_key = (table_name, tuple(columns))
    memoised = _df_memo_get(memo_key)
    if memoised is not None:
        return memoised.copy()

    data, err = sb_select(table_name)
    if data is None:
        st.session_state["last_supabase_error"] = f"{table_name} read failed: {err}"
        # Deliberately NOT memoised. A failed read must not pin an empty frame for
        # the rest of the render -- the next caller should get a chance to retry.
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

    _df_memo_put(memo_key, df)
    return df.copy()


def store_supabase_result(table_name, ok, err):
    if ok:
        st.session_state["last_supabase_write"] = f"Saved to Supabase: {table_name}"
        st.session_state["last_supabase_error"] = ""
    else:
        st.session_state["last_supabase_error"] = f"{table_name} insert failed: {err}"
