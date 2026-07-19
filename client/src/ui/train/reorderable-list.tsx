import { Platform, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useThemeColors } from '@/theme/use-theme';

/**
 * DRAG-TO-REORDER (Tyson, 2026-07-19).
 *
 * A fixed-row-height list whose rows can be dragged into a new order by their
 * grip handle (⣿). Built on gesture-handler + Reanimated so it works with
 * touch on the installed iPhone PWA and with a mouse on desktop web.
 *
 * WHY A GRIP, NOT THE WHOLE ROW: the rows carry their own buttons (✕, SETS,
 * REPS). Binding the pan to a dedicated handle keeps those taps working AND
 * lets the handle claim the gesture, so dragging never fights the page scroll
 * (gesture-handler sets touch-action:none on the detector on web).
 *
 * WHY FIXED HEIGHT: every row is `rowHeight` tall and absolutely positioned at
 * `index * SLOT`. That makes the drop-target maths exact (round the dragged
 * offset to the nearest slot) instead of juggling measured, variable heights —
 * the reliable choice on mobile web. Rows must fit their content in `rowHeight`.
 *
 * The list is CONTROLLED: it renders straight from `items` and only overlays
 * drag transforms. On drop it hands the parent the reordered array via
 * `onReorder`; the parent re-renders with the new order and the transforms
 * reset to identity. No internal copy of the data to drift out of sync.
 *
 * The two drag shared-values are OWNED here and mutated only by the worklet
 * setters below (never by the child rows — the React-compiler immutability
 * rule forbids a child mutating a shared value it received as a prop). Rows
 * only READ them to place themselves.
 */

export interface ReorderableListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The row's own content (buttons and all) — rendered to the right of the grip. */
  renderRow: (item: T, index: number) => React.ReactNode;
  onReorder: (next: T[]) => void;
  /** Fixed pixel height of each row's content. */
  rowHeight: number;
  /** Vertical gap between rows. */
  gap?: number;
}

export function ReorderableList<T>({
  items,
  keyOf,
  renderRow,
  onReorder,
  rowHeight,
  gap = 8,
}: ReorderableListProps<T>) {
  const n = items.length;
  const slot = rowHeight + gap;

  // -1 when nothing is being dragged; otherwise the ORIGINAL index of the row
  // under the finger. `dragY` is that finger's translation since pickup.
  const activeIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);

  // Worklet setters — the ONLY writers of the shared values. Defined here so
  // the mutation lives in the owning component, not in a child (immutability).
  const begin = (index: number) => {
    'worklet';
    activeIndex.value = index;
    dragY.value = 0;
  };
  const move = (ty: number) => {
    'worklet';
    dragY.value = ty;
  };
  const release = () => {
    'worklet';
    activeIndex.value = -1;
    dragY.value = 0;
  };

  const commit = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  return (
    <View style={{ height: n * slot - gap }}>
      {items.map((item, index) => (
        <Row
          key={keyOf(item)}
          index={index}
          count={n}
          slot={slot}
          rowHeight={rowHeight}
          activeIndex={activeIndex}
          dragY={dragY}
          begin={begin}
          move={move}
          release={release}
          onCommit={commit}
        >
          {renderRow(item, index)}
        </Row>
      ))}
    </View>
  );
}

function Row({
  index,
  count,
  slot,
  rowHeight,
  activeIndex,
  dragY,
  begin,
  move,
  release,
  onCommit,
  children,
}: {
  index: number;
  count: number;
  slot: number;
  rowHeight: number;
  activeIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  begin: (index: number) => void;
  move: (ty: number) => void;
  release: () => void;
  onCommit: (from: number, to: number) => void;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();

  const buzz = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onStart(() => {
      begin(index);
      runOnJS(buzz)();
    })
    .onUpdate((e) => {
      move(e.translationY);
    })
    .onEnd(() => {
      const from = activeIndex.value;
      const raw = Math.round((from * slot + dragY.value) / slot);
      const to = Math.max(0, Math.min(count - 1, raw));
      release();
      if (to !== from) runOnJS(onCommit)(from, to);
    })
    .onFinalize(() => {
      // A cancelled gesture (never reached onEnd) must still release the row.
      if (activeIndex.value === index) release();
    });

  const rowStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;
    if (active === -1) {
      return { transform: [{ translateY: index * slot }], zIndex: 0, opacity: 1 };
    }
    if (index === active) {
      return {
        transform: [{ translateY: active * slot + dragY.value }, { scale: 1.03 }],
        zIndex: 20,
        opacity: 0.96,
      };
    }
    // Where the dragged row currently sits, snapped to a slot.
    const draggedDisplay = Math.max(
      0,
      Math.min(count - 1, Math.round((active * slot + dragY.value) / slot))
    );
    let display = index;
    if (active < draggedDisplay && index > active && index <= draggedDisplay) display = index - 1;
    else if (active > draggedDisplay && index >= draggedDisplay && index < active) display = index + 1;
    return {
      transform: [{ translateY: withTiming(display * slot, { duration: 140 }) }],
      zIndex: 0,
      opacity: 1,
    };
  });

  return (
    <Animated.View
      style={[{ position: 'absolute', left: 0, right: 0, height: rowHeight }, rowStyle]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', height: rowHeight }}>
        <GestureDetector gesture={pan}>
          <View
            accessibilityRole="adjustable"
            accessibilityLabel="drag to reorder"
            style={{ width: 30, height: rowHeight, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 18, lineHeight: 20, color: colors['text-mute'] }}>
              ⣿
            </Text>
          </View>
        </GestureDetector>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </Animated.View>
  );
}
