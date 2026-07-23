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
- [ ] A3 No audio or haptics anywhere. → Phase 4 (decision + SFX set). OPEN
- [ ] A4 Title/lobby/champion screens are bare text lists, no art. → Phase 7. OPEN
- [ ] A5 Arena never uses the EvoForge pixel display font; theme values duplicated from tokens. → Phase 7 (font); token unification DEFERRED (product decision — two theme sources are pinned app-wide, see client/CLAUDE.md rarity-palette precedent). OPEN

## Combat feel
- [ ] B1 No unit animation frames — units glide. PARTIAL (Phase 3: movement-driven walk-bob with per-unit phase, reduced-motion gated; white-silhouette hit flash). Full frame cycles DEFERRED: PixelLab animate-with-text degrades/turns the character on toward-camera walks (tested); revisit with skeleton animation or hand frames in Phase 4 only if bob reads as insufficient.
- [ ] B2 No projectiles for ranged units. → Phase 4. OPEN
- [ ] B3 No hit-stop / camera shake / slow-mo; core-sprite shake is the only screen response. → Phase 4 (impact tiers). OPEN
- [ ] B4 No battle intro/countdown; result overlay pops the frame the core dies; core destruction has no climax. → Phases 4+9. OPEN
- [ ] B5 Existing P6 FX (flash/floaters/telegraphs/poofs) read as small ticks, not impact. → Phase 4 (tier scaling). OPEN
- [ ] B6 Zero per-champion FX differentiation beyond hue. → Phase 5. OPEN
- [ ] B7 Hit fx entries carry no unit id (proximity-matched flash; P6 deferral). → Phase 4 engine log addition, replay-verified. OPEN

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
