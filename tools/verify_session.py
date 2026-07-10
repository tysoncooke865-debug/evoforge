"""Pin the "stay signed in" contract, especially refresh-token ROTATION.

Supabase issues a NEW refresh token on every `refresh_session()` and may invalidate
the old one immediately. If the cookie is not overwritten each time, the next visit
presents a dead token -- and the athlete is signed out INTERMITTENTLY: the first
reopen works, the second does not. That is the bug this feature usually ships with,
and it is invisible to a test that only restores once.

Also pinned:
  * the cookie holds the REFRESH token and never the access token
  * a revoked/expired token deletes the cookie instead of being retried forever
  * a failure to restore leaves the athlete signed out, never crashes
  * sign-out revokes server-side AND deletes the cookie

No browser, no database, no Supabase. The cookie manager and the auth client are
stubbed; `tools/verify_isolation.py` uses the same substitution pattern.

    python tools/verify_session.py
"""
import sys
import types
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def section(n):
    print("\n" + "=" * 72 + f"\n{n}\n" + "=" * 72)


class FakeCookieJar:
    """Stands in for the browser. Records what was written, in order."""

    def __init__(self, initial=None):
        self.store = dict(initial or {})
        self.writes = []
        self.deletes = []

    # CookieManager surface
    def get_all(self, key=None):
        # A real browser always returns at least Streamlit's xsrf cookie.
        return {"_streamlit_xsrf": "x", **self.store}

    def set(self, cookie, val, **kwargs):
        self.store[cookie] = val
        self.writes.append((cookie, val, kwargs))

    def delete(self, cookie, key=None):
        self.store.pop(cookie, None)
        self.deletes.append(cookie)


class RotatingAuth:
    """Supabase's actual behaviour: one use per refresh token, then it is dead."""

    def __init__(self, first_token):
        self.valid = {first_token}
        self.dead = set()
        self.issued = 0
        self.signed_out = False

    def refresh_session(self, refresh_token=None):
        if refresh_token in self.dead:
            raise RuntimeError("Invalid Refresh Token: Already Used")
        if refresh_token not in self.valid:
            raise RuntimeError("Invalid Refresh Token: Not Found")

        self.valid.discard(refresh_token)
        self.dead.add(refresh_token)
        self.issued += 1
        new_refresh = f"rt-{self.issued + 1}"
        self.valid.add(new_refresh)

        session = types.SimpleNamespace(
            access_token=f"at-{self.issued}", refresh_token=new_refresh
        )
        # `auth/session.py :: _remember` reads `.id` and `.email` off the user object,
        # the way supabase_auth's User does. A dict would silently take a different path.
        user = types.SimpleNamespace(id="user-1", email="a@example.test")
        return types.SimpleNamespace(session=session, user=user)

    def sign_out(self):
        self.signed_out = True


def install(monkey_cookies, auth):
    """Point auth.persistence at the fakes. Returns a restore() callable."""
    import auth.persistence as persistence
    import data.supabase_client as supabase_client
    import streamlit as st

    persistence._cookie_manager = lambda: monkey_cookies
    supabase_client.get_supabase_client = lambda: types.SimpleNamespace(auth=auth)

    # `_remember` writes to session_state; give it a plain dict to write into.
    st.session_state.clear() if hasattr(st.session_state, "clear") else None
    return persistence


# ---------------------------------------------------------------------------
section("1. ROTATION -- the bug this feature ships with")

import auth.persistence as persistence  # noqa: E402
import auth.session as session_mod  # noqa: E402

state = {}
persistence.st = types.SimpleNamespace(session_state=state, context=None, markdown=lambda *a, **k: None)
session_mod.st = types.SimpleNamespace(session_state=state)

jar = FakeCookieJar({persistence.COOKIE_NAME: "rt-1"})
auth = RotatingAuth("rt-1")

persistence._cookie_manager = lambda: jar
import data.supabase_client as supabase_client  # noqa: E402
supabase_client.get_supabase_client = lambda: types.SimpleNamespace(auth=auth)

stop = persistence.restore_session()
check("first restore does not ask the caller to wait", stop is False)
check("first restore signs the athlete in", state.get("_auth_user") is not None,
      str(state.get("_auth_user")))
check("the cookie was REWRITTEN with the new token", jar.store[persistence.COOKIE_NAME] == "rt-2",
      f"cookie holds {jar.store.get(persistence.COOKIE_NAME)!r}, expected 'rt-2'")

# The old token is now dead. A second visit must use the rotated one.
state.pop("_auth_user", None)
state.pop(persistence.WAIT_KEY, None)
stop = persistence.restore_session()
check("a SECOND restore also succeeds (rotation was persisted)",
      state.get("_auth_user") is not None,
      "the cookie still held the used token -- intermittent sign-outs")
check("the cookie rotated again", jar.store[persistence.COOKIE_NAME] == "rt-3",
      f"cookie holds {jar.store.get(persistence.COOKIE_NAME)!r}")
check("the old tokens are dead server-side", auth.dead == {"rt-1", "rt-2"}, str(auth.dead))

# ---------------------------------------------------------------------------
section("2. THE COOKIE HOLDS THE REFRESH TOKEN, NEVER THE ACCESS TOKEN")

written = [v for _, v, _ in jar.writes]
check("something was written (positive control)", len(written) >= 2, str(written))
check("no access token was ever written to the cookie",
      not any(str(v).startswith("at-") for v in written), str(written))
check("every write was a refresh token",
      all(str(v).startswith("rt-") for v in written), str(written))

opts = jar.writes[-1][2]
check("cookie is SameSite=Lax", opts.get("same_site") == "lax", str(opts))
check("cookie has an explicit expiry (the component defaults to ONE DAY)",
      opts.get("expires_at") is not None, str(opts))

# ---------------------------------------------------------------------------
section("3. A DEAD TOKEN IS BINNED, NOT RETRIED FOREVER")

jar2 = FakeCookieJar({persistence.COOKIE_NAME: "rt-stale"})
auth2 = RotatingAuth("rt-live")  # the cookie's token was never valid
persistence._cookie_manager = lambda: jar2
supabase_client.get_supabase_client = lambda: types.SimpleNamespace(auth=auth2)

state.clear()
stop = persistence.restore_session()
check("a revoked token does not raise", stop is False)
check("the athlete is left signed out", state.get("_auth_user") is None)
check("the stale cookie was DELETED", persistence.COOKIE_NAME in jar2.deletes,
      "a dead token would be retried on every page load")

# ---------------------------------------------------------------------------
section("4. NO COOKIE, AND THE COMPONENT'S FIRST-RUN SILENCE")

# A cookie-less browser still returns _streamlit_xsrf -> a decision can be made.
jar3 = FakeCookieJar({})
persistence._cookie_manager = lambda: jar3
state.clear()
stop = persistence.restore_session()
check("no cookie -> no wait, straight to the login screen", stop is False)
check("no cookie -> signed out", state.get("_auth_user") is None)

# An EMPTY dict means the component's iframe has not reported yet.
class SilentJar(FakeCookieJar):
    def get_all(self, key=None):
        return {}

silent = SilentJar()
persistence._cookie_manager = lambda: silent
state.clear()
waits = 0
while persistence.restore_session():
    waits += 1
    if waits > 10:
        break
check("an unreporting component is waited on, then given up on",
      1 <= waits <= persistence.MAX_COOKIE_WAITS,
      f"waited {waits} runs; MAX={persistence.MAX_COOKIE_WAITS}")
check("the wait terminates (no infinite rerun loop)", waits <= persistence.MAX_COOKIE_WAITS)

# ---------------------------------------------------------------------------
section("5. THE COMPONENT IS OPTIONAL")

persistence._cookie_manager = lambda: None
state.clear()
check("no cookie manager -> restore is a no-op, not a crash",
      persistence.restore_session() is False)
check("no cookie manager -> persist_session returns False, does not raise",
      persistence.persist_session(types.SimpleNamespace(refresh_token="rt-x")) is False)
persistence.clear_session_cookie()  # must not raise
check("no cookie manager -> clear_session_cookie is silent", True)

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL SESSION CHECKS PASSED")
