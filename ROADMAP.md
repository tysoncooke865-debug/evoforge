# EvoForge — Roadmap

One rule drives the order: **do the things that are cheap now and impossible later.**
Identity and XP semantics get exponentially more expensive once real users have data.

The exciting features (PvP, AI judging) are last. Not because they're hard, but
because building them on a shaky identity and an unrankable XP metric means building
them twice.

---

## NOW — polish, optimise, prepare
No new features. Make the foundation safe to build on.

| # | Task | Why now |
|---|---|---|
| 0 | Project memory: `CLAUDE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TASKS.md`, `LOCAL_AI.md`, `tools/` | ✅ done — future sessions stop rediscovering |
| 2 | **Delete the CSV fallback** (`data/csv_store.py`, 7 domain call sites) | ✅ done — Supabase is the only store |
| 5 | Fix `Delete Data` to delete from Supabase, not only CSV | ✅ done |
| 1 | **Run `migrations/001_add_user_id_and_rls.sql`, then `tools/verify_rls.py`** | 🔴 **The only thing left before a public launch.** Auth exists; tenancy does not. Today every signed-in user reads every row. |
| 3 | **Unify XP + add an append-only `xp_events` ledger** | Three formulas exist. The progress bar can never fill. You cannot rank on this, and fixing it after a leaderboard exists invalidates every historic rank. |
| 4 | Remove + rotate the unused `SUPABASE_SECRET_KEY` | Dead service-role credential sitting on disk. |
| 6 | Decouple `domain/xp_leveling.py` + `domain/custom_plan.py` from `streamlit` | The last two blockers to a framework-free service layer. Cheap now. |

---

## NEXT — identity

| # | Task | Status |
|---|---|---|
| 7 | **Schema migration: `user_id uuid` on all 11 tables** + dedupe and composite key for `achievements` | ✅ written — `migrations/001`, **not yet run** |
| 8 | **Supabase Auth**, login gate, session identity, onboarding wizard | ✅ done |
| 9 | **RLS policies** on every table: `user_id = auth.uid()` | in `migrations/001`, **not yet applied** |
| 10 | Per-user cache keys — `cached_sb_select(_sb, table, user_id)` | ✅ done |
| 11 | Kill the 2500-row full-table reads; the `(user_id, date)` indexes are in `migrations/001` | pending |
| 12 | User profiles (display name, avatar, privacy settings) | pending |
| 13 | Achievements + streaks on top of the `xp_events` ledger | blocked by 3 |
| — | Session survives a page refresh (cookie component) | pending; see ARCHITECTURE §1 |
| — | Custom SMTP — the built-in mailer is rate-limited | launch blocker |

**Nothing ships publicly before 9 is applied and `tools/verify_rls.py` passes.**
Auth without RLS is a doorman with no walls: every signed-in user reads every row.
Users' body measurements and physique photographs are sensitive personal data.

---

## LATER — the product
| # | Task | Depends on | Note |
|---|---|---|---|
| 14 | Extract a framework-free service layer + repository interface | 6, 2 | The API seam. Makes the mobile port a port, not a rewrite. |
| 15 | Leaderboards | 3, 9 | Requires *one* XP formula and a ledger, or ranks are meaningless. |
| 16 | Social profiles, following | 12 | |
| 17 | **PvP battles** | 15, 16 | Turn-based/async on Streamlit. Real-time needs 14. Anti-cheat needs the ledger. |
| 18 | Ranked seasons | 15, 17 | Precompute; never query live. |
| 19 | AI physique scoring at scale | 9 | Cost control: cache by photo hash, rate-limit per user. Vision calls are the dominant unit cost. |
| 20 | Payments / subscriptions | 8 | Needs stable verified identity or entitlements and refunds break. External checkout on Streamlit. |
| 21 | Mobile client (React Native / PWA) | 14 | Streamlit cannot become a mobile app. |

---

## Dependency reasoning, stated explicitly

- **3 before 15.** You cannot rank users on a metric with three formulas. Fix XP after a
  leaderboard exists and every historic rank and season is invalidated.
- **2 before 8.** Shipping auth while a shared-disk CSV mirror still writes every row is
  shipping a data leak.
- **7 before 8.** Adding `user_id` to near-empty tables is a migration. Adding it after
  a thousand users have data is a backfill with no source of truth for who owned what.
- **9 before any public launch.** RLS is the only thing between one user and another's
  body data.
- **3 + 7 before 13.** Streaks need timestamped events, not a recomputed aggregate.
- **14 before 21.** Streamlit is not a mobile app. `domain/` is the only thing that
  survives the frontend change.
- **8 before 20.** Payments without stable identity means broken entitlements and
  unrefundable charges.
- **15 + ledger before 17.** PvP on a client-derivable XP score is trivially cheatable.

## Explicitly deferred, and why
**PvP and AI judging are the fun parts.** They are last because every one of their
dependencies (identity, tenancy, a single trustworthy XP number, an anti-cheat ledger)
is currently missing. Building them first guarantees rebuilding them.
