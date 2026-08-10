import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { chipPile, FORGE_CHIPS } from '@/domain/forge-duel';
import { ownerTone, poolTilt, type PoolSide } from '@/domain/forge-pool';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ChipSurface } from '@/ui/duel/physics/chip-surface';
import { useChipTable } from '@/ui/duel/physics/use-chip-table';

/**
 * THE TWO-PAN BALANCE SCALE (Spec v5 §5, Phase 6).
 *
 * BACK metal in one pan, PUSH metal in the other, and the beam leans toward
 * whichever is heavier. NEVER ONE MERGED VESSEL — the sides of a pool are the whole
 * proposition, and pouring them into a single pile would hide the only thing that
 * decides the split.
 *
 * ── THE INGOTS ARE STILL REAL, AND STILL MOVE WITH THE PHONE ──
 *
 * Tyson, 2026-08-10: "I still like the pool with ingots being moveable with the tilt
 * gravity, I dont want to lose that feature to the pans."
 *
 * So each pan is a genuine `ChipWorld` — the same rigid bodies, the same tilt
 * gravity, the same collisions and the same audio. `chip-world.ts` is not touched by
 * any of this; the pans are two of it rather than a replacement for it. Lean the
 * phone and the metal slides in both pans at once, because both worlds read the same
 * accelerometer.
 *
 * WHAT IS DIFFERENT FROM A PLEDGE TABLE: the surface is `locked`, which stops the
 * GRAB but not the tilt. You can push a shared pool around with the phone; you
 * cannot pick somebody else's ingot up and drag it out of the pan, because it is not
 * yours to take back. That distinction is the whole reason `locked` lives on the
 * surface rather than on the world.
 *
 * ── EVERY INGOT SAYS WHOSE IT IS (§5, "no anonymous tokens") ──
 *
 * Tinted by owner, not by side: the pan already tells you the side. The colour is
 * derived from the user id, so it is stable across renders and across devices
 * without needing a name — and the tint is drawn as an underline plus corner ticks,
 * which survive being stacked on.
 */

/** A position in the pool, as the entries table holds it. */
export interface PoolPosition {
  user_id: string;
  side: PoolSide;
  stake: number;
}

/**
 * One pan: a real physics surface holding everybody's metal on that side.
 *
 * The pile is REBUILT from the positions rather than accumulated, because the
 * server is the authority on who is in for how much. `onAmountChange` is a no-op on
 * purpose — this table represents money, it does not decide it.
 */
function Pan({
  positions,
  total,
  label,
  tint,
  height,
  testID,
}: {
  positions: readonly PoolPosition[];
  total: number;
  label: string;
  tint: string;
  height: number;
  testID: string;
}) {
  const colors = useThemeColors();
  const perfMode = useSettingsStore((s) => s.perfMode);

  const table = useChipTable({
    amount: 0,
    // The pan never changes the money. It is a view of a settled fact.
    onAmountChange: () => undefined,
    denominations: FORGE_CHIPS,
    ownerId: 'pool',
    calm: perfMode,
    // NOT locked: a locked WORLD stops reading the phone, and the tilt is the
    // thing we are keeping. The SURFACE is locked instead, just below.
    locked: false,
  });

  /**
   * FILL THE PAN, once per change of positions.
   *
   * Each contributor's stake becomes its own small pile committed under THEIR id,
   * so `toneFor` can tint each piece to its owner. `chipPile` picks a denomination
   * that keeps the body count sane — a 500-coin position must not spawn a hundred
   * rigid bodies.
   */
  useEffect(() => {
    if (positions.length === 0) return;
    let cancelled = false;
    // Stagger slightly so they land as a pour rather than appearing in one frame.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let n = 0;
    for (const p of positions) {
      for (const v of chipPile(p.stake, 6)) {
        const delay = Math.min(600, n * 45);
        n += 1;
        timers.push(
          setTimeout(() => {
            if (!cancelled) table.commit({ value: v, source: 'pour', ownerId: p.user_id });
          }, delay)
        );
      }
    }
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
    // The positions array identity changes when the server data does, which is
    // exactly when the pan should be rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.map((p) => `${p.user_id}:${p.stake}`).join(',')]);

  return (
    <View style={{ flex: 1 }} testID={testID}>
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          className="text-2xs"
          numberOfLines={1}
          style={{ color: colors['text-dim'], letterSpacing: 1, flex: 1, minWidth: 0 }}
        >
          {label}
        </Text>
        <Text allowFontScaling={false} className="text-2xs" style={{ color: tint, ...pixelFont() }}>
          {total}
        </Text>
      </View>
      <View
        className="mt-s1 rounded-md"
        style={{
          height,
          borderWidth: 1,
          borderColor: `${tint}59`,
          backgroundColor: 'rgba(4,8,15,0.55)',
          overflow: 'hidden',
        }}
      >
        {/* THE SURFACE IS LOCKED, THE WORLD IS NOT. Tilt still slides the metal;
            nobody can drag another person's ingot out of a shared pool. */}
        <ChipSurface
          table={table}
          height={height}
          locked
          toneFor={(c) => (c.ownerId === 'pool' ? undefined : ownerTone(c.ownerId))}
          testID={`${testID}-surface`}
        />
      </View>
    </View>
  );
}

/**
 * The scale. Two pans, a beam that leans, and a caption naming what the lean means.
 */
export function PoolScale({
  back,
  push,
  positions,
  athleteId,
  opponentId,
  athleteName,
  panHeight = 108,
  testID = 'pool-scale',
}: {
  back: number;
  push: number;
  positions: readonly PoolPosition[];
  /** The athlete anchors BACK; the opponent anchors PUSH. */
  athleteId: string;
  opponentId: string;
  athleteName: string;
  panHeight?: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const tilt = poolTilt({ back, push });

  // The beam leans toward the heavier pan. Spring rather than timing, because a
  // scale settles — and under reduced motion it simply arrives.
  const lean = useSharedValue(0);
  useEffect(() => {
    lean.value = perfMode ? tilt : withSpring(tilt, { damping: 14, stiffness: 90 });
  }, [tilt, perfMode, lean]);
  const beamStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${lean.value * 4}deg` }],
  }));

  /**
   * THE PRINCIPALS ARE IN THE PANS TOO, and leaving them out was the first build's
   * bug: a 50 v 50 pool rendered "50" and "50" above two EMPTY pans, because the
   * only positions it knew came from the entries table and the athlete's and
   * opponent's stakes live on the callout row.
   *
   * Their share is the side total minus everybody who joined it, so it stays right
   * however the pool grows, and it is attributed to their real ids — §5's "no
   * anonymous tokens" applies most of all to the two people with the most metal in.
   */
  const backers = positions.filter((p) => p.side === 'back');
  const pushers = positions.filter((p) => p.side === 'push');
  const joined = (side: PoolSide) =>
    positions.filter((p) => p.side === side).reduce((n, p) => n + p.stake, 0);
  const anchor = (userId: string, side: PoolSide, total: number): PoolPosition[] => {
    const own = Math.max(0, total - joined(side));
    return own > 0 ? [{ user_id: userId, side, stake: own }] : [];
  };
  const backAll = [...anchor(athleteId, 'back', back), ...backers];
  const pushAll = [...anchor(opponentId, 'push', push), ...pushers];

  return (
    <View testID={testID}>
      {/* THE BEAM. Small angle on purpose: this is a weighing instrument, not a
          seesaw, and a big swing would read as a game of chance rather than as
          two amounts of metal. */}
      <Animated.View
        style={[
          { height: 2, backgroundColor: `${colors.legendary}80`, borderRadius: 1 },
          beamStyle,
        ]}
        testID={`${testID}-beam`}
      />
      <View className="mt-s2 flex-row" style={{ gap: 8 }}>
        <Pan
          positions={backAll}
          total={back}
          label={`BACKING ${athleteName.toUpperCase()}`}
          tint={colors.success}
          height={panHeight}
          testID={`${testID}-back`}
        />
        <Pan
          positions={pushAll}
          total={push}
          label="PUSHING BACK"
          tint={colors.danger}
          height={panHeight}
          testID={`${testID}-push`}
        />
      </View>
      <Text className="mt-s2 text-2xs text-text-mute">
        {/* Says what the metal means, and never quotes a chance. */}
        {back === push
          ? 'Level — the same on both sides.'
          : back > push
            ? `More metal backing ${athleteName}.`
            : `More metal against ${athleteName}.`}{' '}
        Tilt your phone and it slides.
      </Text>
    </View>
  );
}
