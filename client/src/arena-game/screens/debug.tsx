import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { Body, Heading, Mono, NeonButton, Panel, Screen } from '../components/ui';
import { colors } from '../constants/theme';
import { BALANCE, validateAllContent } from '../content';
import { appStorage, playerStore } from '../services/app-services';
import {
  clearBattleRecords,
  estimateBattleRecordsSize,
  loadBattleRecords,
  MAX_BATTLE_RECORDS,
} from '../services/persistence/battle-records';
import { usePlayer } from '../services/player-data/use-player';

export default function DebugScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  const recovered = usePlayer((s) => s.recovered);
  const fresh = usePlayer((s) => s.fresh);
  const report = useMemo(() => validateAllContent(), []);
  const [resetDone, setResetDone] = useState(false);
  const [recordStats, setRecordStats] = useState<{ count: number; bytes: number } | null>(null);

  const refreshRecordStats = useCallback(() => {
    void (async () => {
      const records = await loadBattleRecords(appStorage);
      const bytes = await estimateBattleRecordsSize(appStorage);
      setRecordStats({ count: records.length, bytes });
    })();
  }, []);

  useEffect(() => {
    refreshRecordStats();
  }, [refreshRecordStats]);

  const confirmClearRecords = () => {
    Alert.alert('Clear battle records?', 'This deletes all stored replays. There is no undo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearBattleRecords(appStorage);
          refreshRecordStats();
        },
      },
    ]);
  };

  const confirmReset = () => {
    Alert.alert('Reset all data?', 'This wipes the local save. There is no undo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await playerStore.getState().reset();
          setResetDone(true);
        },
      },
    ]);
  };

  return (
    <Screen>
      <Panel>
        <Heading>Content validation</Heading>
        <Body style={{ color: report.ok ? colors.success : colors.danger }}>
          {report.ok ? 'PASS' : `FAIL — ${report.errors.length} error(s)`}
        </Body>
        <Mono>
          {report.counts.cards} cards · {report.counts.champions} champions ·{' '}
          {report.counts.synergies} synergies · {report.counts.augments} augments
        </Mono>
        {report.errors.map((e, i) => (
          <Mono key={`e${i}`} style={{ color: colors.danger }}>
            ✗ {e}
          </Mono>
        ))}
        {report.warnings.map((w, i) => (
          <Mono key={`w${i}`} style={{ color: colors.warning }}>
            ⚠ {w}
          </Mono>
        ))}
      </Panel>

      <Panel>
        <Heading>Balance</Heading>
        <Mono>balanceVersion: {BALANCE.balanceVersion}</Mono>
        <Mono>
          {BALANCE.ticksPerSecond} ticks/s · battle {BALANCE.battle.durationTicks} ticks · energy
          max {BALANCE.energy.max}
        </Mono>
      </Panel>

      <Panel>
        <Heading>Save data</Heading>
        <Mono>saveVersion: {save.saveVersion}</Mono>
        <Mono>created: {save.createdAt}</Mono>
        <Mono>updated: {save.updatedAt}</Mono>
        <Mono>
          load flags: {fresh ? 'fresh-install ' : ''}
          {recovered ? 'RECOVERED-FROM-CORRUPT ' : ''}
          {!fresh && !recovered ? 'loaded-ok' : ''}
        </Mono>
        <Mono>player: {JSON.stringify(save.player)}</Mono>
        <Mono>fitness: {JSON.stringify(save.fitness)}</Mono>
        <Mono>decks: {JSON.stringify(save.decks)}</Mono>
        <Mono>stats: {JSON.stringify(save.stats)}</Mono>
      </Panel>

      <Panel>
        <Heading>Battle records</Heading>
        {recordStats === null ? (
          <Mono>loading…</Mono>
        ) : (
          <Mono>
            {recordStats.count} / {MAX_BATTLE_RECORDS} stored · ~
            {(recordStats.bytes / 1024).toFixed(1)} KB
          </Mono>
        )}
        <NeonButton label="Clear records" variant="danger" onPress={confirmClearRecords} />
      </Panel>

      <Panel>
        <Heading>Dev tools</Heading>
        <Body dim>
          The fitness editor edits the LOCAL MOCK save only — integrated battles read real
          EvoForge data through the provider and ignore it entirely.
        </Body>
        <NeonButton
          label="Fitness Editor (dev mock)"
          variant="secondary"
          onPress={() => router.push('/forge-arena/dev-fitness-editor')}
        />
        <NeonButton
          label="Render Stress Lab"
          variant="secondary"
          onPress={() => router.push('/forge-arena/dev-stress')}
        />
        <NeonButton
          label="Arena 2.0 · Anim Lab"
          variant="secondary"
          onPress={() => router.push('/forge-arena/arena2-anim-lab')}
        />
        <NeonButton
          label="Arena 2.0 · Landscape Battle Lab"
          variant="secondary"
          onPress={() => router.push('/forge-arena/arena2-battle-lab')}
        />
      </Panel>

      <NeonButton label={resetDone ? 'Data reset ✓' : 'Reset all data'} variant="danger" onPress={confirmReset} />
    </Screen>
  );
}
