/**
 * Horizontal Forge Core health bar — used for both the opponent core (top of
 * the arena) and the player core (bottom).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import type { CoreState } from '../../../game-engine/simulation/state';

interface Props {
  core: CoreState;
  label: string;
}

export function CoreBar({ core, label }: Props) {
  const pct = Math.max(0, Math.min(1, core.health / core.maxHealth));
  const tint = core.team === 'player' ? colors.player : colors.opponent;

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={`${label}: ${Math.max(0, Math.round(core.health))} of ${core.maxHealth} health`}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: tint }]}>{label}</Text>
        <Text style={styles.health}>
          {Math.max(0, Math.round(core.health))} / {core.maxHealth}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, paddingHorizontal: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { ...typography.label },
  health: { ...typography.mono, color: colors.textDim },
  track: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
});
