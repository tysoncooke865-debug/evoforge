'use no memo'; // re-renders on the store version each sim frame; reads live fresh

/**
 * Arena 2.0 — Landscape Battle Lab (Redesign P1, dev-only scratch screen).
 *
 * The P1 demo: seeds a REAL battle via the existing stress driver (mode
 * 'dev-stress' — never recorded, never persisted, zero provider writes) at a
 * low, readable density and renders it with the new landscape `Arena2Battlefield`
 * instead of the portrait ArenaScreen. Because the SIM is untouched, the battle
 * plays digest-identical to portrait — this phase changes only the drawing.
 *
 * Gated behind the `arena2Renderer` flag; reached from the debug Dev tools panel
 * (same "ships in bundle, linked nowhere in production" precedent as the stress
 * lab). Best viewed with the device in landscape.
 */
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';
import { battleStore } from '../features/arena/battle-store';
import { startStressBattle, stopStressDriver } from '../features/arena/dev/stress-driver';
import { useBattle } from '../features/arena/use-battle';
import { Arena2Battlefield } from '../features/arena2/battlefield';
import { ControlDeck } from '../features/arena2/control-deck';
import { arena2FlagEnabled } from '../services/flags/arena-flags';

export default function Arena2BattleLab() {
  const version = useBattle((s) => s.version); // subscribe: forces a re-render each sim frame
  void version;
  const router = useRouter();

  useEffect(() => {
    // Low density so the landscape battlefield reads clearly (not a stress
    // swarm). autoCast OFF — the PLAYER pilots the champion via the control deck.
    startStressBattle({
      targetPerTeam: 5,
      rangedFraction: 0.4,
      topUp: true,
      autoCastChampion: false,
      autoRestart: true,
      simSpeed: 1,
      formation: arena2FlagEnabled('formationSim'),
    });
    return () => {
      stopStressDriver();
      battleStore.getState().reset();
    };
  }, []);

  const enabled = arena2FlagEnabled('arena2Renderer') || arena2FlagEnabled('animLab');
  const live = battleStore.getState().live;
  const playerChampion =
    live?.state.units.find(
      (u) => u.kind === 'champion' && u.team === 'player' && u.champion?.commandable && u.alive
    )?.champion ?? null;

  return (
    <View style={styles.root}>
      {!enabled ? (
        <Text style={styles.msg}>Landscape renderer disabled (arena2 flag `arena2Renderer`).</Text>
      ) : live ? (
        <>
          <Arena2Battlefield live={live} />
          <ControlDeck champion={playerChampion} tick={live.state.tick} />
        </>
      ) : (
        <Text style={styles.msg}>Starting battle…</Text>
      )}
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.badge}>Arena 2.0 · Pilot the Champion (P2)</Text>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  msg: { color: colors.textDim, fontSize: 14, padding: 24, textAlign: 'center', marginTop: 80 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10 },
  badge: {
    color: colors.player,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(4,18,26,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  back: { backgroundColor: 'rgba(4,18,26,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  backText: { color: colors.text, fontSize: 12, fontWeight: '700' },
});
