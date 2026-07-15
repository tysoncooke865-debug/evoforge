import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { focusFor, type MuscleId, type MuscleView } from '@/domain/muscle-map';
import tokens from '@/theme/tokens';
import { BACK_MUSCLE_MASKS } from '@/ui/muscle-map/back-masks';
import { FRONT_MUSCLE_MASKS } from '@/ui/muscle-map/front-masks';
import { MuscleMap } from '@/ui/muscle-map/muscle-map';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/**
 * MUSCLE LAB — the development-only mask workbench (Tyson's spec):
 * toggle each hand-drawn front mask, all at once, tune opacity, compare
 * against the legacy SVG overlays, and view at Train-card size or enlarged.
 *
 * INACCESSIBLE IN PRODUCTION: renders nothing unless the build is __DEV__ or
 * EXPO_PUBLIC_MUSCLE_LAB=1 was set at export time. The production deploy
 * (CI) sets no such variable, so the route exists but shows nothing.
 */
const VIEW_IDS: Record<MuscleView, MuscleId[]> = {
  front: Object.keys(FRONT_MUSCLE_MASKS) as MuscleId[],
  back: Object.keys(BACK_MUSCLE_MASKS) as MuscleId[],
};
const OPACITIES = [0.4, 0.6, 0.8, 1.0] as const;
const ENABLED = __DEV__ || process.env.EXPO_PUBLIC_MUSCLE_LAB === '1';

export default function MuscleLabScreen() {
  const [view, setView] = useState<MuscleView>('front');
  const [active, setActive] = useState<MuscleId[]>(['chest', 'shoulders', 'triceps']);
  const [opacity, setOpacity] = useState<number>(1);
  const [enlarged, setEnlarged] = useState(false);
  const [useMasks, setUseMasks] = useState(true);

  if (!ENABLED) return null;

  const ids = VIEW_IDS[view];
  const toggle = (m: MuscleId) =>
    setActive((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const chip = (label: string, on: boolean, onPress: () => void, testID: string) => (
    <Pressable
      key={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      testID={testID}
      className="rounded-pill border px-s3 py-s2"
      style={{
        minHeight: 40,
        justifyContent: 'center',
        borderColor: on ? `${tokens.colors.accent}8c` : tokens.colors.border,
        backgroundColor: on ? 'rgba(34,211,238,0.12)' : tokens.colors['surface-2'],
      }}
    >
      <Text className="text-2xs font-bold" style={{ color: on ? tokens.colors.accent : tokens.colors['text-dim'] }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <ScreenShell>
      <ScreenHeader kicker="DEV ONLY" title="MUSCLE LAB" />
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
        <View className="flex-row gap-s2">
          {(['front', 'back'] as MuscleView[]).map((v) =>
            chip(v.toUpperCase(), view === v, () => setView(v), `lab-view-${v}`)
          )}
        </View>

        <View className="flex-row flex-wrap gap-s2">
          {ids.map((m) => chip(m.toUpperCase(), active.includes(m), () => toggle(m), `lab-${m}`))}
          {chip('ALL', active.length === ids.length, () => setActive([...ids]), 'lab-all')}
          {chip('NONE', active.length === 0, () => setActive([]), 'lab-none')}
        </View>

        <View className="flex-row flex-wrap items-center gap-s2">
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
            OPACITY
          </Text>
          {OPACITIES.map((o) => chip(String(o), opacity === o, () => setOpacity(o), `lab-op-${o}`))}
          {chip(enlarged ? 'CARD SIZE' : 'ENLARGE', enlarged, () => setEnlarged((e) => !e), 'lab-size')}
          {chip(useMasks ? 'KRITA MASKS' : 'LEGACY SVG', useMasks, () => setUseMasks((v) => !v), 'lab-mode')}
        </View>

        {/* The map at the ACTUAL Train-card size (120) or enlarged (320). */}
        <View className="items-center rounded-xl border p-s3" style={{ borderColor: tokens.colors.border }}>
          <MuscleMap
            selectedMuscles={active}
            view={view}
            width={enlarged ? 320 : 120}
            pulse
            focus={focusFor(active)}
            maskOpacity={opacity}
            useMasks={useMasks}
            testID="lab-map"
          />
          <Text className="mt-s2 text-2xs text-text-mute">
            {enlarged ? '320px — alignment check' : '120px — the Train card'} · {active.length} lit ·{' '}
            {useMasks ? 'Krita masks' : 'legacy SVG paths'}
          </Text>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}
