/**
 * P9 battle intro — the pre-fight ceremony: opponent line, the two
 * champions facing off, then a 3-2-1-FIGHT countdown. The sim is frozen
 * underneath via the store's intro hold (ticks delayed, never skipped), so
 * the player can even pre-select a card during the countdown. Purely
 * elapsed-driven like every other ceremony here: the caller owns the clock
 * and the bounded re-render interval; under reduced motion the numeral pops
 * are suppressed (the count itself still steps — it is information, not
 * decoration).
 */
import React from 'react';
import { Image, type ImageStyle, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, pathColor, radius, spacing, typography } from '../../../constants/theme';
import { getChampionById } from '../../../content';
import { championSprite } from './sprites';

const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

/** Countdown pacing: three beats, then the FIGHT flash. */
export const INTRO_BEAT_MS = 650;
export const INTRO_FIGHT_MS = 500;
export const INTRO_TOTAL_MS = INTRO_BEAT_MS * 3 + INTRO_FIGHT_MS;

interface Props {
  elapsedMs: number;
  playerChampionId: string | null;
  opponentChampionId: string | null;
  /** Who this is against — difficulty label, gym name, or ghost line. */
  opponentLabel: string;
  reduceMotion: boolean;
}

function ChampionPlate({
  championId,
  team,
}: {
  championId: string | null;
  team: 'player' | 'opponent';
}) {
  const champion = championId ? getChampionById(championId) : undefined;
  const sprite = champion ? championSprite(champion.art, team) : null;
  const teamTint = team === 'player' ? colors.player : colors.opponent;
  return (
    <View style={styles.plate}>
      <View style={[styles.plateFrame, { borderColor: teamTint }]}>
        {sprite ? (
          <Image source={sprite} style={[styles.plateSprite, PIXELATED]} fadeDuration={0} />
        ) : (
          <Text style={[styles.plateFallback, { color: teamTint }]}>?</Text>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[styles.plateName, { color: champion ? pathColor(champion.path) : teamTint }]}
      >
        {champion?.name ?? 'Unknown'}
      </Text>
    </View>
  );
}

export function BattleIntro({
  elapsedMs,
  playerChampionId,
  opponentChampionId,
  opponentLabel,
  reduceMotion,
}: Props) {
  const inFight = elapsedMs >= INTRO_BEAT_MS * 3;
  const beat = inFight ? 3 : Math.max(0, Math.floor(elapsedMs / INTRO_BEAT_MS));
  const label = inFight ? 'FIGHT!' : String(3 - beat);
  // Per-beat pop: each numeral lands big and settles.
  const beatT = inFight
    ? Math.min(1, (elapsedMs - INTRO_BEAT_MS * 3) / (INTRO_FIGHT_MS * 0.5))
    : Math.min(1, (elapsedMs - beat * INTRO_BEAT_MS) / (INTRO_BEAT_MS * 0.4));
  const pop = reduceMotion ? 1 : 1.6 - 0.6 * (1 - (1 - beatT) * (1 - beatT));
  const countdownColor = inFight ? colors.cyan : colors.text;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Text style={styles.opponentLine}>{opponentLabel.toUpperCase()}</Text>
      <View style={styles.matchup}>
        <ChampionPlate championId={playerChampionId} team="player" />
        <Text style={styles.vs}>VS</Text>
        <ChampionPlate championId={opponentChampionId} team="opponent" />
      </View>
      <Text
        style={[
          styles.countdown,
          { color: countdownColor, transform: [{ scale: pop }] },
          inFight && styles.fight,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 11, 18, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  opponentLine: { ...typography.label, color: colors.textDim, letterSpacing: 2 },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  plate: { alignItems: 'center', gap: spacing.xs, width: 110 },
  plateFrame: {
    width: 84,
    height: 84,
    borderWidth: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateSprite: { width: 72, height: 72 },
  plateFallback: { ...typography.pixelBold, fontSize: 40 },
  plateName: { ...typography.label, textAlign: 'center' },
  vs: { ...typography.pixelBold, fontSize: 26, color: colors.textDim, letterSpacing: 2 },
  countdown: {
    ...typography.pixelBold,
    fontSize: 72,
    letterSpacing: 4,
    textShadowColor: 'rgba(34, 211, 238, 0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  fight: { letterSpacing: 6 },
});
