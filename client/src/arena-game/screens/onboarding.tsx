/**
 * First-time onboarding flow (M10, reworked P11 for the integrated Arena) —
 * two steps:
 *   1. Champion pick (same card presentation pattern as /champions). The
 *      pick is prefilled from the athlete's EvoForge Origin (synced into the
 *      save at boot by applyProviderIdentity) — switching is free.
 *   2. "How it works" primer: the core loop in three short blocks (deploy
 *      cards / command your champion / destroy the Forge Core), plus the
 *      first-battle note that battles start on the Training AI tier.
 *      Exits: Start Tutorial / Skip to Lobby.
 *
 * There is NO display-name step (audit #9): the Arena battles under the
 * athlete's EvoForge profile name. Both exits mark
 * save.player.onboardingComplete = true; the flow is re-runnable from the
 * lobby ("Replay Onboarding").
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Heading, NeonButton, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing, typography } from '../constants/theme';
import { CHAMPIONS, TICKS_PER_SECOND } from '../content';
import type { ChampionDefinition } from '../content/types';
import { playerStore } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

type Step = 0 | 1;

const STEP_TITLES: Record<Step, string> = {
  0: 'PICK YOUR CHAMPION',
  1: 'HOW IT WORKS',
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
  const [championId, setChampionId] = useState(save.player.championId);

  /** Step 1 → 2: persist the champion choice. */
  const commitChampion = () => {
    void playerStore.getState().update((s) => ({
      ...s,
      player: { ...s.player, championId },
    }));
    setStep(1);
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
        <Text style={styles.stepCounter}>STEP {step + 1} OF 2</Text>
        <Heading>{STEP_TITLES[step]}</Heading>
      </View>

      {step === 0 && (
        <>
          <Body dim>
            Welcome, {save.player.displayName} — the Arena turns your training
            into battles. Your Champion anchors every one: it fights on its
            own, respawns when it falls, and brings an ability plus a
            chargeable ultimate. Your EvoForge Origin pre-selects one, but the
            pick is yours — change it any time from the lobby.
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
        </>
      )}

      {step === 1 && (
        <>
          <PrimerBlock title="▤ DEPLOY CARDS">
            Forge Energy refills over time and pays for every card. Tap a card
            in your hand, then tap the glowing zone at the bottom of a lane to
            deploy it there.
          </PrimerBlock>
          <PrimerBlock title="★ COMMAND YOUR CHAMPION">
            Your Champion fights automatically — trigger its ability and, once
            charged, its ultimate from the buttons above your hand. Your real
            EvoForge ratings shape its stats (capped, never decisive).
          </PrimerBlock>
          <PrimerBlock title="◎ DESTROY THE FORGE CORE">
            Two lanes lead to the enemy Forge Core. Destroy it — or hold more
            core health when the timer runs out — and the battle is yours.
          </PrimerBlock>
          <Body dim>
            Your first battles face the Training AI. Harder tiers unlock in
            the lobby after your first win.
          </Body>
          <NeonButton label="START TUTORIAL" onPress={() => void finish('/forge-arena/tutorial')} />
          <NeonButton
            label="Skip to Lobby"
            variant="secondary"
            onPress={() => void finish('/forge-arena/lobby')}
          />
          <NeonButton label="Back" variant="secondary" onPress={() => setStep(0)} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepHeader: { gap: spacing.xs, marginTop: spacing.md },
  stepCounter: { ...typography.label, color: colors.cyan, letterSpacing: 2 },
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
