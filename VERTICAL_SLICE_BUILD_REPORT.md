# EvoForge Arena — Vertical Slice Build Report

**Program:** Arena polish pass, Phases 1–12 · **Date:** 2026-07-23
**Branch:** `expo-rewrite`, commits `93877b3` → `23bad44` (+ this report)
**Baseline:** `b5ed70f` (post overnight-hardening, balance 0.6.0, save v6)
**Reviewer stance:** this section re-verified claims against the running
export and the deep harness — it does not take the phase reports' word.

---

## 1. Verdict

**The Arena is no longer a boring 1-bit prototype — it is a presentable,
coherent, stable pixel-art vertical slice.** Side-by-side against the
Phase 1 baseline captures, every screen of the core loop transformed:
real characterful sprites on a cyberpunk gym floor, an escalation ladder
of combat feedback, a face-off countdown intro, a staged result ceremony,
full-bleed premium UI in the EvoForge pixel face. Simulation behavior is
provably unchanged (identical deep-harness win rates, byte-identical
replay digests). It is ready for testers and screen recordings, with the
specific caveats in §6 — the most important being that **nothing has been
verified on a real phone** and **one suspicious difficulty signal needs a
human playtest**.

## 2. What was improved (by system)

- **Assets (Phases 2–3, 8).** All battle art is AI-generated via PixelLab
  under Tyson's key through a committed, idempotent, seed-pinned pipeline
  (`client/scripts/arena-pixellab-gen.mjs`): 5 champions with distinct
  physiques + path colors baked in the art, 10 fighter units (3 regenerated
  in P8 when their silhouettes contradicted their card names), Forge Cores
  with cracked damage variants, a lane floor texture, and 4-frame champion
  walk cycles (the animate-with-text turn-around failure was solved with a
  frame-0 inpainting anchor + image_guidance 3.0). 75 game PNGs, 161KB
  crushed. Team identity = baked outline + base plate + health bar +
  chevron; art carries character identity — one generation serves both
  sides, and mirror matches stay readable.
- **Combat feel (Phase 4).** One tier table (`impact.ts`): light hits stay
  quiet; heavy hits shake + 50ms hit-stop; ultimates slow time 0.35× under
  a path-colored wash; severe core hits rank highest; core destruction
  holds a 1.1s climax before the result lands. Store-level time dilation
  delays ticks, never skips them (fake-timer tested; replay digests
  untouched). Sim-synced procedural character animation: anticipation →
  strike lunge → recoil, spawn drop-in, walk-bob; ranged units fire
  visible projectiles; hit flashes are id-matched via two new digest-inert
  fx-log fields (closing a P6 deferral, legacy replays fall back).
- **Champion identity (Phase 5).** Per-path telegraph shapes (Titan
  shockwave+cracks, Mass pressure+dust, Shredder slash arcs, Cardio pulse
  lines, Aesthetics gold ring+sparks), Titan-only ability camera bump,
  Cardio speed afterimage, Shredder strike ghost.
- **Readability (Phase 6).** Unit piles fan out laterally (id-stable
  offsets, tested), champions draw on top, core-danger crimson edges,
  two-line card names (truncation fixed), visible deploy boundary that
  brightens with a selected card.
- **UI (Phase 7).** Tab bar hidden across the arena (full-bleed battle),
  Jersey pixel faces on timer/energy/wordmark/result banner, mini-card
  chips with sprite thumbnails + category edges, sprite portraits on
  champion select + lobby, staged result ceremony with outcome-colored
  treatment.
- **Match flow (Phase 9).** 3-2-1-FIGHT intro over a frozen sim
  (`holdForIntro`, capped, replay-safe, replays on Rematch), timer
  escalation (amber <30s, red sudden death).
- **Gym presentation (Phase 10).** Owner nameplates on borrowed champions
  (engine `ownerName`, digest-neutral, tested), a FIGHTING BESIDE YOU
  squad row in Gym War intros, sprite portraits in the War Squad builder.

**Files:** 148 changed / +3,582 −272 across 6 commits; 27 code files, the
rest assets + docs. Full inventory: `git diff --stat b5ed70f..23bad44`.

## 3. Stability & performance findings (Phase 11, re-verified)

- **Deep harness (`ARENA_STABILITY_DEEP=1`), run on the final build:**
  362/362 matches completed, 0 stalls, 0 errors, 0 invariant violations
  (checked every tick on 304), 30/30 ghost replays digest-identical.
- **Champion win rates are IDENTICAL to the pre-polish baseline** —
  Shredder 54%, Mass 54%, Titan 50%, Cardio 47%, Aesthetics 45% — the
  strongest possible evidence that ten phases of visual work changed
  nothing in the sim.
- **Timers audited:** five timer sites in the package (battle loop, toast,
  intro, climax, result ceremony) — every one has an unmount cleanup AND a
  self-termination path; the screen resets the store (loop + dilation +
  intro hold) on unmount, and sign-out teardown was already wired (P13).
- **Repeated matches:** a new store test drives 3 consecutive battles with
  abandoned mid-battle holds — no dilation/hold state leaks; the review
  tour rematch-looped 3 real battles in the browser with fresh intros and
  ceremonies each time, no console page-errors.
- **Per-frame cost of the new render derivations** (stack offsets + pose
  math at a 40-unit worst case): **6.9µs ≈ 0.014% of the 50ms frame
  budget** (measured). All FX remain capped + TTL-pruned; no Animated
  loops anywhere (verify-motion green); the one continuous effect
  (walk-bob/cycles) is movement-driven and reduced-motion gated.
- **Degradation switches:** deliberately NOT added — existing caps,
  reactive-FX doctrine and the reduced-motion gate cover the need; a
  quality setting would be new surface without evidence it's needed.
- **Gates on the final build:** tsc clean · arena 28 files/514 tests ·
  full suite 1,585 · lint 0 errors (7 documented warnings) ·
  verify-tokens/motion/battle-engine green · web export green.

## 4. Manual review of the running build (Phase 12)

Reviewed moments (phone-sized Playwright captures against the export,
compared with the Phase 1 baseline): battle intro with countdown ·
mid-game crowd with traded core damage · late game · core-destruction
climax (wash + held overlay) · defeat ceremony (staged reveal) · rematch
loop ×3 · title/lobby/champion-select/deck screens · DPR-4 sprite crop.

First-impression test against the audit's goals: which side am I (team
plates/outlines — instant), which is my champion (biggest sprite +
plate — instant), what can I afford (dimmed chips + red cost — instant),
why did the match end (reason line on the ceremony — instant). The
"looks like a real game" bar is met on web.

**Not captured, stated plainly:**
- **No VICTORY screenshot.** Five scripted battles (three blind-clicker,
  two deliberate) all LOST to the Training AI. Defeat ceremony is
  verified; the victory treatment differs only by banner/color/wash and
  is code-shared, but it has not been seen on screen. See finding §5.1.
- **No gym-war on-screen capture** (KNOWN_POLISH_ISSUES G2): the smoke
  account is in no gym and creating one writes real, discoverable social
  data. Engine-tested; components reuse tour-verified patterns.
- **Nothing on real hardware** — the standing gap since M1 (§6).

## 5. Findings from this review

1. **HIGH (playtest, not code): Training AI may be too strong for the
   entry tier.** Five scripted players lost five straight, mostly fast.
   Weak evidence (scripted players are genuinely bad — energy-blind,
   selection-toggling), and AI-vs-AI training matches are a healthy
   48/52 — but harder tiers are win-gated, so a new player who cannot
   beat Training (tutorial aside) is stuck on the ladder floor. Needs one
   human session; if confirmed, tune via the TENDENCY table or a
   training-only AI handicap — never champion stats (ARENA_BALANCE rule).
2. **MEDIUM: no automation hooks in the arena (audit C6 still open).**
   Every tour drives the battle by screen coordinates; one mis-click
   navigated a whole run astray. Adding testIDs to lanes/chips/buttons is
   cheap and would make Phase-12-style reviews robust.
3. **LOW: floor texture repetition** — the amber accent strips tile
   noticeably on tall phones. Cosmetic; a second floor variant or darker
   accent would fix it.
4. **LOW: intro overlaps the augment picker in principle** — not
   observed (augments offer mid-battle, intro is over by then), noted for
   the record.

## 6. What still needs Tyson (unchanged + new)

1. **On-device pass** (small + large phone, VoiceOver/TalkBack) — every
   verification this program ran was desktop-browser Playwright at phone
   viewport. Pixel fonts, safe areas, touch feel and PWA behavior need
   real hardware.
2. **One human playtest of Training difficulty** (finding §5.1).
3. **Gym-war visual check** on a device (or bless a private smoke gym so
   automation can cover it — G2).
4. Standing pre-polish items: XP/reward policy, `gym_detail origin_path`
   migration, custom SMTP for signups.
5. **Audio remains absent by choice** (public-gym context) — the combat
   ladder is visual/temporal only until you call it (A3).

## 7. Recommended next step

Ship this build to a handful of testers with a feedback prompt focused on
(a) Training difficulty, (b) whether combat feels weighty on real phones,
(c) whether the intro/ceremony pacing feels tight or slow. Fix from
evidence. The single highest-value engineering follow-up is testIDs
(finding §5.2), which makes every future review cheap.
