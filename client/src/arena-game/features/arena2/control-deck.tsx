'use no memo'; // meters/cooldowns derive from live champion state each frame

/**
 * Arena 2.0 — one-thumb control deck (Redesign P2).
 *
 * The player pilots ONLY the champion (movement stays automatic). This overlay
 * is the whole control surface: Lane Switch on the left edge, and a
 * bottom-right thumb cluster — Basic Attack (big; tap repeatedly to combo),
 * Ability, and Ultimate (fills with charge, glows when ready). Each button
 * dispatches through the battle store, which queues a replay-safe command for
 * the next tick (the engine re-validates authoritatively). Reads champion state
 * for meters/cooldowns; no per-frame state of its own.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { battleStore } from '../arena/battle-store';
import type { ChampionState } from '../../game-engine/simulation/state';
import { COMBO_MAX, comboActive } from '../../game-engine/commands/champion-control';

export function ControlDeck({ champion, tick }: { champion: ChampionState | null; tick: number }) {
  const store = battleStore.getState();
  const down = champion === null; // no commandable champion alive
  const ultPct = champion ? Math.min(1, champion.ultimateCharge / Math.max(1, champion.chargeRequired)) : 0;
  const ultReady = ultPct >= 1;
  const abilityReady = champion ? champion.abilityCooldownTicks <= 0 : false;
  const laneReady = champion ? tick >= champion.laneSwitchReadyTick : false;
  const combo = champion && comboActive(champion, tick) ? champion.comboCount : 0;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* Left edge: Lane Switch — the core tactical lever. */}
      <Pressable
        disabled={down}
        onPress={() => store.championLaneSwitch()}
        style={[styles.laneBtn, (!laneReady || down) && styles.dim]}
      >
        <Text style={styles.laneIcon}>⇅</Text>
        <Text style={styles.laneLabel}>LANE</Text>
      </Pressable>

      {/* Bottom-right thumb cluster. */}
      <View style={styles.cluster} pointerEvents="box-none">
        <View style={styles.smallCol}>
          <Pressable
            disabled={down}
            onPress={() => store.championAbility()}
            style={[styles.smallBtn, (!abilityReady || down) && styles.dim]}
          >
            <Text style={styles.smallLabel}>ABILITY</Text>
          </Pressable>
          <Pressable
            disabled={down}
            onPress={() => store.championUltimate()}
            style={[styles.ultBtn, ultReady && !down ? styles.ultReady : styles.dim]}
          >
            <View style={[styles.ultFill, { height: `${ultPct * 100}%` }]} />
            <Text style={[styles.smallLabel, ultReady && styles.ultReadyText]}>ULT</Text>
          </Pressable>
        </View>

        <Pressable
          disabled={down}
          onPress={() => store.championBasicAttack()}
          style={[styles.basicBtn, down && styles.dim]}
        >
          <Text style={styles.basicLabel}>ATK</Text>
          {combo > 0 && (
            <Text style={styles.combo}>
              {combo}
              {combo >= COMBO_MAX ? '!' : 'x'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 },
  dim: { opacity: 0.4 },
  laneBtn: {
    position: 'absolute',
    left: 12,
    bottom: 28,
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: colors.player,
    backgroundColor: 'rgba(34,211,238,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laneIcon: { color: colors.player, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  laneLabel: { color: colors.player, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  cluster: { position: 'absolute', right: 12, bottom: 20, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  smallCol: { alignItems: 'center', gap: 10 },
  smallBtn: {
    width: 58,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'rgba(13,20,32,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ultBtn: {
    width: 58,
    height: 52,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.warning,
    backgroundColor: 'rgba(13,20,32,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ultFill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(245,158,11,0.35)' },
  ultReady: { borderColor: colors.warning, backgroundColor: 'rgba(245,158,11,0.3)' },
  ultReadyText: { color: colors.warning },
  smallLabel: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  basicBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: colors.player,
    backgroundColor: 'rgba(34,211,238,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  basicLabel: { color: colors.player, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  combo: { color: colors.warning, fontSize: 13, fontWeight: '900', marginTop: 2 },
});
