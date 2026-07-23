# Arena Vertical Slice Plan — polish pass (authored Phase 1, 2026-07-23)

Companion docs: `ARENA_VISUAL_AUDIT.md` (evidence), `KNOWN_POLISH_ISSUES.md`
(living checklist). Master brief: transform the working-but-boring Arena into
one polished, on-brand, satisfying battle slice. **No new systems, no new
modes, no engine-math rewrites, no server writes, stability preserved.**

## The slice (exact scope — resist widening it)

| Slice element | Choice |
|---|---|
| Arena | The ONE standard battle arena (used by battle/tutorial/ghost/gym-war — they share `ArenaScreen`, so one environment upgrade covers all) |
| Champions | All five official: Aesthetics, Titan, Mass Monster, The Shredder, Cardio Machine |
| Cards | 8–12 chosen from the existing 20 in Phase 8 (roles: tank, bruiser, ranged, assassin, support/heal, area, defensive response, cheap cycle). Non-featured cards stay functional, out of the default deck |
| Flows | Lobby → battle → result → rematch, plus the existing Gym War battle presentation (Phase 10). Tutorial keeps working but is not the polish target |
| Out of scope | New champions/cards/modes, multiplayer, monetisation, reward policy (Tyson's §6 decision), `gym_detail origin_path` migration, replay/battle-log visual overhaul |

## Definition of done (success criteria, testable)

- A battle screenshot no longer reads as a dev testbed: environment art,
  animated characterful units, projectiles, impact effects, full-bleed UI.
- Each champion is identifiable in-battle without reading its name, and team
  allegiance is never ambiguous (incl. mirror matches).
- Basic hit < heavy hit < ability < ultimate < core destruction is a visible
  (and, if audio lands, audible) escalation ladder.
- Match start has a deliberate intro; core death has a climax; result screen
  lands with ceremony and a working Play Again.
- All existing gates stay green: tsc, full vitest, expo lint, verify-tokens,
  verify-motion, verify-battle-engine, deep stability harness, web export.
- Replay digests unchanged for recorded battles (visual work is sim-inert).

## Phase map (this repo's concrete work items)

### Phase 2 — Arena presentation (Sonnet 5, high)
- Battlefield environment: layered pixel-art floor for the two lanes
  (dark cyberpunk gym: rubber-tile floor, painted lane lines, center line,
  neon edge lighting), background depth strip behind the enemy core.
  Implementation: background `Image`/`ImageBackground` per lane +
  screen-level backdrop, generated once as PNG (script or PixelLab tileable
  texture), pngquant-crushed. NO per-tick cost: static images only.
- Deployment zone: visible glowing boundary line + subtle hatch, brightening
  while a card is selected (state already exists in `arena-screen`).
- Forge Cores: bigger presence (reactor/monolith art at both lane ends
  inside the strip or enlarged CoreBar sprite treatment), damage states
  (intact/cracked/critical swap by health fraction — snapshot-driven like
  the existing shake).
- Pixel-safety: `imageRendering: 'pixelated'` on every arena Image (web),
  audit non-integer scales; keep sprite anchors consistent.
- Slightly widen lane visual separation (gutter glow, not layout change).

### Phase 3 — Replace the 1-bit look (Sonnet 5, high)
- **First step: validate PixelLab** (`PIXELLAB_AI_KEY` in `client/.env.local`,
  unused). If it delivers: generate the 5 champions (distinct silhouettes,
  ~32×32, S/N/W directions, idle/walk/attack/hit/death frames) + the slice's
  8–12 unit sprites + projectiles. If not: hand-build from a better CC0 pack
  (Kenney 16×16 colored RPG packs) via the existing
  `arena-sprite-tools.mjs` pipeline. Either way keep the fallback hierarchy:
  path+stage sprite → path base → styled placeholder → current 1-bit tile.
- Sprite sheet runtime: a tiny frame-strip component driven by the existing
  50ms frame (per-unit anim state = f(unit id, moving/attacking flags, age));
  NO Animated loops, NO new timers (doctrine in audit §G). CSS `steps()` is
  the proven web path elsewhere in the app (HANDOVER sprite lessons) but the
  arena already re-renders every 50ms — frame indexing is simpler and
  guard-safe.
- Team-vs-path encoding fix (audit C2): team = outline/base ring color
  (cyan/red painted INTO or around the sprite), path = body/accent colors.
  Mirror-match check becomes a required test/screenshot.
- Larger champions (~1.5× units), stronger silhouettes, 1px dark outline on
  every sprite for separation (also mitigates C1 stacking).
- Add `testID`s to arena screen/HUD/lane components while touching them
  (audit C6) so later phases can screenshot deterministically.

### Phase 4 — Combat-feel system (Fable 5, xhigh)
- Central `impact tier` model: light/medium/heavy/ultimate/core — one
  tuning table mapping tier → {hit-stop ms, shake px, flash, particle count,
  floater size}. Prevents everything-is-maximum.
- Screen shake: transform on the arena container (not per-core), amplitude by
  tier, reduced-motion-aware, hard cap.
- Hit-stop: brief visual-clock pause (freeze interpolation, NOT the sim tick
  — sim stays deterministic; the store keeps ticking, the renderer holds the
  last frame ≤80ms on heavy events).
- Attack cycle: anticipation (wind-up lean/back-swing frame) + strike +
  recoil on target (1–2px positional nudge, decays) — all render-layer,
  derived from attack log entries/cooldown phase; knockback stays visual-only
  unless the engine gains a logged impulse (do NOT change sim movement).
- Projectiles: spawn→target interpolated streaks with trail + impact burst
  for ranged units (log/snapshot-derived; engine may need a logged
  attack event carrying attacker id/target x — digest-inert, replay-verified).
- Engine fx log upgrade (small, audited): add unit ids to `fx hit` entries so
  flashes/recoil are id-matched (closes P6 proximity-match deferral). Keep
  replay digest byte-identical or version it deliberately.
- Ultimates: full-screen flash tint + slow-mo emphasis (visual interpolation
  stretch ≤400ms) + per-path burst; Core destruction: multi-stage break +
  shake + white-out into the result sequence (feeds Phase 9).
- Damage numbers: size/weight by tier, crits/executes emphasized (Shredder).
- Audio decision executes here if approved: tiny SFX set via expo-audio
  (deploy, hit light/heavy, death, ability, ult, core crack, win/lose),
  mute toggle in arena settings, default judged against fitness-app context.

### Phase 5 — Champion visual identities (Sonnet 5, high)
- Per-path FX kits keyed off the existing `path` in telegraph/impact
  derivation: Aesthetics cyan/gold precision flashes + symmetry; Titan ground
  cracks/shockwave rings + strongest shake; Mass Monster dust/pressure pulses
  + biggest persistent silhouette (oppressive, not explosive); Shredder
  slash arcs, purple/red streaks, execute cue; Cardio speed trails, pulse
  waves, rapid-hit rhythm.
- Champion sprites from Phase 3 carry the silhouette differentiation; this
  phase adds the effect language + HUD accents (ability/ult buttons and
  telegraphs already path-colored — extend to shapes, not just hue).

### Phase 6 — Battle readability (Sonnet 5, high)
- Stacking fix (C1): deterministic small lateral offsets for co-located
  units + draw-order (champions on top), verified with a crowded-battle
  screenshot.
- Card chips → readable mini-cards (C3): two-line name or tighter label set,
  cost badge, category color edge; selected/disabled/unaffordable states
  kept.
- Deploy zone affordance (C4) from Phase 2 verified under card-selected and
  invalid-tap states (invalid tap: red edge pulse + existing toast).
- Threatened-lane and core-danger states: momentum edge is presence-based —
  add core-danger treatment (bar pulse + vignette at ≤25%) reusing the
  severe tier.
- First-time-tester check: 10-second screenshot quiz (which side am I? which
  is my champion? what can I afford?) against captured frames.

### Phase 7 — Premium Arena UI (Sonnet 5, high)
- Full-bleed battle (D1): hide the main tab bar for `/forge-arena/battle`
  (+tutorial, gym-war battle) via the `(main)` tabs layout; verify no
  navigation break (back path, result → lobby, Android back).
- HUD treatment pass: pixel display font for numerals/labels (matching the
  main app's `PIXEL_BOLD` usage), consistent panel chrome (thin neon borders,
  subtle scanline/glow, EvoForge cyan), safe-area respected.
- Result overlay ceremony (D3): staged reveal (banner slam → stats count-up →
  rating tick → buttons), differing victory/defeat treatments; Play Again
  prominent. Keep the honesty copy verbatim.
- Menu screens minimum-touch: title screen gets the arena backdrop + champion
  sprite; lobby gets champion portrait panel (sprite + path color); champion
  select cards get sprite portraits. No restructure.

### Phase 8 — Slice roster (Fable 5, high)
- Pick the 8–12 featured cards; rebuild the default deck; verify roles,
  costs, counterplay; art/labels match battlefield behavior; leave the rest
  as non-featured content. Card-name truncation resolved for all featured
  names (C3).

### Phase 9 — Match-flow polish (Fable 5, high)
- Intro sequence: arena reveal → opponent line (name/difficulty or gym) →
  champion entrances (spawn poof+pose) → 3-2-1-FIGHT countdown gating the
  first tick presentation (sim can start paused-equivalent by delaying the
  loop start — NOT by changing tick logic).
- Escalation: sudden-death treatment (existing label + red wash/pulse),
  final-30s tension cue.
- Core-death climax → staged result (from Phases 4/7 pieces): brief hold on
  the dying core, then overlay.
- Play Again path verified clean (fresh seed, zero leaked FX/timers).

### Phase 10 — Gym Champions presentation (Fable 5, xhigh)
- Borrowed-champion entrance moment + clearer owner labeling in-battle
  (small nameplate on spawn, persistent distinct ring), squad preview polish
  in `gym-squad`/`gym-war`, contribution block ceremony on the result card.
  All presentation-only; ownership/progression data untouched; "(EST.)"
  honesty labels preserved.

### Phase 11 — Performance/stability hardening (Opus 4.8, xhigh)
- Re-run: full gates + deep harness (`ARENA_STABILITY_DEEP=1`), repeated
  rematch loop, leave-mid-match, background/resume, missing-asset fallbacks,
  low-end degradation flags (particle/shake/backdrop reduction), memory
  growth across 10 matches, corpse-cost check (audit §G), replay digest
  parity for any engine log additions.

### Phase 12 — Independent review (Opus 4.8, xhigh)
- Fresh-eyes tour with the Phase-3 testIDs, captures of the 8 required
  moments, `VERTICAL_SLICE_BUILD_REPORT.md`, honest readiness call.

## Standing constraints (every phase)

- Sim math, balance numbers, save schema: untouched unless a phase above
  explicitly says otherwise (engine fx-log additions in P4 are the only
  sanctioned engine edit, replay-verified).
- Zero server writes stays absolute (P13 audit is a contract).
- No ambient/continuous animation without real `useReducedMotion` gating —
  `verify-motion.mjs` will NOT catch hand-rolled loops (doctrine).
- Frame-driven FX off the existing 50ms loop; no new timers per effect; caps
  + TTL cleanup for every new effect kind; teardown on unmount/battle end.
- Every new asset: pngquant-crushed, fallback-covered, no broken-image path.
- Gates green + HANDOVER/PROGRESS/KNOWN_POLISH_ISSUES updated at every
  committed checkpoint; repo runnable at each phase end.
- `[architect]` commit tag only if a protected path is touched (engine log
  changes: check `tools/hooks` list).

## Session grouping + model schedule (operator settings)

| Session | Phases | Model | Effort |
|---|---|---|---|
| 1 (this) | 1 audit | Fable 5 | high |
| 2 | 2–3 | Sonnet 5 | high |
| 3 | 4 | Fable 5 | xhigh |
| 4 | 5–7 | Sonnet 5 | high |
| 5 | 8–9 (high) then 10 (xhigh) | Fable 5 | high→xhigh |
| 6 | 11–12 | Opus 4.8 | xhigh |

Session-start ritual: read `ARENA_VISUAL_AUDIT.md`,
`VERTICAL_SLICE_PLAN.md`, `KNOWN_POLISH_ISSUES.md`, latest build report,
`git log --oneline -15`, then verify the working tree yourself — do not trust
the previous session's summary.
