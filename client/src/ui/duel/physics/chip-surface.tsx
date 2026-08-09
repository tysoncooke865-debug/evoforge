import { memo, useCallback } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { ForgeChipValue } from '@/domain/forge-duel';
import { useThemeColors } from '@/theme/use-theme';
import { ForgeChip } from '@/ui/duel/forge-chip';

import { chipRadius } from './chip-world';
import { playChipReturn } from './chip-audio';
import { chipReleaseHaptic } from './chip-haptics';
import type { ChipTableApi, CommittedChip } from './use-chip-table';

/**
 * THE TABLE, drawn.
 *
 * ONE Animated.View PER CHIP, each reading its own three numbers out of a
 * shared pose buffer inside a worklet. React renders this list when a chip is
 * COMMITTED or TAKEN BACK and at no other time — the sixty position updates a
 * second never touch it.
 *
 * Why not a canvas: React Native has no `<canvas>`, so a canvas path would be
 * web-only and would need a whole second implementation for a native build.
 * react-native-svg can draw it, but every node update crosses into the SVG
 * renderer from JS. Reanimated transforms are applied on the UI thread (and
 * compile to CSS transforms on web), which is the cheapest surface available
 * on BOTH targets — and it keeps the chips as real `ForgeChip` components, so
 * the artwork, the rim colours and the pixel numerals are the same ones the
 * tray uses rather than a redrawn copy.
 */

export function ChipSurface({
  table,
  height,
  onReturn,
  locked = false,
  testID,
}: {
  table: ChipTableApi;
  height: number;
  /** A chip (or an intact stack) dragged out through the bottom goes back to
   *  the wallet. The second argument is the TOTAL returned. */
  onReturn?: (chip: CommittedChip, total: number) => void;
  /** After acceptance the table is a picture, not a toy. */
  locked?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height: h } = e.nativeEvent.layout;
      table.setSize(width, h);
    },
    [table]
  );

  // WHAT IS BEING HELD LIVES IN THE WORLD, not in a ref here. A ref captured
  // while building a gesture handler is read during render, and the compiler
  // lint is right to refuse it — the world already knows, so asking it is both
  // legal and the single source of truth.
  const begin = useCallback(
    (x: number, y: number) => {
      if (locked) return;
      if (table.grabAt(x, y)) chipReleaseHaptic();
    },
    [table, locked]
  );

  const move = useCallback(
    (x: number, y: number) => {
      if (!table.isGrabbing()) return;
      table.moveGrab(x, y);
    },
    [table]
  );

  /**
   * RELEASE. Below the table's floor means "give it back" — the drag-to-return
   * the brief asks for, and the reason CLEAR is a convenience rather than the
   * only way out. Everywhere else the chip keeps the finger's velocity and
   * carries on being a physical object.
   */
  const end = useCallback(
    (x: number, y: number, vx: number, vy: number) => {
      const id = table.grabbedChipId();
      if (!id) return;
      const returning = y > table.size.height - 4 && vy > -60;
      table.releaseGrab(returning ? 0 : vx, returning ? 0 : vy);
      if (!returning) return;
      const chip = table.committed.find((c) => c.chipId === id);
      // AN INTACT STACK COMES BACK WHOLE. They grabbed a column, so they get
      // the column's worth; a stack that has already broken returns only the
      // chip actually held, which is the honest answer to what they picked up.
      const returned = table.takeBackStack(id);
      playChipReturn();
      chipReleaseHaptic();
      if (chip) onReturn?.(chip, returned);
      void x;
    },
    [table, onReturn]
  );

  // runOnJS: the world, the audio and the haptics all live on the JS thread,
  // so hopping to the UI thread and back for every move would buy nothing and
  // cost a frame of latency on the grab.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => begin(e.x, e.y))
    .onUpdate((e) => move(e.x, e.y))
    .onEnd((e) => end(e.x, e.y, e.velocityX, e.velocityY))
    .onFinalize((e) => end(e.x, e.y, 0, 0));

  // The table flinches when something lands hard. The scatter underneath is
  // real physics; this is only the echo, and it is deliberately tiny.
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (Math.random() - 0.5) * table.shake.value * 5 },
      { translateY: (Math.random() - 0.5) * table.shake.value * 5 },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={onLayout}
        testID={testID}
        accessible={false}
        style={[
          {
            height,
            width: '100%',
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: 'rgba(4,7,14,0.55)',
            borderWidth: 1,
            borderColor: `${colors.legendary}26`,
          },
          shakeStyle,
        ]}
      >
        {/* The felt: a barely-there centre glow so the table reads as a
            surface rather than a hole in the card. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: '12%',
            right: '12%',
            bottom: -40,
            height: 120,
            borderRadius: 999,
            backgroundColor: `${colors.legendary}0f`,
          }}
        />
        {table.committed.map((c, i) => (
          <PhysicsChip key={c.chipId} index={i} pose={table.pose} value={c.value} />
        ))}
        {table.committed.length === 0 ? (
          <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text className="text-2xs text-text-mute">Throw ingots in.</Text>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * ONE CHIP. Reads three numbers out of the shared buffer; renders nothing else.
 *
 * `memo` matters here: the list re-renders on every commit, and without it
 * every existing chip would re-run its (cheap, but N-times) SVG render for a
 * change that only concerns the new one.
 */
const PhysicsChip = memo(function PhysicsChip({
  index,
  pose,
  value,
}: {
  index: number;
  pose: SharedValue<number[]>;
  value: ForgeChipValue;
}) {
  const r = chipRadius(value);
  const style = useAnimatedStyle(() => {
    const p = pose.value;
    const i = index * 3;
    // The buffer can legitimately be shorter than the list for a frame after a
    // commit — the chip is real, the world just has not stepped yet. Park it
    // off-table rather than at 0,0, where it would flash in the corner.
    if (p.length < i + 3) return { opacity: 0, transform: [{ translateX: -999 }] };
    return {
      opacity: 1,
      transform: [
        { translateX: p[i] - r },
        { translateY: p[i + 1] - r },
        { rotate: `${p[i + 2]}rad` },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, width: r * 2, height: r * 2 }, style]}
    >
      <ForgeChip value={value} size={r * 2} />
    </Animated.View>
  );
});
