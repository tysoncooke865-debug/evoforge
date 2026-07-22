/**
 * Champion selection: the five official Champions (one per EvoForge branch)
 * as tappable cards. Tapping selects (persisted to the save via the player
 * store); the current selection is highlighted. DETAILS opens the full stat
 * sheet.
 */
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing } from '../constants/theme';
import { CHAMPIONS, TICKS_PER_SECOND } from '../content';
import type { ChampionDefinition } from '../content/types';
import { playerStore } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

function statsSummary(champion: ChampionDefinition): string {
  const s = champion.stats;
  const interval = (s.attackIntervalTicks / TICKS_PER_SECOND).toFixed(1);
  return `HP ${s.maxHealth} · DMG ${s.attackDamage} every ${interval}s · RNG ${s.attackRange} · SPD ${s.moveSpeedPerTick}`;
}

function ChampionCard({
  champion,
  selected,
  onSelect,
  onDetails,
}: {
  champion: ChampionDefinition;
  selected: boolean;
  onSelect: () => void;
  onDetails: () => void;
}) {
  const tint = pathColor(champion.path);
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={`Select ${champion.name}, ${champion.role}`}
      accessibilityState={{ selected }}
      style={[styles.card, selected && { borderColor: tint, backgroundColor: colors.surfaceRaised }]}
    >
      <View style={styles.header}>
        <Text style={[styles.name, { color: tint }]}>{champion.name}</Text>
        {selected && <Text style={[styles.selectedBadge, { color: tint }]}>SELECTED</Text>}
      </View>
      <Text style={styles.role}>{champion.role}</Text>
      <Text style={styles.stats}>{statsSummary(champion)}</Text>
      <Text style={styles.abilityLine}>
        <Text style={styles.abilityName}>{champion.passive.name} (passive): </Text>
        {champion.passive.description}
      </Text>
      <Text style={styles.abilityLine}>
        <Text style={styles.abilityName}>{champion.ability.name}: </Text>
        {champion.ability.description}
      </Text>
      <Text style={styles.abilityLine}>
        <Text style={[styles.abilityName, styles.ultimateName]}>
          {champion.ultimate.name} (ult):{' '}
        </Text>
        {champion.ultimate.description}
      </Text>
      <Pressable
        onPress={onDetails}
        hitSlop={16}
        style={styles.detailsLink}
        accessibilityRole="button"
        accessibilityLabel={`${champion.name} details`}
      >
        <Text style={styles.detailsText}>DETAILS →</Text>
      </Pressable>
    </Pressable>
  );
}

export default function ChampionsScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);

  const select = (id: string) => {
    void playerStore.getState().update((s) => ({
      ...s,
      player: { ...s.player, championId: id },
    }));
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Champions' }} />
      <Body dim>
        Your Champion anchors every battle: it fights on its own, respawns when
        it falls, and brings an active ability plus a chargeable ultimate.
      </Body>
      {CHAMPIONS.map((champion) => (
        <ChampionCard
          key={champion.id}
          champion={champion}
          selected={save.player.championId === champion.id}
          onSelect={() => select(champion.id)}
          onDetails={() =>
            router.push({ pathname: '/forge-arena/champion/[id]', params: { id: champion.id } })
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  selectedBadge: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  role: { color: colors.text, fontSize: 13, fontWeight: '600' },
  // textDim (not textFaint): 11px mono is small text and needs AA contrast.
  stats: { color: colors.textDim, fontSize: 11, fontFamily: 'monospace' },
  abilityLine: { color: colors.textDim, fontSize: 12 },
  abilityName: { color: colors.cyan, fontWeight: '700' },
  ultimateName: { color: colors.warning },
  detailsLink: { alignSelf: 'flex-end' },
  detailsText: { color: colors.electricBlue, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
});
