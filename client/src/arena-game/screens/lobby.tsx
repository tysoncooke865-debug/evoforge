import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Heading, NeonButton, Panel, Screen } from '../components/ui';
import { colors, radius, spacing, typography } from '../constants/theme';
import { ALL_AI_DIFFICULTIES, getChampionById } from '../content';
import type { AiDifficulty } from '../content';
import { isDifficultyUnlocked } from '../services/onboarding/onboarding';
import { usePlayer } from '../services/player-data/use-player';

const DIFFICULTY_LABEL: Record<AiDifficulty, string> = {
  training: 'Training',
  standard: 'Standard',
  advanced: 'Advanced',
};

export default function LobbyScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  const update = usePlayer((s) => s.update);
  const champion = getChampionById(save.player.championId);
  const firstBattle = save.stats.battlesPlayed === 0;
  // P11 difficulty gate: locked tiers need a second, deliberate tap.
  const [confirmUnlock, setConfirmUnlock] = useState<AiDifficulty | null>(null);

  const setDifficulty = (aiDifficulty: AiDifficulty) => {
    setConfirmUnlock(null);
    void update((s) => ({ ...s, settings: { ...s.settings, aiDifficulty } }));
  };

  const onDifficultyTap = (difficulty: AiDifficulty) => {
    if (isDifficultyUnlocked(save, difficulty) || save.settings.aiDifficulty === difficulty) {
      setDifficulty(difficulty);
      return;
    }
    // Locked tier: first tap explains, second tap is the explicit choice.
    if (confirmUnlock === difficulty) {
      setDifficulty(difficulty);
    } else {
      setConfirmUnlock(difficulty);
    }
  };

  const anyLocked = ALL_AI_DIFFICULTIES.some((d) => !isDifficultyUnlocked(save, d));

  return (
    <Screen>
      <Panel>
        <Heading>{save.player.displayName}</Heading>
        <Body dim>
          Champion: {champion ? `${champion.name} — ${champion.role}` : 'none selected'}
        </Body>
        <Body dim>
          Arena Rating: {save.player.rankPoints} · Battles: {save.stats.battlesPlayed} (
          {save.stats.wins}W / {save.stats.losses}L / {save.stats.draws}D)
        </Body>
      </Panel>

      {firstBattle && (
        <NeonButton label="START HERE — TUTORIAL" onPress={() => router.push('/forge-arena/tutorial')} />
      )}

      <Panel>
        <Text style={styles.difficultyLabel}>OPPONENT DIFFICULTY</Text>
        <View style={styles.difficultyRow}>
          {ALL_AI_DIFFICULTIES.map((difficulty) => {
            const selected = save.settings.aiDifficulty === difficulty;
            const locked = !isDifficultyUnlocked(save, difficulty) && !selected;
            return (
              <Pressable
                key={difficulty}
                onPress={() => onDifficultyTap(difficulty)}
                accessibilityRole="button"
                accessibilityLabel={`Opponent difficulty ${DIFFICULTY_LABEL[difficulty]}${
                  locked ? ', locked until your first win' : ''
                }`}
                accessibilityState={{ selected }}
                style={[styles.difficultyChip, selected && styles.difficultyChipSelected]}
              >
                <Text
                  style={[styles.difficultyChipText, selected && styles.difficultyChipTextSelected]}
                >
                  {locked ? `🔒 ${DIFFICULTY_LABEL[difficulty]}` : DIFFICULTY_LABEL[difficulty]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {confirmUnlock !== null ? (
          <Body dim>
            {DIFFICULTY_LABEL[confirmUnlock]} unlocks after your first win — tap again to face it
            anyway.
          </Body>
        ) : anyLocked ? (
          <Body dim>Win a battle to unlock the harder tiers.</Body>
        ) : null}
      </Panel>

      <NeonButton label="BATTLE" onPress={() => router.push('/forge-arena/battle')} />
      {!firstBattle && (
        <NeonButton label="Tutorial" variant="secondary" onPress={() => router.push('/forge-arena/tutorial')} />
      )}
      <NeonButton label="Gym" variant="secondary" onPress={() => router.push('/forge-arena/gym')} />
      <NeonButton label="Battle Log" variant="secondary" onPress={() => router.push('/forge-arena/battle-log')} />
      <NeonButton label="Champions" variant="secondary" onPress={() => router.push('/forge-arena/champions')} />
      <NeonButton label="Deck Builder" variant="secondary" onPress={() => router.push('/forge-arena/deck-builder')} />
      <NeonButton label="Card Collection" variant="secondary" onPress={() => router.push('/forge-arena/collection')} />
      <NeonButton label="Arena Rating" variant="secondary" onPress={() => router.push('/forge-arena/rank')} />
      <NeonButton label="Profile" variant="secondary" onPress={() => router.push('/forge-arena/profile')} />
      <NeonButton label="Send Feedback" variant="secondary" onPress={() => router.push('/forge-arena/feedback')} />
      <NeonButton label="Replay Onboarding" variant="secondary" onPress={() => router.push('/forge-arena/onboarding')} />
      {/* The dev fitness editor is deliberately NOT linked here (audit HIGH
          #3): it edits the local mock save, which integrated battles ignore.
          It remains reachable from the Developer Debug screen, labeled.
          P11: the debug door itself is dev/opt-in only — inside EvoForge a
          regular athlete never sees it. */}
      {(__DEV__ || save.settings.showDebugPanel) && (
        <NeonButton label="Developer Debug" variant="secondary" onPress={() => router.push('/forge-arena/debug')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  difficultyLabel: { ...typography.label, color: colors.textDim, letterSpacing: 1 },
  difficultyRow: { flexDirection: 'row', gap: spacing.xs },
  difficultyChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // accessibility: 44pt minimum touch target
  },
  difficultyChipSelected: { borderColor: colors.cyan, backgroundColor: colors.cyanDim },
  difficultyChipText: { ...typography.label, color: colors.textDim },
  difficultyChipTextSelected: { color: '#E0FBFF' },
});
