/**
 * Tutorial step sequencer (M6). A small overlay panel that walks a new
 * player through their first battle. Steps advance when the MATCHING player
 * action appears in the live battle's command log (the same record replays
 * verify against, so "did the player actually do it" is authoritative):
 *
 *   1. deploy a fighter  → first player 'deploy-card'
 *   2. play a technique  → first player 'play-card'
 *   3. champion ability  → first player 'champion-ability'
 *   4. champion ultimate → first player 'champion-ultimate'
 *   5. win condition explained → dismissed by the player
 *
 * Skippable at any time. Pure display + derivation — no gameplay logic, no
 * per-frame React state churn (step is derived from the log each render).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import type { ScheduledCommand } from '../../../game-engine/simulation/events';

interface Props {
  /** The live battle's command log (player + AI commands). */
  commandLog: readonly ScheduledCommand[];
  /** Dismiss the overlay (skip or finish). */
  onClose: () => void;
}

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'STEP 1 · DEPLOY A FIGHTER',
    body: 'Tap a fighter card in your hand, then tap the glowing zone at the bottom of a lane to deploy it. Fighters march at the enemy Forge Core on their own.',
  },
  {
    title: 'STEP 2 · PLAY A TECHNIQUE',
    body: 'Cards marked ⚡ or ⚙ are techniques and equipment. Select one, then tap a lane — it automatically hits a sensible target (wounded allies for heals, the closest threat for attacks).',
  },
  {
    title: 'STEP 3 · CHAMPION ABILITY',
    body: 'Your Champion fights automatically. Press its ability button (above your hand) when it lights up to trigger its signature move.',
  },
  {
    title: 'STEP 4 · UNLEASH THE ULTIMATE',
    body: 'Dealing and taking damage charges your ultimate. When the button reads UNLEASH, press it for a battle-turning effect.',
  },
  {
    title: 'HOW TO WIN',
    body: 'Destroy the enemy Forge Core, or have the healthier core when time runs out. Mid-battle you will be offered an Augment — pick one, it is free. Good luck!',
  },
];

/** Index of the current tutorial step, derived from performed player actions. */
export function tutorialStepIndex(commandLog: readonly ScheduledCommand[]): number {
  let deployed = false;
  let played = false;
  let ability = false;
  let ultimate = false;
  for (const { command } of commandLog) {
    if (command.team !== 'player') continue;
    if (command.type === 'deploy-card') deployed = true;
    else if (command.type === 'play-card') played = true;
    else if (command.type === 'champion-ability') ability = true;
    else if (command.type === 'champion-ultimate') ultimate = true;
  }
  if (!deployed) return 0;
  if (!played) return 1;
  if (!ability) return 2;
  if (!ultimate) return 3;
  return 4;
}

export function TutorialOverlay({ commandLog, onClose }: Props) {
  const step = tutorialStepIndex(commandLog);
  const { title, body } = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.progress}>
            {step + 1}/{STEPS.length}
          </Text>
        </View>
        <Text style={styles.body}>{body}</Text>
        <Pressable onPress={onClose} hitSlop={8} style={styles.actionButton}>
          <Text style={styles.actionText}>{last ? 'GOT IT — FIGHT!' : 'Skip tutorial'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 96,
    left: spacing.sm,
    right: spacing.sm,
    alignItems: 'center',
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(13, 20, 32, 0.94)',
    borderColor: colors.cyan,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.label, color: colors.cyan, letterSpacing: 0.5, flexShrink: 1 },
  progress: { ...typography.mono, color: colors.textFaint },
  body: { ...typography.body, color: colors.text, fontSize: 13, lineHeight: 18 },
  actionButton: { alignSelf: 'flex-end', paddingVertical: 2 },
  actionText: { ...typography.label, color: colors.warning },
});
