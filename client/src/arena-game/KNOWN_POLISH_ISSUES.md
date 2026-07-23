# Known Polish Issues — living checklist for the vertical-slice pass

Tracks the visual/feel/readability issues from `ARENA_VISUAL_AUDIT.md`
(IDs refer to that doc) through the polish phases in
`VERTICAL_SLICE_PLAN.md`. Engineering-correctness issues stay in
`KNOWN_ISSUES.md` — this file is presentation only. Update status per phase
commit; add newly discovered polish issues here, never silently.

Status: OPEN · IN PROGRESS (phase) · DONE (phase, commit) · DEFERRED (why).

## Visual identity
- [ ] A1 Battlefield is two empty flat boxes — no floor/environment/depth. → Phase 2. OPEN
- [ ] A2 Units/champions are flat-tinted static Kenney 1-bit tiles. → Phase 3. OPEN
- [ ] A3 No audio or haptics anywhere. → Phase 4 (decision + SFX set). OPEN
- [ ] A4 Title/lobby/champion screens are bare text lists, no art. → Phase 7. OPEN
- [ ] A5 Arena never uses the EvoForge pixel display font; theme values duplicated from tokens. → Phase 7 (font); token unification DEFERRED (product decision — two theme sources are pinned app-wide, see client/CLAUDE.md rarity-palette precedent). OPEN

## Combat feel
- [ ] B1 No unit animation (idle/walk/attack/hit/death) — units glide. → Phase 3 (frames) + 4 (cycle timing). OPEN
- [ ] B2 No projectiles for ranged units. → Phase 4. OPEN
- [ ] B3 No hit-stop / camera shake / slow-mo; core-sprite shake is the only screen response. → Phase 4 (impact tiers). OPEN
- [ ] B4 No battle intro/countdown; result overlay pops the frame the core dies; core destruction has no climax. → Phases 4+9. OPEN
- [ ] B5 Existing P6 FX (flash/floaters/telegraphs/poofs) read as small ticks, not impact. → Phase 4 (tier scaling). OPEN
- [ ] B6 Zero per-champion FX differentiation beyond hue. → Phase 5. OPEN
- [ ] B7 Hit fx entries carry no unit id (proximity-matched flash; P6 deferral). → Phase 4 engine log addition, replay-verified. OPEN

## Readability
- [ ] C1 Co-located units overprint into an unreadable pile (no stacking offset/draw order). → Phase 6. OPEN
- [ ] C2 Opposing champions near-identical in mirror/path-tint situations; team read hangs on a thin ring. → Phase 3 (encoding) + 6 (verify). OPEN
- [ ] C3 Card names truncate on 390pt phones ("Emergenc…", "Javelin Mark…"). → Phase 6 (chip layout) + 8 (featured names). OPEN
- [ ] C4 Deploy zone tint ~invisible (0.08 alpha); no idle affordance. → Phase 2, verified Phase 6. OPEN
- [ ] C5 Arena Images lack `imageRendering: pixelated`; 64px sprites drawn at 18/24/28pt non-integer scale (rest of app sets it). → Phase 2. OPEN
- [ ] C6 Zero testIDs in the package — audits must click by coordinates. → Phase 3 (add while touching components). OPEN

## UI presentation
- [ ] D1 Main-app tab bar visible during battle (~70pt lost + accidental-exit risk). → Phase 7. OPEN
- [ ] D2 HUD panels functional but generic (system font, flat boxes). → Phase 7. OPEN
- [ ] D3 Result screen is static text; victory/defeat differ only by word/color. → Phase 7 (+9 sequence). OPEN
- [ ] D4 Cards are text chips — no art/frames on the primary interaction surface. → Phases 6+7 (+3 thumbnails if asset budget allows). OPEN

## Pipeline / assets
- [ ] E1 PixelLab key provisioned but unvalidated — confirm API access, license terms, output quality before committing Phase 3 to it; fallback = curated CC0 pack through arena-sprite-tools.mjs. OPEN
- [ ] E2 New sprite sheets need the pngquant diet + fallback hierarchy (path+stage → path base → styled placeholder → 1-bit tile). OPEN (standing rule)

## Guardrails to re-verify after each phase (not issues — tripwires)
- Replay digest parity (any engine log change), deep harness 0 defects,
  full gate sweep green, no new timers/Animated loops, FX teardown on
  unmount, corpse-render cost not multiplied, zero server writes.
