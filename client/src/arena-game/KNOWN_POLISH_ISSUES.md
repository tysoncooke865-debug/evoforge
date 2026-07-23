# Known Polish Issues — living checklist for the vertical-slice pass

Tracks the visual/feel/readability issues from `ARENA_VISUAL_AUDIT.md`
(IDs refer to that doc) through the polish phases in
`VERTICAL_SLICE_PLAN.md`. Engineering-correctness issues stay in
`KNOWN_ISSUES.md` — this file is presentation only. Update status per phase
commit; add newly discovered polish issues here, never silently.

Status: OPEN · IN PROGRESS (phase) · DONE (phase, commit) · DEFERRED (why).

## Visual identity
- [x] A1 Battlefield is two empty flat boxes — no floor/environment/depth. DONE (Phase 2: PixelLab floor texture + center line + deploy boundary; tour-verified). Tuning note: floor amber strips slightly busy, deploy wash strength — judge in Phase 12.
- [x] A2 Units/champions are flat-tinted static Kenney 1-bit tiles. DONE (Phase 3: PixelLab character set, 5 champions + 10 units + cores; team = baked outline + base plate). Frame ANIMATION remains B1.
- [ ] A3 No audio or haptics anywhere. DEFERRED past Phase 4: adding an audio dependency (expo-audio) to a fitness app whose game is often played in public deserves Tyson's sign-off (default-muted? which SFX set?). All Phase 4 feedback shipped visual/temporal instead. Revisit at Phase 9 or on Tyson's call.
- [x] A4 Menu screens. DONE-enough (Phase 7): title wordmark in pixel face; lobby profile + champion select got real sprite portraits in path frames. Deck-builder/collection/gym screens stay text-first (functional, non-slice) — Phase 12 judges whether they need portraits too.
- [x] A5 Pixel font. DONE (Phase 7): Jersey10/25 family names pinned in arena theme (strings, not a fonts.ts import — its .ttf requires break the node test env). Token unification stays DEFERRED (product decision).

## Combat feel
- [x] B1 Unit animation. DONE (Phase 4): champions have REAL 4-frame PixelLab walk cycles (frame-0 inpainting anchor + image_guidance 3.0 cracked the earlier turn-around failure); ALL units get sim-synced procedural attack animation (anticipation → strike lunge → lean), hit recoil, spawn drop-in, walk-bob. Unit walk frames remain optional future work (bob + attack cycle reads well at 26pt).
- [x] B2 Projectiles. DONE (Phase 4): cooldown-reset detection → fast team-colored streak + trail to the target (visual-only, 110ms).
- [x] B3 Hit-stop / screen shake / slow-mo. DONE (Phase 4): impact-tier table (TIER_FX); heavy hits 50ms hit-stop + shake, ultimates 0.35× slow-mo + path-color screen tint, severe core hits top-rung shake + 90ms stop. Store-level time dilation delays ticks, never skips (replay-safe, tested).
- [x] B4 DONE: core-destruction CLIMAX (Phase 4) + battle INTRO (Phase 9: champions face-off + 3-2-1-FIGHT over a frozen sim via holdForIntro; plays on rematch too; tour-verified). Timer escalates amber <30s / red in sudden death.
- [x] B5 Tier scaling. DONE (Phase 4): damage numbers size/weight by tier; light hits stay deliberately quiet.
- [x] B6 Per-champion FX differentiation. DONE (Phase 5): per-path telegraph shapes (Titan shockwave+cracks / Mass pressure+dust / Shredder slashes / Cardio pulses / Aesthetics gold ring+sparks), Titan ability camera bump, Cardio speed afterimage, Shredder strike ghost.
- [x] B7 Hit fx entries carry unit id + shield flag. DONE (Phase 4, digest-inert, legacy fallback kept + tested).

## Readability
- [x] C1 Unit-pile overprint. DONE (Phase 6): computeStackOffsets lateral fan-out (id-stable, cycling slots, tested) + champions draw on top. Crowded-battle screenshot check owed in Phase 12.
- [x] C2 Opposing champions near-identical in mirror/path-tint situations. DONE (Phase 3: team-colored baked outlines + base plates on every character; art carries identity). Mirror-match screenshot check still owed in Phase 6.
- [x] C3 Card-name truncation. DONE (Phase 6/7: two-line mini-card chips; tour-verified full names on 390pt).
- [x] C4 Deploy zone tint ~invisible; no idle affordance. DONE (Phase 2: visible boundary line + zone, both brighten while a card is selected; tour-verified).
- [x] C5 Arena Images lack `imageRendering: pixelated`. DONE (Phase 2/3: applied to floor, units, cores; DPR-4 zoom verified crisp).
- [ ] C6 Zero testIDs in the package — audits must click by coordinates. → Phase 3 (add while touching components). OPEN

## UI presentation
- [x] D1 Tab bar in battle. DONE (Phase 7): hidden for the whole /forge-arena group; full-bleed verified. Watch for navigation complaints in arena MENUS (back header is the only way out now) — revisit if testers get lost.
- [x] D2 HUD treatment. DONE-enough (Phase 7): pixel display faces on timer/energy/wordmark/result banner. Further chrome (scanlines/glow) deliberately NOT added — restraint beats noise; Phase 12 judges.
- [x] D3 Result ceremony. DONE (Phase 7): staged reveal (banner slam → facts → rating → actions), outcome-colored border+glow, reduced-motion instant path; Playwright-verified mid-stage.
- [x] D4 Card chips. DONE (Phases 6+7): mini-cards with fighter sprite thumbnails, category top edges, cost badge.

## Pipeline / assets
- [x] E1 PixelLab key validated and adopted (generate-image-pixflux at 64px low top-down is excellent; animate-with-text unusable for toward-camera walks; rotate south→north returned another front view). Pipeline: scripts/arena-pixellab-gen.mjs, pinned seeds, idempotent raws.
- [x] E2 Sprites pngquant-crushed (175→59KB); runtime fallback = colored dot / letter glyph (unchanged, never a broken image); legacy Kenney set kept on disk as documented fallback source.
- [x] E3 DONE (Phase 8): cardio-runner → human sprinter, drone-archer → javelin thrower (matches the Javelin Marksman rename), support-drone → gym spotter with shield. Deck composition deliberately untouched (AI plays the starter deck — balance-coupled; see PROGRESS P8 decision).

## Gym presentation (Phase 10)
- [x] G1 Borrowed champions carry owner nameplates in-battle (engine ownerName, digest-neutral, tested) + Gym War intro squad row + sprite portraits in the War Squad builder. DONE (Phase 10).
- [ ] G2 On-screen gym-war verification OWED: smoke ALPHA is in no gym and creating one would write real, discoverable social data. Verify the intro squad row + nameplates visually in Phase 12 or Tyson's device pass (a private test gym with the two smoke accounts would do it).

## Guardrails to re-verify after each phase (not issues — tripwires)
- Replay digest parity (any engine log change), deep harness 0 defects,
  full gate sweep green, no new timers/Animated loops, FX teardown on
  unmount, corpse-render cost not multiplied, zero server writes.
