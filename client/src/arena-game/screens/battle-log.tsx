/**
 * Battle Log (M8) — lists the stored battle records (ring buffer of the last
 * 10 finished standard/ghost battles), newest first, with Watch Replay and
 * Fight Ghost actions. Records from an older balance version are marked:
 * they can no longer be replayed or fought (verification refuses cross-
 * balance records by design), and the row explains why.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Heading, Mono, NeonButton, Panel, Screen } from '../components/ui';
import { colors, radius, spacing, typography } from '../constants/theme';
import { BALANCE } from '../content';
import type { BattleRecord } from '../game-engine/simulation/replay';
import { appStorage } from '../services/app-services';
import {
  battleRecordKey,
  loadBattleRecords,
} from '../services/persistence/battle-records';

function outcomeLabel(record: BattleRecord): { text: string; color: string } {
  const winner = record.outcome.winner;
  if (winner === 'player') return { text: 'VICTORY', color: colors.success };
  if (winner === 'opponent') return { text: 'DEFEAT', color: colors.danger };
  return { text: 'DRAW', color: colors.warning };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function BattleLogScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<BattleRecord[] | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    void loadBattleRecords(appStorage).then((loaded) => {
      // Stored oldest-first; show newest first.
      if (!cancelled) setRecords([...loaded].reverse());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  if (records === null) {
    return (
      <Screen>
        <Body dim>Loading battle log…</Body>
      </Screen>
    );
  }

  if (records.length === 0) {
    return (
      <Screen>
        <Panel>
          <Heading>No battles recorded</Heading>
          <Body dim>
            Finish a battle in the Arena and it will appear here — ready to watch again or to
            fight as a ghost of your past self. The log keeps your last 10 battles.
          </Body>
        </Panel>
        <NeonButton label="To the Arena" onPress={() => router.push('/forge-arena/battle')} />
      </Screen>
    );
  }

  return (
    <Screen>
      {records.map((record) => {
        const key = battleRecordKey(record);
        const outcome = outcomeLabel(record);
        const mode = record.debug?.mode ?? 'standard';
        const stale = record.balanceVersion !== BALANCE.balanceVersion;
        return (
          <Panel key={key}>
            <View style={styles.headerRow}>
              <Text style={[styles.outcome, { color: outcome.color }]}>{outcome.text}</Text>
              <View style={styles.chips}>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{mode.toUpperCase()}</Text>
                </View>
                {record.debug?.aiDifficulty && (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{record.debug.aiDifficulty.toUpperCase()}</Text>
                  </View>
                )}
                {stale && (
                  <View style={[styles.chip, styles.staleChip]}>
                    <Text style={[styles.chipText, styles.staleChipText]}>OLD BALANCE</Text>
                  </View>
                )}
              </View>
            </View>
            <Body>vs {record.opponentSnapshot.displayName}</Body>
            <Mono>
              {formatDate(record.recordedAt)} · {Math.round(record.outcome.endTick / BALANCE.ticksPerSecond)}s ·
              seed {record.seed}
            </Mono>
            {stale ? (
              <Body dim>
                Recorded on balance {record.balanceVersion} (current {BALANCE.balanceVersion}) —
                replay and ghost battles need matching battle numbers.
              </Body>
            ) : (
              <View style={styles.actions}>
                <View style={styles.actionButton}>
                  <NeonButton
                    label="Watch Replay"
                    variant="secondary"
                    onPress={() => router.push({ pathname: '/forge-arena/replay', params: { id: key } })}
                  />
                </View>
                <View style={styles.actionButton}>
                  <NeonButton
                    label="Fight Ghost"
                    onPress={() => router.push({ pathname: '/forge-arena/battle', params: { ghostId: key } })}
                  />
                </View>
              </View>
            )}
          </Panel>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  outcome: { ...typography.heading, letterSpacing: 1 },
  chips: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  chipText: { ...typography.label, fontSize: 10, color: colors.textDim },
  staleChip: { borderColor: colors.warning },
  staleChipText: { color: colors.warning },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flex: 1 },
});
