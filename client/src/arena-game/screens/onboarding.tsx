/**
 * First-time onboarding flow (M10) — three steps:
 *   1. Welcome + display-name entry (default kept if left as-is / blanked).
 *   2. Champion pick (same card presentation pattern as /champions).
 *   3. "How it works" primer with Start Tutorial / Skip to Lobby exits.
 * Both exits mark save.player.onboardingComplete = true; the flow is
 * re-runnable from the lobby ("Replay Onboarding").
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Body, Heading, NeonButton, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing, typography } from '../constants/theme';
import { CHAMPIONS, TICKS_PER_SECOND } from '../content';
import type { ChampionDefinition } from '../content/types';
import { playerStore } from '../services/app-services';
import {
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
} from '../services/onboarding/onboarding';
import { usePlayer } from '../services/player-data/use-player';

type Step = 0 | 1 | 2;

const STEP_TITLES: Record<Step, string> = {
  0: 'WELCOME, CHALLENGER',
  1: 'PICK YOUR CHAMPION',
  2: 'HOW IT WORKS',
};

function statsSummary(champion: ChampionDefinition): string {
  const s = champion.stats;
  const interval = (s.attackIntervalTicks / TICKS_PER_SECOND).toFixed(1);
  return `HP ${s.maxHealth} · DMG ${s.attackDamage} every ${interval}s · RNG ${s.attackRange} · SPD ${s.moveSpeedPerTick}`;
}

/** Compact champion card — the /champions presentation pattern, trimmed for
 *  a picker step (name/role/stats/ability + ultimate names). */
function ChampionPickCard({
  champion,
  selected,
  onSelect,
}: {
  champion: ChampionDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  const tint = pathColor(champion.path);
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={`${champion.name}, ${champion.role}`}
      accessibilityState={{ selected }}
      style={[styles.card, selected && { borderColor: tint, backgroundColor: colors.surfaceRaised }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardName, { color: tint }]}>{champion.name}</Text>
        {selected && <Text style={[styles.selectedBadge, { color: tint }]}>SELECTED</Text>}
      </View>
      <Text style={styles.cardRole}>{champion.role}</Text>
      <Text style={styles.cardStats}>{statsSummary(champion)}</Text>
      <Text style={styles.abilityLine}>
        <Text style={styles.abilityName}>{champion.ability.name}</Text>
        {' · '}
        <Text style={[styles.abilityName, styles.ultimateName]}>{champion.ultimate.name} (ult)</Text>
      </Text>
    </Pressable>
  );
}

function PrimerBlock({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.primerBlock}>
      <Text style={styles.primerTitle}>{title}</Text>
      <Body dim>{children}</Body>
    </View>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState(save.player.displayName);
  const [championId, setChampionId] = useState(save.player.championId);

  /** Step 1 → 2: persist the (sanitised) display name; blank keeps default. */
  const commitName = () => {
    void playerStore.getState().update((s) => ({
      ...s,
      player: {
        ...s.player,
        displayName: sanitizeDisplayName(name, s.player.displayName),
      },
    }));
    setStep(1);
  };

  /** Step 2 → 3: persist the champion choice. */
  const commitChampion = () => {
    void playerStore.getState().update((s) => ({
      ...s,
      player: { ...s.player, championId },
    }));
    setStep(2);
  };

  /** Either exit completes onboarding, then leaves the flow. */
  const finish = async (destination: '/forge-arena/tutorial' | '/forge-arena/lobby') => {
    await playerStore.getState().update((s) => ({
      ...s,
      player: { ...s.player, onboardingComplete: true },
    }));
    router.replace(destination);
  };

  return (
    <Screen>
      <View style={styles.stepHeader}>
        <Text style={styles.stepCounter}>STEP {step + 1} OF 3</Text>
        <Heading>{STEP_TITLES[step]}</Heading>
      </View>

      {step === 0 && (
        <>
          <Body dim>
            EvoForge Arena turns your training into battles. Before your first
            fight, tell the arena what to call you.
          </Body>
          <Text style={styles.inputLabel}>DISPLAY NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            placeholder="Challenger"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            accessibilityLabel="Display name"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={commitName}
          />
          <Body dim>Leave it as-is to keep the default. You can battle under any name.</Body>
          <NeonButton label="NEXT" onPress={commitName} />
        </>
      )}

      {step === 1 && (
        <>
          <Body dim>
            Your Champion anchors every battle: it fights on its own, respawns
            when it falls, and brings an ability plus a chargeable ultimate.
            You can change this any time from the lobby.
          </Body>
          {CHAMPIONS.map((champion) => (
            <ChampionPickCard
              key={champion.id}
              champion={champion}
              selected={championId === champion.id}
              onSelect={() => setChampionId(champion.id)}
            />
          ))}
          <NeonButton label="NEXT" onPress={commitChampion} />
          <NeonButton label="Back" variant="secondary" onPress={() => setStep(0)} />
        </>
      )}

      {step === 2 && (
        <>
          <PrimerBlock title="⚡ FORGE ENERGY">
            Energy refills over time and pays for every card you play — and it
            regenerates faster in the final minute. Spend it, don&apos;t hoard it.
          </PrimerBlock>
          <PrimerBlock title="⇅ TWO LANES">
            Two lanes lead to the enemy Forge Core. Tap the glowing zone at the
            bottom of a lane to deploy your selected card there. Destroy their
            core — or hold more core health at the timer — to win.
          </PrimerBlock>
          <PrimerBlock title="▤ YOUR DECK">
            You battle with an 8-card deck and hold 4 in hand. A played card
            cycles to the back of the queue and the next one takes its slot.
          </PrimerBlock>
          <PrimerBlock title="★ YOUR CHAMPION">
            Your Champion fights automatically. Trigger its ability and — once
            charged — its ultimate from the buttons above your hand.
          </PrimerBlock>
          <NeonButton label="START TUTORIAL" onPress={() => void finish('/forge-arena/tutorial')} />
          <NeonButton
            label="Skip to Lobby"
            variant="secondary"
            onPress={() => void finish('/forge-arena/lobby')}
          />
          <NeonButton label="Back" variant="secondary" onPress={() => setStep(1)} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepHeader: { gap: spacing.xs, marginTop: spacing.md },
  stepCounter: { ...typography.label, color: colors.cyan, letterSpacing: 2 },
  inputLabel: { ...typography.label, color: colors.textDim, letterSpacing: 1 },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  selectedBadge: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cardRole: { color: colors.text, fontSize: 13, fontWeight: '600' },
  cardStats: { color: colors.textDim, fontSize: 11, fontFamily: 'monospace' },
  abilityLine: { color: colors.textDim, fontSize: 12 },
  abilityName: { color: colors.cyan, fontWeight: '700' },
  ultimateName: { color: colors.warning },
  primerBlock: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  primerTitle: { ...typography.label, color: colors.text, letterSpacing: 1 },
});
