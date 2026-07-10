"""Keep the athlete signed in across a page refresh, without leaking their token.

`st.session_state` dies when the browser reconnects, and `st.context.cookies` is
read-only, so nothing durable survives. A cookie component can write one.

WHAT IS STORED
    The Supabase REFRESH token, and nothing else. Never the access token: it is a
    bearer JWT usable directly against the API, and `refresh_session()` mints a fresh
    one on every restore anyway. The cookie is `Secure`, `SameSite=Lax`, 30 days.

    ####################################################################
    #  The cookie is JS-READABLE. Streamlit components cannot set      #
    #  HttpOnly. An HTML injection therefore reads it. That is why     #
    #  `ui/escape.py` and `tools/verify_escape.py` landed FIRST.       #
    ####################################################################

ROTATION -- THE BUG THIS FEATURE USUALLY SHIPS WITH
    Supabase issues a NEW refresh token on every `refresh_session()` and may
    invalidate the old one at once. Fail to overwrite the cookie and the next visit
    presents a dead token: the athlete is signed out *intermittently*, succeeding on
    the first reopen and failing on the second. Every successful auth call writes the
    cookie, through the single `persist_session()` below.

WHAT THE COMPONENT ACTUALLY DOES (measured, not assumed)
    * `get_all()` returns `{}` on the first ~2 script runs, before its iframe reports.
    * A genuinely cookie-less browser still returns `_streamlit_xsrf`, which Streamlit
      always sets. So an EMPTY dict means "not asked yet", and a non-empty dict without
      our key means "no cookie". That distinction is what makes the wait terminate.
    * A cookie written this run is NOT readable this run.

FAILING SAFE
    Every path out of here that cannot restore a session leaves `_auth_user` unset, so
    `app.py`'s gate renders the login screen -- exactly today's behaviour. A revoked,
    expired or corrupt token deletes the cookie so it is not retried on every load.
"""
import datetime

import streamlit as st

COOKIE_NAME = "ef_rt"
COOKIE_DAYS = 30

# The component needs a couple of runs before its iframe answers. Past this we stop
# waiting and treat the visitor as signed out rather than spinning forever.
MAX_COOKIE_WAITS = 3
WAIT_KEY = "_cookie_waits"
MANAGER_KEY = "_cookie_manager"


def _cookie_manager():
    """One CookieManager per session, or None if one cannot exist.

    Reading twice from one manager is a documented trap, hence the per-session reuse.

    Returns None outside a real browser -- `AppTest` (every tool in `tools/`) and bare
    scripts have no frontend to host the component's iframe. Persistence then does
    nothing at all, which is precisely right: those environments seed `_auth_user`
    directly and must not depend on a cookie.
    """
    try:
        manager = st.session_state.get(MANAGER_KEY)
        if manager is None:
            import extra_streamlit_components as stx

            manager = stx.CookieManager(key="ef_cookie_manager")
            st.session_state[MANAGER_KEY] = manager
        return manager
    except Exception:
        return None


def _secure_cookie():
    """`Secure` in production; off on a local HTTP dev server, which would drop it."""
    try:
        host = (st.context.headers.get("host") or "").lower()
    except Exception:
        return True
    return not (host.startswith("localhost") or host.startswith("127.0.0.1"))


def persist_session(session):
    """Write the refresh token. Call after EVERY successful auth: sign in, sign up, restore.

    This is the rotation fix. `session` is a `supabase_auth.types.Session`.
    """
    token = getattr(session, "refresh_token", None)
    if not token:
        return False
    manager = _cookie_manager()
    if manager is None:
        return False
    try:
        manager.set(
            COOKIE_NAME,
            token,
            key="ef_rt_set",
            expires_at=datetime.datetime.now() + datetime.timedelta(days=COOKIE_DAYS),
            secure=_secure_cookie(),
            same_site="lax",
        )
        return True
    except Exception:
        # Losing persistence must never break signing in.
        return False


def clear_session_cookie():
    """Drop the cookie. Called on sign-out and whenever a token is refused."""
    manager = _cookie_manager()
    if manager is None:
        return
    try:
        manager.delete(COOKIE_NAME, key="ef_rt_del")
    except Exception:
        pass


def restore_session():
    """Rehydrate identity from the cookie. Returns True when the caller should stop.

    Runs BEFORE `app.py`'s auth gate. Returning True means "this run has nothing to
    show yet; the component will rerun us" -- the caller renders a placeholder and
    stops. Returning False means the decision is made: either `_auth_user` is now set,
    or there is no usable cookie and the gate should show the login screen.
    """
    from auth.session import _remember, current_user

    if current_user() is not None:
        return False

    manager = _cookie_manager()
    if manager is None:
        return False

    try:
        cookies = manager.get_all(key="ef_cookie_read")
    except Exception:
        return False

    # `{}` means the iframe has not reported. A cookie-less browser still returns
    # `_streamlit_xsrf`, so this is not the same as "no cookie".
    if not cookies:
        waits = st.session_state.get(WAIT_KEY, 0)
        if waits < MAX_COOKIE_WAITS:
            st.session_state[WAIT_KEY] = waits + 1
            return True
        return False

    st.session_state[WAIT_KEY] = MAX_COOKIE_WAITS

    token = cookies.get(COOKIE_NAME)
    if not token:
        return False

    from data.supabase_client import get_supabase_client

    client = get_supabase_client()
    if client is None:
        return False

    try:
        # `refresh_session` mints a fresh access+refresh pair from the refresh token
        # alone, and leaves the authenticated session ON this client instance -- which
        # is the client every later query uses. `set_session` wants a non-empty access
        # token we do not have.
        response = client.auth.refresh_session(refresh_token=token)
    except Exception:
        # Expired, revoked, rotated away, or unreachable. Drop the cookie so we do not
        # retry a dead token on every page load, and fall through to the login screen.
        clear_session_cookie()
        return False

    session = getattr(response, "session", None)
    user = getattr(response, "user", None)
    if not session or not user:
        clear_session_cookie()
        return False

    _remember(user)
    persist_session(session)  # ROTATION: the new token, every time.
    return False


def render_restoring_placeholder():
    """Shown for the run or two while the cookie component reports back.

    Without this the athlete sees the login screen flash before being signed in.
    """
    st.markdown(
        '<div class="hero-panel"><div class="hero-copy">'
        '<div class="hero-title">EvoForge</div>'
        '<div class="hero-subtitle">Restoring your session…</div>'
        "</div></div>",
        unsafe_allow_html=True,
    )
