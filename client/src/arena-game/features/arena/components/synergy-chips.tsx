/**
 * Small labeled chips showing a team's active synergies (and its chosen
 * augment, if any) near that team's core bar. Reads the derived aura layer —
 * pure display, no gameplay logic.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import { getAugmentById, SYNERGIES } from '../../../content';
import type { TeamId } from '../../../game-engine/types';

interface Props {
  team: TeamId;
  /** Active synergy ids for this team (state.auras[team].activeSynergyIds). */
  synergyIds: readonly string[];
  /** The team's chosen augment id, if any. */
  augmentId: string | null;
}

export function SynergyChips({ team, synergyIds, augmentId }: Props) {
  const tint = team === 'player' ? colors.player : colors.opponent;
  const augment = augmentId ? getAugmentById(augmentId) : undefined;
  if (synergyIds.length === 0 && !augment) return null;

  return (
    <View style={styles.row}>
      {synergyIds.map((id) => {
        const synergy = SYNERGIES.find((s) => s.id === id);
        if (!synergy) return null;
        return (
          <View key={id} style={[styles.chip, { borderColor: tint }]}>
            <Text style={[styles.chipText, { color: tint }]} numberOfLines={1}>
              {synergy.name}
            </Text>
          </View>
        );
      })}
      {augment && (
        <View style={[styles.chip, styles.augmentChip]}>
          <Text style={[styles.chipText, styles.augmentChipText]} numberOfLines={1}>
            ⬢ {augment.name}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { ...typography.label, fontSize: 10 },
  augmentChip: { borderColor: colors.warning },
  augmentChipText: { color: colors.warning },
});
