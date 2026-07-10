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
    sb_ops.sb_select = lambda table, select_cols="*": (ROWS.get(table, []), None)


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


def check_achievement_sweep():
    """`check_achievements()` runs on EVERY set save. It must be one read, one write.

    It used to call `load_achievements()` once per candidate -- about sixty table
    reads -- and `sb_insert` per unlock, each of which calls `clear_data_cache()`.
    The wipe happened INSIDE the loop, so a set that earned three achievements went
    back to the network between each one.
    """
    print()
    print("=" * 72)
    print("ACHIEVEMENT SWEEP: one read, one batch write")
    print("=" * 72)

    import data.sb_ops as sb_ops
    import domain.achievements as achievements

    seen = {"loads": 0, "single_inserts": 0, "batch_inserts": 0, "batch_rows": 0}

    real_load = achievements.load_achievements
    real_single = achievements.sb_insert
    real_batch = achievements.sb_insert_many
    real_store = achievements.store_supabase_result

    def fake_load():
        seen["loads"] += 1
        return real_load()

    def fake_single(table, row, **kw):
        seen["single_inserts"] += 1
        return True, None

    def fake_batch(table, rows):
        seen["batch_inserts"] += 1
        seen["batch_rows"] += len(rows)
        return True, None

    try:
        achievements.load_achievements = fake_load
        achievements.sb_insert = fake_single
        achievements.sb_insert_many = fake_batch
        achievements.store_supabase_result = lambda *a, **k: None
        # `check_achievements` reads no achievements rows -> everything is unearned,
        # so the seeded workout log unlocks several at once. That is the case that
        # used to thrash the cache.
        sb_ops.sb_select = lambda table, select_cols="*": (ROWS.get(table, []), None)

        unlocked = achievements.check_achievements()
    finally:
        achievements.load_achievements = real_load
        achievements.sb_insert = real_single
        achievements.sb_insert_many = real_batch
        achievements.store_supabase_result = real_store

    # Positive control: the sweep must actually have unlocked something, or the
    # "one insert" assertions below pass because nothing happened.
    check("the sweep unlocked at least one achievement", len(unlocked) >= 1,
          f"unlocked={unlocked}")
    check("the achievements table is read exactly once", seen["loads"] == 1,
          f"read {seen['loads']}x -- one read per candidate is the N+1")
    check("no per-achievement single inserts", seen["single_inserts"] == 0,
          f"{seen['single_inserts']} single inserts; each one wipes the cache mid-loop")
    check("exactly one batch insert", seen["batch_inserts"] == 1,
          f"{seen['batch_inserts']} batch inserts")
    check("the batch carried every unlock", seen["batch_rows"] == len(unlocked),
          f"{seen['batch_rows']} rows for {len(unlocked)} unlocks")
    check("no duplicate achievement_id in the batch", seen["batch_rows"] == len(set(unlocked)),
          "001 puts a unique (user_id, achievement_id) index on this table")


def check_log_projection():
    """`load_log()` must read only the columns it uses, not `select *`.

    workout_log carries muscle, volume, estimated_1rm and notes that this frame
    never reads. But `id` MUST stay in the projection -- save_set_auto() updates a
    set in place by its id -- so this asserts both: the heavy columns are gone AND
    id is present.
    """
    print()
    print("=" * 72)
    print("load_log() PROJECTS THE READ (keeps id, drops the heavy columns)")
    print("=" * 72)

    import data.sb_ops as sb_ops
    import domain.workouts as workouts

    seen = {}

    def spy(table, columns, select_cols="*"):
        seen[table] = select_cols
        return __import__("pandas").DataFrame(columns=columns)

    real = workouts.df_from_supabase
    try:
        workouts.df_from_supabase = spy
        workouts.load_log()
    finally:
        workouts.df_from_supabase = real

    proj = seen.get("workout_log", "*")
    cols = {c.strip() for c in proj.split(",")}
    check("load_log projects, it does not select *", proj != "*", f"select_cols={proj!r}")
    check("id stays in the projection (save_set_auto needs it)", "id" in cols, proj)
    for heavy in ("muscle", "volume", "estimated_1rm", "notes"):
        check(f"the heavy column '{heavy}' is off the wire", heavy not in cols, proj)


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

    check_achievement_sweep()
    check_log_projection()

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
