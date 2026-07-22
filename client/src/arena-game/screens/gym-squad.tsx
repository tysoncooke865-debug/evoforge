/**
 * War Squad builder (M9): pick up to BALANCE.gym.maxBorrowed gym members
 * whose champions fight beside your captain in Gym Wars. Shows each member's
 * champion path and fitness-derived scaling preview (the same capped
 * computeFitnessScaling used in battle). Selection persists to the save
 * (gym.selectedSquad) through the player store. Borrowing is a pure read —
 * members are never modified.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Heading, Mono, Panel, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing, typography } from '../constants/theme';
import { BALANCE, getChampionByPath } from '../content';
import { memberScaling } from '../features/gyms/squad';
import type { GymMemberInfo } from '../integration/evoforge/types';
import { playerProvider } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

function scalingPreview(member: GymMemberInfo): string {
  const s = memberScaling(member.fitness, BALANCE);
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  return `DMG ${pct(s.attackDamageMult)} · HP ${pct(s.maxHealthMult)} · SPD ${pct(
    s.moveSpeedMult
  )} · CD ${pct(s.abilityCooldownMult)} · ULT ${pct(s.ultimateChargeMult)}`;
}

export default function GymSquadScreen() {
  const save = usePlayer((s) => s.save);
  const update = usePlayer((s) => s.update);
  const [members, setMembers] = useState<GymMemberInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await playerProvider.getGymProfile(save.player.playerId);
        if (!profile) {
          if (!cancelled) setError('You are not a member of a gym yet.');
          return;
        }
        const roster = await playerProvider.getGymMembers(profile.gymId);
        if (!cancelled) setMembers(roster.filter((m) => m.playerId !== save.player.playerId));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [save.player.playerId]);

  if (error) {
    return (
      <Screen>
        <Panel>
          <Heading>Squad unavailable</Heading>
          <Body dim>{error}</Body>
        </Panel>
      </Screen>
    );
  }

  if (!members) {
    return (
      <Screen>
        <Body dim>Loading members…</Body>
      </Screen>
    );
  }

  const selected = save.gym.selectedSquad;
  const toggle = (playerId: string) => {
    void update((s) => {
      const current = s.gym.selectedSquad;
      const next = current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : current.length < BALANCE.gym.maxBorrowed
          ? [...current, playerId]
          : current; // cap reached — ignore
      return { ...s, gym: { ...s.gym, selectedSquad: next } };
    });
  };

  return (
    <Screen>
      <Panel>
        <Heading>War Squad</Heading>
        <Body dim>
          Borrow up to {BALANCE.gym.maxBorrowed} gym members. Their champions fight automatically
          beside your captain — you command the captain, borrowed champions cast their own
          abilities.
        </Body>
        <Mono>
          Selected: {selected.length}/{BALANCE.gym.maxBorrowed}
        </Mono>
      </Panel>

      {members.map((member) => {
        const champion = getChampionByPath(member.fitness.avatarPath);
        const isSelected = selected.includes(member.playerId);
        const full = !isSelected && selected.length >= BALANCE.gym.maxBorrowed;
        return (
          <Pressable
            key={member.playerId}
            onPress={() => toggle(member.playerId)}
            style={[styles.card, isSelected && styles.cardSelected, full && styles.cardDim]}
          >
            <View style={styles.headerRow}>
              <Text style={styles.name}>{member.displayName}</Text>
              <Text style={[styles.champ, { color: pathColor(member.fitness.avatarPath) }]}>
                {champion ? champion.name : member.fitness.avatarPath}
              </Text>
            </View>
            <Text style={styles.preview}>{scalingPreview(member)}</Text>
            <Text style={[styles.state, isSelected && styles.stateSelected]}>
              {isSelected ? 'IN SQUAD — tap to remove' : full ? 'Squad full' : 'Tap to add'}
            </Text>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardSelected: { borderColor: colors.cyan, backgroundColor: colors.surfaceRaised },
  cardDim: { opacity: 0.55 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  name: { ...typography.heading, color: colors.text, flexShrink: 1 },
  champ: { ...typography.label },
  preview: { ...typography.mono, color: colors.textDim },
  state: { ...typography.label, color: colors.textFaint },
  stateSelected: { color: colors.cyan },
});
