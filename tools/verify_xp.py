"""The XP contract, asserted.

Pure. No database, no Streamlit, no browser. If these pass, the progress bar
fills to exactly 100% at the moment the level is granted -- which the previous
three-formula arrangement made mathematically impossible.

    python tools/verify_xp.py
"""
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from domain.xp import (  # noqa: E402
    MAX_LEVEL, XP_PER_CARDIO_MINUTE, XP_PER_SET,
    activity_xp, cumulative_xp, level_and_progress, progress_percent,
    xp_for_level, xp_to_next_level,
)

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if not cond and detail else ""))
    if not cond:
        failures.append(name)


print("=" * 72)
print("1. THE CURVE")
print("=" * 72)
check("level 1 -> 2 costs 500", xp_for_level(1) == 500, f"got {xp_for_level(1)}")
check("level 42 -> 43 costs 1525", xp_for_level(42) == 1525, f"got {xp_for_level(42)}")
check("xp_to_next_level is xp_for_level",
      all(xp_to_next_level(lv) == xp_for_level(lv) for lv in range(1, 101)))
check("cost rises with level",
      all(xp_for_level(lv) < xp_for_level(lv + 1) for lv in range(1, MAX_LEVEL - 1)))
check("cost never 0 (no divide-by-zero at cap)",
      all(xp_for_level(lv) > 0 for lv in range(-5, 130)))
check("out-of-range levels clamp, never raise",
      xp_for_level(0) == xp_for_level(1) and xp_for_level(999) == xp_for_level(MAX_LEVEL))
check("non-numeric level does not raise", xp_for_level("nonsense") == xp_for_level(1))

print()
print("=" * 72)
print("2. EARNING")
print("=" * 72)
check("a set is 10 XP", activity_xp(total_sets=1) == XP_PER_SET)
check("a cardio minute is 2 XP", activity_xp(cardio_minutes=1) == XP_PER_CARDIO_MINUTE)
check("they add", activity_xp(3, 10) == 3 * XP_PER_SET + 10 * XP_PER_CARDIO_MINUTE)
check("negatives floor at 0", activity_xp(-5, -5) == 0)
check("junk floors at 0", activity_xp("x", None) == 0)

print()
print("=" * 72)
print("3. THE BAR FILLS EXACTLY AT LEVEL-UP")
print("=" * 72)
# The bug: the bar divided by a different number than the one granting the level.
for base in (1, 42, 98):
    cost = xp_for_level(base)

    lv, into, need = level_and_progress(base, cost - 1)
    check(f"L{base}: one XP short -> still L{base}, bar < 100%",
          lv == base and into == cost - 1 and need == cost and progress_percent(into, need) < 100.0,
          f"got level={lv} into={into} need={need}")

    lv, into, need = level_and_progress(base, cost)
    check(f"L{base}: exactly the cost -> L{base + 1}, bar resets to 0%",
          lv == base + 1 and into == 0 and progress_percent(into, need) == 0.0,
          f"got level={lv} into={into} need={need}")

# MAX_LEVEL is the one place the bar does NOT reset. There is no next level, and
# a bar snapping to 0% at the cap would read as "you lost everything". It pins
# full instead. Asserted explicitly rather than excluded from the loop above.
cost_99 = xp_for_level(MAX_LEVEL - 1)
lv, into, need = level_and_progress(MAX_LEVEL - 1, cost_99 - 1)
check(f"L{MAX_LEVEL - 1}: one XP short -> still L{MAX_LEVEL - 1}, bar < 100%",
      lv == MAX_LEVEL - 1 and progress_percent(into, need) < 100.0,
      f"got level={lv} into={into} need={need}")

lv, into, need = level_and_progress(MAX_LEVEL - 1, cost_99)
check(f"L{MAX_LEVEL - 1}: exactly the cost -> L{MAX_LEVEL}, bar PINS FULL",
      lv == MAX_LEVEL and into == need and progress_percent(into, need) == 100.0,
      f"got level={lv} into={into} need={need}")

print()
check("progress is never > 100%",
      all(progress_percent(*level_and_progress(1, xp)[1:]) <= 100.0 for xp in range(0, 20000, 137)))
check("progress is never < 0%",
      all(progress_percent(*level_and_progress(1, xp)[1:]) >= 0.0 for xp in range(0, 20000, 137)))
check("xp_into_level < xp_needed below cap",
      all(level_and_progress(1, xp)[1] < level_and_progress(1, xp)[2]
          for xp in range(0, 5000, 61)))

print()
print("=" * 72)
print("4. LEVELS ARE MONOTONIC AND CAPPED")
print("=" * 72)
levels = [level_and_progress(1, xp)[0] for xp in range(0, 300000, 500)]
check("more XP never lowers the level", all(b >= a for a, b in zip(levels, levels[1:])))
check("level never exceeds MAX_LEVEL", max(levels) == MAX_LEVEL)
check("level never below 1", min(levels) >= 1)
check("enormous XP pins at MAX_LEVEL", level_and_progress(1, 10 ** 9)[0] == MAX_LEVEL)
check("at MAX_LEVEL the bar pins full",
      progress_percent(*level_and_progress(1, 10 ** 9)[1:]) == 100.0)
check("base_level above cap clamps", level_and_progress(150, 0)[0] == MAX_LEVEL)
check("base_level below 1 clamps", level_and_progress(0, 0)[0] == 1)
check("negative XP is treated as 0", level_and_progress(42, -100) == level_and_progress(42, 0))

print()
print("=" * 72)
print("5. THE LEDGER INVARIANT: sum of costs == XP to reach a level")
print("=" * 72)
# What an xp_events ledger must reconcile against, once it exists.
for base, target in ((1, 10), (1, 50), (42, 60), (90, 99)):
    total = cumulative_xp(base, target)
    lv, into, _ = level_and_progress(base, total)
    check(f"cumulative_xp({base},{target}) lands exactly on L{target} with 0 into",
          lv == target and into == 0, f"got level={lv} into={into}")

    lv, into, _ = level_and_progress(base, total - 1)
    check(f"one XP less lands on L{target - 1}", lv == target - 1, f"got level={lv}")

# The cap again: exact XP reaches L100, and the bar pins rather than resetting.
total = cumulative_xp(90, MAX_LEVEL)
lv, into, need = level_and_progress(90, total)
check(f"cumulative_xp(90,{MAX_LEVEL}) reaches L{MAX_LEVEL} with the bar full",
      lv == MAX_LEVEL and into == need, f"got level={lv} into={into} need={need}")
lv, _, _ = level_and_progress(90, total - 1)
check(f"one XP less lands on L{MAX_LEVEL - 1}", lv == MAX_LEVEL - 1, f"got level={lv}")

print()
print("=" * 72)
print("6. THE LEDGER MIGRATION AGREES WITH THE CURVE")
print("=" * 72)
# migrations/002_xp_events.sql backfills XP with literals. If someone changes
# XP_PER_SET here and not there, the ledger silently disagrees with the app --
# and the reconciliation query in that migration would be the only thing to
# notice, months later, against real user data.
import re  # noqa: E402

ledger_sql = APP_DIR / "migrations" / "002_xp_events.sql"
if not ledger_sql.exists():
    check("migrations/002_xp_events.sql exists", False, "missing")
else:
    src = ledger_sql.read_text(encoding="utf-8")
    m_set = re.search(r"'set',\s*(\d+),", src)
    m_cardio = re.search(r"floor\(c\.minutes \* (\d+)\)", src)
    check("backfill grants XP_PER_SET per set",
          bool(m_set) and int(m_set.group(1)) == XP_PER_SET,
          f"migration says {m_set.group(1) if m_set else '?'}, code says {XP_PER_SET}")
    check("backfill grants XP_PER_CARDIO_MINUTE per cardio minute",
          bool(m_cardio) and int(m_cardio.group(1)) == XP_PER_CARDIO_MINUTE,
          f"migration says {m_cardio.group(1) if m_cardio else '?'}, code says {XP_PER_CARDIO_MINUTE}")
    check("ledger is append-only: no update/delete policy",
          "for update" not in src.lower() and "for delete" not in src.lower())

print()
print("=" * 72)
print("7. THE LEDGER PATH AND THE DERIVED PATH ARE THE SAME CURVE")
print("=" * 72)
# The whole point of the ledger is that it changes WHERE the number comes from,
# never WHAT the number means. If these two ever disagree, the migration's STEP 4
# reconciliation is comparing apples to oranges and would still print `true`.
from domain.xp import level_from_ledger, resolve_xp  # noqa: E402
from domain.xp_ledger import cardio_event_amount  # noqa: E402

for base, xp in ((1, 0), (1, 499), (1, 500), (42, 1524), (42, 1525), (90, 99999)):
    check(f"level_from_ledger == level_and_progress at base={base} xp={xp}",
          level_from_ledger(base, xp) == level_and_progress(base, xp))

# resolve_xp: the ledger wins when present, derived is the fallback, and a missing
# ledger must NEVER be read as zero XP -- that would drop every user to base level
# the moment this shipped ahead of migrations/002.
check("no ledger -> derived is used", resolve_xp(1234, None) == (1234, "derived", 0))
check("no ledger -> not treated as 0 XP", resolve_xp(1234, None)[0] != 0)
check("ledger present -> ledger wins", resolve_xp(1000, 1200) == (1200, "ledger", 200))
check("agreement -> zero drift", resolve_xp(1000, 1000) == (1000, "ledger", 0))
check("ledger behind derived -> negative drift is reported, not hidden",
      resolve_xp(1000, 900) == (900, "ledger", -100))
check("an empty ledger (0) is distinct from an absent one (None)",
      resolve_xp(1000, 0) == (0, "ledger", -1000))
check("garbage ledger value falls back to derived", resolve_xp(500, "nonsense")[1] == "derived")

# The live cardio grant must equal the migration's backfill literal, exactly.
# `floor(minutes * 2)`, and skipped when it rounds to nothing.
for minutes, expected in ((0, 0), (0.4, 0), (0.5, 1), (1, 2), (30, 60), (12.7, 25)):
    check(f"cardio_event_amount({minutes}) == floor({minutes} * {XP_PER_CARDIO_MINUTE})",
          cardio_event_amount(minutes) == expected,
          f"got {cardio_event_amount(minutes)}, want {expected}")
check("negative cardio mints nothing", cardio_event_amount(-10) == 0)
check("non-numeric cardio mints nothing", cardio_event_amount("nonsense") == 0)

# A set is a flat grant. If this ever depends on weight or reps, editing a set
# would have to re-grant, and the append-only ledger cannot revoke the old one.
check("a set is a flat XP_PER_SET, independent of load", XP_PER_SET == 10)

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL XP CHECKS PASSED")
