/**
 * Champion HUD strip: champion name + prominent health, an ability button
 * (cooldown seconds remaining) and an ultimate button (charge %). Buttons
 * queue engine commands for the next tick via the battle store; the engine
 * re-validates at apply time. While the champion is down, both buttons are
 * replaced by a respawn countdown.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, pathColor, radius, spacing, typography } from '../../../constants/theme';
import { getChampionById, TICKS_PER_SECOND } from '../../../content';
import type { UnitState } from '../../../game-engine/simulation/state';

interface Props {
  /** The player's champion unit (alive or down). Null hides the HUD. */
  champion: UnitState | null;
  /** Current simulation tick, for the respawn countdown. */
  tick: number;
  onAbility: () => void;
  onUltimate: () => void;
}

export function ChampionHud({ champion, tick, onAbility, onUltimate }: Props) {
  if (!champion || !champion.champion) return null;
  const definition = getChampionById(champion.contentId);
  if (!definition) return null;

  const runtime = champion.champion;
  const tint = pathColor(definition.path);
  const healthPct = Math.max(0, Math.min(1, champion.health / champion.baseMaxHealth));

  if (!champion.alive) {
    const respawnSeconds =
      runtime.respawnAtTick !== null
        ? Math.max(0, Math.ceil((runtime.respawnAtTick - tick) / TICKS_PER_SECOND))
        : 0;
    return (
      <View style={styles.row}>
        <View style={styles.identity}>
          <Text style={[styles.name, { color: tint }]}>{definition.name}</Text>
          <Text style={styles.downLabel}>DOWN — respawn in {respawnSeconds}s</Text>
        </View>
      </View>
    );
  }

  const abilityReady = runtime.abilityCooldownTicks === 0;
  const cooldownSeconds = Math.ceil(runtime.abilityCooldownTicks / TICKS_PER_SECOND);
  const chargePct = Math.min(
    100,
    Math.floor((runtime.ultimateCharge / runtime.chargeRequired) * 100)
  );
  const ultimateReady = chargePct >= 100;

  return (
    <View style={styles.row}>
      <View style={styles.identity}>
        <Text style={[styles.name, { color: tint }]}>{definition.name}</Text>
        <Text style={styles.health}>
          {Math.max(0, Math.round(champion.health))} / {champion.baseMaxHealth}
        </Text>
        <View style={styles.healthTrack}>
          <View style={[styles.healthFill, { width: `${healthPct * 100}%`, backgroundColor: tint }]} />
        </View>
      </View>

      <Pressable
        onPress={onAbility}
        disabled={!abilityReady}
        accessibilityRole="button"
        accessibilityLabel={`Ability ${definition.ability.name}${
          abilityReady ? ', ready' : `, on cooldown ${cooldownSeconds} seconds`
        }`}
        accessibilityState={{ disabled: !abilityReady }}
        style={[styles.button, abilityReady ? styles.buttonReady : styles.buttonCooling]}
      >
        <Text style={[styles.buttonName, !abilityReady && styles.buttonNameDim]} numberOfLines={1}>
          {definition.ability.name}
        </Text>
        <Text style={[styles.buttonState, !abilityReady && styles.buttonNameDim]}>
          {abilityReady ? 'READY' : `${cooldownSeconds}s`}
        </Text>
      </Pressable>

      <Pressable
        onPress={onUltimate}
        disabled={!ultimateReady}
        accessibilityRole="button"
        accessibilityLabel={`Ultimate ${definition.ultimate.name}${
          ultimateReady ? ', charged' : `, ${chargePct} percent charged`
        }`}
        accessibilityState={{ disabled: !ultimateReady }}
        style={[styles.button, ultimateReady ? styles.buttonUltimateReady : styles.buttonCooling]}
      >
        <Text style={[styles.buttonName, !ultimateReady && styles.buttonNameDim]} numberOfLines={1}>
          {definition.ultimate.name}
        </Text>
        <Text
          style={[
            styles.buttonState,
            ultimateReady ? styles.ultimateReadyLabel : styles.buttonNameDim,
          ]}
        >
          {ultimateReady ? 'UNLEASH' : `${chargePct}%`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  identity: { flex: 1.2, gap: 2 },
  name: { ...typography.label, fontSize: 12 },
  health: { ...typography.mono, color: colors.text, fontSize: 13, fontWeight: '700' },
  healthTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  healthFill: { height: '100%' },
  downLabel: { ...typography.label, color: colors.danger, fontSize: 12 },
  button: {
    flex: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    minHeight: 44, // accessibility: 44pt minimum touch target
  },
  buttonReady: { backgroundColor: colors.cyanDim, borderColor: colors.cyan },
  buttonUltimateReady: { backgroundColor: colors.surfaceRaised, borderColor: colors.warning },
  buttonCooling: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  buttonName: { ...typography.label, color: colors.text, fontSize: 11, textAlign: 'center' },
  buttonNameDim: { color: colors.textFaint },
  buttonState: { ...typography.mono, color: colors.cyan, fontSize: 11, fontWeight: '700' },
  ultimateReadyLabel: { color: colors.warning },
});
