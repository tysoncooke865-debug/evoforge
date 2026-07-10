"""Assert that "the latest record" really is the latest.

`cached_sb_select` orders rows DESCENDING so that `limit(2500)` keeps the most
recent ones. Every consumer then reads `.iloc[-1]` to mean "latest". On a
descending frame that is the OLDEST row.

That bug shipped: the app showed the first bodyweight ever logged as the current
one, and derived avatar stats from the oldest measurements. `df_from_supabase`
now re-sorts ascending. This pins it.

No database. The Supabase layer is stubbed with rows in the order Supabase
actually returns them.

    python tools/verify_ordering.py
"""
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

# Rows exactly as Supabase hands them back: newest first.
ROWS = {
    "bodyweight_log": [
        {"date": "2026-07-01", "bodyweight": 77.0, "timestamp": "2026-07-01T10:00:00"},
        {"date": "2025-01-01", "bodyweight": 70.0, "timestamp": "2025-01-01T10:00:00"},
        {"date": "2024-01-01", "bodyweight": 65.0, "timestamp": "2024-01-01T10:00:00"},
    ],
    "profile": [
        {"base_level": 5,  "created_at": "2026-07-10T10:00:00", "timestamp": "2026-07-10T10:00:00"},
        {"base_level": 42, "created_at": "2024-01-01T10:00:00", "timestamp": "2024-01-01T10:00:00"},
    ],
    "bodyfat_log": [
        {"date": "2026-07-01", "bf_mid": 12.0, "timestamp": "2026-07-01T10:00:00"},
        {"date": "2024-01-01", "bf_mid": 22.0, "timestamp": "2024-01-01T10:00:00"},
    ],
    "measurements": [
        {"date": "2026-07-01", "bicep_cm": 40.0, "timestamp": "2026-07-01T10:00:00"},
        {"date": "2024-01-01", "bicep_cm": 33.0, "timestamp": "2024-01-01T10:00:00"},
    ],
    "physique_ratings": [
        {"date": "2026-07-01", "physique_score": 80, "leanness_score": 70,
         "symmetry_score": 75, "muscularity_score": 78, "timestamp": "2026-07-01T10:00:00"},
        {"date": "2024-01-01", "physique_score": 30, "leanness_score": 20,
         "symmetry_score": 25, "muscularity_score": 28, "timestamp": "2024-01-01T10:00:00"},
    ],
}


def main():
    import data.sb_ops as sb_ops
    sb_ops.sb_select = lambda table: (ROWS.get(table, []), None)

    from domain.bodyweight import latest_bodyweight_value, get_bodyweight_stats
    from domain.bodyfat import latest_bodyfat_mid
    from domain.measurements import latest_measurements
    from domain.physique_ratings import latest_physique_rating_values
    from domain.profile import get_base_level

    checks = [
        ("latest_bodyweight_value",        latest_bodyweight_value(),                    77.0),
        ("get_bodyweight_stats[latest]",   get_bodyweight_stats()["latest"],             77.0),
        ("latest_bodyfat_mid",             latest_bodyfat_mid(),                         12.0),
        ("get_base_level",                 get_base_level(),                             5),
        ("latest_measurements[bicep_cm]",  float(latest_measurements()["bicep_cm"]),     40.0),
        ("latest_physique[physique_score]",
         float(latest_physique_rating_values()["physique_score"]),                       80.0),
    ]

    failures = []
    for name, got, want in checks:
        ok = got == want
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<34} got={got!r:<8} want={want!r}")
        if not ok:
            failures.append(name)

    # Min/max must still see the whole history, not just the newest row.
    stats = get_bodyweight_stats()
    for name, got, want in [("bodyweight min", stats["min"], 65.0),
                            ("bodyweight max", stats["max"], 77.0),
                            ("bodyweight count", stats["count"], 3)]:
        ok = got == want
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<34} got={got!r:<8} want={want!r}")
        if not ok:
            failures.append(name)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s). `.iloc[-1]` is not the latest row.")
        print("df_from_supabase must re-sort ascending: cached_sb_select orders desc.")
        sys.exit(1)
    print("ALL ORDERING CHECKS PASSED")


if __name__ == "__main__":
    main()
