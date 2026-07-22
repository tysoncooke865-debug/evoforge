/**
 * Full-screen result overlay shown once the battle store's status is
 * 'finished'. Outcome is always described from the local player's
 * perspective (the live battle's 'player' team).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NeonButton } from '../../../components/ui';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import type { BattleOutcome } from '../../../game-engine/simulation/state';

/** One fielded gym member's contribution line (M9 Gym Wars). */
export interface ContributionLine {
  key: string;
  label: string;
  detail: string;
}

interface Props {
  outcome: BattleOutcome;
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
  onRematch,
  onBackToLobby,
  contributions,
  contributionsTitle,
}: Props) {
  const title =
    outcome.winner === 'player' ? 'VICTORY' : outcome.winner === 'opponent' ? 'DEFEAT' : 'DRAW';
  const titleColor =
    outcome.winner === 'player'
      ? colors.success
      : outcome.winner === 'opponent'
        ? colors.danger
        : colors.warning;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
        <Text style={styles.reason}>{REASON_LABEL[outcome.reason]}</Text>
        <View style={styles.healthRow}>
          <Text style={styles.healthText}>You {Math.max(0, Math.round(outcome.playerCoreHealth))}</Text>
          <Text style={styles.healthText}>
            Opponent {Math.max(0, Math.round(outcome.opponentCoreHealth))}
          </Text>
        </View>
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
        <NeonButton label="Rematch" onPress={onRematch} />
        <NeonButton label="Back to Lobby" variant="secondary" onPress={onBackToLobby} />
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
  title: { fontSize: 34, fontWeight: '800', letterSpacing: 2 },
  reason: { ...typography.body, color: colors.textDim, textAlign: 'center' },
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
