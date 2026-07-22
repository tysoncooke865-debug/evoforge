'use no memo'; // React Compiler opt-out: these components render a mutable simulation read from refs on a version counter (see battle-store docs).

/**
 * One vertical lane of the arena. Engine x in [0, laneLength] maps onto
 * screen y: x = 0 (the player's own core) is the bottom of the strip, x =
 * laneLength (the opponent's core) is the top — see game-engine/simulation
 * state.ts's coordinate convention. The bottom `deployZoneDepth` slice is the
 * player's tap-to-deploy zone, tinted so it reads as interactive.
 */
import React, { useCallback, useState } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, pathColor, radius } from '../../../constants/theme';
import { BALANCE, getCardById, getChampionById } from '../../../content';
import type { UnitState } from '../../../game-engine/simulation/state';
import type { LaneId } from '../../../game-engine/types';

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
  text: string;
  color: string;
  bornAtMs: number;
}

/** Floater lifetime; the arena screen prunes with the same constant. */
export const FLOATER_TTL_MS = 700;

interface Props {
  lane: LaneId;
  /** Living units in this lane only — dead units are filtered out by the caller. */
  units: UnitState[];
  /** Active combat floaters for this lane (already capped by the caller). */
  floaters?: readonly LaneFloater[];
  onDeployTap: (lane: LaneId, engineX: number) => void;
}

export function LaneStrip({ lane, units, floaters, onDeployTap }: Props) {
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
      {units.map((unit) => (
        <UnitMarker key={unit.id} unit={unit} />
      ))}
      {floaters?.map((floater) => (
        <Floater key={floater.key} floater={floater} />
      ))}
    </Pressable>
  );
}

/** One floating damage/heal number or death fade, aged per frame. */
function Floater({ floater }: { floater: LaneFloater }) {
  const age = Math.min(FLOATER_TTL_MS, Math.max(0, Date.now() - floater.bornAtMs));
  const t = age / FLOATER_TTL_MS; // 0..1
  return (
    <Text
      pointerEvents="none"
      style={[
        styles.floater,
        {
          top: `${floater.topPct}%`,
          color: floater.color,
          opacity: 1 - t,
          transform: [{ translateY: -10 - t * 16 }],
        },
      ]}
    >
      {floater.text}
    </Text>
  );
}

/** Small marker dot with a 3px health bar; ranged/healer units get a letter from their art key. */
function UnitMarker({ unit }: { unit: UnitState }) {
  const topPct = (1 - unit.x / laneLength) * 100;
  const healthPct = Math.max(0, Math.min(1, unit.health / unit.baseMaxHealth));
  const tint = unit.team === 'player' ? colors.player : colors.opponent;

  if (unit.kind === 'champion') {
    // Champions render larger, tinted with their path color and initial;
    // the team still reads from the border + health bar tint. Borrowed squad
    // champions (M9) keep the path color + initial but use a visibly smaller
    // ring — the captain keeps the big marker.
    const champion = getChampionById(unit.contentId);
    const fill = champion ? pathColor(champion.path) : tint;
    const initial = champion ? champion.name.charAt(0).toUpperCase() : '?';
    const borrowed = unit.champion ? !unit.champion.commandable : false;
    return (
      <View style={[styles.unitWrap, { top: `${topPct}%` }]} pointerEvents="none">
        <View
          style={[
            styles.unitHealthTrack,
            borrowed ? styles.borrowedHealthTrack : styles.championHealthTrack,
          ]}
        >
          <View
            style={[styles.unitHealthFill, { width: `${healthPct * 100}%`, backgroundColor: tint }]}
          />
        </View>
        <View
          style={[
            borrowed ? styles.borrowedDot : styles.championDot,
            { backgroundColor: fill, borderColor: tint },
          ]}
        >
          <Text style={borrowed ? styles.borrowedMarkerText : styles.championMarkerText}>
            {initial}
          </Text>
        </View>
      </View>
    );
  }

  const card = getCardById(unit.contentId);
  const marker =
    card?.unit?.behavior === 'healer' || card?.unit?.stats.isRanged
      ? card.art.charAt(0).toUpperCase()
      : null;

  return (
    <View style={[styles.unitWrap, { top: `${topPct}%` }]} pointerEvents="none">
      <View style={styles.unitHealthTrack}>
        <View
          style={[styles.unitHealthFill, { width: `${healthPct * 100}%`, backgroundColor: tint }]}
        />
      </View>
      <View style={[styles.unitDot, { backgroundColor: tint, borderColor: tint }]}>
        {marker ? <Text style={styles.unitMarkerText}>{marker}</Text> : null}
      </View>
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
});
