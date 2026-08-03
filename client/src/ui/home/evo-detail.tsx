/**
 * HOME §1b (PREMIUM PASS, 2026-08-03) — THE EVO RATING SHEET.
 *
 * Tapping the rating used to jump straight to /evo, a full page load away
 * from the champion. The brief's rule is that an athlete must never wonder
 * how the rating works, and a page they have to navigate to (and back from)
 * is not where that question gets answered — it gets answered in place.
 *
 * So this is the in-place answer: what the number is, how close the next one
 * is, what the four pillars are in plain English, and the five things that
 * move them. /evo is still one tap away at the bottom, and it still owns the
 * long tail (history, forecasts, confidences, pending evidence).
 *
 * EVERY NUMBER IS THE ATHLETE'S OWN ROW. The pillars are the four columns
 * `evo_rating_current` stores (migration 024), the tier arithmetic is
 * `evoTierStanding` over EVO_RATING_TIERS, and the momentum line is a real
 * subtraction across `evo_rating_snapshots`. Nothing here is illustrative:
 * a missing row renders nothing rather than a plausible zero.
 *
 * PLAIN ENGLISH IS THE POINT. The stored column is `aesthetics_score`, but
 * "Aesthetics" is jargon to somebody who just wants to know why their number
 * is 51 — it reads as PHYSIQUE here and on /evo, which is the same word for
 * the same pillar in both places. The weights (30/25/30/15) are shown because
 * they explain the geometric mean's cruelty: a neglected pillar drags the
 * whole rating down, and an athlete who cannot see the weights reads that as
 * the app being broken.
 *
 * Motion: the bars are ONE-SHOTS on open (stagger 60ms), so they are not
 * ambient loops and need no useAmbient gate — but reduced motion still pins
 * them at their final width, because a bar that grows is decoration and a bar
 * that is the wrong length is a lie.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEvoSnapshots } from '@/data/progression/use-evo-rating';
import { evoTierStanding } from '@/domain/progression/evo-rating';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

import { EvoEmblem } from './evo-emblem';

/** The four stored pillars, in the order they read to a human: what you can
 *  lift, what you carry, how you look, what your engine does. Colour is a
 *  TOKEN KEY resolved at render — /evo uses the same four, so a pillar is
 *  never a different hue in two places. */
const PILLARS: readonly {
  key: string;
  label: string;
  gloss: string;
  weight: number;
  colour: 'accent' | 'epic' | 'mythic' | 'rare';
}[] = [
  { key: 'strength_score', label: 'STRENGTH', gloss: 'What you can lift, for your bodyweight', weight: 30, colour: 'accent' },
  { key: 'size_score', label: 'SIZE', gloss: 'How much muscle you carry', weight: 30, colour: 'epic' },
  { key: 'aesthetics_score', label: 'PHYSIQUE', gloss: 'Leanness, symmetry and proportion', weight: 25, colour: 'mythic' },
  { key: 'cardio_score', label: 'CARDIO', gloss: 'Your engine and endurance', weight: 15, colour: 'rare' },
];

/** The five levers, in the brief's order. Each one is a real input to the
 *  review — nothing here is aspirational copy. */
const LEVERS: readonly string[] = [
  'Complete your workouts — every logged set is evidence',
  'Get stronger — heavier lifts raise Strength',
  'Build muscle — training volume raises Size',
  'Improve your physique — scans raise Physique',
  'Log cardio — minutes and tests raise Cardio',
];

export function EvoDetailSheet({
  row,
  onClose,
}: {
  /** The athlete's `evo_rating_current` row. Never null — the caller only
   *  opens this sheet when a confirmed rating exists. */
  row: Record<string, unknown>;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const rating = Number(row.displayed_rating ?? 1);
  const progress = Math.max(0, Math.min(100, Number(row.evolution_progress ?? 0)));
  const descriptor = String(row.descriptor ?? 'Untrained').toUpperCase();
  const standing = evoTierStanding(rating, progress);
  const provisional = String(row.status ?? 'provisional') === 'provisional';

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.86)' }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        testID="evo-sheet-backdrop"
      >
        {/* The sheet itself swallows presses — only the backdrop closes. */}
        <Pressable
          onPress={() => undefined}
          testID="evo-sheet"
          className="overflow-hidden rounded-t-xl border-t"
          style={{
            maxHeight: '90%',
            borderColor: `${colors.epic}6b`,
            backgroundColor: colors.surface,
            shadowColor: colors.epic,
            shadowOpacity: 0.4,
            shadowRadius: 40,
            elevation: 20,
          }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 12) + 20 }}
          >
            {/* The grabber. It does not drag — RN Modal has no sheet gesture
                here — but it is the universal "this is a sheet, the backdrop
                closes it" sign, and without it the panel reads as a page. */}
            <View
              pointerEvents="none"
              style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: colors.border, marginBottom: 14 }}
            />
            {/* ---- THE CREST. Same emblem as Home, so the sheet reads as the
                same object opening rather than a different screen. ---- */}
            <View className="items-center">
              <Text
                allowFontScaling={false}
                style={{ fontSize: 11, letterSpacing: 3.5, color: colors.epic, ...pixelFont(false) }}
              >
                EVO RATING
              </Text>
              <View className="mt-s2 items-center justify-center">
                <View pointerEvents="none" style={{ position: 'absolute' }}>
                  <EvoEmblem width={190} colour={colors.epic} />
                </View>
                <Text
                  allowFontScaling={false}
                  testID="evo-sheet-rating"
                  style={{
                    fontSize: 58,
                    lineHeight: 62,
                    letterSpacing: 0,
                    color: colors.text,
                    textShadowColor: 'rgba(168,85,247,0.6)',
                    textShadowRadius: 18,
                    ...pixelFont(),
                  }}
                >
                  {rating}
                </Text>
              </View>
              <Text className="mt-s1 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
                OVERALL FITNESS SCORE
              </Text>
              <View
                className="mt-s2 rounded-pill border px-s3 py-s1"
                style={{ borderColor: `${colors.epic}4d`, backgroundColor: 'rgba(168,85,247,0.08)' }}
              >
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 12, letterSpacing: 1.5, color: colors['text-dim'], ...pixelFont(false) }}
                >
                  {descriptor}
                  {provisional ? (
                    <Text style={{ color: colors['text-mute'] }}>{'  ·  PROVISIONAL'}</Text>
                  ) : null}
                </Text>
              </View>
            </View>

            {/* ---- WHERE THE NEXT POINT AND THE NEXT NAME ARE. Two different
                questions, so two bars — the integer step, then the rank. ---- */}
            <View className="mt-s5">
              <Row
                left={`PROGRESS TO EVO ${Math.min(100, rating + 1)}`}
                right={`${Math.round(progress)}%`}
                colour={colors.epic}
              />
              <Bar value={progress / 100} colour={colors.epic} track={colors['surface-3']} delay={0} />

              {standing.nextTier ? (
                <View className="mt-s3">
                  {/* EPIC, not gold. The page has exactly three colour
                      meanings and they must hold everywhere: purple is the
                      Evo Rating and everything about it (including the rank
                      ladder), cyan is training and machinery, gold is
                      CURRENCY — XP and coins, nothing else. A gold rank bar
                      here would be a third meaning for gold and would also
                      disagree with Home's own rank rail. */}
                  <Row
                    left={`NEXT RANK · ${standing.nextTier.toUpperCase()}`}
                    right={`${standing.evoToGo} TO GO`}
                    colour={colors.epic}
                  />
                  <Bar value={standing.progress} colour={colors.epic} track={colors['surface-3']} delay={70} />
                </View>
              ) : (
                <Text className="mt-s3 text-2xs" style={{ color: colors.legendary, letterSpacing: 1 }}>
                  YOU HAVE REACHED THE SUMMIT OF THE LADDER
                </Text>
              )}
            </View>

            {/* ---- THE BREAKDOWN. ---- */}
            <SectionLabel>WHAT MAKES IT UP</SectionLabel>
            {PILLARS.map((p, i) => {
              const score = Number(row[p.key] ?? 0);
              return (
                <View key={p.key} className={i === 0 ? '' : 'mt-s3'}>
                  <Row
                    left={`${p.label}  ·  ${p.weight}%`}
                    right={String(Math.floor(score))}
                    colour={colors[p.colour]}
                  />
                  <Bar
                    value={Math.max(0, Math.min(100, score)) / 100}
                    colour={colors[p.colour]}
                    track={colors['surface-3']}
                    delay={140 + i * 60}
                  />
                  <Text className="mt-s1 text-2xs text-text-mute">{p.gloss}</Text>
                </View>
              );
            })}
            {/* The one thing athletes assume is a fifth bar, answered before
                they have to ask. Consistency is not scored — it is the reason
                the four above move at all. */}
            <Text className="mt-s3 text-2xs text-text-dim">
              Consistency isn&apos;t a fifth score — it&apos;s what moves the four above. Train
              regularly and every one of them climbs.
            </Text>

            <Momentum rating={rating} />

            {/* ---- THE LEVERS. ---- */}
            <SectionLabel>HOW TO INCREASE YOUR EVO</SectionLabel>
            {LEVERS.map((lever) => (
              <View key={lever} className="mt-s2 flex-row items-start" style={{ gap: 8 }}>
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 13, lineHeight: 18, fontWeight: '800', color: colors.success }}
                >
                  ✓
                </Text>
                <Text className="text-sm text-text-dim" style={{ flex: 1 }}>
                  {lever}
                </Text>
              </View>
            ))}
            <Text className="mt-s3 text-2xs text-text-mute">
              Your rating is recalculated from this evidence at each Evo review — it moves when
              your training does, not on a timer.
            </Text>

            <View className="mt-s5" style={{ gap: 8 }}>
              <NeonButton
                title="FULL BREAKDOWN"
                variant="ghost"
                pixel
                onPress={() => {
                  onClose();
                  router.push('/evo' as never);
                }}
                rightIcon={<Text style={{ color: colors.accent, fontSize: 16, fontWeight: '800' }}>›</Text>}
                testID="evo-sheet-full"
              />
              <NeonButton title="GOT IT" variant="epic" pixel onPress={onClose} testID="evo-sheet-close" />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * PROVEN MOMENTUM, never a projection. The brief asks the app to constantly
 * reinforce "train → the rating climbs"; the honest way to do that is to show
 * that it ALREADY HAS. This subtracts the oldest snapshot inside a 90-day
 * window from the current rating, so it is a measurement of the athlete's own
 * history — not the per-workout Evo estimate the mock asked for, which cannot
 * exist (the rating is recomputed from evidence at review time, so no workout
 * can promise a delta before it is trained).
 *
 * Renders NOTHING when there is no gain to report: a "+0 EVO" badge is a
 * demotivator, and a single-snapshot athlete has no history to measure.
 */
function Momentum({ rating }: { rating: number }) {
  const colors = useThemeColors();
  const snapshots = useEvoSnapshots(26);
  const rows = snapshots.data ?? [];
  if (rows.length < 2) return null;

  // todayIso() is the app-wide clock seam — Date.now() in render trips the
  // compiler's purity rule, and a 90-day window is a CALENDAR span anyway.
  const cutoff = Date.parse(`${calendarToday()}T00:00:00Z`) - 90 * 86_400_000;
  // Rows arrive newest-first; the last one still inside the window is the
  // oldest comparable reading.
  const inWindow = rows.filter((r) => {
    const t = Date.parse(String(r.calculated_at));
    return Number.isFinite(t) && t >= cutoff;
  });
  const oldest = inWindow[inWindow.length - 1];
  if (!oldest) return null;

  const gain = rating - Number(oldest.displayed_rating ?? rating);
  if (gain <= 0) return null;

  return (
    <View
      className="mt-s4 flex-row items-center rounded-lg border px-s3 py-s2"
      style={{ gap: 10, borderColor: `${colors.success}45`, backgroundColor: `${colors.success}12` }}
      testID="evo-sheet-momentum"
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 20, letterSpacing: 0, color: colors.success, ...pixelFont() }}
      >
        +{gain}
      </Text>
      <Text className="text-2xs text-text-dim" style={{ flex: 1 }}>
        Evo gained in the last 90 days. This is what training does.
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  const colors = useThemeColors();
  return (
    <View className="mt-s5 mb-s3 flex-row items-center" style={{ gap: 8 }}>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 2, color: colors['text-mute'], ...pixelFont(false) }}
      >
        {children}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

function Row({ left, right, colour }: { left: string; right: string; colour: string }) {
  const colors = useThemeColors();
  return (
    <View className="mb-s1 flex-row items-baseline justify-between" style={{ gap: 8 }}>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{ flex: 1, fontSize: 10, letterSpacing: 1.2, color: colors['text-dim'], ...pixelFont(false) }}
      >
        {left}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 15, letterSpacing: 0, color: colour, ...pixelFont() }}>
        {right}
      </Text>
    </View>
  );
}

/** A pillar bar that grows once on open. `scaleX` from a full-width child, not
 *  an animated `width`: a width animation re-lays-out the row every frame,
 *  which is the layout thrash the perf rule bans — a transform is composited. */
function Bar({
  value,
  colour,
  track,
  delay,
}: {
  value: number;
  colour: string;
  track: string;
  delay: number;
}) {
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const t = useSharedValue(reduced ? target : 0);

  useEffect(() => {
    if (reduced) {
      t.value = target;
      return;
    }
    t.value = withDelay(delay, withTiming(target, { duration: 620, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: t.value }] }));

  return (
    <View className="w-full overflow-hidden rounded-pill" style={{ height: 7, backgroundColor: track }}>
      <Animated.View
        style={[
          {
            width: '100%',
            height: '100%',
            borderRadius: 999,
            backgroundColor: colour,
            // scaleX pins to the centre by default — anchor it left so the bar
            // grows out of the track's start like a fill, not a zoom.
            transformOrigin: 'left',
          },
          style,
        ]}
      />
    </View>
  );
}
