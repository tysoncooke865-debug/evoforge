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
import { abilityCooldownFraction, healthBarColor } from './readability';

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
  // P7: cooldown-elapsed fraction (0 = just used, 1 = ready) for the ability
  // button's progress fill — the numeric "Ns" label already existed, this
  // adds an at-a-glance affordance for "how close" without reading the number.
  const cooldownFrac = abilityCooldownFraction(
    runtime.abilityCooldownTicks,
    definition.ability.cooldownTicks
  );
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
          <View
            style={[
              styles.healthFill,
              { width: `${healthPct * 100}%`, backgroundColor: healthBarColor(healthPct, tint, colors.warning) },
            ]}
          />
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
        {/* P7: cooldown-progress fill — data-driven (moves only because
            abilityCooldownTicks actually ticks down), not an ambient loop,
            so it needs no reduced-motion gate (see verify-motion.mjs). */}
        {!abilityReady && (
          <View style={styles.buttonProgressTrack} pointerEvents="none">
            <View style={[styles.buttonProgressFill, { width: `${cooldownFrac * 100}%` }]} />
          </View>
        )}
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
        {/* P7: charge-progress fill for the ultimate, same treatment as the
            ability's cooldown fill — was numeric-only before. */}
        {!ultimateReady && (
          <View style={styles.buttonProgressTrack} pointerEvents="none">
            <View
              style={[
                styles.buttonProgressFill,
                styles.buttonProgressFillUltimate,
                { width: `${chargePct}%` },
              ]}
            />
          </View>
        )}
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
    position: 'relative',
    overflow: 'hidden',
  },
  // P7: ready states get a visibly thicker border (2px vs. 1px cooling) —
  // a static, non-animated "pop" so readiness reads at a glance without a
  // continuous glow/pulse (deliberately skipped; see KNOWN_ISSUES.md).
  buttonReady: { backgroundColor: colors.cyanDim, borderColor: colors.cyan, borderWidth: 2 },
  buttonUltimateReady: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.warning,
    borderWidth: 2,
  },
  buttonCooling: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  // P7: cooldown/charge progress fill, pinned to the button's bottom edge —
  // data-driven width (cooldownFrac / chargePct), no Animated value.
  buttonProgressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  buttonProgressFill: { height: '100%', backgroundColor: colors.cyan },
  buttonProgressFillUltimate: { backgroundColor: colors.warning },
  buttonName: { ...typography.label, color: colors.text, fontSize: 11, textAlign: 'center' },
  buttonNameDim: { color: colors.textFaint },
  buttonState: { ...typography.mono, color: colors.cyan, fontSize: 11, fontWeight: '700' },
  ultimateReadyLabel: { color: colors.warning },
});
