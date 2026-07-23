'use no memo'; // React Compiler opt-out: these components render a mutable simulation read from refs on a version counter (see battle-store docs).

/**
 * One vertical lane of the arena. Engine x in [0, laneLength] maps onto
 * screen y: x = 0 (the player's own core) is the bottom of the strip, x =
 * laneLength (the opponent's core) is the top — see game-engine/simulation
 * state.ts's coordinate convention. The bottom `deployZoneDepth` slice is the
 * player's tap-to-deploy zone, tinted so it reads as interactive.
 */
import React, { useCallback, useState } from 'react';
import {
  GestureResponderEvent,
  Image,
  type ImageStyle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, pathColor, radius } from '../../../constants/theme';
import { BALANCE, getCardById, getChampionById } from '../../../content';
import type { UnitState } from '../../../game-engine/simulation/state';
import type { LaneId, TeamId } from '../../../game-engine/types';
import { latestMatchingHit, type TelegraphTier } from './combat-fx';
import { attackPose, spawnScale, tierForDamage, PROJECTILE_TTL_MS, STRIKE_MS, TIER_FX } from './impact';
import { computeStackOffsets, healthBarColor } from './readability';
import { arenaFloorTexture, championSprite, championWalkFrames, unitSprite } from './sprites';

const { laneLength, deployZoneDepth } = BALANCE.arena;
const DEPLOY_ZONE_HEIGHT_PCT = (deployZoneDepth / laneLength) * 100;

/** Nearest-neighbour rendering for the pixel sprites on web (native ignores
 *  it) — the rest of EvoForge sets the same flag on its pixel art; without it
 *  the browser's bilinear filter softens every downscaled sprite (audit C5). */
const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

/** Walk-bob (Phase 3): amplitude/period of the little vertical bounce a unit
 *  carries while it is actually moving (no combat target). Movement-driven —
 *  it stops the moment the unit stops — and additionally gated behind the
 *  reduced-motion preference (see use-reduced-motion.ts). */
const BOB_AMPLITUDE_PX = 1.6;
const BOB_PERIOD_MS = 340;
/** P4 champion walk cycle: ms per frame (4 frames ≈ 1.8 steps/second). */
const WALK_FRAME_MS = 140;

/** Deterministic per-unit phase offset so a pack of walkers doesn't bob in
 *  perfect sync (reads as one blob) — derived from the unit id, no state. */
function bobPhase(id: number): number {
  return (((id * 2654435761) >>> 0) % 628) / 100; // 0..2π
}

/** Phase 6 draw order: champions render LAST (on top of the pile) so the
 *  most important silhouette is never buried under a swarm. */
function renderOrder(units: readonly UnitState[]): UnitState[] {
  return [...units].sort((a, b) => {
    const rank = (u: UnitState) => (u.kind === 'champion' ? 1 : 0);
    return rank(a) - rank(b) || a.id - b.id;
  });
}

/**
 * Combat-feedback floater (damage/heal number or death marker), derived by
 * the arena screen from the battle log delta since the last frame. Purely
 * frame-driven: opacity/rise are computed from age on each of the ~50ms
 * re-renders the battle store already forces — no Animated values, no
 * per-unit React state.
 */
export interface LaneFloater {
  key: number;
  lane: LaneId;
  /** Vertical position, percent from the top of the strip. */
  topPct: number;
  /** 'death' renders a richer dissolve marker instead of rising text. */
  kind: 'hit' | 'heal' | 'death';
  text: string;
  color: string;
  bornAtMs: number;
  /** P7: extra vertical offset (px) so floaters landing at nearly the same
   *  spot at nearly the same time don't render perfectly on top of each
   *  other — see readability.ts's computeFloaterStagger. 0 for a floater
   *  with no nearby neighbor when it was created. */
  staggerPx: number;
  /** P4 impact tiers: big hits print bigger/bolder numbers. */
  fontSize: number;
  fontWeight: '700' | '800' | '900';
}

/** Floater lifetime; the arena screen prunes with the same constant. */
export const FLOATER_TTL_MS = 700;

/**
 * Brief per-unit hit ping used to flash the unit that was just struck — kept
 * separate from the floater above (both derive from the same 'fx hit' log
 * entry) because a floater is a fixed position/text/color, while a hit ping
 * is matched against a unit's CURRENT position every frame (see
 * combat-fx.ts's latestMatchingHit) so the flash tracks a moving unit.
 */
export interface LaneHitPing {
  lane: LaneId;
  x: number;
  team: TeamId;
  bornAtMs: number;
  /** P4: target unit id from the fx log entry (null on pre-P4 records —
   *  those fall back to proximity matching, see latestMatchingHit). */
  targetId: number | null;
  /** Damage dealt — drives recoil strength via the impact tier table. */
  amount: number;
  /** True when the hit was (partly) absorbed by a shield — the flash tints
   *  shield-blue instead of white. */
  shielded: boolean;
}

/** P4: a ranged shot in flight — a fast streak from muzzle to target. */
export interface LaneProjectile {
  key: number;
  lane: LaneId;
  fromTopPct: number;
  toTopPct: number;
  team: TeamId;
  bornAtMs: number;
}

/** Hit-flash lifetime — short by design (readability: never obscures a unit
 *  for more than ~150ms). */
export const HIT_FLASH_TTL_MS = 150;
/** World-unit search radius for matching a hit ping to the struck unit. */
const HIT_FLASH_MATCH_RADIUS = 3;

/** Ability/ultimate cast telegraph: an expanding ring + the ability's name,
 *  in the champion's path color, at the caster's position. */
export interface LaneTelegraph {
  key: number;
  lane: LaneId;
  topPct: number;
  tier: TelegraphTier;
  label: string;
  color: string;
  bornAtMs: number;
  /** P5: caster champion's path — selects the per-path telegraph shape. */
  path: string | null;
}

/** Ultimates telegraph bigger and longer than signature abilities. */
export const TELEGRAPH_TTL_MS: Record<TelegraphTier, number> = { ability: 450, ultimate: 700 };
const TELEGRAPH_MAX_RING_PX: Record<TelegraphTier, number> = { ability: 30, ultimate: 50 };
const TELEGRAPH_BORDER_PX: Record<TelegraphTier, number> = { ability: 2, ultimate: 3 };

/** Arrival marker for a card landing in the deploy zone OR a champion summon
 *  (Mass Uprising's Titan Guards) — both are the engine's 'spawn' log entry. */
export interface LaneSpawnPoof {
  key: number;
  lane: LaneId;
  topPct: number;
  team: TeamId;
  bornAtMs: number;
}

export const SPAWN_POOF_TTL_MS = 400;

interface Props {
  lane: LaneId;
  /** Living units in this lane only — dead units are filtered out by the caller. */
  units: UnitState[];
  /** Active combat floaters for this lane (already capped by the caller). */
  floaters?: readonly LaneFloater[];
  /** Active hit pings for this lane, matched against units for the flash. */
  hitPings?: readonly LaneHitPing[];
  /** Active ability/ultimate telegraphs for this lane (already capped). */
  telegraphs?: readonly LaneTelegraph[];
  /** Active spawn/summon arrival markers for this lane (already capped). */
  spawnPoofs?: readonly LaneSpawnPoof[];
  /** P4: ranged shots currently in flight in this lane (already capped). */
  projectiles?: readonly LaneProjectile[];
  /** P4: unit id → strike start (ms) for attacks that just fired — drives
   *  the attack lunge (see impact.ts's attackPose). */
  strikes?: ReadonlyMap<number, number>;
  /** Current sim tick — drives the spawn drop-in scale. */
  tick?: number;
  /** P7: -1..1 signed lane momentum (see readability.ts's computeLaneMomentum)
   *  — which team currently has more living presence pushing this lane, and
   *  toward which core. Omit (or 0) for no edge indicator. */
  momentum?: number;
  /** True while a card is selected — the deploy zone brightens to advertise
   *  where the tap will land (Phase 2 readability). */
  deployHighlight?: boolean;
  /** Reduced-motion preference (see use-reduced-motion.ts) — suppresses the
   *  walk-bob; every other effect here is already reactive + short-lived. */
  reduceMotion?: boolean;
  onDeployTap: (lane: LaneId, engineX: number) => void;
}

export function LaneStrip({
  lane,
  units,
  floaters,
  hitPings,
  telegraphs,
  spawnPoofs,
  projectiles,
  strikes,
  tick = 0,
  momentum = 0,
  deployHighlight = false,
  reduceMotion = false,
  onDeployTap,
}: Props) {
  const [height, setHeight] = useState(0);
  // Phase 6 (audit C1): fan co-located units out laterally so piles stay
  // readable — recomputed each frame from current positions (pure helper).
  const stackOffsets = computeStackOffsets(units);

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      // locationY is reliable on native but often undefined on
      // react-native-web, where the underlying DOM event exposes offsetY
      // instead. Any non-finite result falls back to the middle of the
      // deploy zone so a tap always deploys somewhere sensible instead of
      // producing a NaN position the engine rejects.
      const nativeEvent = e.nativeEvent as GestureResponderEvent['nativeEvent'] & {
        offsetY?: number;
      };
      const tapY = Number.isFinite(nativeEvent.locationY)
        ? nativeEvent.locationY
        : nativeEvent.offsetY;
      let engineX =
        height > 0 && typeof tapY === 'number' && Number.isFinite(tapY)
          ? (1 - tapY / height) * laneLength
          : deployZoneDepth / 2;
      if (!Number.isFinite(engineX)) engineX = deployZoneDepth / 2;
      const clamped = Math.max(0, Math.min(deployZoneDepth, engineX));
      onDeployTap(lane, clamped);
    },
    [height, lane, onDeployTap]
  );

  return (
    <Pressable
      style={styles.strip}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Lane ${lane + 1} — tap the deploy zone to deploy the selected card`}
    >
      {/* Phase 2: the cyberpunk gym floor — a static texture, zero per-tick
          cost; the strip's surface color remains behind it as the fallback. */}
      <Image
        source={arenaFloorTexture()}
        style={[styles.floor, PIXELATED]}
        resizeMode="cover"
        fadeDuration={0}
      />
      <View style={styles.centerLine} />
      <View style={[styles.deployZone, deployHighlight && styles.deployZoneActive]} />
      <View style={[styles.deployBoundary, deployHighlight && styles.deployBoundaryActive]} />
      {momentum !== 0 && <LaneMomentumEdge momentum={momentum} />}
      {renderOrder(units).map((unit) => (
        <UnitMarker
          key={unit.id}
          unit={unit}
          tick={tick}
          reduceMotion={reduceMotion}
          stackOffsetX={stackOffsets.get(unit.id) ?? 0}
          strikeBornAtMs={strikes?.get(unit.id) ?? null}
          hitPing={
            hitPings?.length
              ? latestMatchingHit(unit.id, unit.lane, unit.x, unit.team, hitPings, HIT_FLASH_MATCH_RADIUS)
              : null
          }
        />
      ))}
      {projectiles?.map((shot) => (
        <ProjectileMarker key={shot.key} shot={shot} />
      ))}
      {floaters?.map((floater) => (
        <Floater key={floater.key} floater={floater} />
      ))}
      {telegraphs?.map((telegraph) => (
        <TelegraphMarker key={telegraph.key} telegraph={telegraph} />
      ))}
      {spawnPoofs?.map((poof) => (
        <SpawnPoofMarker key={poof.key} poof={poof} />
      ))}
    </Pressable>
  );
}

/** One floating damage/heal number, or a death dissolve marker, aged per frame. */
function Floater({ floater }: { floater: LaneFloater }) {
  const age = Math.min(FLOATER_TTL_MS, Math.max(0, Date.now() - floater.bornAtMs));
  const t = age / FLOATER_TTL_MS; // 0..1

  // P7: staggerPx lifts a floater that landed at nearly the same spot/time
  // as another (see readability.ts's computeFloaterStagger) — a constant
  // extra rise added on top of the normal age-based one, so simultaneous
  // hits/heals/deaths in one tick fan out instead of overprinting each other.
  const stagger = floater.staggerPx;

  if (floater.kind === 'death') {
    // Death dissolve: a fading ring shrinking outward-then-gone plus a larger,
    // scaling-down glyph — reads as "gone" rather than just another number.
    const ringSize = 26 - t * 10;
    return (
      <View pointerEvents="none" style={[styles.deathWrap, { top: `${floater.topPct}%` }]}>
        <View
          style={[
            styles.deathRing,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              marginLeft: -ringSize / 2,
              borderColor: floater.color,
              opacity: (1 - t) * 0.6,
              transform: [{ translateY: -stagger }],
            },
          ]}
        />
        <Text
          style={[
            styles.deathGlyph,
            {
              color: floater.color,
              opacity: 1 - t,
              transform: [{ scale: 1.3 - t * 0.5 }, { translateY: -4 - t * 10 - stagger }],
            },
          ]}
        >
          {floater.text}
        </Text>
      </View>
    );
  }

  return (
    <Text
      pointerEvents="none"
      style={[
        styles.floater,
        {
          top: `${floater.topPct}%`,
          color: floater.color,
          opacity: 1 - t,
          fontSize: floater.fontSize,
          fontWeight: floater.fontWeight,
          transform: [{ translateY: -10 - t * 16 - stagger }],
        },
      ]}
    >
      {floater.text}
    </Text>
  );
}

/** P4 — a ranged shot: a short team-colored streak racing from the muzzle
 *  to the target with a fading trail, gone within PROJECTILE_TTL_MS (fast on
 *  purpose — the sim applies damage at fire time). */
function ProjectileMarker({ shot }: { shot: LaneProjectile }) {
  const age = Math.min(PROJECTILE_TTL_MS, Math.max(0, Date.now() - shot.bornAtMs));
  const t = age / PROJECTILE_TTL_MS;
  const topPct = shot.fromTopPct + (shot.toTopPct - shot.fromTopPct) * t;
  const tint = shot.team === 'player' ? colors.player : colors.opponent;
  const movingUp = shot.toTopPct < shot.fromTopPct;
  return (
    <View pointerEvents="none" style={[styles.projectileWrap, { top: `${topPct}%` }]}>
      <View style={[styles.projectileBolt, { backgroundColor: tint }]} />
      <View
        style={[
          styles.projectileTrail,
          { backgroundColor: tint, opacity: 0.4 * (1 - t) },
          movingUp ? styles.projectileTrailBelow : styles.projectileTrailAbove,
        ]}
      />
    </View>
  );
}

/**
 * Ability/ultimate cast telegraph. P5: each champion path speaks its own
 * effect language on top of the base expanding ring — shape, not just hue,
 * so two paths never read alike:
 *  - Titan: shockwave — a second trailing ring + four radial crack lines;
 *  - Mass Monster: pressure — one THICK slow ring + drifting dust dots;
 *  - The Shredder: violence — two crossing slash arcs, violet over crimson;
 *  - Cardio Machine: momentum — widening horizontal pulse lines;
 *  - Aesthetics: precision — a gold inner ring + four symmetric sparks.
 * All derived from age each frame, same TTL/caps as before.
 */
function TelegraphMarker({ telegraph }: { telegraph: LaneTelegraph }) {
  const ttl = TELEGRAPH_TTL_MS[telegraph.tier];
  const age = Math.min(ttl, Math.max(0, Date.now() - telegraph.bornAtMs));
  const t = age / ttl;
  const maxSize = TELEGRAPH_MAX_RING_PX[telegraph.tier];
  const size = 8 + t * maxSize;
  const opacity = 1 - t;
  const ring = (
    <View
      style={[
        styles.telegraphRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          marginLeft: -size / 2,
          borderColor: telegraph.color,
          borderWidth: TELEGRAPH_BORDER_PX[telegraph.tier],
          opacity: opacity * 0.85,
        },
      ]}
    />
  );

  let pathLayer: React.ReactNode = null;
  if (telegraph.path === 'titan') {
    // Trailing shockwave ring + radial cracks.
    const size2 = 4 + Math.max(0, t - 0.25) * maxSize;
    const crackLen = 6 + t * (maxSize * 0.55);
    pathLayer = (
      <>
        {t > 0.25 && (
          <View
            style={[
              styles.telegraphRing,
              {
                width: size2,
                height: size2,
                borderRadius: size2 / 2,
                marginLeft: -size2 / 2,
                borderColor: telegraph.color,
                borderWidth: 2,
                opacity: opacity * 0.5,
              },
            ]}
          />
        )}
        {[45, 135, 225, 315].map((deg) => (
          <View
            key={deg}
            style={[
              styles.telegraphCrack,
              {
                height: crackLen,
                backgroundColor: telegraph.color,
                opacity: opacity * 0.8,
                transform: [{ rotate: `${deg}deg` }, { translateY: -crackLen / 2 - 4 }],
              },
            ]}
          />
        ))}
      </>
    );
  } else if (telegraph.path === 'mass') {
    // Oppressive pressure: dust dots drifting outward.
    const drift = 6 + t * (maxSize * 0.5);
    pathLayer = (
      <>
        {[0, 60, 120, 180, 240, 300].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <View
              key={deg}
              style={[
                styles.telegraphDust,
                {
                  backgroundColor: telegraph.color,
                  opacity: opacity * 0.7,
                  transform: [
                    { translateX: Math.cos(rad) * drift },
                    { translateY: Math.sin(rad) * drift * 0.6 },
                  ],
                },
              ]}
            />
          );
        })}
      </>
    );
  } else if (telegraph.path === 'shredder') {
    // Crossing slash arcs: violet over crimson, growing fast then gone.
    const slashLen = 10 + Math.min(1, t * 1.8) * (maxSize * 0.9);
    pathLayer = (
      <>
        <View
          style={[
            styles.telegraphSlash,
            {
              height: slashLen,
              backgroundColor: colors.danger,
              opacity: opacity * 0.75,
              transform: [{ rotate: '45deg' }],
            },
          ]}
        />
        <View
          style={[
            styles.telegraphSlash,
            {
              height: slashLen,
              backgroundColor: telegraph.color,
              opacity: opacity * 0.9,
              transform: [{ rotate: '-45deg' }],
            },
          ]}
        />
      </>
    );
  } else if (telegraph.path === 'cardio') {
    // Momentum pulses: horizontal lines widening away from the cast point.
    const width = 8 + t * maxSize * 1.4;
    pathLayer = (
      <>
        {[-8, 0, 8].map((dy) => (
          <View
            key={dy}
            style={[
              styles.telegraphPulse,
              {
                width,
                marginLeft: -width / 2,
                backgroundColor: telegraph.color,
                opacity: opacity * (dy === 0 ? 0.9 : 0.5),
                transform: [{ translateY: dy }],
              },
            ]}
          />
        ))}
      </>
    );
  } else if (telegraph.path === 'aesthetic') {
    // Precision: gold inner ring + four symmetric sparks on the diagonals.
    const inner = Math.max(4, size * 0.55);
    const sparkDist = 4 + t * (maxSize * 0.5);
    pathLayer = (
      <>
        <View
          style={[
            styles.telegraphRing,
            {
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              marginLeft: -inner / 2,
              borderColor: colors.warning,
              borderWidth: 1.5,
              opacity: opacity * 0.9,
            },
          ]}
        />
        {[45, 135, 225, 315].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <View
              key={deg}
              style={[
                styles.telegraphSpark,
                {
                  backgroundColor: colors.warning,
                  opacity: opacity * 0.9,
                  transform: [
                    { translateX: Math.cos(rad) * sparkDist },
                    { translateY: Math.sin(rad) * sparkDist },
                    { rotate: '45deg' },
                  ],
                },
              ]}
            />
          );
        })}
      </>
    );
  }

  return (
    <View pointerEvents="none" style={[styles.telegraphWrap, { top: `${telegraph.topPct}%` }]}>
      {ring}
      {pathLayer}
      <Text
        numberOfLines={1}
        style={[styles.telegraphLabel, { color: telegraph.color, opacity }]}
      >
        {telegraph.label.toUpperCase()}
      </Text>
    </View>
  );
}

/** Landing poof for a deployed card or a champion summon — a quick expanding
 *  ring in the deploying team's color, gone well within readability budget. */
function SpawnPoofMarker({ poof }: { poof: LaneSpawnPoof }) {
  const age = Math.min(SPAWN_POOF_TTL_MS, Math.max(0, Date.now() - poof.bornAtMs));
  const t = age / SPAWN_POOF_TTL_MS;
  const tint = poof.team === 'player' ? colors.player : colors.opponent;
  const size = 6 + t * 22;
  return (
    <View pointerEvents="none" style={[styles.poofWrap, { top: `${poof.topPct}%` }]}>
      <View
        style={[
          styles.poofRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: -size / 2,
            borderColor: tint,
            opacity: 1 - t,
          },
        ]}
      />
    </View>
  );
}

/**
 * P7 — lane momentum: a subtle tint along whichever edge of the strip is
 * under pressure from this lane's living presence (see readability.ts's
 * computeLaneMomentum). `momentum` > 0 means the player currently has more
 * living health in this lane, i.e. the push is toward the OPPONENT core —
 * the top edge (x = laneLength) — so the top glows player-tinted; < 0
 * glows the bottom edge (the player's own core) opponent-tinted. A few
 * stacked, decreasingly-opaque bands approximate a gradient without a
 * gradient-capable primitive. Deliberately not rendered at momentum === 0
 * (caller already skips it) so an empty or perfectly even lane stays quiet.
 */
function LaneMomentumEdge({ momentum }: { momentum: number }) {
  const pushingTowardTop = momentum > 0; // player dominant -> pressure on the opponent core
  const tint = pushingTowardTop ? colors.player : colors.opponent;
  const strength = Math.min(1, Math.abs(momentum));
  // Bands are always authored strongest-band-first; anchoring at the bottom
  // needs them laid out bottom-up so the strongest band still sits flush
  // against the true edge rather than the far side of the fixed-height box.
  const edgeStyle = pushingTowardTop
    ? { top: 0 as const, flexDirection: 'column' as const }
    : { bottom: 0 as const, flexDirection: 'column-reverse' as const };
  return (
    <View pointerEvents="none" style={[styles.momentumEdge, edgeStyle]}>
      {MOMENTUM_BAND_OPACITIES.map((bandOpacity, i) => (
        <View
          key={i}
          style={[
            styles.momentumBand,
            { backgroundColor: tint, opacity: bandOpacity * strength * MOMENTUM_MAX_OPACITY },
          ]}
        />
      ))}
    </View>
  );
}

/** Decreasing opacity multipliers for the stacked momentum bands, outermost
 *  (closest to the edge) first. */
const MOMENTUM_BAND_OPACITIES = [1, 0.6, 0.3];
/** Ceiling on the strongest band's opacity even at momentum = ±1 — this is a
 *  read-the-room cue, never a bright team-colored bar competing with units. */
const MOMENTUM_MAX_OPACITY = 0.35;

/** Tiny team-facing chevron under a unit's health bar: player units point up
 *  (toward the opponent core, x = laneLength), opponent units point down
 *  (toward the player's own core, x = 0) — a shape/direction cue that holds
 *  even for a colorblind viewer, independent of the cyan/red team hues. */
function DirectionChevron({ team }: { team: TeamId }) {
  const tint = team === 'player' ? colors.player : colors.opponent;
  return (
    <View
      style={[
        styles.directionChevron,
        team === 'player' ? { borderBottomColor: tint } : { borderTopColor: tint },
      ]}
    />
  );
}

/** A unit/champion marker: team base plate + PixelLab sprite + health bar +
 *  direction chevron, carrying the P3/P4 procedural character animation:
 *  walk-bob while moving, fighting lean / wind-up / strike lunge from the
 *  sim's own attack cooldown (impact.ts's attackPose), hit recoil + white
 *  (or shield-blue) silhouette flash on the struck unit, and a spawn
 *  drop-in scale. Everything ages from the frame clock or derives from sim
 *  state — no Animated values, no per-unit React state. */
function UnitMarker({
  unit,
  tick,
  hitPing,
  strikeBornAtMs,
  stackOffsetX,
  reduceMotion,
}: {
  unit: UnitState;
  tick: number;
  hitPing: LaneHitPing | null;
  strikeBornAtMs: number | null;
  stackOffsetX: number;
  reduceMotion: boolean;
}) {
  const nowMs = Date.now();
  const topPct = (1 - unit.x / laneLength) * 100;
  const healthPct = Math.max(0, Math.min(1, unit.health / unit.baseMaxHealth));
  const tint = unit.team === 'player' ? colors.player : colors.opponent;
  const flashAge = hitPing === null ? HIT_FLASH_TTL_MS : Math.max(0, nowMs - hitPing.bornAtMs);
  const flashOpacity = flashAge < HIT_FLASH_TTL_MS ? (1 - flashAge / HIT_FLASH_TTL_MS) * 0.75 : 0;
  const boxFlashOverlay = flashOpacity > 0 && (
    <View pointerEvents="none" style={[styles.hitFlashOverlay, { opacity: flashOpacity }]} />
  );
  const moving = unit.targetId === null;
  const bobY =
    moving && !reduceMotion
      ? Math.sin((nowMs / BOB_PERIOD_MS) * Math.PI * 2 + bobPhase(unit.id)) * BOB_AMPLITUDE_PX
      : 0;

  // P4 character animation: anticipation → strike → recovery from the sim's
  // attack cooldown; recoil pushes the DEFENDER back (toward its own core)
  // while its hit flash is active, scaled by the hit's impact tier.
  const strikeAge = strikeBornAtMs === null ? null : Math.max(0, nowMs - strikeBornAtMs);
  const pose = attackPose(unit, strikeAge !== null && strikeAge < STRIKE_MS ? strikeAge : null);
  const recoilPx =
    hitPing !== null && flashOpacity > 0
      ? TIER_FX[tierForDamage(hitPing.amount)].recoilPx * (flashOpacity / 0.75)
      : 0;
  const backwardSign = unit.team === 'player' ? 1 : -1; // toward own core
  const dropScale = spawnScale(tick - unit.spawnedAtTick);
  const animOffsetY = bobY + pose.offsetY + backwardSign * recoilPx;
  const animScale = pose.scale * dropScale;
  const flashTint = hitPing?.shielded ? colors.shield : '#FFFFFF';

  /** Sprite + silhouette flash + team base plate (+ optional P5 motion
   *  trail behind the sprite), animating together. */
  const spriteStack = (
    sprite: NonNullable<ReturnType<typeof unitSprite>>,
    sizeStyle: ImageStyle,
    plateStyle: object,
    trail?: { offsetY: number; tintColor: string; opacity: number } | null
  ) => (
    <View
      style={[
        styles.spriteStack,
        { transform: [{ translateY: animOffsetY }, { scale: animScale }] },
      ]}
    >
      <View style={[styles.basePlate, plateStyle, { borderColor: tint, backgroundColor: `${tint}33` }]} />
      {trail && (
        <Image
          source={sprite}
          style={[
            sizeStyle,
            PIXELATED,
            styles.trailSilhouette,
            { opacity: trail.opacity, tintColor: trail.tintColor, transform: [{ translateY: trail.offsetY }] },
          ]}
          fadeDuration={0}
        />
      )}
      <Image source={sprite} style={[sizeStyle, PIXELATED]} fadeDuration={0} />
      {flashOpacity > 0 && (
        <Image
          source={sprite}
          style={[
            sizeStyle,
            PIXELATED,
            styles.flashSilhouette,
            { opacity: flashOpacity, tintColor: flashTint },
          ]}
          fadeDuration={0}
        />
      )}
    </View>
  );

  if (unit.kind === 'champion') {
    // Champions render distinctly larger; their path identity lives in the
    // art itself (PixelLab), team reads from outline + plate + health bar.
    // Borrowed squad champions (M9) sit between unit and captain size.
    const champion = getChampionById(unit.contentId);
    const fill = champion ? pathColor(champion.path) : tint;
    const initial = champion ? champion.name.charAt(0).toUpperCase() : '?';
    const borrowed = unit.champion ? !unit.champion.commandable : false;
    // P4 real character animation: champions cycle their PixelLab walk
    // frames while moving (frame 0 is anchored to the base sprite); static
    // base sprite in combat / under reduced motion / when frames missing.
    const walkFrames = champion ? championWalkFrames(champion.art, unit.team) : null;
    const walking = moving && !reduceMotion && walkFrames !== null;
    const sprite = walking
      ? walkFrames![Math.floor((nowMs / WALK_FRAME_MS + bobPhase(unit.id)) % 4)]
      : champion
        ? championSprite(champion.art, unit.team)
        : null;
    // P5 path identity in motion: the Cardio Machine leaves a speed
    // afterimage while moving; the Shredder leaves a crimson ghost during
    // its strike lunge. Both are a second sprite draw offset behind the
    // facing direction — no extra assets, gone with the pose.
    const behindSign = unit.team === 'player' ? 1 : -1;
    let trail: { offsetY: number; tintColor: string; opacity: number } | null = null;
    if (champion && sprite && !reduceMotion) {
      if (champion.path === 'cardio' && moving) {
        trail = { offsetY: behindSign * 7, tintColor: colors.pathCardio, opacity: 0.3 };
      } else if (
        champion.path === 'shredder' &&
        strikeAge !== null &&
        strikeAge < STRIKE_MS
      ) {
        trail = {
          offsetY: behindSign * 6,
          tintColor: colors.danger,
          opacity: 0.45 * (1 - strikeAge / STRIKE_MS),
        };
      }
    }
    return (
      <View
        style={[
          styles.unitWrap,
          { top: `${topPct}%`, transform: [{ translateY: -14 }, { translateX: stackOffsetX }] },
        ]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.unitHealthTrack,
            borrowed ? styles.borrowedHealthTrack : styles.championHealthTrack,
          ]}
        >
          <View
            style={[
              styles.unitHealthFill,
              { width: `${healthPct * 100}%`, backgroundColor: healthBarColor(healthPct, tint, colors.warning) },
            ]}
          />
        </View>
        {sprite ? (
          spriteStack(
            sprite,
            borrowed ? styles.borrowedSprite : styles.championSprite,
            borrowed ? styles.borrowedPlate : styles.championPlate,
            trail
          )
        ) : (
          <View
            style={[
              borrowed ? styles.borrowedDot : styles.championDot,
              { backgroundColor: fill, borderColor: tint },
            ]}
          >
            <Text style={borrowed ? styles.borrowedMarkerText : styles.championMarkerText}>
              {initial}
            </Text>
            {boxFlashOverlay}
          </View>
        )}
        <DirectionChevron team={unit.team} />
        {/* P10: a borrowed champion carries its OWNER's name — the social
            point of Gym Wars is fielding your gym-mates, so say whose
            champion this is right on the battlefield. */}
        {borrowed && unit.champion?.ownerName ? (
          <Text numberOfLines={1} style={[styles.ownerPlate, { color: tint }]}>
            {unit.champion.ownerName}
          </Text>
        ) : null}
      </View>
    );
  }

  const card = getCardById(unit.contentId);
  const sprite = card ? unitSprite(card.art, unit.team) : null;
  const marker =
    card?.unit?.behavior === 'healer' || card?.unit?.stats.isRanged
      ? card.art.charAt(0).toUpperCase()
      : null;

  return (
    <View style={[styles.unitWrap, { top: `${topPct}%` }]} pointerEvents="none">
      <View style={styles.unitHealthTrack}>
        <View
          style={[
            styles.unitHealthFill,
            { width: `${healthPct * 100}%`, backgroundColor: healthBarColor(healthPct, tint, colors.warning) },
          ]}
        />
      </View>
      {sprite ? (
        spriteStack(sprite, styles.unitSprite, styles.unitPlate)
      ) : (
        <View style={[styles.unitDot, { backgroundColor: tint, borderColor: tint }]}>
          {marker ? <Text style={styles.unitMarkerText}>{marker}</Text> : null}
          {boxFlashOverlay}
        </View>
      )}
      <DirectionChevron team={unit.team} />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  // Phase 2 — environment. The floor texture fills the strip (static Image,
  // zero per-tick cost); the faint center line marks the halfway point; the
  // deploy zone gets a real boundary line that brightens while a card is
  // selected.
  floor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0.92,
  },
  centerLine: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: '50%',
    height: 1,
    backgroundColor: 'rgba(230, 241, 255, 0.07)',
  },
  deployZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: `${DEPLOY_ZONE_HEIGHT_PCT}%`,
    backgroundColor: 'rgba(34, 211, 238, 0.07)',
  },
  deployZoneActive: { backgroundColor: 'rgba(34, 211, 238, 0.16)' },
  deployBoundary: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: `${DEPLOY_ZONE_HEIGHT_PCT}%`,
    height: 2,
    backgroundColor: 'rgba(34, 211, 238, 0.28)',
  },
  deployBoundaryActive: { backgroundColor: 'rgba(34, 211, 238, 0.8)' },
  unitWrap: {
    position: 'absolute',
    left: '50%',
    marginLeft: -22,
    width: 44,
    alignItems: 'center',
    transform: [{ translateY: -14 }],
  },
  unitHealthTrack: {
    width: 20,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 2,
  },
  unitHealthFill: { height: '100%' },
  // Sprite stack: team base plate (ground ellipse) behind the sprite; the
  // white silhouette flash overlays it; all three bob together while moving.
  spriteStack: { position: 'relative', alignItems: 'center' },
  basePlate: {
    position: 'absolute',
    bottom: -1,
    borderWidth: 1.5,
  },
  unitPlate: { width: 20, height: 7, borderRadius: 4 },
  championPlate: { width: 30, height: 9, borderRadius: 5, borderWidth: 2 },
  borrowedPlate: { width: 24, height: 8, borderRadius: 4 },
  // White-silhouette hit flash: the same sprite re-drawn tinted solid white
  // over itself (tintColor recolors every opaque pixel).
  flashSilhouette: { position: 'absolute', top: 0, tintColor: '#FFFFFF' },
  // P5 motion trail: the sprite re-drawn tinted + offset behind the mover.
  trailSilhouette: { position: 'absolute', top: 0 },
  unitDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitMarkerText: { color: '#04121A', fontSize: 8, fontWeight: '800' },
  floater: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
  },
  championHealthTrack: { width: 30 },
  championDot: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  championMarkerText: { color: '#04121A', fontSize: 11, fontWeight: '800' },
  // PixelLab sprites (64px source, team-outlined at build time). Champions
  // are deliberately much larger than units — silhouette hierarchy is the
  // primary "that's a champion" read (Phase 3).
  unitSprite: { width: 26, height: 26 },
  championSprite: { width: 38, height: 38 },
  borrowedSprite: { width: 30, height: 30 },
  // Borrowed (M9): between a regular unit and the captain in size — the
  // smaller sprite + thinner plate mark it as borrowed.
  borrowedHealthTrack: { width: 24 },
  borrowedDot: {
    width: 17,
    height: 17,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  borrowedMarkerText: { color: '#04121A', fontSize: 9, fontWeight: '800' },
  // P10 — owner nameplate under a borrowed champion (team-tinted, tiny but
  // readable; the wrap is 44pt wide so ~8 chars show before ellipsis).
  ownerPlate: {
    marginTop: 1,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
    maxWidth: 44,
    textShadowColor: 'rgba(4, 18, 26, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  // Hit-flash for the DOT fallback path only — sprites flash via the tinted
  // silhouette overlay instead (flashSilhouette). Plain View + opacity, aged
  // per frame — no Animated.
  hitFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
  },
  // Death dissolve: a shrinking-fade ring plus a scaling-down glyph, centered
  // on the unit's last position.
  deathWrap: { position: 'absolute', left: '50%' },
  deathRing: { position: 'absolute', top: -13, borderWidth: 2 },
  deathGlyph: {
    marginLeft: -8,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  // Ability/ultimate telegraph: expanding ring + name label in the champion's
  // path color, centered on the caster. P5 adds per-path shape layers.
  telegraphWrap: { position: 'absolute', left: '50%' },
  telegraphRing: { position: 'absolute', top: -25 },
  telegraphCrack: { position: 'absolute', top: -25, width: 2, marginLeft: -1, borderRadius: 1 },
  telegraphDust: {
    position: 'absolute',
    top: -27,
    width: 4,
    height: 4,
    borderRadius: 2,
    marginLeft: -2,
  },
  telegraphSlash: { position: 'absolute', top: -25, width: 3, marginLeft: -1.5, borderRadius: 1.5 },
  telegraphPulse: { position: 'absolute', top: -26, height: 2, borderRadius: 1 },
  telegraphSpark: { position: 'absolute', top: -27, width: 5, height: 5, marginLeft: -2.5 },
  telegraphLabel: {
    position: 'absolute',
    top: -6,
    left: -60,
    width: 120,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  // Spawn/summon arrival poof: a quick expanding ring in the deploying
  // team's color.
  poofWrap: { position: 'absolute', left: '50%' },
  poofRing: { position: 'absolute', top: -14, borderWidth: 2 },
  // P4 — projectile streak: a small bright bolt with a fading trail behind
  // it, centered on the lane like the units it flies between.
  projectileWrap: { position: 'absolute', left: '50%', alignItems: 'center' },
  projectileBolt: { position: 'absolute', top: -5, width: 3, height: 8, borderRadius: 1.5, marginLeft: -1.5 },
  projectileTrail: { position: 'absolute', width: 2, height: 12, borderRadius: 1, marginLeft: -1 },
  projectileTrailAbove: { top: -18 },
  projectileTrailBelow: { top: 3 },
  // P7 — lane momentum edge: a few stacked, decreasingly-opaque bands
  // against whichever edge is under pressure (see LaneMomentumEdge).
  momentumEdge: { position: 'absolute', left: 0, right: 0, height: 22 },
  momentumBand: { flex: 1 },
  // P7 — team-direction chevron under every unit marker: a CSS-triangle
  // (zero-size box, two transparent side borders, one colored border on the
  // facing edge) pointing up for the player (toward the opponent core) and
  // down for the opponent (toward the player's own core).
  directionChevron: {
    marginTop: 1,
    width: 0,
    height: 0,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
});
