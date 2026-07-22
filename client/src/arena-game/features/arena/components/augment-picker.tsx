/**
 * Non-blocking mid-match augment picker. When the player's offer opens, a
 * compact 3-option overlay appears at the top of the arena; the battle keeps
 * running underneath. It can be dismissed and reopened via a small pill
 * button until a choice is made — a team that never chooses gets nothing.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import { getAugmentById } from '../../../content';

interface Props {
  /** The player's offered augment ids. */
  offeredIds: readonly string[];
  /** Overlay open (false = collapsed to the reopen pill). */
  open: boolean;
  onChoose: (augmentId: string) => void;
  onDismiss: () => void;
  onReopen: () => void;
}

export function AugmentPicker({ offeredIds, open, onChoose, onDismiss, onReopen }: Props) {
  if (!open) {
    return (
      <View style={styles.pillWrap} pointerEvents="box-none">
        <Pressable
          style={styles.pill}
          onPress={onReopen}
          accessibilityRole="button"
          accessibilityLabel="Open augment choices"
          hitSlop={12}
        >
          <Text style={styles.pillText}>⬢ AUGMENT</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.overlayWrap} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>CHOOSE AN AUGMENT</Text>
          <Pressable
            onPress={onDismiss}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Choose later"
          >
            <Text style={styles.dismiss}>LATER</Text>
          </Pressable>
        </View>
        <View style={styles.optionsRow}>
          {offeredIds.map((id) => {
            const augment = getAugmentById(id);
            if (!augment) return null;
            return (
              <Pressable
                key={id}
                style={styles.option}
                onPress={() => onChoose(id)}
                accessibilityRole="button"
                accessibilityLabel={`Augment ${augment.name}. ${augment.description}`}
              >
                <Text style={styles.optionName} numberOfLines={2}>
                  {augment.name}
                </Text>
                <Text style={styles.optionDescription} numberOfLines={3}>
                  {augment.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: 'absolute',
    top: 64,
    left: spacing.sm,
    right: spacing.sm,
    alignItems: 'center',
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(13, 20, 32, 0.96)',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.label, color: colors.warning, letterSpacing: 1 },
  dismiss: { ...typography.label, color: colors.textDim },
  optionsRow: { flexDirection: 'row', gap: spacing.xs },
  option: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.xs,
    gap: 2,
    minHeight: 44, // accessibility: 44pt minimum touch target
  },
  optionName: { ...typography.label, color: colors.text, fontSize: 11 },
  optionDescription: { ...typography.body, color: colors.textDim, fontSize: 10, lineHeight: 13 },
  pillWrap: { position: 'absolute', top: 64, right: spacing.sm },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pillText: { ...typography.label, color: colors.warning, fontSize: 10 },
});
