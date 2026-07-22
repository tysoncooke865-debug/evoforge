/**
 * Developer fitness-profile editor (Milestone 7). Simulates what EvoForge
 * will eventually supply through the provider boundary: edit the mock
 * FitnessProfile and see exactly how it shapes the Champion — the scaling
 * preview uses the same computeFitnessScaling the battle setup uses, so the
 * effect is predictable by construction.
 */
import { Stack } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Heading, Mono, Panel, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing } from '../constants/theme';
import { BALANCE } from '../content';
import { computeFitnessScaling } from '../game-engine/balance/fitness-scaling';
import { ALL_AVATAR_PATHS, AvatarPath } from '../game-engine/types';
import type { FitnessProfile } from '../integration/evoforge/types';
import { playerStore } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

const RATING_KEYS = [
  ['strengthRating', 'Strength'],
  ['cardioRating', 'Cardio'],
  ['muscularityRating', 'Muscularity'],
  ['leannessRating', 'Leanness'],
  ['aestheticsRating', 'Aesthetics'],
] as const;

type RatingKey = (typeof RATING_KEYS)[number][0];

function clampRating(v: number): number {
  return Math.min(BALANCE.fitness.maxRating, Math.max(BALANCE.fitness.minRating, v));
}

/** Overall Evo Rating derives from the sub-ratings in the mock. */
function deriveEvoRating(f: FitnessProfile): number {
  return Math.round(
    (f.strengthRating +
      f.cardioRating +
      f.muscularityRating +
      f.leannessRating +
      f.aestheticsRating) /
      5
  );
}

function Stepper({
  label,
  value,
  onChange,
  step = 10,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function pct(mult: number, invert = false): string {
  const delta = invert ? 1 - mult : mult - 1;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

export default function DevFitnessEditorScreen() {
  const fitness = usePlayer((s) => s.save.fitness);

  const update = (mutate: (f: FitnessProfile) => FitnessProfile) => {
    void playerStore.getState().update((save) => {
      const next = mutate({ ...save.fitness });
      next.evoRating = deriveEvoRating(next);
      return { ...save, fitness: next };
    });
  };

  const setRating = (key: RatingKey, value: number) =>
    update((f) => ({ ...f, [key]: clampRating(value) }));

  const scaling = computeFitnessScaling(
    {
      strength: fitness.strengthRating,
      cardio: fitness.cardioRating,
      muscularity: fitness.muscularityRating,
      leanness: fitness.leannessRating,
      aesthetics: fitness.aestheticsRating,
    },
    BALANCE
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Fitness Editor (dev)' }} />
      <Panel>
        <Heading>Mock Evo Rating: {fitness.evoRating}</Heading>
        <Body dim>
          Simulated EvoForge data. In the integrated app these values come from the
          EvoForgePlayerProvider — the game never reads them from anywhere else.
        </Body>
        {RATING_KEYS.map(([key, label]) => (
          <Stepper
            key={key}
            label={label}
            value={fitness[key]}
            onChange={(v) => setRating(key, v)}
          />
        ))}
      </Panel>

      <Panel>
        <Heading>Forge Level & Avatar</Heading>
        <Stepper
          label="Forge Level"
          value={fitness.forgeLevel}
          onChange={(v) => update((f) => ({ ...f, forgeLevel: Math.max(1, Math.min(50, v)) }))}
          step={1}
          min={1}
          max={50}
        />
        <Stepper
          label="Avatar Stage"
          value={fitness.avatarStage}
          onChange={(v) => update((f) => ({ ...f, avatarStage: Math.max(1, Math.min(5, v)) }))}
          step={1}
          min={1}
          max={5}
        />
        <Body dim>Avatar Path</Body>
        <View style={styles.pathRow}>
          {ALL_AVATAR_PATHS.map((path: AvatarPath) => (
            <Pressable
              key={path}
              onPress={() => update((f) => ({ ...f, avatarPath: path }))}
              style={[
                styles.pathChip,
                { borderColor: pathColor(path) },
                fitness.avatarPath === path && { backgroundColor: pathColor(path) },
              ]}
            >
              <Text
                style={[
                  styles.pathChipText,
                  fitness.avatarPath === path && styles.pathChipTextActive,
                ]}
              >
                {path}
              </Text>
            </Pressable>
          ))}
        </View>
      </Panel>

      <Panel>
        <Heading>Champion effect (ranked-capped)</Heading>
        <Mono>Attack damage {pct(scaling.attackDamageMult)} (Strength)</Mono>
        <Mono>Ability cooldowns {pct(scaling.abilityCooldownMult, true)} faster (Cardio)</Mono>
        <Mono>Max health {pct(scaling.maxHealthMult)} (Muscularity)</Mono>
        <Mono>Move speed {pct(scaling.moveSpeedMult)} (Leanness)</Mono>
        <Mono>Ultimate charge {pct(scaling.ultimateChargeMult)} (Aesthetics)</Mono>
        <Body dim>
          Total combat advantage is capped at ±
          {Math.round(BALANCE.fitness.rankedMaxTotalAdvantage * 100)}% — fitness shapes your
          Champion, it never decides the battle.
        </Body>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  stepperLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: colors.cyan, fontSize: 18, fontWeight: '800' },
  stepperValue: {
    color: colors.text,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    minWidth: 32,
    textAlign: 'center',
  },
  pathRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  pathChip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  pathChipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  pathChipTextActive: { color: '#04121A' },
});
