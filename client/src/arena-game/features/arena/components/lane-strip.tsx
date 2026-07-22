'use no memo'; // React Compiler opt-out: these components render a mutable simulation read from refs on a version counter (see battle-store docs).

/**
 * One vertical lane of the arena. Engine x in [0, laneLength] maps onto
 * screen y: x = 0 (the player's own core) is the bottom of the strip, x =
 * laneLength (the opponent's core) is the top — see game-engine/simulation
 * state.ts's coordinate convention. The bottom `deployZoneDepth` slice is the
 * player's tap-to-deploy zone, tinted so it reads as interactive.
 */
import React, { useCallback, useState } from 'react';
import { GestureResponderEvent, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, pathColor, radius } from '../../../constants/theme';
import { BALANCE, getCardById, getChampionById } from '../../../content';
import type { UnitState } from '../../../game-engine/simulation/state';
import type { LaneId, TeamId } from '../../../game-engine/types';
import { latestMatchingHit, type TelegraphTier } from './combat-fx';
import { healthBarColor } from './readability';
import { championSprite, unitSprite } from './sprites';

const { laneLength, deployZoneDepth } = BALANCE.arena;
const DEPLOY_ZONE_HEIGHT_PCT = (deployZoneDepth / laneLength) * 100;

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
  /** P7: -1..1 signed lane momentum (see readability.ts's computeLaneMomentum)
   *  — which team currently has more living presence pushing this lane, and
   *  toward which core. Omit (or 0) for no edge indicator. */
  momentum?: number;
  onDeployTap: (lane: LaneId, engineX: number) => void;
}

export function LaneStrip({
  lane,
  units,
  floaters,
  hitPings,
  telegraphs,
  spawnPoofs,
  momentum = 0,
  onDeployTap,
}: Props) {
  const [height, setHeight] = useState(0);

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
      <View style={styles.deployZone} />
      {momentum !== 0 && <LaneMomentumEdge momentum={momentum} />}
      {units.map((unit) => (
        <UnitMarker
          key={unit.id}
          unit={unit}
          flashBornAtMs={
            hitPings?.length
              ? latestMatchingHit(unit.lane, unit.x, unit.team, hitPings, HIT_FLASH_MATCH_RADIUS)
              : null
          }
        />
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
          transform: [{ translateY: -10 - t * 16 - stagger }],
        },
      ]}
    >
      {floater.text}
    </Text>
  );
}

/** Expanding ring + name label for an ability/ultimate cast — ultimates ring
 *  bigger and hold longer (TELEGRAPH_TTL_MS / TELEGRAPH_MAX_RING_PX), so the
 *  same visual language reads as "bigger deal" without new colors. */
function TelegraphMarker({ telegraph }: { telegraph: LaneTelegraph }) {
  const ttl = TELEGRAPH_TTL_MS[telegraph.tier];
  const age = Math.min(ttl, Math.max(0, Date.now() - telegraph.bornAtMs));
  const t = age / ttl;
  const maxSize = TELEGRAPH_MAX_RING_PX[telegraph.tier];
  const size = 8 + t * maxSize;
  const opacity = 1 - t;
  return (
    <View pointerEvents="none" style={[styles.telegraphWrap, { top: `${telegraph.topPct}%` }]}>
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

/** Small marker dot with a 3px health bar; ranged/healer units get a letter from their art key.
 *  `flashBornAtMs` (null when no recent hit matched) drives a brief white
 *  overlay flash, aged the same way as every other combat-feel effect here —
 *  no Animated value, no per-unit React state. */
function UnitMarker({ unit, flashBornAtMs }: { unit: UnitState; flashBornAtMs: number | null }) {
  const topPct = (1 - unit.x / laneLength) * 100;
  const healthPct = Math.max(0, Math.min(1, unit.health / unit.baseMaxHealth));
  const tint = unit.team === 'player' ? colors.player : colors.opponent;
  const flashAge =
    flashBornAtMs === null ? HIT_FLASH_TTL_MS : Math.max(0, Date.now() - flashBornAtMs);
  const flashOpacity = flashAge < HIT_FLASH_TTL_MS ? (1 - flashAge / HIT_FLASH_TTL_MS) * 0.75 : 0;
  const flashOverlay = flashOpacity > 0 && (
    <View pointerEvents="none" style={[styles.hitFlashOverlay, { opacity: flashOpacity }]} />
  );

  if (unit.kind === 'champion') {
    // Champions render larger, tinted with their path color and initial;
    // the team still reads from the border + health bar tint. Borrowed squad
    // champions (M9) keep the path color + initial but use a visibly smaller
    // ring — the captain keeps the big marker.
    const champion = getChampionById(unit.contentId);
    const fill = champion ? pathColor(champion.path) : tint;
    const initial = champion ? champion.name.charAt(0).toUpperCase() : '?';
    const borrowed = unit.champion ? !unit.champion.commandable : false;
    // Pixel sprite (path-colored) when available; the team ring + health bar
    // tint keep team readability. Falls back to the colored dot + initial.
    const sprite = champion ? championSprite(champion.art, champion.path) : null;
    return (
      <View style={[styles.unitWrap, { top: `${topPct}%` }]} pointerEvents="none">
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
          <View
            style={[
              borrowed ? styles.borrowedSpriteFrame : styles.championSpriteFrame,
              { borderColor: tint },
            ]}
          >
            <Image
              source={sprite}
              style={borrowed ? styles.borrowedSprite : styles.championSprite}
            />
            {flashOverlay}
          </View>
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
            {flashOverlay}
          </View>
        )}
        <DirectionChevron team={unit.team} />
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
        <View style={styles.spriteFlashClip}>
          <Image source={sprite} style={styles.unitSprite} />
          {flashOverlay}
        </View>
      ) : (
        <View style={[styles.unitDot, { backgroundColor: tint, borderColor: tint }]}>
          {marker ? <Text style={styles.unitMarkerText}>{marker}</Text> : null}
          {flashOverlay}
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
  deployZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: `${DEPLOY_ZONE_HEIGHT_PCT}%`,
    backgroundColor: 'rgba(34, 211, 238, 0.08)',
  },
  unitWrap: {
    position: 'absolute',
    left: '50%',
    marginLeft: -9,
    width: 18,
    alignItems: 'center',
    transform: [{ translateY: -9 }],
  },
  unitHealthTrack: {
    width: 16,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 2,
  },
  unitHealthFill: { height: '100%' },
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
  championHealthTrack: { width: 26 },
  championDot: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  championMarkerText: { color: '#04121A', fontSize: 11, fontWeight: '800' },
  // Pixel sprites (Kenney 1-bit, pre-tinted). Sizes mirror the dot metrics
  // so battle-density readability stays unchanged.
  unitSprite: { width: 18, height: 18 },
  championSpriteFrame: {
    borderWidth: 2,
    borderRadius: 6,
    padding: 1,
    backgroundColor: 'rgba(4, 18, 26, 0.65)',
  },
  championSprite: { width: 24, height: 24 },
  borrowedSpriteFrame: {
    borderWidth: 1,
    borderRadius: 5,
    padding: 1,
    backgroundColor: 'rgba(4, 18, 26, 0.65)',
  },
  borrowedSprite: { width: 18, height: 18 },
  // Borrowed (M9): between a regular unit and the captain in size — path
  // color + initial mark it as a champion, the thinner ring as borrowed.
  borrowedHealthTrack: { width: 20 },
  borrowedDot: {
    width: 17,
    height: 17,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  borrowedMarkerText: { color: '#04121A', fontSize: 9, fontWeight: '800' },
  // Hit-flash: a brief bright overlay clipped to the sprite/dot's own box —
  // never the health bar above it (see spriteFlashClip / the frame views'
  // implicit sizing). Plain View + opacity, aged per frame — no Animated.
  hitFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
  },
  spriteFlashClip: { position: 'relative' },
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
  // path color, centered on the caster.
  telegraphWrap: { position: 'absolute', left: '50%' },
  telegraphRing: { position: 'absolute', top: -25 },
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
