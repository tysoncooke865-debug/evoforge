'use no memo';
/**
 * Render Stress Lab — dev-only harness (premium program P1/P3).
 *
 * Mounts the REAL ArenaScreen (so the true render path is what gets
 * measured) over a battle seeded in mode 'dev-stress' by the stress driver.
 * ArenaScreen's boot effect skips start() when a battle is already running,
 * and its unmount cleanup resets the store — exactly the teardown we want.
 *
 * Reached from the debug screen's Dev tools panel (same precedent as the
 * fitness editor: ships in the bundle, linked nowhere in production UI).
 * Zero server writes: 'dev-stress' finishes return before the provider.
 *
 * The 'use no memo' pragma matches the arena components: overlays here
 * derive styles from Date.now() in render, which must never be memoized.
 */
import React, { Profiler, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';
import { ArenaScreen } from '../features/arena/components/arena-screen';
import { useBattle } from '../features/arena/use-battle';
import {
  isProfilerRunning,
  profileSnapshot,
  recordCommit,
  resetProfileWindow,
  startFrameProfiler,
  stopFrameProfiler,
  type ProfileSnapshot,
} from '../features/arena/dev/frame-profiler';
import {
  DEFAULT_STRESS_CONFIG,
  isStressDriverActive,
  restartStressBattle,
  startStressBattle,
  stopStressDriver,
  updateStressConfig,
  type StressConfig,
} from '../features/arena/dev/stress-driver';

const DENSITIES = [10, 20, 30, 40] as const;
const RANGED_FRACTIONS = [0, 0.3, 0.6] as const;
const SPEEDS = [1, 2, 4] as const;
const PARTICLE_COUNTS = [0, 50, 150, 400] as const;

/** Synthetic particle overlay — measures marginal aged-View cost in
 *  isolation. Own component + own 50ms tick so its re-renders never cascade
 *  into ArenaScreen's parent. Same frame-driven pattern as the climax
 *  overlay: no Animated, no withRepeat. */
function ParticleOverlay({ count }: { count: number }) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (count <= 0) return;
    const id = setInterval(() => setFrame((f) => f + 1), 50);
    return () => clearInterval(id);
  }, [count]);
  if (count <= 0) return null;
  const now = Date.now();
  const dots = [];
  for (let i = 0; i < count; i++) {
    // Position/phase hashed from index; drift + fade aged from wall clock.
    const phase = ((i * 2654435761) >>> 0) % 4000;
    const age = (now + phase) % 4000;
    const t = age / 4000;
    const left = ((i * 97) % 100) + Math.sin((age / 1000) * (1 + (i % 5) * 0.3)) * 4;
    const top = ((i * 61) % 100) - t * 8;
    dots.push(
      <View
        key={i}
        style={{
          position: 'absolute',
          left: `${left}%`,
          top: `${top}%`,
          width: 3,
          height: 3,
          borderRadius: 1.5,
          backgroundColor: i % 3 === 0 ? colors.cyan : colors.electricBlue,
          opacity: 0.25 + 0.5 * Math.abs(Math.sin(t * Math.PI)),
        }}
      />
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="stress-particles">
      {dots}
    </View>
  );
}

/** 2Hz profiler readout — negligible against the 20Hz tree being measured. */
function ProfilerHud() {
  const [snap, setSnap] = useState<ProfileSnapshot | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      if (isProfilerRunning()) setSnap(profileSnapshot());
    }, 500);
    return () => clearInterval(id);
  }, []);
  if (!snap) return null;
  const r = snap.raf;
  const s = snap.store;
  return (
    <View pointerEvents="none" style={styles.hud} testID="stress-hud">
      <Text style={styles.hudText}>
        {`fps ${r.fpsAvg.toFixed(1)} (1% ${r.fps1PercentLow.toFixed(1)}) | frame avg ${r.avgFrameMs.toFixed(1)}ms worst ${r.worstFrameMs.toFixed(0)}ms`}
      </Text>
      <Text style={styles.hudText}>
        {`>16.7ms ${r.framesOver16_7}/${r.sampleCount} | >33ms ${r.framesOver33} | stalls ${s.stallCount} (worst gap ${s.worstGapMs.toFixed(0)}ms)`}
      </Text>
      <Text style={styles.hudText}>
        {`sim ${s.avgSimMs.toFixed(2)}ms | publish ${s.avgPublishMs.toFixed(2)}ms | tickHz ${s.effectiveTickHz.toFixed(1)}`}
      </Text>
      <Text style={styles.hudText}>
        {`${snap.battle ? `units ${snap.battle.units} (${snap.battle.playerUnits}v${snap.battle.opponentUnits}) tick ${snap.battle.tick} log ${snap.battle.logLength}` : 'no battle'}${snap.heap ? ` | heap ${snap.heap.usedMB.toFixed(1)}MB` : ' | heap n/a'}`}
      </Text>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function DevStressScreen() {
  const status = useBattle((s) => s.status);
  const [cfg, setCfg] = useState<StressConfig>({ ...DEFAULT_STRESS_CONFIG });
  const [particles, setParticles] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const startedRef = useRef(false);

  useEffect(() => {
    startFrameProfiler();
    return () => {
      stopStressDriver();
      stopFrameProfiler();
    };
  }, []);

  const apply = (partial: Partial<StressConfig>) => {
    const next = { ...cfg, ...partial };
    setCfg(next);
    if (!startedRef.current || !isStressDriverActive()) {
      startedRef.current = true;
      startStressBattle(next);
    } else {
      // Density/composition changes take effect through the running top-up;
      // speed/toggles apply on their next interval fire.
      updateStressConfig(next);
    }
    resetProfileWindow();
  };

  return (
    <View style={styles.root} testID="stress-ready">
      {status !== 'idle' ? (
        <Profiler
          id="arena-stress"
          onRender={(_, __, actualDuration) => recordCommit(actualDuration)}
        >
          <ArenaScreen />
        </Profiler>
      ) : (
        <View style={styles.idle}>
          <Text style={styles.idleText}>RENDER STRESS LAB</Text>
          <Text style={styles.idleSub}>
            Pick a density to start a dev-stress battle. Nothing here is recorded, rated, or
            persisted.
          </Text>
        </View>
      )}
      <ParticleOverlay count={particles} />
      <ProfilerHud />

      <View style={styles.drawer}>
        <Pressable
          onPress={() => setDrawerOpen((o) => !o)}
          style={styles.drawerToggle}
          testID="stress-drawer-toggle"
        >
          <Text style={styles.chipText}>{drawerOpen ? 'HIDE STRESS CONTROLS' : 'SHOW STRESS CONTROLS'}</Text>
        </Pressable>
        {drawerOpen ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rows}
          >
            <View style={styles.group}>
              <Text style={styles.groupLabel}>units/team</Text>
              <View style={styles.row}>
                {DENSITIES.map((d) => (
                  <Chip
                    key={d}
                    label={`${d}`}
                    active={cfg.targetPerTeam === d}
                    onPress={() => apply({ targetPerTeam: d })}
                    testID={`stress-density-${d}`}
                  />
                ))}
              </View>
            </View>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>ranged</Text>
              <View style={styles.row}>
                {RANGED_FRACTIONS.map((f) => (
                  <Chip
                    key={f}
                    label={`${Math.round(f * 100)}%`}
                    active={cfg.rangedFraction === f}
                    onPress={() => apply({ rangedFraction: f })}
                    testID={`stress-ranged-${Math.round(f * 100)}`}
                  />
                ))}
              </View>
            </View>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>speed</Text>
              <View style={styles.row}>
                {SPEEDS.map((sp) => (
                  <Chip
                    key={sp}
                    label={`${sp}x`}
                    active={cfg.simSpeed === sp}
                    onPress={() => apply({ simSpeed: sp })}
                    testID={`stress-speed-${sp}`}
                  />
                ))}
              </View>
            </View>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>particles</Text>
              <View style={styles.row}>
                {PARTICLE_COUNTS.map((p) => (
                  <Chip
                    key={p}
                    label={`${p}`}
                    active={particles === p}
                    onPress={() => {
                      setParticles(p);
                      resetProfileWindow();
                    }}
                    testID={`stress-particles-${p}`}
                  />
                ))}
              </View>
            </View>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>toggles</Text>
              <View style={styles.row}>
                <Chip
                  label="top-up"
                  active={cfg.topUp}
                  onPress={() => apply({ topUp: !cfg.topUp })}
                  testID="stress-topup"
                />
                <Chip
                  label="autocast"
                  active={cfg.autoCastChampion}
                  onPress={() => apply({ autoCastChampion: !cfg.autoCastChampion })}
                  testID="stress-autocast"
                />
                <Chip
                  label="loop"
                  active={cfg.autoRestart}
                  onPress={() => apply({ autoRestart: !cfg.autoRestart })}
                  testID="stress-autorestart"
                />
                <Chip
                  label="restart"
                  active={false}
                  onPress={() => {
                    if (isStressDriverActive()) restartStressBattle();
                    else apply({});
                    resetProfileWindow();
                  }}
                  testID="stress-restart"
                />
              </View>
            </View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  idle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  idleText: { color: colors.cyan, fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  idleSub: { color: colors.textDim, fontSize: 13, textAlign: 'center', maxWidth: 300 },
  hud: {
    position: 'absolute',
    top: 40,
    left: 8,
    backgroundColor: 'rgba(4, 10, 18, 0.82)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  hudText: { color: '#9FE8FF', fontSize: 10, fontFamily: 'monospace' as const },
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(4, 10, 18, 0.92)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  drawerToggle: { alignItems: 'center', paddingVertical: 6 },
  rows: { paddingHorizontal: 8, paddingBottom: 10, gap: 14 },
  group: { gap: 4, marginRight: 10 },
  groupLabel: { color: colors.textDim, fontSize: 10, letterSpacing: 1 },
  row: { flexDirection: 'row', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(12, 22, 36, 0.9)',
  },
  chipActive: { borderColor: colors.cyan, backgroundColor: 'rgba(34, 211, 238, 0.18)' },
  chipText: { color: colors.textDim, fontSize: 12 },
  chipTextActive: { color: colors.cyan, fontWeight: '700' },
});
