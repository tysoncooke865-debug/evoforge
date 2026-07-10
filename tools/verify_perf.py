"""A render budget. Fail if a page starts doing more work than it used to.

Every rerun of a Streamlit app re-executes the whole script -- every button, every
keystroke in a number input. So the cost of ONE render is the cost of every
interaction, and it is the number that decides whether the app feels laggy.

Three counters. Note carefully what each one MEASURES -- the first version of this
file counted calls to `df_from_supabase` and called the number "rebuilds", so when
a memo was added the count did not move and the guard learned nothing:

  * `df_calls`  -- invocations of `data/sb_ops.py :: df_from_supabase`. Cheap once
    memoised. Reported, not budgeted. A high number here is fine.
  * `df_builds` -- how many times a DataFrame was actually CONSTRUCTED, sorted and
    de-duplicated. This is the expensive work. Counted at `_df_memo_put`, which is
    reached exactly once per real build. **This is the number that matters.**
  * `stats`     -- calls to `domain/avatar_stats.py :: calculate_avatar_stats`,
    roughly eleven builds each. It used to run TWICE per page: once for the sidebar
    (`ui/nav.py`) and once for the page body, each throwing the other away.

`stats` is asserted EXACTLY, not as a ceiling. That is what makes the double-call
falsifiable: add a second call anywhere and this goes red.

    python tools/verify_perf.py            # enforce the budget
    python tools/verify_perf.py --report   # print counts, never fail (for tuning)

No database, no browser. `sb_select` is stubbed the way tools/verify_ordering.py
and tools/verify_isolation.py stub it.
"""
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

REPORT_ONLY = "--report" in sys.argv

TEST_USER = {"id": "00000000-0000-0000-0000-0000000000ff", "email": "perf@example.test"}

# Non-empty rows. A page reading nothing does no work and would "pass" any budget;
# the positive control below is the real defence, but seed real data anyway.
ROWS = {
    "workout_log": [
        {"user_id": TEST_USER["id"], "date": "2026-07-01", "workout": "Push 1 - Strength",
         "exercise": "Barbell Bench Press (Strength)", "set": 1, "weight": 100.0, "reps": 5,
         "timestamp": "2026-07-01T10:00:00"},
        {"user_id": TEST_USER["id"], "date": "2026-07-02", "workout": "Legs",
         "exercise": "Barbell Back Squat", "set": 1, "weight": 140.0, "reps": 5,
         "timestamp": "2026-07-02T10:00:00"},
    ],
    "bodyweight_log": [{"date": "2026-07-01", "bodyweight": 77.0, "timestamp": "2026-07-01T10:00:00"}],
    "cardio_log": [{"date": "2026-07-01", "type": "Run", "minutes": 30, "timestamp": "2026-07-01T10:00:00"}],
    "bodyfat_log": [{"date": "2026-07-01", "bf_mid": 12.0, "timestamp": "2026-07-01T10:00:00"}],
    "profile": [{"base_level": 42, "created_at": "2026-07-01T10:00:00", "timestamp": "2026-07-01T10:00:00"}],
}

# Budgets. `stats` is EXACT. `df_builds` is a ceiling -- there are 11 tables, and a
# render should build each at most once. `df_calls` is reported, never budgeted.
BUDGET = {
    "Home":   {"stats": 1, "df_builds": 9},
    "Avatar": {"stats": 1, "df_builds": 9},
    "Today":  {"stats": 1, "df_builds": 9},
}

counts = {"df_calls": 0, "df_builds": 0, "stats": 0}
failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def _rebind_everywhere(real, wrapper, attr_name):
    """Replace `real` with `wrapper` on EVERY module that holds a reference.

    THE TRAP: `from data.sb_ops import df_from_supabase` binds the FUNCTION OBJECT
    into the importing module's namespace. Patching `sb_ops.df_from_supabase` alone
    leaves `domain.workouts.df_from_supabase` pointing at the original, and the
    counter reads zero while the work still happens -- a guard measuring nothing.

    So walk sys.modules and rebind every name that `is` the original.
    """
    for module in list(sys.modules.values()):
        try:
            if getattr(module, attr_name, None) is real:
                setattr(module, attr_name, wrapper)
        except Exception:
            continue


def _counted(real, key):
    def wrapper(*args, **kwargs):
        counts[key] += 1
        return real(*args, **kwargs)
    wrapper.__name__ = getattr(real, "__name__", key)
    return wrapper


def install_counters():
    import data.sb_ops as sb_ops
    import domain.avatar_stats as avatar_stats

    real_df = sb_ops.df_from_supabase
    _rebind_everywhere(real_df, _counted(real_df, "df_calls"), "df_from_supabase")

    # `_df_memo_put` is reached exactly once per genuine DataFrame construction --
    # a memo hit returns before it, and the error path never memoises. It is the
    # only honest place to count the expensive work. `df_from_supabase` itself is
    # only ever called by name inside its own module, so a plain attribute patch
    # on sb_ops is enough here (no `from ... import _df_memo_put` anywhere).
    real_put = sb_ops._df_memo_put
    sb_ops._df_memo_put = _counted(real_put, "df_builds")

    real_stats = avatar_stats.calculate_avatar_stats
    _rebind_everywhere(real_stats, _counted(real_stats, "stats"), "calculate_avatar_stats")


def stub_data():
    import data.sb_ops as sb_ops
    sb_ops.sb_select = lambda table: (ROWS.get(table, []), None)


def run_page(page):
    from streamlit.testing.v1 import AppTest
    from tools.verify_ui import stub_onboarded
    from data.sb_ops import cached_sb_select

    cached_sb_select.clear()
    for k in counts:
        counts[k] = 0

    stub_onboarded()
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=120)
    at.session_state["_auth_user"] = TEST_USER
    at.session_state["active_page"] = page
    at.session_state["_nav_initialised"] = True
    at.run()
    return at, dict(counts)


def main():
    install_counters()
    stub_data()

    print("=" * 72)
    print("RENDER BUDGET" + ("  (report only -- never fails)" if REPORT_ONLY else ""))
    print("=" * 72)
    print(f"  {'page':<10} {'avatar_stats':>13} {'df BUILDS':>11} {'df calls':>10}")
    print("  " + "-" * 48)

    results = {}
    for page in BUDGET:
        at, seen = run_page(page)
        results[page] = (at, seen)
        print(f"  {page:<10} {seen['stats']:>13} {seen['df_builds']:>11} {seen['df_calls']:>10}")

    print()
    for page, (at, seen) in results.items():
        budget = BUDGET[page]

        # POSITIVE CONTROL, first. A page that renders nothing does no work and
        # would satisfy every ceiling below. `.hero-panel` comes only from
        # page_hero(), which every page calls and no chrome emits.
        bodies = [m.value for m in at.main.markdown if "<style>" not in m.value]
        rendered = any("hero-panel" in b for b in bodies)
        check(f"{page}: rendered its hero (the page actually ran)", rendered)
        check(f"{page}: no exceptions", not at.exception,
              "; ".join(str(e.value)[:60] for e in at.exception))

        if REPORT_ONLY:
            continue

        # EXACT, not a ceiling. This is the assertion that makes a second
        # calculate_avatar_stats() call impossible to reintroduce quietly.
        check(f"{page}: calculate_avatar_stats runs exactly {budget['stats']}x",
              seen["stats"] == budget["stats"], f"ran {seen['stats']}x")
        check(f"{page}: DataFrame builds within budget ({budget['df_builds']})",
              seen["df_builds"] <= budget["df_builds"],
              f"{seen['df_builds']} builds, budget {budget['df_builds']}")
        # A memo that never hits is not a memo. If builds == calls, the render memo
        # is broken and every caller is paying full price again.
        check(f"{page}: the render memo is actually hitting",
              seen["df_calls"] > seen["df_builds"],
              f"{seen['df_calls']} calls but {seen['df_builds']} builds -- memo not working")

    print()
    if REPORT_ONLY:
        print("report only -- no budget enforced")
        return
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL PERF CHECKS PASSED")


if __name__ == "__main__":
    main()
