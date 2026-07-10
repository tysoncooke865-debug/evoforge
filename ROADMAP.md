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
| 1 | **Verify RLS by hand** in the Supabase dashboard | Ten minutes. Blocks everything. If RLS is off, the publishable key reads every row. |
| 2 | **Delete the CSV fallback** (`data/csv_store.py`, 7 domain call sites) | On Streamlit Cloud the disk is ephemeral *and shared*. Harmless today, a cross-user leak the day auth ships. |
| 3 | **Unify XP + add an append-only `xp_events` ledger** | Three formulas exist. The progress bar can never fill. You cannot rank on this, and fixing it after a leaderboard exists invalidates every historic rank. |
| 4 | Remove + rotate the unused `SUPABASE_SECRET_KEY` | Dead service-role credential sitting on disk. |
| 5 | Fix `Delete Data` to delete from Supabase, not only CSV | Deletions currently don't propagate. Becomes a GDPR problem the moment there are users. |
| 6 | Decouple `domain/xp_leveling.py` + `domain/custom_plan.py` from `streamlit` | The last two blockers to a framework-free service layer. Cheap now. |

---

## NEXT — identity
Everything here is blocked by NOW. Do not start until 1–3 are done.

| # | Task | Depends on |
|---|---|---|
| 7 | **Schema migration: `user_id uuid` on all 11 tables** + composite keys for `achievements` / `avatar_progression` | 2 |
| 8 | **Supabase Auth** (email + OAuth), login gate, session identity | 7 |
| 9 | **RLS policies** on every table: `user_id = auth.uid()` | 7, 8 |
| 10 | Per-user cache keys — `cached_sb_select(table, user_id)` | 8 |
| 11 | Scope every query by `user_id`; kill the 2500-row full-table reads; index `(user_id, date)` | 7 |
| 12 | User profiles (display name, avatar, privacy settings) | 8 |
| 13 | Achievements + streaks on top of the `xp_events` ledger | 3, 7 |

**Nothing ships publicly before 9 is verified.** Users' body measurements and physique
photographs are sensitive personal data.

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
