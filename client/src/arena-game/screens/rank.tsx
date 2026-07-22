import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Heading, Panel, Screen } from '../components/ui';
import { colors, radius, spacing } from '../constants/theme';
import { BALANCE } from '../content';
import { rankTierForPoints } from '../services/progression/rank';
import { usePlayer } from '../services/player-data/use-player';

export default function RankScreen() {
  const save = usePlayer((s) => s.save);
  const info = rankTierForPoints(save.player.rankPoints, BALANCE);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Arena Rating' }} />
      <Panel>
        <Heading>{info.name}</Heading>
        <Body dim>{save.player.rankPoints} Arena Rating</Body>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${info.progress * 100}%` }]} />
        </View>
        {info.next ? (
          <Body dim>
            {info.next.minPoints - save.player.rankPoints} points to {info.next.name}
          </Body>
        ) : (
          <Body dim>Top tier reached.</Body>
        )}
        <Body dim>
          Record: {save.stats.wins}W / {save.stats.losses}L / {save.stats.draws}D (
          {save.stats.battlesPlayed} battles)
        </Body>
      </Panel>

      <Panel>
        <Heading>Tiers</Heading>
        {BALANCE.rank.tiers.map((tier) => (
          <View key={tier.name} style={styles.tierRow}>
            <Text style={[styles.tierName, tier.name === info.name && styles.tierCurrent]}>
              {tier.name}
              {tier.name === info.name ? '  ◄ you' : ''}
            </Text>
            <Text style={styles.tierPoints}>{tier.minPoints}+</Text>
          </View>
        ))}
      </Panel>

      <Panel>
        <Heading>How progression fits together</Heading>
        <Body dim>
          Arena Rating measures battle results only, and it stays in the Arena — cosmetic
          standing, never Forge XP. It is separate from your Evo Rating (physical
          development, shapes your Champion within a capped ±{Math.round(
            (BALANCE.fitness.rankedMaxTotalAdvantage / 2) * 100
          )}–{Math.round(BALANCE.fitness.rankedMaxTotalAdvantage * 100)}% band) and your Forge
          Level (training consistency, unlocks content — never raw stats).
        </Body>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.cyan },
  tierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tierName: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  tierCurrent: { color: colors.cyan },
  tierPoints: { color: colors.textFaint, fontSize: 13, fontFamily: 'monospace' },
});
