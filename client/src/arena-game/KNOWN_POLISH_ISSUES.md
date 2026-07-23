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
- [ ] A4 Title/lobby/champion screens are bare text lists, no art. → Phase 7. OPEN
- [ ] A5 Arena never uses the EvoForge pixel display font; theme values duplicated from tokens. → Phase 7 (font); token unification DEFERRED (product decision — two theme sources are pinned app-wide, see client/CLAUDE.md rarity-palette precedent). OPEN

## Combat feel
- [x] B1 Unit animation. DONE (Phase 4): champions have REAL 4-frame PixelLab walk cycles (frame-0 inpainting anchor + image_guidance 3.0 cracked the earlier turn-around failure); ALL units get sim-synced procedural attack animation (anticipation → strike lunge → lean), hit recoil, spawn drop-in, walk-bob. Unit walk frames remain optional future work (bob + attack cycle reads well at 26pt).
- [x] B2 Projectiles. DONE (Phase 4): cooldown-reset detection → fast team-colored streak + trail to the target (visual-only, 110ms).
- [x] B3 Hit-stop / screen shake / slow-mo. DONE (Phase 4): impact-tier table (TIER_FX); heavy hits 50ms hit-stop + shake, ultimates 0.35× slow-mo + path-color screen tint, severe core hits top-rung shake + 90ms stop. Store-level time dilation delays ticks, never skips (replay-safe, tested).
- [x] B4 PARTIAL: core-destruction CLIMAX done (1.1s hold, winner-colored wash, top shake, then result overlay). Battle intro/countdown remains → Phase 9. 
- [x] B5 Tier scaling. DONE (Phase 4): damage numbers size/weight by tier; light hits stay deliberately quiet.
- [ ] B6 Zero per-champion FX differentiation beyond hue. → Phase 5. OPEN
- [x] B7 Hit fx entries carry unit id + shield flag. DONE (Phase 4, digest-inert, legacy fallback kept + tested).

## Readability
- [ ] C1 Co-located units overprint into an unreadable pile (no stacking offset/draw order). → Phase 6. OPEN
- [x] C2 Opposing champions near-identical in mirror/path-tint situations. DONE (Phase 3: team-colored baked outlines + base plates on every character; art carries identity). Mirror-match screenshot check still owed in Phase 6.
- [ ] C3 Card names truncate on 390pt phones ("Emergenc…", "Javelin Mark…"). → Phase 6 (chip layout) + 8 (featured names). OPEN
- [x] C4 Deploy zone tint ~invisible; no idle affordance. DONE (Phase 2: visible boundary line + zone, both brighten while a card is selected; tour-verified).
- [x] C5 Arena Images lack `imageRendering: pixelated`. DONE (Phase 2/3: applied to floor, units, cores; DPR-4 zoom verified crisp).
- [ ] C6 Zero testIDs in the package — audits must click by coordinates. → Phase 3 (add while touching components). OPEN

## UI presentation
- [ ] D1 Main-app tab bar visible during battle (~70pt lost + accidental-exit risk). → Phase 7. OPEN
- [ ] D2 HUD panels functional but generic (system font, flat boxes). → Phase 7. OPEN
- [ ] D3 Result screen is static text; victory/defeat differ only by word/color. → Phase 7 (+9 sequence). OPEN
- [ ] D4 Cards are text chips — no art/frames on the primary interaction surface. → Phases 6+7 (+3 thumbnails if asset budget allows). OPEN

## Pipeline / assets
- [x] E1 PixelLab key validated and adopted (generate-image-pixflux at 64px low top-down is excellent; animate-with-text unusable for toward-camera walks; rotate south→north returned another front view). Pipeline: scripts/arena-pixellab-gen.mjs, pinned seeds, idempotent raws.
- [x] E2 Sprites pngquant-crushed (175→59KB); runtime fallback = colored dot / letter glyph (unchanged, never a broken image); legacy Kenney set kept on disk as documented fallback source.
- [ ] E3 NEW: unit sprites at 26pt occasionally read ambiguous at arm's length (cardio-runner reads bike-ish) — judge per-card during Phase 8 roster selection; regenerate individual raws (delete + re-run generate) where identity fails. OPEN

## Guardrails to re-verify after each phase (not issues — tripwires)
- Replay digest parity (any engine log change), deep harness 0 defects,
  full gate sweep green, no new timers/Animated loops, FX teardown on
  unmount, corpse-render cost not multiplied, zero server writes.
