"""Identity for EvoForge.

Thin wrapper over Supabase Auth. Everything here exists so that queries carry
the user's JWT, which is the only reason Postgres RLS policies keyed on
`auth.uid()` actually isolate one user's body data from another's.

Two facts drive the design:

1. The JWT lives on the Supabase *client instance*, not in a global. So the
   client is stored per browser session (`data/supabase_client.py`) and must
   never be cached process-globally.

2. `st.context.cookies` is read-only -- Streamlit cannot set a cookie -- so a
   session cannot survive a page refresh. Refreshing signs the user out. The
   refresh token is deliberately NOT stashed in a query param: that would leak
   it into browser history and Referer headers.
"""

import streamlit as st

from data.supabase_client import get_supabase_client, reset_supabase_client

USER_KEY = "_auth_user"

# Password rules are enforced by Supabase too; checking here gives a better error.
MIN_PASSWORD_LENGTH = 8


def _friendly_error(exc):
    message = str(getattr(exc, "message", "") or exc)
    lowered = message.lower()
    if "invalid login credentials" in lowered:
        return "Incorrect email or password."
    if "email not confirmed" in lowered:
        return "Confirm your email address first — check your inbox."
    if "rate limit" in lowered or "too many requests" in lowered:
        return "Too many attempts. Wait a minute and try again."
    if "password should be" in lowered or "weak password" in lowered:
        return f"Password is too weak. Use at least {MIN_PASSWORD_LENGTH} characters."
    return message or "Authentication failed."


def _remember(user):
    st.session_state[USER_KEY] = {"id": str(user.id), "email": user.email or ""}


def current_user():
    """The signed-in user as {'id', 'email'}, or None."""
    return st.session_state.get(USER_KEY)


def current_user_id():
    user = current_user()
    return user["id"] if user else None


def current_user_email():
    user = current_user()
    return user["email"] if user else None


def is_signed_in():
    return current_user() is not None


def sign_in(email, password):
    """Returns (ok, error_message)."""
    client = get_supabase_client()
    if client is None:
        return False, "Supabase is not configured."

    try:
        response = client.auth.sign_in_with_password(
            {"email": email.strip(), "password": password}
        )
    except Exception as exc:
        return False, _friendly_error(exc)

    if not response.session or not response.user:
        return False, "Incorrect email or password."

    _remember(response.user)
    _clear_cached_data()
    return True, None


def sign_up(email, password):
    """Returns (ok, error_message, needs_email_confirmation).

    Supabase behaves differently depending on the project's email-confirmation
    setting, and both cases must be handled:

    - confirmations OFF -> a session comes back; the user is signed in now.
    - confirmations ON  -> a user comes back with no session; they must click
      the emailed link first.

    Supabase also returns a user with an empty `identities` list when the email
    is already registered, so that sign-up cannot be used to enumerate accounts.
    That is reported as "check your inbox" rather than "already registered" —
    do not change this to be more helpful.
    """
    client = get_supabase_client()
    if client is None:
        return False, "Supabase is not configured.", False

    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.", False

    try:
        response = client.auth.sign_up({"email": email.strip(), "password": password})
    except Exception as exc:
        return False, _friendly_error(exc), False

    if not response.user:
        return False, "Sign-up failed. Try again.", False

    if response.session:
        _remember(response.user)
        _clear_cached_data()
        return True, None, False

    return True, None, True


def sign_out():
    client = get_supabase_client()
    if client is not None:
        try:
            client.auth.sign_out()
        except Exception:
            # The local session is dropped below regardless: a failed network
            # call must never leave the browser session looking signed in.
            pass

    st.session_state.pop(USER_KEY, None)
    reset_supabase_client()
    _clear_cached_data()


def _clear_cached_data():
    """Drop every cached read so the next render cannot serve the last user's rows.

    `cached_sb_select` is `@st.cache_data`, which is process-global. Its key
    includes the user id, but the per-session snapshot does not — so both go.
    Imported lazily: `data.sb_ops` reads identity from this module.
    """
    from data.sb_ops import clear_data_cache

    clear_data_cache()
    for key in ("_fast_snapshot", "achievements_checked_this_session"):
        st.session_state.pop(key, None)
