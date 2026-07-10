"""Prove that row-level security actually isolates one user's data from another's.

This is the acceptance test for migrations/001_add_user_id_and_rls.sql. Every
other check in tools/ is about how the app looks. This one is about whether a
stranger can read your body measurements.

It asserts three things:

  1. A signed-in user reads their own rows.
  2. A signed-in user reads ZERO of another user's rows.
  3. A client holding only the publishable key, with no session, reads ZERO rows.

(3) is the one that matters most. The app has always connected with the
publishable key. If RLS is off or permissive, that key is a skeleton key.

    ###################################################################
    #  RUN THIS AGAINST A STAGING SUPABASE PROJECT, NOT PRODUCTION.   #
    #                                                                 #
    #  It creates two accounts and writes a row to all 11 tables as   #
    #  each of them. It deletes the rows it wrote, but it cannot      #
    #  delete the auth.users rows without a service-role key.         #
    ###################################################################

There is also a read-only mode, `--anon-only`, which writes nothing and creates
no accounts. It checks only property (3). That one is safe against PRODUCTION.

Usage (PowerShell):
    $env:SUPABASE_URL = "https://<staging-ref>.supabase.co"
    $env:SUPABASE_KEY = "<staging publishable key>"
    python tools/verify_rls.py --i-understand-this-writes-to-the-database

    # read-only, safe against production:
    python tools/verify_rls.py --anon-only

Usage (bash):
    export SUPABASE_URL=https://<staging-ref>.supabase.co
    export SUPABASE_KEY=<staging publishable key>
    python tools/verify_rls.py --i-understand-this-writes-to-the-database

It reads those two environment variables and nothing else -- in particular it
never opens .streamlit/secrets.toml, so it cannot reach production by accident.

It will ask you to type the project ref back before it writes anything.

Exits non-zero on any leak.
"""

import os
import sys
import uuid
from datetime import date, datetime

TABLES = [
    "workout_log", "bodyweight_log", "cardio_log", "bodyfat_log", "measurements",
    "physique_ratings", "custom_workout_plan", "achievements", "targets",
    "profile", "avatar_progression",
    # migrations/002. Every XP grant in the system lives here. A new table is
    # exactly the thing that gets created without policies and quietly leaks, so
    # it belongs in the security test the day it exists -- not the day it matters.
    "xp_events",
]


def _now():
    return datetime.now().isoformat(timespec="seconds")


def sample_row(table, marker):
    """One row per table. `marker` makes each user's rows identifiable.

    user_id is deliberately absent: Postgres fills it from DEFAULT auth.uid().
    If a row lands with the wrong owner, that default is broken.
    """
    today = str(date.today())
    rows = {
        "workout_log": {"date": today, "workout": marker, "exercise": marker, "muscle": "Test",
                        "set": 1, "weight": 1, "reps": 1, "estimated_1rm": 1, "volume": 1,
                        "notes": marker, "timestamp": _now()},
        "bodyweight_log": {"date": today, "bodyweight": 77.0, "timestamp": _now()},
        "cardio_log": {"date": today, "type": marker, "minutes": 1, "distance_km": 0.1,
                       "incline": 0, "speed": 1, "calories": 1, "notes": marker, "timestamp": _now()},
        "bodyfat_log": {"date": today, "method": marker, "bodyweight": 77.0, "height_cm": 183.5,
                        "waist_cm": 0, "neck_cm": 0, "bf_low": 12, "bf_high": 14, "bf_mid": 13,
                        "confidence": "test", "notes": marker, "timestamp": _now()},
        "measurements": {"date": today, "bodyweight": 77.0, "wrist_cm": 0, "forearm_cm": 0,
                         "bicep_cm": 0, "chest_cm": 0, "waist_cm": 0, "hips_cm": 0, "thigh_cm": 0,
                         "calf_cm": 0, "shoulders_cm": 0, "neck_cm": 0, "notes": marker,
                         "timestamp": _now()},
        "physique_ratings": {"date": today, "physique_score": 1, "leanness_score": 1,
                             "symmetry_score": 1, "muscularity_score": 1, "confidence": "test",
                             "weak_points": [marker], "improvements": [marker], "summary": marker,
                             "timestamp": _now()},
        "custom_workout_plan": {"plan_name": marker, "workout": marker, "exercise": marker,
                                "sets": 1, "reps": "1", "muscle": "Test", "reason": marker,
                                "day_goal": marker, "timestamp": _now()},
        "achievements": {"achievement_id": marker, "name": marker, "description": marker,
                         "date_unlocked": _now()},
        "targets": {"target_type": marker, "name": marker, "target_value": 1, "unit": "test",
                    "created_at": _now(), "notes": marker},
        "profile": {"height_cm": 183.5, "bodyweight_kg": 77.0, "bench_e1rm": 100, "squat_e1rm": 140,
                    "training_years": 3, "physique_score": 10, "leanness_score": 10,
                    "base_level": 42, "created_at": _now()},
        "avatar_progression": {"date": today, "level": 42, "rank": marker, "character_class": marker,
                               "build_type": marker, "strength_score": 70, "size_score": 60,
                               "leanness_score": 65, "conditioning_score": 40, "aesthetic_score": 68,
                               "weak_point_focus": marker, "ai_summary": marker, "timestamp": _now()},
        # `amount <> 0` is a check constraint. source_id is null here, which the
        # partial unique index permits -- it only covers `source_id is not null`.
        "xp_events": {"kind": "adjustment", "amount": 1, "created_at": _now()},
    }
    return rows[table]


def make_user(url, key):
    from supabase import create_client

    client = create_client(url, key)
    email = f"rls-verify-{uuid.uuid4().hex[:12]}@example.test"
    password = uuid.uuid4().hex + "Aa1!"

    response = client.auth.sign_up({"email": email, "password": password})
    if not response.session:
        raise SystemExit(
            "Sign-up returned no session. Disable 'Confirm email' in the staging project's\n"
            "Authentication -> Providers -> Email settings, or this test cannot sign in."
        )
    return client, response.user.id, email


def _is_authorization_error(exc):
    """True only for an explicit permission denial from Postgres/PostgREST.

    Under RLS a denied SELECT normally returns HTTP 200 with an empty array, not
    an error. So an exception here is almost always infrastructure, and must NOT
    be read as "securely denied".
    """
    text = f"{getattr(exc, 'code', '')} {getattr(exc, 'message', '')} {exc}".lower()
    return any(s in text for s in (
        "permission denied", "42501", "not authorized", "unauthorized",
        "jwt", "401", "403",
    ))


def preflight(url, key):
    """Prove the project is REACHABLE before concluding anything about RLS.

    A paused, deleted or misspelled project fails DNS. Without this, every table
    raised `getaddrinfo failed`, the old code counted each as "a hard denial",
    and the tool printed ANON LOCKED OUT while talking to nothing. A security
    check that passes when it cannot reach the database is worse than no check.

    Returns an error string, or None when the project answered.
    """
    import socket
    from urllib.parse import urlparse

    import httpx  # a supabase dependency; always present

    host = urlparse(url).hostname
    if not host:
        return f"cannot parse a hostname out of {url!r}"

    try:
        socket.getaddrinfo(host, 443)
    except socket.gaierror:
        return (f"{host} does not resolve. The project is paused or deleted, or the "
                f"URL is wrong. Nothing can be concluded about RLS.")

    try:
        # /auth/v1/health accepts ANY valid API key and is independent of RLS and
        # of table GRANTs -- exactly what a reachability probe needs.
        #
        # Do NOT probe PostgREST's root (/rest/v1/) here. On new-format projects
        # it serves the OpenAPI schema to SECRET keys only, and answers a
        # publishable key with 401 "Secret API key required". This function then
        # read that as "wrong or rotated key" and exited 2 -- so the acceptance
        # test for migrations/001 could never pass on any project using the new
        # key format, while the app, which connects with the publishable key,
        # was working fine. Probe on the credential the app actually uses.
        resp = httpx.get(f"{url.rstrip('/')}/auth/v1/health",
                         headers={"apikey": key}, timeout=20.0)
    except Exception as exc:
        return f"could not reach {host}: {type(exc).__name__}: {str(exc)[:80]}"

    if resp.status_code >= 500:
        return f"{host} returned HTTP {resp.status_code}; the API is unhealthy"
    if resp.status_code in (401, 403):
        return f"{host} rejected the key (HTTP {resp.status_code}). Wrong or rotated key?"
    return None


def anon_only(url, key):
    """Read-only check: an unauthenticated publishable-key client reads nothing.

    Writes nothing, creates no accounts. Safe to point at PRODUCTION. Weaker than
    the full test -- it cannot prove user A is hidden from user B, only that a
    stranger holding the publishable key sees zero rows. That is nonetheless the
    single most important property, and the one that went unverified for the
    whole life of this project.
    """
    problem = preflight(url, key)
    if problem:
        print(f"CANNOT VERIFY: {problem}")
        sys.exit(2)
    print("  preflight: project reachable, key accepted\n")

    from supabase import create_client

    anon = create_client(url, key)
    leaks, unreachable, denied, empty = [], [], 0, 0

    for table in TABLES:
        try:
            rows = anon.table(table).select("*").limit(1).execute().data or []
        except Exception as exc:
            if _is_authorization_error(exc):
                denied += 1
                print(f"  {table:<22} denied by policy")
            else:
                unreachable.append(f"{table}: {type(exc).__name__}: {str(exc)[:60]}")
                print(f"  {table:<22} ERROR -- cannot conclude ({str(exc)[:40]})")
            continue

        if rows:
            leaks.append(table)
            print(f"  {table:<22} LEAK -- {len(rows)} row(s) readable")
        else:
            empty += 1
            print(f"  {table:<22} 0 rows")

    print(f"\n{len(TABLES)} tables: {empty} empty, {denied} denied, "
          f"{len(leaks)} leaking, {len(unreachable)} inconclusive")

    if unreachable:
        print("\nCANNOT VERIFY -- these tables could not be queried:")
        for u in unreachable:
            print(f"  - {u}")
        print("\nAn error is not a denial. Fix the connection and re-run.")
        sys.exit(2)

    if leaks:
        print(f"\nFAILED -- the anonymous publishable key reads {len(leaks)} table(s):")
        for t in leaks:
            print(f"  - LEAK: {t}")
        sys.exit(1)

    print("\nANON LOCKED OUT: the publishable key alone reads nothing.")
    print("Note: this does not prove user-vs-user isolation. Run the full test")
    print("against staging for that.")


def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_KEY.")
        sys.exit(2)

    if "--anon-only" in sys.argv:
        print(f"Target: {url}  (read-only)\n")
        anon_only(url, key)
        return

    if "--i-understand-this-writes-to-the-database" not in sys.argv:
        print(__doc__)
        print("Refusing to run without --i-understand-this-writes-to-the-database")
        print("For a read-only check safe to point at production, use --anon-only")
        sys.exit(2)

    print(f"Target: {url}")
    problem = preflight(url, key)
    if problem:
        print(f"CANNOT VERIFY: {problem}")
        sys.exit(2)

    if "localhost" not in url:
        confirm = input("Type the project ref to confirm this is STAGING: ").strip()
        if not confirm or confirm not in url:
            print("Ref did not match. Aborting.")
            sys.exit(2)

    from supabase import create_client

    failures = []
    alice, alice_id, alice_email = make_user(url, key)
    bob, bob_id, bob_email = make_user(url, key)
    print(f"alice = {alice_email} ({alice_id})")
    print(f"bob   = {bob_email} ({bob_id})")

    marker_a = f"rls_a_{uuid.uuid4().hex[:8]}"
    marker_b = f"rls_b_{uuid.uuid4().hex[:8]}"

    try:
        # ---- write one row per table, as each user
        for client, marker, who in ((alice, marker_a, "alice"), (bob, marker_b, "bob")):
            for table in TABLES:
                try:
                    client.table(table).insert(sample_row(table, marker)).execute()
                except Exception as exc:
                    failures.append(f"{who} could not insert into {table}: {exc}")

        # ---- 1 + 2: each user sees their own rows and only their own
        for client, own_id, other_id, who in (
            (alice, alice_id, bob_id, "alice"),
            (bob, bob_id, alice_id, "bob"),
        ):
            for table in TABLES:
                try:
                    rows = client.table(table).select("user_id").execute().data or []
                except Exception as exc:
                    failures.append(f"{who} could not read {table}: {exc}")
                    continue

                if not rows:
                    failures.append(f"{who} reads 0 rows from {table} — the insert or the policy is wrong")
                foreign = [r for r in rows if str(r.get("user_id")) != str(own_id)]
                if foreign:
                    failures.append(
                        f"LEAK: {who} reads {len(foreign)} row(s) from {table} owned by someone else"
                    )

        # ---- 3: the publishable key alone reads nothing
        anon = create_client(url, key)
        for table in TABLES:
            try:
                rows = anon.table(table).select("*").limit(1).execute().data or []
            except Exception as exc:
                # An error is NOT a denial. Under RLS a denied SELECT returns 200
                # with an empty array; an exception means we could not ask.
                if _is_authorization_error(exc):
                    continue
                failures.append(f"INCONCLUSIVE: anon read of {table} errored: {str(exc)[:60]}")
                continue
            if rows:
                failures.append(f"LEAK: the anonymous publishable key reads {table}")

        # ---- 4: a user cannot forge ownership
        try:
            forged = sample_row("bodyweight_log", marker_a)
            forged["user_id"] = bob_id
            alice.table("bodyweight_log").insert(forged).execute()
            failures.append("LEAK: alice inserted a row owned by bob (WITH CHECK is missing)")
        except Exception:
            pass  # rejected, as it must be

    finally:
        # PostgREST refuses an unfiltered DELETE. `id is not null` matches every
        # row and is type-agnostic; RLS narrows it to this client's own rows.
        for client, marker, who in ((alice, marker_a, "alice"), (bob, marker_b, "bob")):
            for table in TABLES:
                try:
                    client.table(table).delete().not_.is_("id", "null").execute()
                except Exception:
                    pass
            try:
                client.auth.sign_out()
            except Exception:
                pass
        print(
            "\nCleaned up the rows. The two auth.users rows remain — delete them in\n"
            "Supabase -> Authentication -> Users, or with a service-role key."
        )

    print()
    if failures:
        print(f"FAILED — {len(failures)} problem(s):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print("RLS VERIFIED: each user reads only their own rows; the anon key reads nothing.")


if __name__ == "__main__":
    main()
