# EvoForge Arena — Overnight Hardening Run Report

**Branch:** `expo-rewrite` · **Package:** `client/src/arena-game/**` · **Date:** 2026-07-23
**Balance:** 0.6.0 · **Save schema:** v6 · **Verified by:** Phase 14 final sweep (this document)

---

## 1. TL;DR — what the Arena is now

The Arena is a deterministic, replay-verifiable autobattler living entirely inside EvoForge
(`/forge-arena`), fielding the **five official EvoForge champions** — Aesthetics, Titan,
Mass Monster, The Shredder, Cardio Machine — one per live BranchV2 path, each with a distinct
kit and a data-driven passive. Your champion's power is shaped (never more than ±12%) by your
**real** Evo sub-ratings, and your Arena avatar shows your **real** evolution stage (The Shredder's
from body-fat, the rest from your live level ledger). Everything the Arena *awards* —
Arena Rating, battle stats, gym contribution — is device-local and cosmetic: the package makes
**zero** server writes, mints no XP, and fabricates no fitness data (P13 protection audit: clean).
Onboard → tutorial → build a deck → pick a champion → battle three AI tiers with synergies,
augments and fitness-scaled champions → ghost battles and replays → gym squads and Gym Wars.
It is beta-ready as a fully local experience; the only real gaps left are policy decisions for
Tyson (see §6), not defects.

---

## 2. Phase-by-phase

| Phase | Commit | What changed | Headline |
|---|---|---|---|
| P1 audit | `8fbb9de` | Integrated audit + package docs (ARENA_BETA_AUDIT / PROGRESS / KNOWN_ISSUES / ARENA_BALANCE) | 11 findings classified; baseline gates green |
| P2+P3 | `7891ea4` | Official five-champion roster keyed to BranchV2 slugs; real progression (real stage, dev editor demoted); Mass Monster new kit + one passive each | Balance 0.6.0, save v5; 0 player-facing speedster/hybrid |
| P4 | `864319f` | Engine-reliability review — 8 adversarial defects fixed (null-target throw, malformed schedule, unvalidated scaling, command cap, Cardio Lane Shift ping-pong) | reject-never-throw restored; audit #5 closed |
| P4 addendum | `d2609c3` | Passive-correctness review; tick-0 synergy-on logging fix | 1 log-only fix, 0 digest impact |
| P5 | `67fff03` | Stability harness at five champions — full 5×5 matrix + squads + ghosts | 208 matches (383 deep), **zero defects** |
| P6 | `24bdb6b` | Combat FX layer (hit flash, telegraphs, core shake, deploy/summon poofs) | frame-driven, sim untouched, 0 digest impact |
| P7 | `39c4f15` | Readability pass (chevrons, low-health color, lane momentum, energy pips) | fixed `pathCardio` == player-cyan hex collision |
| P8 | `9f12a5e` | Five-champion balance tune from deep-harness data | spread 18 → 7 pts, all in **[46, 53]** |
| P9 | `7ab68b1` | Cards/synergies official-terminology pass (6 renames, 2 retags, 2 new synergies) | every path has fighter-card + synergy coverage; still 20 cards |
| P10 | `ffadca6` | AI champion-path tendencies + seed-varied openings + re-tune | all five in **[45, 54]**; Titan +70 HP, Shredder charge trim |
| P11 | `d60585b` | Player journey + tutorial gating + identity sync | save v6; tutorial off the ladder; Arena Rating naming |
| P12 | `4fa1daf` | Gym Champions vertical slice — official-path roles, synergy preview, honesty copy | no schema change; roles NAME existing kits |
| P13 | `c4b3fc9` | Reward-safety protection audit | **CLEAN** — no violations, no code change |
| P14 | (this run) | Final verification + report | all gates green |

---

## 3. The final state

### Champions (kits + passives + roles)

| Champion (`path`) | Stats | Passive | Ability | Ultimate | Gym role |
|---|---|---|---|---|---|
| **Aesthetics** (`aesthetic`) | 1150 HP · 66 dmg/1.0s · spd 0.24 | **Flow State** — team +10% healing while alive | Stance Shift (Bulwark/Assault) | Forge Rally (allies +25% dmg, 150 heal) | Coach (team aura) |
| **Titan** (`titan`) | 1470 HP · 70 dmg/1.5s · spd 0.16 | **Iron Hide** — every hit −5 flat (min 1) | Quake Stomp (both-lane stun) | Seismic Smash (320 dmg + stun) | Anchor (self) |
| **Mass Monster** (`mass`) | 1820→2002 HP · 55 dmg/1.4s · spd 0.14 | **Colossal Frame** — +10% max HP baked at spawn | Gravity Well (both-lane slow to 60%) | Mass Uprising (summon 2 Titan Guards) | Bulwark (self) |
| **The Shredder** (`shredder`) | 750 HP · 90 dmg/1.1s · spd 0.26 | **Killer Instinct** — own hits +25% vs <35% HP | Phase Dash (120 dmg, reach) | Final Cut (250; executes <30%) | Finisher (self) |
| **Cardio Machine** (`cardio`) | 850 HP · 45 dmg/0.6s · spd 0.34 | **Perpetual Motion** — team energy regen ×1.05 while alive | Lane Shift (join-combat gated) | Overclock (2× atk speed, +1 energy refund) | Pacer (team aura) |

### Balance — win rates (deterministic deep harness, 362 matches, `ARENA_STABILITY_DEEP=1`)

| Champion | Fielded | Win% | Band [42, 58] |
|---|---|---|---|
| The Shredder | 120 | 54% | ok |
| Mass Monster | 127 | 54% | ok |
| Titan | 129 | 50% | ok |
| Cardio Machine | 123 | 47% | ok |
| Aesthetics | 137 | 45% | ok |

**9-point spread, all five inside [45, 54].** 362/362 completed, 0 stalls, 0 errors,
0 invariant violations (checked every tick on 304 of 362), 1 rejected command (the documented
report-only same-tick invalidation), 30/30 ghost replays digest-identical, 0 borrowed-champion
ultimate casts. Side bias free (training 48/52, standard 47/53, advanced 39/61 — the last
reflects genuine skill, not lane advantage).

### Content + test counts

| Metric | Value |
|---|---|
| Champions | 5 (exactly one per path, pinned names as validation errors) |
| Cards | 20 (within the 12–20 requirement) |
| Synergies | 7 (every path has one identity synergy + 2 cross-path) |
| Arena tests | 487 (26 files) |
| Full-project tests | 1,558 (98 files) — arena +169 since the P1 baseline of 318 |

### Gate sweep (run from `client/`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — clean, 0 errors |
| `npx vitest run` (full) | **PASS** — 98 files / 1,558 tests |
| `npx vitest run src/arena-game` | **PASS** — 26 files / 487 tests |
| `npx expo lint` | **PASS** — 0 errors (7 documented warnings: unused vars in tests, inert `no-console` disables) |
| `node scripts/verify-tokens.mjs` | **PASS** — 56 tokens + 2 overrides match; 591 files clean |
| `node scripts/verify-motion.mjs` | **PASS** — 14 looping components, all reduced-motion gated |
| `node scripts/verify-battle-engine.mjs` | **PASS** — parity 18026 bytes × 3 |
| deep stability harness | **PASS** — 362 matches, 0 defects (table above) |
| `npx expo export -p web` | **PASS** — 130 routes; all 25 `/forge-arena` routes emit incl. all 5 champion pages |

**No arena failures. No other-session failures** — the full suite is green including the
concurrently-edited `data/`/`domain/`/`today.tsx` files (non-arena test count moved 1069 → 1071,
the other session's new muscle-lookup test).

---

## 4. What was protected (P13 verdicts, verified against source)

- **Zero server writes** — the package's entire external surface is one read-only `@/data/supabase`
  client; every call is a `.select`/read RPC. No insert/update/upsert/delete anywhere.
- **No XP minting** — no `xp_ledger`/`xp_events` writes; no `@/data/mutations` or `hooks` imports;
  all completion paths write only the local per-user save.
- **No fabricated fitness data** — `evo_rating_current`/`profiles`/`bodyfat_log`/`user_progression`
  are read-only; the dev-mock editor is inert in the integrated app.
- **No duplicate progression** — Arena Rating is Arena-local and cosmetic; avatar stage is the real
  derivation; Forge Level is only ever read.
- **Farm-proof** — rating/stats/contribution are device-local; farming harms only the farmer;
  ghost battles move zero rank.
- **Sign-out teardown** — `resetArenaSession` stops the battle loop and drops in-memory state,
  wired into auth-context; `u/<userId>/` namespacing blocks cross-account leakage.
- **No photos/PII** — zero camera/media references; feedback export is user-initiated Share only.
- **Untrusted-data paths fail safe** — records/ghosts parse corrupt-safe and scaling-bounded, and
  only ever drive offline replays.

---

## 5. Known issues + deferred work (honest, the important ones)

- **Gym-mate identity is ESTIMATED** (audit #4, still open by design). `gym_detail` RPC exposes only
  display_name/forge_level/evo_rating, so gym members' champion paths are synthesized from a
  deterministic hash over the five slugs, sub-ratings clone the evo_rating, and stages estimate from
  Forge Level — all surfaced as "(EST.)". The real fix is a `gym_detail origin_path` migration
  (shared-schema, not done in the Arena package — see §6).
- **Ledger-behind athletes may briefly see an earlier stage** in the Arena than on the avatar screen:
  EvoForge floors the ledger at the log-derived XP total, which a pure profile query can't recompute.
  Always under-states, never inflates.
- **Balance <0.6.0 records are cleanly unplayable** — old battle records stay listed with the
  stale-balance explanation and disabled Watch/Fight (established gate). Not destructive.
- **Ghost fidelity is best-effort** — a fresh-seed ghost's card plays that fall outside its rotating
  hand are rejected and the battle continues (reliability over fidelity). Deckless records replay
  perfectly.
- **Borrowed champions never ultimate** (simplified build) and **warContribution is a participation
  proxy**, not damage attribution (needs per-unit damage tracking).
- **Perf backlog** (measured, non-blocking): corpse accumulation raises late-battle tick cost to
  ~0.5–1.3ms (≈2.6% of the 50ms budget); replay-open re-simulates behind a spinner.
- **Feedback export no-ops** on browsers without the Share API (fail-soft; clipboard fallback is
  backlog).
- **Sprites are static 1-bit** — P6/P7 added reactive FX (floaters, telegraphs, core shake) but the
  champion sprites themselves don't animate.

---

## 6. What needs Tyson (decisions only he can make)

1. **XP / reward policy.** Battle results are deliberately cosmetic (Arena-local rating only) pending
   your call on whether Arena wins should mint real Forge XP or Evo movement. If yes, it needs an
   `xp_events`-writing migration + the append-only guard-trigger path — an explicit, audited server
   change, not something the overnight run would do on its own.
2. **`gym_detail origin_path` migration.** The one change that turns estimated gym-mate identities
   into real ones. It's a shared-schema RPC change (protected), so it was flagged, not executed.
   Adding `origin_path` (and ideally per-pillar ratings) to `gym_detail` is the real fix for audit #4.
3. **On-device testing pass.** Every phase was verified via tsc + vitest + `expo export` static render
   only — there's no emulator/device on the build machine. Do one manual pass on a small and a large
   phone (Expo Go), with VoiceOver/TalkBack, before wide beta. This is the standing gap since M1.
4. **Whether to narrow the balance spread further.** All five champions are inside the required band,
   but Aesthetics (45%) and the Shredder (54%) sit near the edges. Tuning lever is the TENDENCY table
   (`features/arena/champion-tendencies.ts`), never champion stats — only if playtesting shows a real
   problem.

---

## Audit closure (findings #1–#11)

| # | Sev | Finding | Status | Verified |
|---|---|---|---|---|
| 1 | CRITICAL | Champion identity vs official roster | **RESOLVED** (P2) | 5 champions, names pinned as validation errors |
| 2 | HIGH | Avatar/evolution stage not real | **RESOLVED** (P3, 1 documented approximation) | Shredder body-fat derivation in `progression-mapping.ts` |
| 3 | HIGH | Dev fitness editor misleading | **RESOLVED** (P3) | no lobby/title button; debug-only; DEV MOCK banner |
| 4 | HIGH | Gym member paths synthesized | **OPEN / DEFERRED** | needs `gym_detail origin_path` migration (§6) |
| 5 | HIGH | Cardio Lane Shift ping-pong | **RESOLVED** (P4) | `laneShiftJoinsCombat` join-only gate |
| 6 | MEDIUM | "Rank points" vs Rival Rank | **RESOLVED** (P11) | rank screen titled/copied "Arena Rating" |
| 7 | MEDIUM | Corpse accumulation perf | deferred (fix sketch) | KNOWN_ISSUES |
| 8 | MEDIUM | Replay re-sim spinner | deferred | KNOWN_ISSUES |
| 9 | MEDIUM | Onboarding name step duplicates display name | **RESOLVED** (P11) | name step removed; identity synced from provider |
| 10 | COSMETIC | Static sprites | addressed (P6/P7 reactive FX) | sprites still 1-bit static |
| 11 | COSMETIC | Feedback export no-op without Share API | deferred (fail-soft) | KNOWN_ISSUES |

All CRITICAL/HIGH findings are resolved except #4, which is a shared-schema migration deliberately
left for Tyson.
