import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Heading, Panel, Screen } from '../components/ui';
import { colors, radius, spacing } from '../constants/theme';
import { CARDS } from '../content';
import type { CardDefinition } from '../content/types';

const CATEGORY_LABELS: Record<CardDefinition['category'], string> = {
  fighter: 'Fighters',
  technique: 'Techniques',
  equipment: 'Equipment',
};

function CardRow({ card }: { card: CardDefinition }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={styles.cost}>{card.energyCost} ⚡</Text>
      </View>
      <Text style={styles.desc}>{card.description}</Text>
      {card.unit && (
        <Text style={styles.stats}>
          HP {card.unit.stats.maxHealth} · DMG {card.unit.stats.attackDamage} · RNG{' '}
          {card.unit.stats.attackRange}
          {card.unit.deployCount > 1 ? ` · x${card.unit.deployCount}` : ''}
        </Text>
      )}
      {card.tags.length > 0 && <Text style={styles.tags}>{card.tags.join(' · ')}</Text>}
    </View>
  );
}

export default function CollectionScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Card Collection' }} />
      {(['fighter', 'technique', 'equipment'] as const).map((category) => (
        <Panel key={category}>
          <Heading>{CATEGORY_LABELS[category]}</Heading>
          {CARDS.filter((c) => c.category === category).map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </Panel>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    gap: 2,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { color: colors.text, fontWeight: '700', fontSize: 14 },
  cost: { color: colors.cyan, fontWeight: '800', fontSize: 13 },
  desc: { color: colors.textDim, fontSize: 12 },
  stats: { color: colors.textFaint, fontSize: 11, fontFamily: 'monospace' },
  tags: { color: colors.cyanDim, fontSize: 11 },
});
