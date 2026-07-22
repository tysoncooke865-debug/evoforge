/**
 * Bottom HUD card row — renders the live rotating hand. Card selection and
 * energy gating are display-only here; the engine re-validates
 * authoritatively when the command applies.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import { getCardById } from '../../../content';

const ENERGY_EPSILON = 1e-9;

const CATEGORY_MARKER: Record<string, string> = {
  fighter: '',
  technique: '⚡',
  equipment: '⚙',
};

interface Props {
  /** Current hand (card ids), in slot order. */
  cardIds: readonly string[];
  energy: number;
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  /** Tap on a card the player cannot afford — surface feedback, not silence. */
  onUnaffordable?: (cardId: string) => void;
}

export function CardRow({ cardIds, energy, selectedCardId, onSelect, onUnaffordable }: Props) {
  return (
    <View style={styles.row}>
      {cardIds.map((id, slot) => {
        const card = getCardById(id);
        if (!card) return null;
        const affordable = energy >= card.energyCost - ENERGY_EPSILON;
        const selected = selectedCardId === id;
        return (
          <Pressable
            key={`${slot}-${id}`}
            onPress={() => (affordable ? onSelect(id) : onUnaffordable?.(id))}
            accessibilityRole="button"
            accessibilityLabel={`${card.name}, ${card.energyCost} energy${
              affordable ? '' : ', not enough energy'
            }`}
            accessibilityState={{ selected }}
            style={[styles.chip, selected && styles.chipSelected, !affordable && styles.chipDisabled]}
          >
            <Text style={[styles.name, !affordable && styles.dim]} numberOfLines={1}>
              {CATEGORY_MARKER[card.category]}
              {card.name}
            </Text>
            {/* P7: an unaffordable card's cost is highlighted in the danger
                color (not just dimmed like the name) — it's the specific
                reason the card can't be played, so it should read as the
                thing to look at, not fade away with the rest of the chip. */}
            <Text style={[styles.cost, !affordable && styles.costUnaffordable]}>
              {card.energyCost}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  chip: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 44, // accessibility: 44pt minimum touch target
  },
  chipSelected: { borderColor: colors.cyan, backgroundColor: colors.cyanDim },
  chipDisabled: { opacity: 0.4 },
  name: { ...typography.label, color: colors.text, fontSize: 11, textAlign: 'center' },
  cost: { ...typography.mono, color: colors.cyan, fontSize: 13, fontWeight: '700' },
  dim: { color: colors.textFaint },
  costUnaffordable: { color: colors.danger },
});
