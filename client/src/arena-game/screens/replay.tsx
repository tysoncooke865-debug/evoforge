'use no memo'; // React Compiler opt-out: these components render a mutable simulation read from refs on a version counter (see battle-store docs).

/**
 * Replay viewer (M8) — plays a stored battle record back with the arena
 * visuals (read-only LaneStrip/CoreBar/SynergyChips; no HUD, no input).
 *
 * The record is VERIFIED before playing (verifyBattleRecord re-simulates and
 * checks outcome + digest); a record that fails verification — tampered,
 * corrupt, or from a different balance version after tuning — shows a clear
 * error state instead of playing. Playback drives a local BattleState via
 * the pure replay-player helper on a wall-clock accumulator timer at
 * 20 ticks/s x the chosen speed. No store singleton is involved.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NeonButton } from '../components/ui';
import { colors, radius, spacing, typography } from '../constants/theme';
import { BALANCE } from '../content';
import type { BattleRecord } from '../game-engine/simulation/replay';
import { verifyBattleRecord } from '../game-engine/simulation/replay';
import {
  createReplayPlayer,
  replayDigest,
  replayFinished,
  ReplayPlayer,
  stepReplay,
} from '../features/arena/replay-player';
import { LaneStrip } from '../features/arena/components/lane-strip';
import { CoreBar } from '../features/arena/components/core-bar';
import { SynergyChips } from '../features/arena/components/synergy-chips';
import { appStorage } from '../services/app-services';
import {
  battleRecordKey,
  loadBattleRecords,
} from '../services/persistence/battle-records';

/** Base simulation cadence (50ms per tick at 20 ticks/s). */
const TICK_MS = 1000 / BALANCE.ticksPerSecond;
/** Catch-up cap per timer fire, scaled by speed below. */
const MAX_BASE_TICKS_PER_FIRE = 5;

const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

type ViewState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; record: BattleRecord };

export default function ReplayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;

  const [view, setView] = useState<ViewState>({ phase: 'loading' });
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [, setVersion] = useState(0);
  const playerRef = useRef<ReplayPlayer | null>(null);

  // Load → find → verify → build the player. All failure paths land in the
  // error state; nothing here can throw out of the effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        if (!cancelled) setView({ phase: 'error', message: 'No replay id given.' });
        return;
      }
      try {
        const records = await loadBattleRecords(appStorage);
        const record = records.find((r) => battleRecordKey(r) === id);
        if (cancelled) return;
        if (!record) {
          setView({
            phase: 'error',
            message: 'Recording not found — it may have rotated out of the battle log.',
          });
          return;
        }
        const verified = verifyBattleRecord(record, BALANCE);
        if (!verified.ok) {
          setView({
            phase: 'error',
            message: `This recording failed verification and cannot be played: ${verified.reason}`,
          });
          return;
        }
        const built = createReplayPlayer(record);
        if (!built.ok) {
          setView({ phase: 'error', message: built.reason });
          return;
        }
        playerRef.current = built.player;
        setView({ phase: 'ready', record });
      } catch (e) {
        if (!cancelled) {
          setView({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Playback loop: wall-clock accumulator at the chosen speed, catch-up
  // capped so a stalled timer resumes at normal pace.
  useEffect(() => {
    if (!playing || view.phase !== 'ready') return;
    let last = Date.now();
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const elapsed = Date.now() - last;
      let ticks = Math.floor((elapsed * speed) / TICK_MS);
      if (ticks <= 0) return;
      const cap = MAX_BASE_TICKS_PER_FIRE * speed;
      if (ticks > cap) ticks = cap;
      last += (ticks * TICK_MS) / speed;
      stepReplay(player, ticks);
      setVersion((v) => v + 1);
      if (replayFinished(player)) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [playing, speed, view.phase]);

  if (view.phase === 'loading') {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  if (view.phase === 'error') {
    return (
      <View style={[styles.screen, styles.center, styles.errorWrap]}>
        <Text style={styles.errorTitle}>REPLAY UNAVAILABLE</Text>
        <Text style={styles.errorText}>{view.message}</Text>
        <NeonButton label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const player = playerRef.current;
  if (!player) return null; // unreachable in the ready phase

  const { state } = player;
  const { record } = view;
  const endTick = Math.max(1, record.outcome.endTick);
  const progress = Math.max(0, Math.min(1, state.tick / endTick));
  const finished = replayFinished(player);
  const lane0Units = state.units.filter((u) => u.alive && u.lane === 0);
  const lane1Units = state.units.filter((u) => u.alive && u.lane === 1);
  const noop = () => undefined;

  const restart = () => {
    const built = createReplayPlayer(record);
    if (!built.ok) {
      setView({ phase: 'error', message: built.reason });
      return;
    }
    playerRef.current = built.player;
    setVersion((v) => v + 1);
    setPlaying(true);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          {record.playerSnapshot.displayName} vs {record.opponentSnapshot.displayName}
        </Text>
      </View>

      <CoreBar core={state.cores.opponent} label="OPPONENT CORE" />
      <SynergyChips
        team="opponent"
        synergyIds={state.auras.opponent.activeSynergyIds}
        augmentId={state.teams.opponent.augment.chosenId}
      />

      <View style={styles.arena}>
        <LaneStrip lane={0} units={lane0Units} onDeployTap={noop} />
        <LaneStrip lane={1} units={lane1Units} onDeployTap={noop} />
      </View>

      <SynergyChips
        team="player"
        synergyIds={state.auras.player.activeSynergyIds}
        augmentId={state.teams.player.augment.chosenId}
      />
      <CoreBar core={state.cores.player} label="PLAYER CORE" />

      <View style={styles.progressRow}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {state.tick} / {endTick}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.controlButton} onPress={restart}>
          <Text style={styles.controlText}>RESTART</Text>
        </Pressable>
        <Pressable
          style={[styles.controlButton, styles.controlPrimary]}
          onPress={() => {
            if (finished) restart();
            else setPlaying((p) => !p);
          }}
        >
          <Text style={[styles.controlText, styles.controlPrimaryText]}>
            {finished ? 'REPLAY' : playing ? 'PAUSE' : 'PLAY'}
          </Text>
        </Pressable>
        <Pressable style={styles.controlButton} onPress={cycleSpeed}>
          <Text style={styles.controlText}>{speed}x</Text>
        </Pressable>
      </View>

      {finished && (
        <Text style={styles.outcomeText}>
          {record.outcome.winner === 'player'
            ? `${record.playerSnapshot.displayName} wins`
            : record.outcome.winner === 'opponent'
              ? `${record.opponentSnapshot.displayName} wins`
              : 'Draw'}{' '}
          ({record.outcome.reason})
        </Text>
      )}

      {__DEV__ && (
        <View style={styles.devOverlay} pointerEvents="none">
          <Text style={styles.devText}>
            seed {state.seed} · tick {state.tick} · digest {replayDigest(player)} · rej{' '}
            {player.rejected.length}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.sm, gap: spacing.sm },
  center: { alignItems: 'center', justifyContent: 'center' },
  errorWrap: { gap: spacing.md, padding: spacing.lg },
  errorTitle: { ...typography.heading, color: colors.danger, letterSpacing: 1.5 },
  errorText: { ...typography.body, color: colors.textDim, textAlign: 'center' },
  metaRow: { alignItems: 'center' },
  metaText: { ...typography.label, color: colors.textDim },
  arena: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.cyan },
  progressText: { ...typography.mono, color: colors.textDim },
  controls: { flexDirection: 'row', gap: spacing.sm },
  controlButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  controlPrimary: { borderColor: colors.cyan, backgroundColor: colors.cyanDim },
  controlText: { ...typography.label, color: colors.textDim },
  controlPrimaryText: { color: '#E0FBFF' },
  outcomeText: { ...typography.label, color: colors.text, textAlign: 'center' },
  devOverlay: { position: 'absolute', left: 4, bottom: 4 },
  devText: { ...typography.mono, fontSize: 9, color: colors.textFaint },
});
