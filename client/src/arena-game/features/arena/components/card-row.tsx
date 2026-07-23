/**
 * Bottom HUD card row — renders the live rotating hand. Card selection and
 * energy gating are display-only here; the engine re-validates
 * authoritatively when the command applies.
 *
 * Phase 6/7: chips are mini-cards now — fighter chips show their actual
 * battlefield sprite (so what you play is what you see land), technique/
 * equipment chips keep their glyph; names get two lines (audit C3: one line
 * truncated half the roster on a 390pt phone); a category-colored top edge
 * separates fighters / techniques / equipment at a glance.
 */
import React from 'react';
import { Image, type ImageStyle, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import { getCardById } from '../../../content';
import { unitSprite } from './sprites';

const ENERGY_EPSILON = 1e-9;

const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

const CATEGORY_MARKER: Record<string, string> = {
  fighter: '',
  technique: '⚡',
  equipment: '⚙',
};

/** Category accents: fighters read as team-cyan (they spawn units), the
 *  support categories get their own hues. */
const CATEGORY_EDGE: Record<string, string> = {
  fighter: colors.cyan,
  technique: colors.warning,
  equipment: colors.electricBlue,
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
        const sprite = card.category === 'fighter' ? unitSprite(card.art, 'player') : null;
        return (
          <Pressable
            key={`${slot}-${id}`}
            onPress={() => (affordable ? onSelect(id) : onUnaffordable?.(id))}
            accessibilityRole="button"
            accessibilityLabel={`${card.name}, ${card.energyCost} energy${
              affordable ? '' : ', not enough energy'
            }`}
            accessibilityState={{ selected }}
            style={[
              styles.chip,
              { borderTopColor: CATEGORY_EDGE[card.category] ?? colors.border },
              selected && styles.chipSelected,
              !affordable && styles.chipDisabled,
            ]}
          >
            {sprite ? (
              <Image source={sprite} style={[styles.thumb, PIXELATED]} fadeDuration={0} />
            ) : (
              <Text style={styles.glyph}>{CATEGORY_MARKER[card.category] || '◆'}</Text>
            )}
            <Text style={[styles.name, !affordable && styles.dim]} numberOfLines={2}>
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
    borderTopWidth: 2,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 1,
    minHeight: 74, // thumb + two name lines + cost; ≥44pt touch target
  },
  chipSelected: { borderColor: colors.cyan, backgroundColor: colors.cyanDim },
  chipDisabled: { opacity: 0.4 },
  thumb: { width: 24, height: 24 },
  glyph: { fontSize: 16, lineHeight: 24, color: colors.warning },
  name: {
    ...typography.label,
    color: colors.text,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  cost: { ...typography.mono, color: colors.cyan, fontSize: 13, fontWeight: '700' },
  dim: { color: colors.textFaint },
  costUnaffordable: { color: colors.danger },
});
