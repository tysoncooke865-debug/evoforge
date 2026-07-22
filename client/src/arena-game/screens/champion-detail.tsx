/**
 * Champion detail: full stats, ability/ultimate numbers and respawn rules
 * for one Champion, with a select action.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Heading, NeonButton, Panel, Screen } from '../components/ui';
import { colors, pathColor, spacing } from '../constants/theme';
import { BALANCE, CHAMPIONS, getChampionById, TICKS_PER_SECOND } from '../content';
import type { ChampionAbilityDefinition } from '../content/types';
import { playerStore } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

export function generateStaticParams(): { id: string }[] {
  return CHAMPIONS.map((champion) => ({ id: champion.id }));
}

function seconds(ticks: number): string {
  return `${(ticks / TICKS_PER_SECOND).toFixed(1)}s`;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function AbilityPanel({
  title,
  ability,
  extra,
}: {
  title: string;
  ability: ChampionAbilityDefinition;
  extra: string;
}) {
  const e = ability.effects;
  const lines: string[] = [];
  if (e.damage) lines.push(`Damage ${e.damage}`);
  if (e.radius) lines.push(`Radius ${e.radius}`);
  if (e.stunTicks) lines.push(`Stun ${seconds(e.stunTicks)}`);
  if (e.heal) lines.push(`Heal ${e.heal}`);
  if (e.durationTicks) lines.push(`Duration ${seconds(e.durationTicks)}`);
  if (e.attackDamageMult) lines.push(`Attack damage x${e.attackDamageMult}`);
  if (e.attackIntervalMult) lines.push(`Attack interval x${e.attackIntervalMult}`);
  if (e.moveSpeedMult) lines.push(`Move speed x${e.moveSpeedMult}`);
  if (e.damageTakenMult) lines.push(`Damage taken x${e.damageTakenMult}`);
  if (e.executeBelowHealthFraction)
    lines.push(`Executes below ${Math.round(e.executeBelowHealthFraction * 100)}% health`);
  return (
    <Panel>
      <Heading>
        {title}: {ability.name}
      </Heading>
      <Body dim>{ability.description}</Body>
      {lines.length > 0 && <Text style={styles.effectLines}>{lines.join(' · ')}</Text>}
      <Text style={styles.effectLines}>{extra}</Text>
    </Panel>
  );
}

export default function ChampionDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const champion = getChampionById(id);
  const save = usePlayer((s) => s.save);

  if (!champion) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Champion' }} />
        <Heading>Unknown champion</Heading>
        <Body dim>No champion with id &apos;{id}&apos; exists.</Body>
      </Screen>
    );
  }

  const tint = pathColor(champion.path);
  const selected = save.player.championId === champion.id;
  const s = champion.stats;

  const select = () => {
    void playerStore.getState().update((prev) => ({
      ...prev,
      player: { ...prev.player, championId: champion.id },
    }));
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: champion.name }} />
      <Panel>
        <Text style={[styles.name, { color: tint }]}>{champion.name}</Text>
        <Body>{champion.role}</Body>
        <Body dim>{champion.description}</Body>
      </Panel>

      <Panel>
        <Heading>Combat stats</Heading>
        <StatRow label="Max health" value={`${s.maxHealth}`} />
        <StatRow label="Attack damage" value={`${s.attackDamage}`} />
        <StatRow label="Attack interval" value={seconds(s.attackIntervalTicks)} />
        <StatRow label="Attack range" value={`${s.attackRange}`} />
        <StatRow label="Move speed" value={`${s.moveSpeedPerTick} / tick`} />
        <StatRow
          label="Respawn"
          value={`${seconds(BALANCE.champion.respawnTicks)} at ${Math.round(
            BALANCE.champion.respawnHealthFraction * 100
          )}% health`}
        />
      </Panel>

      <AbilityPanel
        title="Ability"
        ability={champion.ability}
        extra={`Cooldown ${seconds(champion.ability.cooldownTicks)}`}
      />
      <AbilityPanel
        title="Ultimate"
        ability={champion.ultimate}
        extra={`Charges from combat: +${champion.ultimateChargePerDamageDealt} per damage dealt, +${champion.ultimateChargePerDamageTaken} per damage taken (${champion.ultimateChargeRequired} to unleash)`}
      />

      <NeonButton
        label={selected ? 'Selected ✓' : `Select ${champion.name}`}
        onPress={select}
        disabled={selected}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel: { color: colors.textDim, fontSize: 13 },
  statValue: { color: colors.text, fontSize: 13, fontFamily: 'monospace' },
  effectLines: { color: colors.textFaint, fontSize: 12, fontFamily: 'monospace', marginTop: spacing.xs },
});
