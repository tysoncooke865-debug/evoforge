import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  formatChance,
  formatRevealCoins,
  producerLabel,
  revealChance,
  type BankedReveal,
  type ClaimedReveal,
  type RevealOutcome,
} from '@/domain/forge-reveal';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * THE REVEAL, AS A SCREEN (Spec v5 §3).
 *
 * WHAT THIS IS NOT, AND THE SHAPE OF THE FILE ENFORCES IT: there is no stake
 * control, no chip rack, no lane picker, no board, no peg field and no multiplier
 * anywhere below. The only interactive control is a single button that says CLAIM.
 *
 * THE SCREENSHOT TEST (invariant 3) is a design constraint, not a coat of paint.
 * A peg board with multiplier buckets is a casino product's signature even
 * unstaked, so the frame is a CRUCIBLE and a MOULD: an ingot is poured, it falls,
 * it settles, and the stamp on it is what the forge produced. No reels, no wheels,
 * no coin spray, no jackpot styling.
 *
 * THE SERVER DECIDES FIRST. `onClaim` resolves with the outcome BEFORE any motion
 * starts, so the animation is replaying a fact. There is deliberately no code path
 * in which the animation could influence, or appear to influence, the result:
 *
 *   * the fall duration is FIXED, regardless of the amount. A slower descent for a
 *     bigger prize is the "engineered almost-win" §3 bans.
 *   * nothing renders the outcomes it did NOT land on. There is no wheel to watch
 *     pass a better prize, because there is no wheel.
 *   * the stamp is written once, at the end, from the server's number.
 */

/** §3: the full table, viewable BEFORE every reveal. Not behind a disclosure. */
export function DropTable({
  table,
  compact = false,
}: {
  table: RevealOutcome[];
  compact?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View testID="reveal-drop-table" accessibilityLabel="The forge drop table">
      <Text
        allowFontScaling={false}
        className="mb-s1 text-2xs text-text-mute"
        style={{ letterSpacing: 1 }}
      >
        WHAT THE FORGE CAN PRODUCE
      </Text>
      {table.map((o) => (
        <View
          key={o.coins}
          className="flex-row items-center justify-between py-s1"
          accessibilityLabel={`${o.coins} coins, ${formatChance(revealChance(o, table))} chance`}
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: compact ? 10 : 12, color: colors.legendary, ...pixelFont() }}
          >
            {formatRevealCoins(o.coins)}
          </Text>
          {compact ? null : (
            <Text allowFontScaling={false} className="flex-1 px-s2 text-2xs text-text-dim">
              {o.label}
            </Text>
          )}
          <Text allowFontScaling={false} className="text-2xs text-text-mute">
            {formatChance(revealChance(o, table))}
          </Text>
        </View>
      ))}
      {/* Honesty about the average, stated rather than left to be inferred from
          five rows of arithmetic. */}
      <Text allowFontScaling={false} className="mt-s1 text-3xs text-text-mute">
        Every reveal adds coins. There is no losing result and nothing is ever staked.
      </Text>
    </View>
  );
}

/** The ingot: poured, falling, settled. Three states and no fourth. */
type Stage = 'ready' | 'falling' | 'settled';

/**
 * CALLERS MUST KEY THIS BY `reveal.id`:
 *
 *     <RevealSheet key={reveal.id} … />
 *
 * There is deliberately no effect resetting `stage`/`result` when the sheet hides.
 * Calling setState inside an effect body causes the cascading renders the React
 * Compiler rule flags — and the fix is not to silence the rule, it is to let a new
 * reveal be a new component. A claimed reveal leaves `banked`, so the same id is
 * never reopened and stale state cannot be shown.
 */
export function RevealSheet({
  visible,
  reveal,
  table,
  onClaim,
  onClose,
}: {
  visible: boolean;
  reveal: BankedReveal | null;
  table: RevealOutcome[];
  /** Resolves with the SERVER's outcome. Called before any motion begins. */
  onClaim: (revealId: string) => Promise<ClaimedReveal>;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const reducedPref = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const revealsHidden = useSettingsStore((s) => s.revealsHidden);
  const reduced = reducedPref || perfMode;

  const [stage, setStage] = useState<Stage>('ready');
  const [result, setResult] = useState<ClaimedReveal | null>(null);
  const [busy, setBusy] = useState(false);

  const drop = useSharedValue(0);
  const glow = useSharedValue(0);

  /**
   * A FIXED DURATION, WHATEVER THE OUTCOME. Reading `result` to time the fall is
   * exactly the near-miss choreography §3 forbids, so the animation never sees the
   * amount — it only knows that a decided result exists.
   */
  const FALL_MS = 900;

  async function claim() {
    if (!reveal || busy) return;
    setBusy(true);
    try {
      // THE SERVER FIRST, ALWAYS. Nothing moves until the outcome is a fact.
      const outcome = await onClaim(reveal.id);
      setResult(outcome);

      if (reduced || revealsHidden) {
        // No ceremony: the reward is already banked, so show it and stop.
        setStage('settled');
        return;
      }
      setStage('falling');
      drop.value = withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.quad) });
      glow.value = withSequence(
        withTiming(0, { duration: FALL_MS - 120 }),
        withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) })
      );
      // A timer rather than a completion callback: nested withTiming callbacks are
      // what killed the board's rAF loop once, and 78 pegs doing it blew the stack.
      setTimeout(() => setStage('settled'), FALL_MS + 60);
    } finally {
      setBusy(false);
    }
  }

  const ingotStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: drop.value * 150 },
      { rotate: `${drop.value * 26}deg` },
      { scaleY: 1 - drop.value * 0.08 },
    ],
  }));
  const mouldGlow = useAnimatedStyle(() => ({ opacity: 0.25 + glow.value * 0.75 }));

  if (!reveal) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center px-s4" style={{ backgroundColor: 'rgba(4,8,15,0.86)' }}>
        <View
          testID="reveal-sheet"
          className="w-full rounded-xl p-s4"
          style={{
            maxWidth: 420,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: 'rgba(13,21,36,0.98)',
          }}
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: 13, color: colors.accent, ...pixelFont() }}
          >
            THE FORGE
          </Text>
          <Text allowFontScaling={false} className="mb-s3 text-2xs text-text-dim">
            {producerLabel(reveal.producer)}
            {reveal.exercise ? ` · ${reveal.exercise}` : ''}
          </Text>

          {stage === 'ready' ? (
            <>
              {/* §3: the odds BEFORE the claim, every time. */}
              <DropTable table={table} />
              <View className="mt-s4">
                <NeonButton
                  title="CLAIM"
                  onPress={claim}
                  disabled={busy}
                  busy={busy}
                  testID="reveal-claim"
                />
              </View>
              {/* Leaving is frictionless (§8) — no sunk-cost copy, no "are you sure". */}
              <Pressable onPress={onClose} className="mt-s2 items-center py-s2" testID="reveal-later">
                <Text allowFontScaling={false} className="text-2xs text-text-mute">
                  Keep it for later — it never expires
                </Text>
              </Pressable>
            </>
          ) : (
            <View className="items-center py-s3">
              {/* THE CRUCIBLE AND THE MOULD. Not a board, not a wheel. */}
              <View style={{ height: 200, justifyContent: 'flex-start', alignItems: 'center' }}>
                <Animated.View
                  style={[
                    {
                      width: 54,
                      height: 26,
                      borderRadius: 4,
                      backgroundColor: colors.legendary,
                      borderWidth: 1,
                      borderColor: '#F6E7C1',
                    },
                    ingotStyle,
                  ]}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: 'absolute',
                      bottom: 0,
                      width: 96,
                      height: 10,
                      borderRadius: 3,
                      backgroundColor: colors.accent,
                    },
                    mouldGlow,
                  ]}
                />
              </View>

              {stage === 'settled' && result ? (
                <>
                  <Text
                    allowFontScaling={false}
                    testID="reveal-outcome"
                    style={{ fontSize: 30, color: colors.legendary, ...pixelFont() }}
                  >
                    {formatRevealCoins(result.coins)}
                  </Text>
                  <Text allowFontScaling={false} className="mt-s1 text-2xs text-text-dim">
                    {table.find((o) => o.coins === result.coins)?.label ?? 'Tempered'}
                  </Text>
                  <Text allowFontScaling={false} className="mt-s2 text-2xs text-text-mute">
                    Balance {Math.round(result.balance)}
                  </Text>
                  <View className="mt-s4 w-full">
                    <NeonButton title="DONE" onPress={onClose} testID="reveal-done" />
                  </View>
                  {/* NO "REVEAL AGAIN". §3 rations reveals by training, and a button
                      here would invite a second one that does not exist. */}
                </>
              ) : (
                <Text allowFontScaling={false} className="text-2xs text-text-mute">
                  Pouring…
                </Text>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
