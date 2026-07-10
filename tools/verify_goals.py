"""Pin the goal-progress contract.

A bodyweight target of 75kg means opposite things to an athlete standing at 85kg
and one standing at 70kg. A ratio cannot tell them apart:

    current / target  -> 80/75 = 107%, clamped to 100%. The bar reads COMPLETE for
                         someone cutting 85 -> 75 who still has five kilos to lose.
    target / current  -> breaks the athlete who is bulking.

The direction is not a property of the metric. It is a property of where they
started. `domain.targets.journey_percent` measures the distance travelled as a
fraction of the distance to travel, and this file makes sure it stays that way.

Pure: no database, no streamlit, no browser.

Usage:
    python tools/verify_goals.py
"""
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from domain.targets import journey_percent  # noqa: E402

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def approx(a, b, tol=1e-6):
    return a is not None and abs(a - b) < tol


print("=" * 72)
print("1. CUTTING -- the bug that shipped")
print("=" * 72)
# The exact report: target below current weight, bar read complete.
check("cutting 85 -> 75, at 80kg, is halfway", approx(journey_percent(85, 80, 75), 50.0),
      f"got {journey_percent(85, 80, 75)}")
check("cutting 85 -> 75, at 85kg, has not started", approx(journey_percent(85, 85, 75), 0.0))
check("cutting 85 -> 75, at 75kg, is complete", approx(journey_percent(85, 75, 75), 100.0))
check("cutting 85 -> 75, at 74kg, clamps to complete", approx(journey_percent(85, 74, 75), 100.0))
check("cutting 85 -> 75, at 90kg (wrong way), clamps to 0", approx(journey_percent(85, 90, 75), 0.0))
# The old ratio would have said 107% here. It must NOT read complete.
check("a cutting athlete mid-journey is never reported complete",
      journey_percent(85, 80, 75) < 100.0)

print()
print("=" * 72)
print("2. BULKING -- the case `lower_is_better` would have broken")
print("=" * 72)
check("bulking 70 -> 80, at 75kg, is halfway", approx(journey_percent(70, 75, 80), 50.0))
check("bulking 70 -> 80, at 70kg, has not started", approx(journey_percent(70, 70, 80), 0.0))
check("bulking 70 -> 80, at 80kg, is complete", approx(journey_percent(70, 80, 80), 100.0))
check("bulking 70 -> 80, at 82kg, clamps to complete", approx(journey_percent(70, 82, 80), 100.0))
check("bulking 70 -> 80, at 65kg (wrong way), clamps to 0", approx(journey_percent(70, 65, 80), 0.0))

print()
print("=" * 72)
print("3. SYMMETRY -- neither direction is privileged")
print("=" * 72)
# Mirror journeys of the same length must report the same progress.
for travelled in (0, 0.25, 0.5, 0.75, 1.0):
    cut = journey_percent(85, 85 - 10 * travelled, 75)
    bulk = journey_percent(70, 70 + 10 * travelled, 80)
    check(f"{travelled:.0%} travelled reads the same cutting and bulking",
          approx(cut, bulk), f"cut={cut} bulk={bulk}")

print()
print("=" * 72)
print("4. DEGENERATE INPUTS")
print("=" * 72)
check("baseline == target, standing on it -> complete", approx(journey_percent(75, 75, 75), 100.0))
check("baseline == target, standing off it -> 0", approx(journey_percent(75, 80, 75), 0.0))
check("None baseline -> None", journey_percent(None, 80, 75) is None)
check("None current -> None", journey_percent(85, None, 75) is None)
check("None target -> None", journey_percent(85, 80, None) is None)
check("non-numeric -> None", journey_percent("x", 80, 75) is None)
check("never below 0", all(journey_percent(85, c, 75) >= 0 for c in (60, 75, 85, 100)))
check("never above 100", all(journey_percent(85, c, 75) <= 100 for c in (60, 75, 85, 100)))

print()
print("=" * 72)
print("5. MONOTONIC -- progress never goes backwards as you approach the target")
print("=" * 72)
cutting = [journey_percent(85, w, 75) for w in (85, 83, 81, 79, 77, 75)]
check("cutting progress is non-decreasing", all(b >= a for a, b in zip(cutting, cutting[1:])),
      str(cutting))
bulking = [journey_percent(70, w, 80) for w in (70, 72, 74, 76, 78, 80)]
check("bulking progress is non-decreasing", all(b >= a for a, b in zip(bulking, bulking[1:])),
      str(bulking))

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL GOAL CHECKS PASSED")
