# EvoForge — autonomous QA / security / perf pass (2026-07-21)

Full-app test with the smoke accounts (ALPHA + BRAVO), a security audit, a
performance audit, and functional verification. Everything below is either FIXED
(committed) or a tracked observation. Migrations 078 (perf + a privacy gate) and
079 (security) are APPLIED + falsified.

## ✅ Fixed this pass

| # | Sev | Area | Issue | Fix |
|---|-----|------|-------|-----|
| 1 | **HIGH** | security | `report_pr_crossings` (072) trusted client `p_new_e1rm`/`p_prev_e1rm` → an attacker could fabricate a 99999 PR to **spam every friend** with `pr_beaten` notifications+pushes, and use the returned friend-id array as a **private-lift oracle**. | **079**: anchor to the caller's real server-side best (`v_base`), clamp the claim to a realistic band (new ≤ 1.6×base+25, prev ∈ [0.5×base, base]), reject no-history, cap targets at 25. |
| 2 | MED | security | `discover_gyms`/`gym_detail` `roster_power` summed member ratings **without a `show_evo` gate** — a solo public gym's roster_power = the owner's exact Evo rating, leaking a `show_evo=false` athlete's number to any browser. | **078**: gate each member's rating on `show_evo`, matching the individual-rating rule everywhere else. |
| 3 | **HIGH** | perf | `report_pr_crossings` did a correlated `max(estimated_1rm)` per friend over `workout_log` with only a `(user_id, date)` index — N+1 on the hottest write path (every PR). | **078**: `create index workout_log(user_id, exercise, estimated_1rm desc)` — also speeds every per-set PR/coin lookup (013/030/033/061). |
| 4 | MED-HIGH | perf | `discover_gyms` computed `member_count` 3× per row and ordered by it over all public gyms. | **078**: one `join lateral` aggregate. |
| 5 | MED | perf | Typeahead `LIKE '%q%'` on `display_name` / gym name can't use a btree. | **078**: `pg_trgm` GIN indexes (engage at scale; tiny tables still seq-scan, correctly). |
| 6 | MED | perf | Matchmaking 3s poll ran while the PWA was backgrounded and never timed out. | client `matchmaking.ts`: gate the poll on `document.hidden`, widen 3s→5s (Realtime is the primary signal). |
| 7 | BUG | UX | Live-match result modal stayed stuck after a win (tab navigator kept `/pvp` mounted). | fixed earlier (`onLeave` resets matchmaking state → runner+modal unmount, then navigate). Two-client verified. |

## ⚠️ Accepted / documented (no change)

- **[LOW security] `pvp_finish`/`pvp_forfeit` are client-authoritative** — the loser can call `pvp_finish(p_i_won=true)` first and record a win. Bounded to the **cosmetic** rivalry record (nothing farmable — no XP/coins). Acceptable per the "grants nothing farmable" posture. **If rivalry ever gains rewards, add a server referee that recomputes the winner from `pvp_moves` before crediting.**

## ✅ Verified functional (smoke accounts, live)

- **All 29 screens render** — Home, Train, Oracle, Social, Arena, Fuel + every
  `href:null` sub-route — with **0 console errors, 0 page errors, 0 5xx**.
- **Interactions work**: schedule save (toast), fuel manual target editor, social
  HYPE reaction, social tabs (rivals/discover/gyms), notifications inbox, friends
  name search, gym discovery search.
- **Real-time multiplayer** (two live clients): PvP Quick Match + fitness-duel
  matchmaking both pair into the same match; presence "N ONLINE" count; result
  modal dismiss.

## ✅ Audited clean (for the record)

RLS + definer gating solid across the new RPCs; no client-mintable XP/coins; no
exposed `EXPO_PUBLIC_*` secret; no `dangerouslySetInnerHTML`; `share_token` is a
uuid (not brute-forceable); presence channel has no leak; the shared `workout_log`
TanStack index invariant is intact; the online battle runner drives per-turn state
via refs (no re-render storm); LIKE patterns are values (no SQL injection).

## 📋 Backlog — noticed / would like to work on

**Multiplayer / battles**
- **Matchmaking has no "no opponent" fallback** — a lone searcher waits forever.
  Add a timeout → "still searching?" prompt and/or an AI-opponent fallback so a
  first mover isn't stuck. (MED — real UX gap now that codes are gone.)
- **Targeted friend challenge** was removed with the codes. Add it back as a
  DIRECT challenge (friend gets a notification → accept → match), since anonymous
  matchmaking can't express "fight THIS person."
- **RANKED is still a "COMING SOON" placeholder** — the Glicko-2 rating math
  already exists (028). Wire ranked quick-match on top of the 074 matchmaker.
- **Real-time ghost arena race** (`ghost_snapshots`, 009/028) is a dead table —
  the deferred Phase-3 "race a recorded run". Build or drop.
- **Two battle systems** (System A real-workout duel + System B champion RPG)
  share "arena/battle" naming — confusing. Consider unifying the vocabulary/UX.
- **Dead edge functions**: `battle-invite`/`battle-join` are unused after 077 —
  delete for cleanliness.

**AI / cost**
- The **AI vision judges on gpt-5.1 dominate cost** (see the cost chart). Where
  verdict consistency allows, route more to `gpt-5-mini` or widen the
  `ai_scan_cache`. Not deep-tested: `damage-assessment`, `evo-scan`, `meal-scan`
  actual AI submissions (they cost real calls) — worth a manual pass.

**Data / empty states**
- `muscle-lab`, `game-log`, `log`, `goals`, `streak`, `rank` render very short for
  a data-less account — confirm they populate correctly with real data (they're
  likely just empty states for ALPHA, but unverified with data).

**Consistency**
- The client `NotificationType` union had drifted from the DB (was missing
  `comment_reaction`/`comment_reply`); fixed alongside `pr_beaten`. Keep the union
  + the `VERB` record in sync with any new notification type (compile-forcing).
