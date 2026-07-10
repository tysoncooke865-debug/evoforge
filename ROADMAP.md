# EvoForge — Roadmap

One rule drives the order: **do the things that are cheap now and impossible later.**
Identity and XP semantics get exponentially more expensive once real users have data.

The exciting features (PvP, AI judging) are last. Not because they're hard, but
because building them on a shaky identity and an unrankable XP metric means building
them twice.

---

## SHIPPED — the foundation is built (as of 2026-07-11)
Everything the launch used to be blocked on is live in production. See `TASKS.md`
DONE for the detail; this is the map.

| # | Task | State |
|---|---|---|
| 0,2,5 | Project memory · delete CSV fallback · Delete-Data hits Supabase | ✅ |
| 1,7 | `migrations/001`: `user_id` + RLS on all 11 tables | ✅ applied, verified `ANON LOCKED OUT` |
| 8,9,10 | Supabase Auth · RLS `user_id = auth.uid()` · per-user cache keys | ✅ |
| 3 | Unify XP — one curve in `domain/xp.py` | ✅ |
| — | `migrations/002` XP ledger · `003` server-side sum · `006` anti-cheat trigger | ✅ applied |
| 12 | Public display name + opt-in privacy (`public_profile`, `004`) | ✅ |
| 15 | **Leaderboards** — 4-column read surface (`005`), ranked by avatar level | ✅ live |
| — | Session survives a refresh — cookie + rotating refresh token (`auth/persistence.py`) | ✅ |
| — | Perf pass (render 44→8 DataFrame builds), XSS hardening, deps pinned on Py 3.13 | ✅ |
| 11 | 2500-row reads | ◐ `load_log()` projects; row cap remains (server-side `activity_totals()` RPC is the follow-up) |

---

## NOW — the real frontier

| # | Task | Why |
|---|---|---|
| — | **Validate workout *writes*** (rate limits / plausibility bounds) | The remaining anti-cheat gap. `006` stopped raw XP minting, but `workout_log` is user-writable, so fabricated sets earn real XP. Trust-on-first-use until this lands. **Do before advertising.** |
| 4 | Rotate `SUPABASE_SECRET_KEY` in the dashboard | Already out of `secrets.toml`; just the rotation. `verify_rls --anon-only` uses it as an env-var control. |
| 6 | Decouple `domain/xp_leveling.py` + `domain/custom_plan.py` from `streamlit` | The last two blockers to T14. `grep -l streamlit domain/*.py` must return nothing. |
| 13 | Achievements + streaks on the `xp_events` ledger | **Unblocked** — the ledger exists and has timestamps. Real "when earned", true streaks, no re-grant on edit. |
| — | Custom SMTP — the built-in mailer is rate-limited | Launch blocker for real signups at volume. |
| — | Re-enable "Confirm email" (`T1c`) | Off since the RLS cutover; anyone can register an unowned address, and sessions now persist 30 days. Accepted while unadvertised. |

---

## LATER — the product
| # | Task | Depends on | Note |
|---|---|---|---|
| 14 | Framework-free service layer + repository interface | 6 | The API seam. Makes the mobile port a port, not a rewrite. |
| 16 | Social profiles, following | 12 ✅ | `public_profile` is the seam; extend it. |
| 17 | **PvP battles** | 15 ✅, 16 | Turn-based/async on Streamlit. Real-time needs 14. Anti-cheat needs workout-write validation, not just the ledger. |
| 18 | Ranked seasons | 15 ✅ | Precompute; never query live. `leaderboard_top()` is the seam. |
| 19 | AI physique scoring at scale | 9 ✅ | Cache by photo hash, rate-limit per user. Vision calls are the dominant unit cost. |
| 20 | Payments / subscriptions | 8 ✅ | External checkout on Streamlit. Needs stable identity (have it). |
| 21 | Mobile client (React Native / PWA) | 14 | Streamlit cannot become a mobile app. `domain/` survives the frontend change. |

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
**PvP and AI judging are the fun parts.** They were last because their dependencies —
identity, tenancy, one trustworthy XP number, an anti-cheat ledger — were missing.
**As of 2026-07-11 those exist.** The last thing standing between the current state and
honest competition is **workout-write validation**: XP is only as trustworthy as the
`workout_log` rows it is derived from, and those are still user-writable with any date.
Close that before PvP or ranked seasons, or the scoreboard is a fiction.
