# EvoForge Arena 2.0 — Redesign & Production Plan

> **STATUS: PROPOSAL — AWAITING APPROVAL. No gameplay code changes until Tyson approves.**
> This document is the deliverable for the "Arena 2.0" brief. It covers vision,
> gameplay/combat/controls/AI redesign, the five champions, the PixelLab →
> AutoSprite → atlas → controller art pipeline, the current-arena audit
> (reuse/adapt/rewrite/delete), architecture + folder structure, migration +
> feature flags + rollback, and phased implementation/testing/perf/regression
> roadmaps. Implementation begins **one phase at a time, only after approval.**
>
> Companion docs (existing, still authoritative until superseded): `PROGRESS.md`,
> `ARENA_ART_BIBLE.md`, `ARENA_RENDERER_DECISION.md`, `ARENA_BALANCE.md`,
> `RENDER_ARCHITECTURE.md`, `ASSETS.md`.

---

## 0. The one-line pitch

**Your months of real-world gym progress become a Champion you pilot, one-thumb,
through a landscape tactical battler where every hit feels earned.** Support units
are the tide; your Champion is the story. Arena exists to make you *want* to train.

---

## 1. Design philosophy (the north star)

EvoForge is a **fitness tracker whose real-world progress creates your Champion.**
Arena is the emotional payoff, not a bolt-on minigame. Three rules gate every
decision in this document:

1. **The Champion is sacred.** It represents months/years of the player's real
   training. It is always the largest, most detailed, most recognizable thing on
   screen. The player controls *only* it. Every mechanic reinforces "this is MY
   Champion."
2. **Fun over familiarity.** Any mechanic that can be more fun without diluting the
   fitness identity gets redesigned. We are not porting the autobattler to
   landscape — we are rebuilding the *feel*.
3. **Earned, not grindy.** Progression tracks real training. Cosmetics and mastery
   deepen attachment; they never sell power. (This preserves the shipped invariant:
   Arena results stay cosmetic — no Forge XP / Evo Rating minting from battles.)

---

## 2. The Shredder L4 benchmark (the production standard)

The attached `ShredderL4-spritesheet/` is the **quality bar for every future
Champion.** Analysis of the actual asset:

| Property | Measured value | Standard it sets |
|---|---|---|
| Frame canvas | **128×128** px, transparent | 2× today's 64px units — Champions render large and detailed |
| Clips | `idle`, `run`, `attack`, `hit-react`, `dash`, `ultimate` (all `_right`) | The canonical Champion clip set (§5) |
| Frame counts | idle 25, **run 64**, attack 25, hit 25, dash 25, ultimate 25 | Long smooth cycles; run is the showcase loop |
| Atlas | `atlas.json` = `{frames:{"<i>":{x,y,w,h,duration}}}`, uniform `duration:1` | TexturePacker-style hash atlas; timing is set per-clip by the controller, not the atlas |
| Character footprint | ~52–65 px wide, ~55–60 px tall inside the cell | Character ≈ 45% of cell height — **the rest is VFX headroom** |
| VFX | Signature **cyan energy blade + aura**, baked into frames (ultimate streak up to 118 px wide) | Path-color VFX is baked into art (consistent with ART_BIBLE §5); team reads from framing, not tint |
| Orientation | **Side-view, facing right** (`_right`) | Confirms the side-scroller; left-facing = horizontal mirror |
| Anchor | Feet baseline consistent *within* a clip (idle 91, hit 88, dash 87–89) but **drifts across clips** (attack→99, ultimate→86) | Pipeline **must** normalize to a shared feet-anchor per Champion (§11) |
| centerX | Drifts on lunges (attack 53→79, ultimate 42→94) | Intentional motion; pivot = feet-center so lunges read, not teleport |

**Quality read at scale:** strong silhouette, readable anticipation→strike→recovery
arcs, restrained-but-punchy VFX, clean 1px self-outline. This is a large step up from
the shipped 64px/4-frame arena sprites and justifies the pipeline investment.

> **DECIDED (Tyson, §17-A): cyan is the Shredder's full canonical identity** across all
> stages. `ARENA_ART_BIBLE.md §6` must be updated (Shredder → cyan energy blade + aura,
> replacing violet+crimson) as a P5 art task, and the P7 readability rule ("cardio indigo
> is deliberately not team-cyan") must be re-checked so the Shredder's cyan reads as
> path-identity, not team-side (team reads from framing/nameplate in landscape, not tint).

---

## 3. Core gameplay redesign

### 3.1 The arena (landscape)
- **Orientation:** landscape, two **horizontal** lanes (top lane / bottom lane).
- **Ends:** player Forge Core at the left, enemy Forge Core at the right. Destroy
  the enemy Core (or lead on Core HP at time) to win. (Preserves the shipped
  win/tiebreak model; only the axis rotates.)
- **Camera:** a light **parallax follow-camera** biased to the active lane and the
  Champion, not a fixed whole-lane view. This is the single biggest feel upgrade —
  the battlefield gains depth and the Champion gains presence. The lane is longer
  than the screen; the camera reveals the push. (Perf: the camera is a transform on
  a container, not per-unit work — see §11/§13.)
- **Ground line:** every combatant stands on a shared per-lane ground line (feet
  anchor). This is what makes the AutoSprite feet-anchor normalization matter.

### 3.2 Who controls what
- **Support units:** fully **AI** — walk, target, attack, defend, heal, tank, stun,
  pressure. They form the frontline tide. They **never** overshadow the Champion.
- **The Champion:** the player controls **only** the Champion, and **never** with a
  joystick. In-lane movement is **automatic** (advance with the frontline, stop to
  fight, retreat if overwhelmed, resume). The player controls *decisions and timing*,
  not pathing:
  - **Lane switch** (the core tactical lever)
  - **Basic attack** (tap) → **combo** (rhythm taps within a window)
  - **Primary ability** (button, cooldown)
  - **Ultimate** (button, charges via the meter)
  - **Card deployment** (support units / techniques / equipment)
  - **Tactical timing** of all of the above

This keeps the game **one-thumb** while giving it real decisions (where to commit
the Champion, when to spend the ultimate, what to deploy, when to combo a telegraphed
opening).

### 3.3 The core loop (session-to-session excitement)
1. **Open:** pick lane, deploy an opening card, position the Champion.
2. **Build:** manage the frontline tide with cards; farm the ultimate meter with
   basic attacks/combos; read enemy telegraphs.
3. **Spike:** commit the Champion + ultimate to win a lane, then swing to the other.
4. **Close:** break a Core. Every match has a climax beat (§6 ultimate/Core-break
   presentation).

Target match length: **90–150s** (mobile-session friendly, ranked-viable, spectator-
friendly). Fast enough to "one more game," deep enough to master.

---

## 4. Why this is addictive (the retention thesis)

Mapped to the brief's maximization targets:

- **Champion attachment** — the Champion is literally the player's real body of work,
  piloted directly. Direct control (vs autobattler) multiplies attachment.
- **Competitive depth** — lane-switch commitment + ultimate timing + combo execution +
  deck synergy + the FORCE/FORM/FLOW style triangle = a high skill ceiling with a low
  skill floor.
- **Session excitement** — the spike/swing rhythm + camera + hitstop + ultimate
  ceremonies make 2 minutes feel eventful.
- **Long-term progression** — real training drives Champion evolution stages (already
  wired: `integration/evoforge/progression-mapping`); Arena adds *mastery* per
  Champion.
- **Cosmetic desirability** — 128px Champions with baked signature VFX are genuinely
  covetable; skins recolor the signature energy (cheap to produce, high perceived
  value).
- **Readability** — big Champion, small support, clear frontline, telegraphs, ground
  line, lane framing.
- **Mobile / one-handed** — thumb-zone control map (§9), landscape both-thumbs *or*
  one-thumb.

Full meta systems in §10.

---

## 5. The Champion controller (state machine from the benchmark)

The benchmark clip set *is* the controller. Each Champion is a small deterministic
state machine; the **sim** owns state transitions (deterministic, replayable), the
**renderer** just draws the current clip + frame (frame-driven, no per-unit React
state — the shipped doctrine holds).

States (→ benchmark clip):
- `idle` → idle (holding lane, no target)
- `advance` → run (moving with frontline)
- `basicAttack` / `combo[n]` → attack (tap; combo chains re-enter with escalating
  frames/damage inside the combo window)
- `ability` → **dash** clip doubles as the Shredder's mobility ability; other
  Champions map their primary to their signature clip
- `ultimate` → ultimate (meter-gated; i-frames + presentation beat)
- `hitReact` → hit-react (interrupt on heavy hits / breaks combo)
- `retreat` → run (mirrored) when overwhelmed
- `faint` → (death; today's units dissolve — Champions get a knockdown + respawn
  timer, already modeled via `respawnAtTick`)

Transition rules live in a data-driven **`ChampionController` spec** per Champion
(cooldowns, combo window ms, i-frame windows, ultimate cost, which clip each ability
uses). This is the bridge between the animation set and the sim.

---

## 6. Combat systems

The brief's checklist, each classified as **[HAVE]** (shipped, reuse), **[ADAPT]**
(exists, needs landscape/axis work), or **[NEW]** (build):

- **Deterministic simulation** — [HAVE] pure TS engine, SeededRng, versioned saves.
- **Ultimate meter** — [ADAPT] champions already have ability/ultimate concepts; make
  the meter player-visible and player-spent.
- **Ability cooldowns / combo windows** — [NEW] player-triggered timing layer.
- **Lane switching (Champion)** — [NEW] the core tactical control.
- **Formation system / reserved melee slots / anti-overlap / collision widths / ally
  spacing / ranged-behind-tanks** — [NEW at sim level]. Today spacing is a *cosmetic*
  render offset (`computeStackOffsets`). Arena 2.0 needs **real** frontline formation:
  a lane is a 1-D queue with melee "attack slots" at the contact line, ranged units
  held back by a standoff distance, tanks winning the front slots. This is the single
  biggest sim addition and the key to "no sprite stacking, always readable."
- **Projectiles / knockback / hitstop / screen & camera shake / impact sparks /
  crit FX / enemy telegraphs / ultimate indicators / speed lines** — [ADAPT] a strong
  FX layer already exists (`impact.ts` TIER_FX, hitstop/time-dilation, screen shake,
  telegraphs, projectiles, per-path telegraph shapes). Re-home it to landscape and
  scale it up for the bigger Champion.
- **Critical hits** — [NEW] combo-finisher and style-triangle-advantage crits, with
  the existing crit FX hooks.

**Battle feel doctrine** (anticipation, overshoot, recoil, hitstop, flash, particles,
speed lines, combo chaining) is applied at the Champion first (it's the star), then
tuned down for support units so the Champion always reads as the most impactful actor.

---

## 7. The five Champions

Roster is fixed (no new Paths). Each keeps its shipped identity (ART_BIBLE §6,
`BranchV2` slugs, real evolution stages) and gains an **active** kit for direct
control. The **style triangle** (FORCE > FORM > FLOW > FORCE, ×1.3/×0.77, already in
`domain/battle-rpg/style.ts`) governs matchup advantage and feeds crit chance on
advantage.

| Champion | Style | Role | Passive | Primary (cooldown) | Ultimate (meter) | Combo / signature |
|---|---|---|---|---|---|---|
| **Aesthetics** (emerald+gold) | FLOW | Precision duelist / team sustain | **Flow State:** +team healing; the Champion's crits heal the frontline | **Golden Hour:** a precise dash-strike that marks a target for +crit | **Grand Posedown:** radial pose shockwave, heals allies + stuns enemies in-lane | Rhythm combo rewards clean timing (whiffs break Flow) |
| **Titan** (amber) | FORCE | Frontline anchor / zone control | **Immovable:** knockback resistance; nearby allies take less knockback | **Quake Stomp:** ground slam, knocks back + slows the contact line | **Seismic Smash:** the ground-shaker ultimate — screen shake + core-adjacent AoE | Heavy, slow combo with huge overshoot/recoil |
| **Mass Monster** (fuchsia) | FORCE | Space-denial / summoner | **Gravity Well:** pulls enemy support toward it (breaks their formation) | **Mass Uprising:** summons Titan-Guard adds (already implemented as a champion kit) | **Colossal Press:** towering slam that flattens a lane segment | Wide-arc slams; width > height silhouette (must never read like Titan) |
| **The Shredder** (**cyan** energy — canonical, §17-A) | FLOW→FORM | Assassin / burst mobility | **Bleed:** attacks stack a DoT; body-fat evolution sharpens it | **Phase Dash:** the benchmark `dash` — i-frame reposition + strike ghost | **Peak Week:** cyan flurry, executes low-HP targets | Fast combo, cyan strike-ghost afterimage; hunts the weakest target |
| **Cardio Machine** (indigo) | FORM | Tempo / Core-pressure | **Second Wind:** regenerates ultimate meter faster; ignores unit collision briefly | **Sprint Finish:** dash past the frontline to pressure the Core | **Zone Five:** afterimage barrage down a lane, ramping speed | Momentum combo — damage ramps the longer it stays moving |

Each Champion needs (production checklist, benchmark-grade): unique passive, primary,
ultimate, combo timing, role, visual identity, **signature silhouette**, signature
stance, unique particles, unique sound profile. Sound: the shipped synth kit
(`ui/core/sound.ts`, noise/thud/clank/whoosh/shing/click/beep) is the palette; each
Champion gets a signature layer.

---

## 8. Support units

Support units are the **tide**, never the star. Roles (map cleanly from today's 10
fighter cards): **tank** (Titan Guard / Heavy Tank), **push** (Recruit / Runner),
**pressure DPS** (Boxer / Cutter / Marksman — now animated), **heal** (Recovery
Coach), **shield/stun** (Spotter). They:
- form frontlines automatically (the new formation system),
- are ~60% the Champion's on-screen size,
- use the lighter FX tier so they never out-sparkle the Champion,
- create openings the Champion converts (a stun the player combos into, a tank that
  holds the line while the Champion swings lanes).

The already-shipped animated **Marksman** (`drone-archer`, `unitAnimFrames`) is the
proof-of-concept that support units can be frame-animated; Arena 2.0 generalizes that
into the support animation tier (fewer clips than Champions: run/attack/hit/death).

---

## 9. Controls (one-handed landscape)

Thumb-zone layout (right-thumb default; mirrorable):
- **Bottom-right cluster (primary thumb):** Basic Attack (big), Primary Ability,
  Ultimate (glows when charged). Tap Basic repeatedly = combo.
- **Right edge:** **Lane Switch** — a single tap flips the Champion to the other lane
  (or a vertical swipe). The most-used control; biggest, most forgiving target.
- **Bottom strip:** Card hand (deploy = tap card → tap lane; or tap card → auto-drop
  at the Champion's lane front, to preserve one-thumb).
- **Everything reachable within a few thumb movements.** No joystick, no d-pad, no
  manual walking, no platforming.

Accessibility: reduced-motion already gates continuous motion; add a "hold to repeat
combo" and larger-targets option.

---

## 10. Retention & meta

Only mechanics that strengthen the fitness identity:

- **Champion Mastery** — per-Champion XP earned by *playing that Champion* (cosmetic
  track: banners, energy-color skins, victory poses). Deepens attachment; no power.
- **Real-training progression** — evolution stages already track real fitness
  (`progression-mapping`; Shredder = body-fat). Arena 2.0 *shows* this: your L4
  Champion visibly out-classes an L1 (bigger, awakened VFX) — a flex that requires
  real gym work. This is the retention engine unique to EvoForge.
- **Daily engagement** — a daily "Training Contract" (win a match using the Champion
  whose real lift you PR'd today, etc.) — ties Arena back to the tracker.
- **Ranked** — **DECIDED (§17-D): a real seasonal ladder.** Arena Rating becomes real
  progress, not cosmetic — which **deliberately amends** the shipped "Arena stays
  cosmetic / no reward minting" invariant *for ranked mode only*. This REQUIRES, before
  P6 ships: (1) a **farm-proof server rule** (server-authoritative rating deltas,
  anti-collusion/anti-smurf, rate limits, verified-battle-record gating via the existing
  digest + `verifyBattleRecord`), (2) a **migration** (new ranked tables / rating ledger
  under owner-only RLS + `security definer` RPCs, per the DB contract), and (3) Tyson's
  sign-off on the specific rule. Casual/standard results stay cosmetic; only ranked
  awards ladder progress. Seasons reset the ladder.
- **Cosmetics** — energy-color skins (recolor the baked signature VFX — cheap, high
  value), victory poses, Core skins, lane environments. Never power.
- **Seasons** — a rotating featured Champion + cosmetic line + ladder reset.
- **Spectator / social sharing** — deterministic replays already exist (ghost
  battles); a share-a-replay clip of your Champion's ultimate is native virality.

---

## 11. Art & animation pipeline (PixelLab → AutoSprite → game)

The benchmark defines the format; this is the production line.

```
PixelLab (generate base Champion, pinned seed, ART_BIBLE identity)
   ↓  raw 128px base sprite (idle key pose)
AutoSprite (generate each clip: idle/run/attack/hit/dash/ultimate)
   ↓  per-clip spritesheet.png + atlas.json (hash: {i:{x,y,w,h,duration}})
Atlas normalizer (our new build step)
   ↓  validate + feet-anchor-normalize + team/identity checks + pngquant
Metadata (champion.anim.json: clips, fps, anchors, combo/i-frame windows, events)
   ↓
Importer (static require table, Metro-safe, keyed by champion+clip)
   ↓
AnimationController (deterministic clip/frame selection from sim state)
   ↓
Game (renderer draws current frame at feet anchor; camera follows)
```

**Build step (`scripts/arena-autosprite-import.mjs`, new):**
1. Ingest each `<clip>/spritesheet.png` + `atlas.json` (128px cells).
2. **Validate & reject** (the brief's "reject inconsistent sprites"):
   - cell size == 128, transparent bg, ≤N frames/clip;
   - **feet-anchor drift** across clips ≤ threshold (from §2 analysis: normalize all
     clips to a shared feet Y; reject/auto-correct outliers like attack→99 vs idle→91);
   - silhouette footprint within bounds (character ≤ ~70px wide so VFX headroom holds);
   - identity/palette check per ART_BIBLE (path color present; no team tint baked).
3. **Emit** a compact per-champion atlas + `champion.anim.json` metadata (fps per clip:
   idle ~10, run ~24, attack ~30 w/ hit-frame event, dash ~30, ultimate authored,
   hit ~24) and pngquant the sheets.
4. **Left-facing** = runtime horizontal mirror (no doubled assets) — but flag
   asymmetric clips (a right-hand blade) so mirroring the *blade side* stays correct
   (the ART_BIBLE "javelin/blade arms matter" note).

**AnimationController:** pure function `(champion, simState, frameClock) → {clip,
frameIndex, mirrored, anchor}`. Frame index derives from clip fps + clip start tick
(deterministic); events (hit frame, i-frame window) come from metadata, not hardcoded.
This is the same frame-driven, no-per-unit-state discipline the arena already enforces
— generalized from 4-frame walks to full clip sets.

**Validation gate in CI:** `verify-arena-anim.mjs` — every registered Champion has all
required clips, anchors within tolerance, metadata parses, atlas indices resolve. Falsified
once (break it, watch red) per the repo's guard doctrine.

---

## 12. Current-arena audit — reuse / adapt / rewrite / delete

**The load-bearing insight:** the simulation is **1-D per lane and axis-agnostic**
(`x ∈ [0,100]`, scalar distance `Math.abs(a-b)`, `game-engine/simulation/tick.ts`).
Portrait-vs-landscape is a **render mapping + control + formation** problem, *not* an
engine rewrite. That keeps the deterministic engine, replay, digest, and command
model — the risky parts — intact.

| System | Verdict | Notes (file anchors) |
|---|---|---|
| Deterministic engine (`game-engine/`) | **REUSE** | SeededRng, digest, replay via `commandLog`, reject-never-throw, 20Hz. Axis-agnostic. `tick.ts`, `run.ts`, `replay.ts` |
| Battle store loop (`battle-store.ts`) | **REUSE** | 50ms accumulator loop, single `version` publish, mode gating |
| FX derivation (`combat-fx.ts`/`impact.ts`/`readability.ts`) | **REUSE (pure) + ADAPT (axis)** | Pure per-frame derivation stays; the *placement* math flips Y→X |
| Avatar/identity bridge + fidelity chain | **REUSE** | `avatar-profile.ts`, `battle-assets-core.ts` (layer-drift rule), profile→own-path guard |
| `constants/theme.ts` | **REUSE** | Zero orientation assumptions; colors/fonts/pathColor as-is |
| Command model (`events.ts` `BattleCommand` union) | **ADAPT (extend)** | Add `champion-basic-attack`, `champion-combo`, `champion-lane-switch`; replay-compatible (queued tick+1) |
| Champion control | **ADAPT** | Manual ability+ultimate ALREADY exist (`champion-hud.tsx`, `battle-controller.ts:268`). Generalize Cardio's `lane-shift` into a control verb; add basic/combo |
| Ultimate meter (`ultimateCharge`) | **ADAPT** | Damage-driven charge exists (`combat.ts:29`); surface + player-spend it |
| `arena-screen.tsx` layout | **REWRITE (landscape)** | Fixed portrait flex column; cores top/bottom; x→Y inversion. → x→X + camera |
| `lane-strip.tsx` orientation | **REWRITE** | Vertical strip, deploy-zone-bottom, chevrons, momentum edges, marksman toward/away keyed to vertical |
| Art pipeline (`arena-pixellab-gen.mjs`) | **ADAPT (64→128) + EXTEND** | Add the AutoSprite atlas path (§11); keep PixelLab base-gen |
| Sprite loading (static `require` table) | **EXTEND** | Add an **atlas-backed sprite component** (clip-View technique, §13) for 128px multi-clip champions; keep the table for units |
| Spacing / formation | **NEW** | Today cosmetic only (`compute(Stack)Offsets`). Real formation = the key sim addition |
| Camera / viewport | **NEW** | None exists anywhere |
| Feature-flag registry | **NEW** | Today one global bool; need a real registry + an `arena2` mode for parallel rollout |
| Vertical floor tile, portrait momentum/danger edges | **DELETE (after cutover)** | Superseded by the landscape battlefield |

## 13. Architecture & folder structure

**Principle: parallel, flagged, additive.** Arena 1.0 (portrait) stays fully working
behind the flag; 2.0 is a new render/control path over the *same* engine. Nothing
working is destroyed.

```
client/src/arena-game/
  game-engine/                     # REUSE, + additive modules (gated by balance version)
    formation/                     # NEW — per-lane 1-D formation resolver (spacing, melee slots, ranged standoff)
    commands/champion-control.ts   # NEW — basic/combo/lane-switch command handlers
  content/
    champion-anim/                 # NEW — <champion>.anim.json metadata (clips, fps, anchors, events)
  features/
    arena/                         # 1.0 portrait — UNTOUCHED until cutover
    arena2/                        # NEW — landscape renderer
      battlefield.tsx              #   horizontal battlefield + ground line
      camera.ts                    #   follow-camera transform (container-level)
      champion-controller.ts       #   sim-state → {clip,frame,mirror,anchor}
      atlas-sprite.tsx             #   clip-View spritesheet renderer (native+web, no new dep)
      control-deck.tsx             #   one-thumb control map (attack/ability/ult/lane/cards)
  services/flags/arena-flags.ts    # NEW — data-driven flag registry
  scripts/
    arena-autosprite-import.mjs    # NEW — atlas ingest + validate + normalize + pngquant
    verify-arena-anim.mjs          # NEW — CI validation gate
```

**Atlas-sprite render technique (no new dependency):** an oversized `<Image>` of the
clip sheet inside an `overflow:'hidden'` 128px `<View>`, translated by `-(col*128)`,
`-(row*128)` to show one frame — the classic cross-platform spritesheet crop. Frame
index comes from the `ChampionController` (deterministic, frame-clock-derived). Left
facing = `scaleX:-1` on the wrapper. This keeps the "no per-unit React state / no
Animated" doctrine and adds **zero** runtime dependencies (Reanimated stays the
reserved off-thread lever for the camera if perf needs it — §16).

**Camera:** a single transform on the battlefield container (`translateX` toward the
active lane's front + the Champion), eased. One transform, not per-unit work — cheap.

## 14. Migration, feature flags & rollback

**Flag registry (`services/flags/arena-flags.ts`):** replaces the lone `arenaGameEnabled`
bool with a frozen, data-driven map (`arena2Renderer`, `championControl`,
`formationSim`, `autoSpriteChampions`, `rankedLadder`, …). Each 2.0 system ships behind
its own flag so we can enable incrementally and **roll back instantly** by flipping one
value — no redeploy of logic, no data loss.

**Battle-mode:** add `'arena2'` to `BattleMode` (the de-facto gating primitive today).
It records/persists like `standard` but under the new balance version, so 1.0 and 2.0
records never cross-contaminate (`verifyBattleRecord` already refuses cross-balance
replays — old records become *legacy*, still viewable, never "broken").

**Balance/version bumps:** the formation sim + champion control change combat outcomes,
so they land under a new `BALANCE_VERSION` and a `SAVE_VERSION` bump with a migration
(the `MIGRATIONS` map never throws; unknown/old saves fall back safely). Old ghost/rank
records are re-tagged legacy, not invalidated.

**Rollback capability:** (1) flags off → instantly back to 1.0 portrait; (2) 2.0 code is
a separate `arena2/` path, deletable without touching 1.0; (3) balance-version isolation
means enabling 2.0 can never corrupt 1.0 replays or ratings.

## 15. Implementation roadmap (one phase at a time, each behind flags, each tested)

- **P0 — Pipeline & foundation.** Flag registry; `arena2` mode scaffold; the AutoSprite
  import build step + `verify-arena-anim.mjs`; the atlas-sprite component. **Exit:** the
  benchmark Shredder plays all 6 clips animated in a scratch `arena2` screen; CI anim
  gate green. *(No gameplay change; nothing user-visible yet.)*
- **P1 — Landscape renderer (no gameplay change). ✅ DONE 2026-07-24.** `features/arena2/`
  `battlefield.tsx` renders the SAME sim in landscape (engine x→screen X, cores left/right,
  two horizontal lanes) with a pure follow-camera (`camera.ts`, 13 tests); the dev
  `arena2-battle-lab` (debug menu) seeds a real low-density battle via the stress driver
  and renders it landscape. Sim untouched → digest-identical by construction (548 arena
  tests green). Verified with a landscape Playwright tour: units advance, the camera
  follows the push (player core → opponent core scroll into view), teams face correctly,
  health/floaters render. Combatants still use 1.0 top-down sprites (side-view 128px
  champions arrive at P5); full FX layer re-homed at P4. Perf sweep vs baseline: deferred
  to the P7 device pass (camera = one transform, cheap).
- **P2 — Champion controller & control deck. ✅ DONE 2026-07-24.** New replay-safe engine
  commands `champion-basic-attack` (rate-limited, chains a combo that boosts the next
  strike) and `champion-lane-switch` (flip lane on a cooldown) — the manual ability +
  ultimate already existed. `game-engine/commands/champion-control.ts` (pure) + store/
  controller plumbing (`championBasicAttack`/`championLaneSwitch`). One-thumb
  `features/arena2/control-deck.tsx` (Lane / Ability / Ultimate-with-meter / big Basic-
  with-combo-counter) wired into the pilotable `arena2-battle-lab` (autoCast off).
  **Determinism:** new ChampionState counters are NOT digested; their EFFECTS (lane,
  attackCooldownTicks, combo damage→health) are — so 1.0 digests stay byte-identical
  (558 arena tests + stability suite green) and arena2 records replay digest-identically
  (proven: piloting with the new commands re-sims to the same digest). Movement stays
  automatic. Champion still renders via 1.0 sprites (128px controller = P5).
- **P3 — Formation sim. ✅ DONE 2026-07-24.** A per-tick anti-overlap pass
  (`tick.ts::applyFormation`, `FORMATION_GAP=3.5`): same-team same-lane units are pushed
  back behind the one ahead, forming a natural queue (melee contact line, ranged/others
  spaced behind) — deterministic (front-most-first sort, id tie-break, push-back-only).
  Gated per-battle via a new `BattleConfig.formation` flag (threaded config→state→
  LiveBattleOptions→stress-driver; `formationSim` flag ON): OFF in Arena 1.0 so its
  positions/digests are byte-identical (561 arena tests + stability suite green). No
  overlap + gating + replay-determinism proven in `formation.test.ts`. Balance:
  formation is SYMMETRIC (both teams, same rule) so it can't skew relative balance — a
  40-match AI-vs-AI check stayed balanced (formation off 40/60, on 55/45, both in
  [40%,60%]); a full deep-harness re-baseline can follow if desired. Refinement noted:
  explicit role-priority slotting (tanks strictly front) beyond position-based queuing.
- **P4 — Battle feel.** FX scaled to the big Champion + landscape; ultimate ceremony,
  camera/screen shake, hitstop, crits, telegraphs, speed lines. **Exit:** feel review vs
  the Supercell/Halfbrick bar; perf still in budget.
- **P5 — The five champion kits + benchmark art.** Data + new ability handlers for each
  kit (§7); generate + validate all five at benchmark grade. **Exit:** balance harness
  green per champion; anim validation green for all five.
- **P6 — Meta & retention.** Mastery, cosmetics (energy-color skins), seasons; ranked
  ladder *iff* §17-D approved (farm-proof server rule + migration). **Exit:** cosmetic
  reward-safety audit clean (the shipped invariant holds).
- **P7 — Device pass & cutover.** The still-pending real-device perf baseline; make
  `arena2` the default; keep 1.0 behind the flag one release; then retire.

## 16. Testing, performance & regression roadmap

**Testing.** (a) Determinism digests for every new command + the formation pass
(re-sim == live). (b) Extend the **deep harness** (`ARENA_STABILITY_DEEP`, seeded
AI-vs-AI) to the new controllers + formation, keeping the win-rate bands the balance
gate. (c) `verify-arena-anim.mjs` in CI — clips/anchors/metadata/atlas indices. (d)
Replay-compatibility tests (old records legacy, still verify). (e) Playwright landscape
tours (lobby → battle → ultimate → result) as the visual gate.

**Performance.** Baseline reality (`ARENA_RENDERER_DECISION.md`): desktop 60fps to
30/team; **4× CPU throttle ≈ 9fps** (script-bound, ~12% fixed chrome floor). Landscape
adds a camera (one transform — cheap) and a 2× bigger Champion (one sprite — cheap); the
real risk is per-frame atlas crops × unit count. Levers, in order: memoize chrome/HUD;
cap support-unit counts; **Reanimated worklets** for camera + Champion motion (the
installed-but-unused off-thread lever); Skia only if those fail on hardware. Gate every
phase on the stress lab + finally run the **pending real-device baseline** (recent+old
iPhone, ordinary Android) — it may show the renderer is already fine.

**Regression.** 1.0 stays live behind the flag throughout; balance-version isolation
protects 1.0 replays/ratings; digest determinism catches sim drift; flags give instant
rollback; the reward-safety invariant (Arena stays cosmetic) is re-audited at P6.

## 17. Open decisions for Tyson (needed before / during build)

- **A. Shredder palette** — ✅ **RESOLVED: cyan is the full canonical identity** (update
  ART_BIBLE §6 at P5).
- **B. Control depth** — confirm: movement auto; basic/combo/ability/ultimate/lane-switch
  manual; no joystick. *Rec: as speced (matches the brief).* (Assumed yes unless told.)
- **C. Match length** — *Rec: 90–150s.* (Assumed unless told.)
- **D. Ranked** — ✅ **RESOLVED: real seasonal ladder.** Needs the farm-proof server rule +
  migration + Tyson sign-off before P6 ships (see §10). Standard stays cosmetic.
- **E. Asset budget** — 5 champions × 6 clips × 128px sheets. *Rec:* atlas sheets +
  pngquant + **lazy-load per champion** (only the two fielded champions' sheets load per
  match). Need a target MB budget.
- **F. Orientation** — landscape-only for 2.0 (portrait 1.0 kept behind the flag during
  transition, then retired)? *Rec: yes.* (Assumed unless told.)
- **G. Scope** — ✅ **APPROVED: start P0.** Building the AutoSprite pipeline + atlas-sprite +
  flag registry now, behind flags, then reporting before advancing to P1.

---

*Prepared as the Arena 2.0 proposal. On approval I implement P0 first, in isolation,
behind flags, and report before advancing — per the brief's phase-gated, test-every-
phase, rollback-always mandate.*
