# Champion Battles → FireRed-class (plan, 2026-07-18)

> Tyson: "different animations based off the unique attacks, more dynamic and
> interesting gameplay, and a better game." This plan layers Pokémon FireRed's
> presentation grammar and strategic depth onto the EXISTING deterministic
> engine — no rewrite. Every phase is independently shippable.

## What already exists (don't rebuild)
- Pure deterministic engine (`domain/battle-rpg/`): 17 moves with categories,
  stamina costs, cooldowns, statuses (bleed/guard/etc.), special mechanics
  (execute_below, stronger_if_bleeding, combo_bonus), PRIORITY already in the
  turn-order rules, RNG threaded for exact tests.
- Event queue with 780ms beats + tap-to-fast-forward; typewriter battle text.
- POV stage: idle bob, anticipation wind-up → lunge → knockback, impact burst
  rings (crit-tinted), screen shake, crit white-blink, mode haze.
- HP/stamina bars with the damage-trail ghost; status chips; floating numbers.
- 7 `animationType`s and 6 `theme` colours on moves — the hooks for per-move FX.
- Retro synth SFX (hit/crit/heal/victory/defeat) that mixes with music.

## The FireRed grammar being adopted
Turn beat = TEXT ("X used MOVE!") → UNIQUE MOVE ANIMATION → IMPACT → HP
DRAINS OVER TIME with colour stages → CONSEQUENCE TEXT ("A crushing blow!",
"It's super effective!", status lines) → next actor. Entry ceremony, faint
slide, low-HP tension, and a type triangle that makes move choice matter.

---

## Phase A — Per-move animation system ✅ SHIPPED 2026-07-18 (gym-flavoured)
Tyson's direction: "punching, throwing a dumbbell, speed blitz, LUNK ALARM".
Shipped as ui/battle/move-fx.tsx — MOVE_FX table over 9 primitives
(projectile/ghostDash/slash/strobe/drop/stars/rise/dome/speedlines), all 17
moves uniquely animated: Forge Smash THROWS A SPINNING PIXEL DUMBBELL,
Rapid Strike is the SPEED BLITZ (the attacker's own sprite afterimages dash
through), Colossal Pressure is the LUNK ALARM (red siren strobes + siren
SFX), Precision Strike is the punch-star combo, ultimates drop barbells,
shredder moves slash arcs, buffs rise auras. Per-move SFX table in sound.ts
(whoosh+clang, zips, siren, shings, booms). Verified live: 4 casts, blitz
afterimages captured on screen, zero errors; reduced-motion renders none.
Original spec follows for reference:
A DECLARATIVE spec per move, rendered by a small FX layer — data, not
hand-coded one-offs, so new moves get animations by table entry.

1. `domain/battle-rpg/move-fx.ts`: `MOVE_FX: Record<MoveId, MoveFx>` where
   `MoveFx = { form: 'projectile'|'slash'|'beam'|'rush'|'slam'|'aura'|'guard'|
   'heal', colors: [string,string], particles: 'sparks'|'embers'|'rings'|
   'plus'|'shards', screen: ('shake'|'flash'|'zoomIn')[], travelMs, impactMs }`.
   All 17 moves get a UNIQUE combination (e.g. Precision Strike = fast cyan
   slash + shards; Apex Execution = legendary beam + zoomIn + flash; Perfect
   Form = rising epic aura + plus-particles; Counter Pose = guard dome).
2. `ui/battle/move-fx-layer.tsx`: renders the spec over the arena —
   primitives only (transform/opacity Reanimated or CSS keyframes per the
   perf doctrine): a projectile that travels the attacker→defender diagonal,
   an arc-slash mask, a vertical beam column, particle bursts from a small
   pool (6–10 Views, no engine changes). Reduced-motion collapses to the
   existing flash/shake.
3. Wire into `battle-arena.tsx` off `activeEvent` (it already carries moveId)
   — anim plays in the gap the event queue already provides; impact effects
   (burst/knockback) fire at `travelMs`, not at event start, so hits LAND.
4. Per-move SFX variants: extend the synth — each `form` gets a distinct
   chirp family, pitch-shifted by theme (data-driven like the FX table).
**Verify:** a scripted battle that casts every move once (training dummy,
seeded RNG) + screenshot per move; zero page errors; reduced-motion run.

## Phase B — FireRed presentation beats
1. **HP drain over time**: CombatBar animates to the new value across
   ~600ms SYNCED to the event beat (ghost already exists), with FireRed
   colour stages — >50% green, 20–50% yellow, <20% red + bar pulse and a
   soft low-HP heartbeat SFX while it stays red.
2. **Beat choreography**: today text+anim+HP land together; re-order the
   queue so each event is TEXT → FX → drain → consequence lines ("A crushing
   blow!" for crits, status inflictions as their own beats). EVENT_MS becomes
   per-beat timing from the FX spec.
3. **Entry ceremony**: battle-start wipe (CSS radial/venetian, 400ms), sprites
   slide in from their corners with name-plates sweeping in, "A CHALLENGER —
   {gym leader} wants to battle!" beat before move selection unlocks.
4. **Faint**: loser slides DOWN off the platform while fading (FireRed's
   signature), platform glow dies; victory pose + the existing glow for the
   winner; then the result sheet.
5. **Stat-change flashes**: buffs/debuffs flash the sprite scale up/down with
   rising/falling arrow particles (hooks exist: 'buff'/'defence' events).
**Verify:** full-battle recording (screenshot strip), the beat order asserted
from the event log, tour green.

## Phase C — Dynamic gameplay: the STYLE TRIANGLE + choices that matter
The strategic core FireRed has and we lack: type effectiveness.
1. **Styles**: every champion and every attack move gets a style —
   `FORCE` (titan/mass power), `FORM` (aesthetic/shredded technique),
   `FLOW` (cardio/apex tempo). Triangle: FORCE > FORM > FLOW > FORCE.
   Multipliers ×1.3 / ×0.77, neutral otherwise, applied in `damage.ts`
   (deterministic, golden-tested). UI: "It's super effective!" /
   "It barely landed…" consequence beats + effectiveness hint pips on the
   move buttons once you've SEEN the matchup (FireRed-style learned info).
2. **Battle items (2 per battle)**: PROTEIN SHAKE (heal 35%, ends turn) and
   PRE-WORKOUT (+speed & +crit for 2 turns) on a small items row — costs the
   turn, AI gets them too at gym tier. Engine: new action kind 'item',
   deterministic effects, capStats untouched.
3. **Priority surfaced**: 'quick' moves already win order — badge them
   ("FIRST STRIKE") and add one priority move to champions lacking one so
   the speed/priority dance is playable, not incidental.
4. **Gym conditions**: each gym arena applies a visible ambient rule
   (Iron Foundry: heavy moves +15% both sides; Cardio Circuit: stamina
   regen +2; etc.) — banner at entry, small icon by the HP bars. Pure
   engine modifiers, per-gym table.
5. **Rebalance pass**: with the triangle live, re-tune base powers/stamina
   so every champion has a winning line into every other (sim harness:
   scripted AI-vs-AI across all matchups × styles, assert win-rate bounds —
   the engine's determinism makes this a fast vitest).
**Verify:** golden tests for triangle math + items; the AI-vs-AI balance sim
in CI; challenge/ghost/versus modes inherit automatically (same engine).

## Phase D — Polish that makes it "a better game"
1. **XP bar tick-up** on the victory screen (FireRed's EXP fill + level-up
   jingle already exists — connect them).
2. **Battle speed setting** (1×/2× beats) beside the existing tap-to-skip.
3. **Run/forfeit** for training battles (never rated ones).
4. **Move info long-press** gains the style + priority + status icons.
5. **Champion select shows the triangle** so counter-picking gyms is a
   decision (recommended style hint per gym).

## Order & scope honesty
A → B → C → D. A+B are pure presentation (no engine risk, big felt
difference). C touches `damage.ts`/`engine.ts` — the deterministic tests and
the balance sim gate it. Versus/challenge/ghost battles inherit everything
because they share the engine and arena. Native-only flourishes (haptics per
impact) ride along where already gated.

## Success criteria
Every one of the 17 moves visually distinct and nameable with sound; a full
battle reads in FireRed beats (text → anim → drain → consequence); the style
triangle makes champion & move choice strategic (balance sim proves no
dominant champion); entry/faint ceremonies; zero regressions on the
existing tours and 752+ tests.
