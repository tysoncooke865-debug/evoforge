"""Prove that one user's rows never reach another user's screen.

`migrations/001` proves isolation in POSTGRES. This proves it in the PROCESS.

Streamlit Cloud multiplexes every browser session into one Python process, and
`st.cache_data` / `st.cache_resource` are process-global. RLS cannot help you here:
by the time a row is in a module-level cache it has already been fetched with
somebody's JWT. Two mechanisms stand between one athlete's body measurements and
another's:

  * `data/sb_ops.py :: cached_sb_select(_sb, table_name, user_id)` -- `user_id` is
    part of the cache key. `_sb` is underscore-prefixed so Streamlit EXCLUDES it
    from the hash, which means the key is `(table_name, user_id)` and nothing else.
    Drop `user_id` and the second user gets a cache hit on the first user's rows.
  * `data/supabase_client.py :: get_supabase_client()` -- one client per browser
    session, held in `st.session_state`. The signed-in user's JWT lives ON the
    client instance. `@st.cache_resource` would hand one user's JWT to the next
    visitor.

Both are correct. Neither was tested by anything until now.

No database, no browser. The Supabase layer is stubbed the way
`tools/verify_ordering.py` stubs it.

    python tools/verify_isolation.py
"""
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

ALICE = {"id": "aaaaaaaa-0000-0000-0000-00000000000a", "email": "alice@example.test"}
BOB = {"id": "bbbbbbbb-0000-0000-0000-00000000000b", "email": "bob@example.test"}

# Tagged, NON-EMPTY rows. Emptiness is the enemy of every check in this repo: if
# both users read zero rows, "no crossover" passes while nothing was ever tested.
ROWS = {
    ALICE["id"]: [{"user_id": ALICE["id"], "marker": "alice", "date": "2026-07-01",
                   "workout": "Push 1 - Strength", "exercise": "Barbell Bench Press (Strength)",
                   "set": 1, "weight": 100.0, "reps": 5, "timestamp": "2026-07-01T10:00:00"}],
    BOB["id"]: [{"user_id": BOB["id"], "marker": "bob", "date": "2026-07-02",
                 "workout": "Legs", "exercise": "Barbell Back Squat",
                 "set": 1, "weight": 60.0, "reps": 8, "timestamp": "2026-07-02T10:00:00"}],
}

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def section(n):
    print("\n" + "=" * 72 + f"\n{n}\n" + "=" * 72)


class _FakeQuery:
    """The chain `cached_sb_select` builds: .select().order().limit().execute()."""

    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return type("Res", (), {"data": self._rows})()


class _FakeClient:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _FakeQuery(self._rows)


# ---------------------------------------------------------------------------
section("1. cached_sb_select IS KEYED ON user_id")
# `_sb` is excluded from the hash by its underscore. If `user_id` is dropped from
# the signature, the key collapses to `(table_name,)` and Bob's read is a cache HIT
# on Alice's rows -- served with Alice's body measurements in them.
from data.sb_ops import cached_sb_select  # noqa: E402

cached_sb_select.clear()

alice_client = _FakeClient(ROWS[ALICE["id"]])
bob_client = _FakeClient(ROWS[BOB["id"]])

rows_a, err_a = cached_sb_select(alice_client, "workout_log", ALICE["id"])
rows_b, err_b = cached_sb_select(bob_client, "workout_log", BOB["id"])

# Positive controls FIRST. `all(...)` over an empty list is True.
check("alice's read returned rows", bool(rows_a), f"got {rows_a!r}")
check("bob's read returned rows", bool(rows_b), f"got {rows_b!r}")
check("neither read errored", not err_a and not err_b, f"{err_a} / {err_b}")

check("alice sees only alice's rows",
      bool(rows_a) and all(r["marker"] == "alice" for r in rows_a), str(rows_a))
check("bob sees only bob's rows -- no cache crossover",
      bool(rows_b) and all(r["marker"] == "bob" for r in rows_b), str(rows_b))
check("bob's rows carry bob's user_id",
      bool(rows_b) and all(r["user_id"] == BOB["id"] for r in rows_b))

# The cache must still BE a cache, or the isolation above is trivially true.
rows_a2, _ = cached_sb_select(_FakeClient([{"marker": "poisoned"}]), "workout_log", ALICE["id"])
check("a repeat read for the same user is a cache hit",
      bool(rows_a2) and all(r["marker"] == "alice" for r in rows_a2),
      f"expected alice's cached rows, got {rows_a2!r}")

# ---------------------------------------------------------------------------
section("2. THE AUTHENTICATED CLIENT IS NEVER PROCESS-GLOBAL")
# The signed-in user's JWT lives on the client instance. `@st.cache_resource` is
# process-global: it would hand one visitor's JWT to the next.
import data.supabase_client as supabase_client  # noqa: E402

check("get_supabase_client is not a cached function",
      not hasattr(supabase_client.get_supabase_client, "clear"),
      "st.cache_data/@st.cache_resource wrap into a CachedFunc exposing .clear()")

_real_new_client = supabase_client._new_client
try:
    supabase_client._new_client = lambda: object()

    first = supabase_client.get_supabase_client()
    # Simulate the next browser session: a fresh session_state.
    try:
        import streamlit as st
        st.session_state.pop("_sb_client", None)
    except Exception:
        pass  # bare mode: get_supabase_client already falls back to a fresh client
    second = supabase_client.get_supabase_client()

    check("both calls produced a client", first is not None and second is not None)
    check("a new session gets a NEW client, not the previous user's",
          first is not second,
          "the client -- and the JWT on it -- is being shared across sessions")
finally:
    supabase_client._new_client = _real_new_client

# ---------------------------------------------------------------------------
section("3. TWO SESSIONS, TWO USERS, NO CROSSOVER")
# End to end, through the real app. `get_fast_snapshot()` memoises df + summary into
# st.session_state. Session state is per-session -- but a future refactor that
# memoises it into a module global would leak Alice's whole workout log to Bob, and
# nothing else in tools/ would notice.
import data.sb_ops as sb_ops  # noqa: E402
from tools.verify_ui import stub_onboarded  # noqa: E402


def _current_user_rows(table):
    import streamlit as st
    if table != "workout_log":
        return [], None
    user = st.session_state.get("_auth_user") or {}
    return ROWS.get(user.get("id"), []), None


def run_session(user):
    from streamlit.testing.v1 import AppTest
    stub_onboarded()
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=90)
    at.session_state["_auth_user"] = user
    at.session_state["active_page"] = "Home"
    at.session_state["_nav_initialised"] = True
    at.run()
    return at


_real_sb_select = sb_ops.sb_select
try:
    sb_ops.sb_select = _current_user_rows
    cached_sb_select.clear()

    at_a = run_session(ALICE)
    at_b = run_session(BOB)

    check("alice's session rendered without exceptions", not at_a.exception)
    check("bob's session rendered without exceptions", not at_b.exception)

    def snapshot_of(at):
        """None when the session never built one of its own.

        A process-global memo returns a cached snapshot BEFORE the write, so the
        second session's `session_state` stays empty. Reading it with `[...]` here
        raised KeyError and the leak looked like a crash rather than a leak. The
        absence IS the symptom: a session that renders somebody else's data never
        stores its own.
        """
        try:
            return at.session_state["_fast_snapshot"]
        except (KeyError, AttributeError):
            return None

    snap_a, snap_b = snapshot_of(at_a), snapshot_of(at_b)

    check("alice's session built a snapshot", snap_a is not None)
    check("bob's session built its OWN snapshot", snap_b is not None,
          "bob rendered without storing one -- he was served a cached snapshot")

    if snap_a is None or snap_b is None:
        # Cannot compare rows; the checks above already failed loudly.
        df_a = df_b = None
    else:
        df_a, df_b = snap_a["df"], snap_b["df"]

        # Positive controls before any `all(...)` over rows.
        check("alice's snapshot is non-empty", not df_a.empty, f"{len(df_a)} rows")
        check("bob's snapshot is non-empty", not df_b.empty, f"{len(df_b)} rows")

        markers_a = set(df_a["marker"].astype(str)) if "marker" in df_a.columns else set()
        markers_b = set(df_b["marker"].astype(str)) if "marker" in df_b.columns else set()

        check("alice's snapshot holds only alice's rows", markers_a == {"alice"}, str(markers_a))
        check("bob's snapshot holds only bob's rows", markers_b == {"bob"}, str(markers_b))
        check("no row of alice's leaked into bob's session", "alice" not in markers_b, str(markers_b))
        check("no row of bob's leaked into alice's session", "bob" not in markers_a, str(markers_a))
finally:
    sb_ops.sb_select = _real_sb_select
    cached_sb_select.clear()

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL ISOLATION CHECKS PASSED")
