/**
 * Full-screen result overlay shown once the battle store's status is
 * 'finished'. Outcome is always described from the local player's
 * perspective (the live battle's 'player' team).
 *
 * P11: shows what the battle actually earned — the Arena Rating delta the
 * store applied (same ratingDeltaForOutcome source), with tutorial/ghost
 * battles explicitly labeled as moving nothing — plus the standing line
 * that Arena progress is cosmetic and never touches EvoForge progression.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NeonButton } from '../../../components/ui';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import type { BattleOutcome } from '../../../game-engine/simulation/state';
import { ratingLineFor } from '../../../services/progression/rank';
import type { BattleMode } from '../battle-store';
import { useReducedMotionPref } from './use-reduced-motion';

/** P7 staged reveal: banner slams in, then facts, then actions — a result
 *  should LAND, not appear. One bounded interval drives it (~1s, cleared on
 *  completion/unmount); under reduced motion everything shows immediately.
 *  Sections fade in at fixed offsets but always occupy layout (opacity, not
 *  conditional render) so the card never reflows mid-ceremony. */
const REVEAL_BANNER_MS = 240;
const REVEAL_FACTS_AT = 240;
const REVEAL_RATING_AT = 430;
const REVEAL_ACTIONS_AT = 640;
const REVEAL_TOTAL_MS = 700;

/** One fielded gym member's contribution line (M9 Gym Wars). */
export interface ContributionLine {
  key: string;
  label: string;
  detail: string;
}

interface Props {
  outcome: BattleOutcome;
  /** Battle mode — decides how the rating line reads (P11). */
  mode: BattleMode;
  /** Arena Rating delta the store recorded for this outcome (0 for tutorial/ghost). */
  ratingDelta: number;
  onRematch: () => void;
  onBackToLobby: () => void;
  /** Gym War contribution summary for the fielded members (M9). */
  contributions?: ContributionLine[];
  /** Heading above the contribution lines. */
  contributionsTitle?: string;
}

const REASON_LABEL: Record<BattleOutcome['reason'], string> = {
  'core-destroyed': 'Forge Core destroyed',
  'timeout-core-health': 'Time limit — higher core health wins',
  'sudden-death': 'Sudden death — first blood',
  draw: 'Neither side broke through',
};

export function ResultOverlay({
  outcome,
  mode,
  ratingDelta,
  onRematch,
  onBackToLobby,
  contributions,
  contributionsTitle,
}: Props) {
  const reduceMotion = useReducedMotionPref();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (reduceMotion) {
      setElapsed(REVEAL_TOTAL_MS);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      const e = Date.now() - start;
      setElapsed(e);
      if (e >= REVEAL_TOTAL_MS) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [reduceMotion]);

  const title =
    outcome.winner === 'player' ? 'VICTORY' : outcome.winner === 'opponent' ? 'DEFEAT' : 'DRAW';
  const titleColor =
    outcome.winner === 'player'
      ? colors.success
      : outcome.winner === 'opponent'
        ? colors.danger
        : colors.warning;

  // Banner slam: scale eases 1.5 -> 1 as it fades in.
  const bannerT = Math.min(1, elapsed / REVEAL_BANNER_MS);
  const bannerEase = 1 - (1 - bannerT) * (1 - bannerT);
  const sectionOpacity = (atMs: number) => ({ opacity: elapsed >= atMs ? 1 : 0 });

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { borderColor: titleColor }]}>
        <Text
          style={[
            styles.title,
            {
              color: titleColor,
              opacity: bannerT,
              textShadowColor: `${titleColor}66`,
              transform: [{ scale: 1.5 - 0.5 * bannerEase }],
            },
          ]}
        >
          {title}
        </Text>
        <View style={[styles.section, sectionOpacity(REVEAL_FACTS_AT)]}>
          <Text style={styles.reason}>{REASON_LABEL[outcome.reason]}</Text>
          <View style={styles.healthRow}>
            <Text style={styles.healthText}>You {Math.max(0, Math.round(outcome.playerCoreHealth))}</Text>
            <Text style={styles.healthText}>
              Opponent {Math.max(0, Math.round(outcome.opponentCoreHealth))}
            </Text>
          </View>
        </View>
        <View style={[styles.section, sectionOpacity(REVEAL_RATING_AT)]}>
          <Text
            style={[
              styles.ratingLine,
              ratingDelta > 0 && { color: colors.success },
              ratingDelta < 0 && { color: colors.danger },
            ]}
          >
            {ratingLineFor(mode, ratingDelta)}
          </Text>
          <Text style={styles.cosmeticNote}>
            Arena progress stays in the Arena — no Forge XP, no Evo Rating change.
          </Text>
          {contributions && contributions.length > 0 && (
            <View style={styles.contribBlock}>
              {contributionsTitle && <Text style={styles.contribTitle}>{contributionsTitle}</Text>}
              {contributions.map((line) => (
                <View key={line.key} style={styles.contribRow}>
                  <Text style={styles.contribLabel}>{line.label}</Text>
                  <Text style={styles.contribDetail}>{line.detail}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={[styles.actions, sectionOpacity(REVEAL_ACTIONS_AT)]}>
          <NeonButton label="Rematch" onPress={onRematch} />
          <NeonButton label="Back to Lobby" variant="secondary" onPress={onBackToLobby} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 11, 18, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  // P7: pixel display face + soft glow in the outcome color.
  title: {
    ...typography.pixelBold,
    fontSize: 44,
    letterSpacing: 3,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  section: { gap: spacing.md, alignItems: 'center', alignSelf: 'stretch' },
  actions: { gap: spacing.md, alignSelf: 'stretch' },
  reason: { ...typography.body, color: colors.textDim, textAlign: 'center' },
  ratingLine: { ...typography.label, color: colors.textDim, letterSpacing: 1 },
  cosmeticNote: { ...typography.body, fontSize: 12, color: colors.textDim, textAlign: 'center' },
  healthRow: { flexDirection: 'row', gap: spacing.lg },
  healthText: { ...typography.mono, color: colors.text },
  contribBlock: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  contribTitle: { ...typography.label, color: colors.textDim, letterSpacing: 1 },
  contribRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  contribLabel: { ...typography.body, color: colors.text, flexShrink: 1 },
  contribDetail: { ...typography.mono, color: colors.cyan },
});
