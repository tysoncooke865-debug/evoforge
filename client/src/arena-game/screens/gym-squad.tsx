/**
 * War Squad builder (M9, P12): pick up to BALANCE.gym.maxBorrowed gym members
 * whose champions fight beside your captain in Gym Wars. Shows each member's
 * champion path, official-path squad ROLE (P12 — names what the kit already
 * does) and fitness-derived scaling preview (the same capped
 * computeFitnessScaling used in battle), plus a live squad-synergy preview
 * (pure previewSquadSynergies over champion tags + the active deck).
 * Selection persists to the save (gym.selectedSquad) through the player
 * store; stale selections (members who left the gym) are pruned on load.
 * Borrowing is a pure read — members are never modified.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Image,
  type ImageStyle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Body, Heading, Mono, NeonButton, Panel, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing, typography } from '../constants/theme';
import { BALANCE, CHAMPIONS, getChampionById, getChampionByPath } from '../content';
import { championSprite } from '../features/arena/components/sprites';
import { pathSquadRole } from '../features/gyms/path-roles';
import { memberChampionId, memberScaling, pruneSquadSelection } from '../features/gyms/squad';
import {
  hasSpawnSynergy,
  previewSquadSynergies,
  relevantSynergyEntries,
} from '../features/gyms/synergy-preview';
import type { GymMemberInfo } from '../integration/evoforge/types';
import { playerProvider } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

function scalingPreview(member: GymMemberInfo): string {
  const s = memberScaling(member.fitness, BALANCE);
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  return `DMG ${pct(s.attackDamageMult)} · HP ${pct(s.maxHealthMult)} · SPD ${pct(
    s.moveSpeedMult
  )} · CD ${pct(s.abilityCooldownMult)} · ULT ${pct(s.ultimateChargeMult)}`;
}

export default function GymSquadScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  const update = usePlayer((s) => s.update);
  const [members, setMembers] = useState<GymMemberInfo[] | null>(null);
  // P12: non-membership is the same friendly state the gym overview uses,
  // not an error; only real read failures land in `error`.
  const [noGym, setNoGym] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await playerProvider.getGymProfile(save.player.playerId);
        if (!profile) {
          if (!cancelled) setNoGym(true);
          return;
        }
        const roster = await playerProvider.getGymMembers(profile.gymId);
        if (cancelled) return;
        const others = roster.filter((m) => m.playerId !== save.player.playerId);
        setMembers(others);
        // Prune selections whose member left the gym so the saved squad and
        // the n/3 cap reflect reality (persisted only when something changed;
        // the mutator recomputes from the fresh save, never the closure).
        if (
          pruneSquadSelection(save.gym.selectedSquad, others).length !==
          save.gym.selectedSquad.length
        ) {
          void update((s) => ({
            ...s,
            gym: { ...s.gym, selectedSquad: pruneSquadSelection(s.gym.selectedSquad, others) },
          }));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.player.playerId]);

  if (noGym) {
    return (
      <Screen>
        <Panel>
          <Heading>No gym yet</Heading>
          <Body dim>
            War squads borrow champions from your real EvoForge gym. Join one in EvoForge (Social →
            Gyms), then come back here to build your squad.
          </Body>
        </Panel>
        <NeonButton label="Open EvoForge Social" onPress={() => router.push('/social')} />
      </Screen>
    );
  }

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

  // Synergy preview (P12): the captain's champion + the selected members'
  // champions, against the active deck — the same squad a Gym War fields.
  const captainId = getChampionById(save.player.championId)?.id ?? CHAMPIONS[0].id;
  const selectedMembers = selected
    .map((id) => members.find((m) => m.playerId === id))
    .filter((m): m is GymMemberInfo => m !== undefined);
  const activeDeck = save.decks.all.find((d) => d.id === save.decks.activeDeckId);
  const preview = previewSquadSynergies(
    [captainId, ...selectedMembers.map((m) => memberChampionId(m))],
    activeDeck?.cardIds ?? []
  );
  const shown = relevantSynergyEntries(preview);

  return (
    <Screen>
      <Panel>
        <Heading>War Squad</Heading>
        <Body dim>
          Borrow up to {BALANCE.gym.maxBorrowed} gym members. Their champions fight automatically
          beside your captain — you command the captain, borrowed champions cast their own
          abilities (never their ultimate).
        </Body>
        <Mono>
          Selected: {selected.length}/{BALANCE.gym.maxBorrowed}
        </Mono>
      </Panel>

      <Panel>
        <Heading>Squad synergy</Heading>
        {shown.map((entry) => (
          <View key={entry.synergyId} style={styles.synergyRow}>
            <Text style={[styles.synergyName, entry.activeFromSpawn && styles.synergyActive]}>
              {entry.name} {entry.squadCount}/{entry.threshold}
              {entry.activeFromSpawn ? ' — LIVE FROM SPAWN' : ''}
            </Text>
            {!entry.activeFromSpawn && entry.deckFighterCount > 0 && (
              <Text style={styles.synergyDeck}>
                deck fighters can add {entry.deckFighterCount}
              </Text>
            )}
          </View>
        ))}
        {!hasSpawnSynergy(preview) && (
          <Body dim>
            No synergy live from spawn — mix paths for Balanced Forge or pair with your deck&apos;s
            fighters mid-battle.
          </Body>
        )}
      </Panel>

      {members.length === 0 && (
        <Panel>
          <Heading>No squad-mates yet</Heading>
          <Body dim>
            Your gym has no other members to borrow — your captain fights Gym Wars solo. Recruit
            gym-mates in EvoForge (Social → Gyms) to fill the squad.
          </Body>
        </Panel>
      )}

      {members.map((member) => {
        const champion = getChampionByPath(member.fitness.avatarPath);
        const role = pathSquadRole(member.fitness.avatarPath);
        const isSelected = selected.includes(member.playerId);
        const full = !isSelected && selected.length >= BALANCE.gym.maxBorrowed;
        return (
          <Pressable
            key={member.playerId}
            onPress={() => toggle(member.playerId)}
            style={[styles.card, isSelected && styles.cardSelected, full && styles.cardDim]}
          >
            <View style={styles.headerRow}>
              {/* P10: the member's champion stands on the card — the same
                  sprite that will fight beside you. */}
              {(() => {
                const sprite = champion ? championSprite(champion.art, 'player') : null;
                return sprite ? (
                  <View
                    style={[
                      styles.portraitFrame,
                      { borderColor: pathColor(member.fitness.avatarPath) },
                    ]}
                  >
                    <Image source={sprite} style={[styles.portrait, PIXELATED]} fadeDuration={0} />
                  </View>
                ) : null;
              })()}
              <View style={styles.headerText}>
                <Text style={styles.name}>{member.displayName}</Text>
                <Text style={[styles.champ, { color: pathColor(member.fitness.avatarPath) }]}>
                  {champion ? champion.name : member.fitness.avatarPath} (EST.)
                </Text>
                {role && (
                  <Text style={[styles.role, { color: pathColor(member.fitness.avatarPath) }]}>
                    {role.label.toUpperCase()} — {role.summary}
                  </Text>
                )}
              </View>
            </View>
            <Text style={styles.preview}>{scalingPreview(member)}</Text>
            <Text style={[styles.state, isSelected && styles.stateSelected]}>
              {isSelected ? 'IN SQUAD — tap to remove' : full ? 'Squad full' : 'Tap to add'}
            </Text>
          </Pressable>
        );
      })}

      {members.length > 0 && (
        <Body dim>
          Estimated builds: squad-mates&apos; paths and stats are estimated from their Forge Level
          and Evo Rating (EST.) until real origin data is shared.
        </Body>
      )}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, gap: 2 },
  portraitFrame: {
    width: 48,
    height: 48,
    borderWidth: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portrait: { width: 40, height: 40 },
  name: { ...typography.heading, color: colors.text, flexShrink: 1 },
  champ: { ...typography.label },
  role: { ...typography.label, fontSize: 10 },
  preview: { ...typography.mono, color: colors.textDim },
  state: { ...typography.label, color: colors.textFaint },
  stateSelected: { color: colors.cyan },
  synergyRow: { gap: 2 },
  synergyName: { ...typography.label, color: colors.textDim },
  synergyActive: { color: colors.cyan },
  synergyDeck: { ...typography.mono, fontSize: 11, color: colors.textDim },
});
