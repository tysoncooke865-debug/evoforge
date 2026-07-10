"""The athlete's opt-in public identity: a display name and a visibility flag.

Stored in its own table (`migrations/004`), deliberately apart from `profile`, so
the leaderboard's cross-user read surface can never reach body data. See
`migrations/004_public_profile.sql`.

Correct on both sides of the migration: before `004` is applied, the reads return an
empty frame and the save returns `(False, err)`, and the UI treats both as "not live
yet". Nothing here blocks onboarding or sign-in.
"""
from datetime import datetime

from data.sb_ops import df_from_supabase, sb_rpc, sb_upsert, store_supabase_result

NAME_MIN, NAME_MAX = 3, 24


def leaderboard_top(n=50):
    """The public ranking: a list of `{display_name, xp, base_level, position}`.

    Reads `public.leaderboard_top()` (migrations/005), the ONE surface that crosses
    users -- and it returns four columns, never body data. Returns `[]` on any
    failure, including before 005 is applied, so `views/leaderboard.py` shows a
    "warming up" state rather than crashing. The display LEVEL is computed by the
    caller from `base_level` + `xp` via `domain/xp.py`, keeping the curve in one place.
    """
    data, err = sb_rpc("leaderboard_top", {"n": int(n)})
    if err or not isinstance(data, list):
        return []
    return data


def load_public_profile():
    """This user's row as a DataFrame (0 or 1 rows). RLS scopes it to the caller."""
    return df_from_supabase("public_profile", ["display_name", "is_public", "updated_at"])


def get_public_identity():
    """`(display_name, is_public)` for the signed-in user. `(None, False)` if unset."""
    df = load_public_profile()
    if df.empty:
        return None, False
    row = df.iloc[-1]
    name = row.get("display_name")
    name = str(name) if name is not None and str(name).strip() else None
    return name, bool(row.get("is_public"))


def name_error(display_name):
    """Why a name is invalid, or None if it is fine. Pure -- pinned by tools/."""
    if display_name is None:
        return None  # clearing the name is allowed
    name = str(display_name).strip()
    if name == "":
        return None
    if len(name) < NAME_MIN or len(name) > NAME_MAX:
        return f"Display name must be {NAME_MIN}–{NAME_MAX} characters."
    return None


def save_public_profile(display_name, is_public):
    """Upsert the caller's public identity. Returns (ok, error_message).

    The database enforces the length bound and case-insensitive uniqueness; this
    surfaces the taken-name collision as a friendly message rather than a raw error.
    """
    problem = name_error(display_name)
    if problem:
        return False, problem

    name = str(display_name).strip() if display_name and str(display_name).strip() else None

    # Cannot be public without a name to show.
    is_public = bool(is_public) and name is not None

    row = {
        "display_name": name,
        "is_public": is_public,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    ok, err = sb_upsert("public_profile", row, on_conflict="user_id")
    if not ok and err and ("duplicate" in err.lower() or "unique" in err.lower()):
        err = "That display name is already taken."
    store_supabase_result("public_profile", ok, err)
    return ok, err
