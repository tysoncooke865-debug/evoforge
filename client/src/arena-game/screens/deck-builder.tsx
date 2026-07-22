import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Heading, NeonButton, Panel, Screen } from '../components/ui';
import { colors, radius, spacing } from '../constants/theme';
import { BALANCE, CARDS, getCardById } from '../content';
import type { CardDefinition } from '../content/types';
import { validateDeck } from '../game-engine/cards/deck';
import { playerStore } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

const CATEGORY_LABELS: Record<CardDefinition['category'], string> = {
  fighter: 'Fighters',
  technique: 'Techniques',
  equipment: 'Equipment',
};

export default function DeckBuilderScreen() {
  const save = usePlayer((s) => s.save);
  const activeDeck = save.decks.all.find((d) => d.id === save.decks.activeDeckId);
  const [cardIds, setCardIds] = useState<string[]>(activeDeck?.cardIds ?? []);
  const [saved, setSaved] = useState(false);

  const errors = useMemo(() => validateDeck(cardIds, BALANCE), [cardIds]);
  const complete = cardIds.length === BALANCE.cards.deckSize;

  const toggle = (id: string) => {
    setSaved(false);
    setCardIds((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : current.length < BALANCE.cards.deckSize
          ? [...current, id]
          : current
    );
  };

  const persist = async () => {
    if (errors.length > 0) return;
    await playerStore.getState().update((s) => ({
      ...s,
      decks: {
        ...s.decks,
        all: s.decks.all.map((d) =>
          d.id === s.decks.activeDeckId ? { ...d, cardIds: [...cardIds] } : d
        ),
      },
    }));
    setSaved(true);
  };

  const avgCost =
    cardIds.length > 0
      ? cardIds.reduce((sum, id) => sum + (getCardById(id)?.energyCost ?? 0), 0) / cardIds.length
      : 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Deck Builder' }} />
      <Panel>
        <Heading>
          {activeDeck?.name ?? 'Deck'} — {cardIds.length}/{BALANCE.cards.deckSize}
        </Heading>
        <Body dim>Average energy cost: {avgCost.toFixed(1)}</Body>
        <View style={styles.slotRow}>
          {Array.from({ length: BALANCE.cards.deckSize }, (_, i) => {
            const card = cardIds[i] ? getCardById(cardIds[i]) : undefined;
            return (
              <Pressable
                key={i}
                style={[styles.slot, card && styles.slotFilled]}
                onPress={() => card && toggle(card.id)}
                accessibilityRole="button"
                accessibilityLabel={
                  card
                    ? `Deck slot ${i + 1}: ${card.name}, tap to remove`
                    : `Deck slot ${i + 1}: empty`
                }
              >
                <Text style={styles.slotText} numberOfLines={2}>
                  {card ? card.name : '—'}
                </Text>
                {card && <Text style={styles.slotCost}>{card.energyCost}</Text>}
              </Pressable>
            );
          })}
        </View>
        {!complete && <Body dim>Select {BALANCE.cards.deckSize - cardIds.length} more card(s).</Body>}
        {complete && errors.map((e, i) => (
          <Body key={i} style={{ color: colors.danger }}>
            {e}
          </Body>
        ))}
        <NeonButton
          label={saved ? 'Deck saved ✓' : 'Save deck'}
          onPress={persist}
          disabled={errors.length > 0}
        />
      </Panel>

      {(['fighter', 'technique', 'equipment'] as const).map((category) => (
        <Panel key={category}>
          <Heading>{CATEGORY_LABELS[category]}</Heading>
          <View style={styles.cardGrid}>
            {CARDS.filter((c) => c.category === category).map((card) => {
              const selected = cardIds.includes(card.id);
              return (
                <Pressable
                  key={card.id}
                  onPress={() => toggle(card.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${card.name}, ${card.energyCost} energy${
                    selected ? ', in deck, tap to remove' : ', tap to add'
                  }`}
                  accessibilityState={{ selected }}
                  style={[styles.card, selected && styles.cardSelected]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {card.name}
                    </Text>
                    <Text style={styles.cardCost}>{card.energyCost}</Text>
                  </View>
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {card.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Panel>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slot: {
    width: '23%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.xs,
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
  },
  slotFilled: { borderColor: colors.cyan },
  slotText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  slotCost: { color: colors.cyan, fontSize: 11, fontWeight: '800' },
  cardGrid: { gap: spacing.xs },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    gap: 2,
    minHeight: 44, // accessibility: 44pt minimum touch target
    justifyContent: 'center',
  },
  cardSelected: { borderColor: colors.cyan, backgroundColor: '#0A2530' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  cardName: { color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 },
  cardCost: { color: colors.cyan, fontWeight: '800', fontSize: 13 },
  cardDesc: { color: colors.textDim, fontSize: 11 },
});
