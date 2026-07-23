/**
 * Horizontal Forge Core health bar — used for both the opponent core (top of
 * the arena) and the player core (bottom). The fortress sprite (Kenney 1-bit,
 * team-tinted) gives the core a physical identity.
 */
import React from 'react';
import { Image, type ImageStyle, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../../constants/theme';
import type { CoreState } from '../../../game-engine/simulation/state';
import { healthBarColor } from './readability';
import { coreSprite } from './sprites';

/** Nearest-neighbour rendering on web (see lane-strip.tsx). */
const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

/** Below this health fraction the core art swaps to its cracked variant —
 *  a persistent damage state on top of the transient hit shake/flash. */
const DAMAGED_ART_FRACTION = 0.5;

/**
 * Core hit feedback (P6) — the caller (arena-screen.tsx) derives this fresh
 * every ~50ms frame from consecutive core-health snapshots (see
 * combat-fx.ts's deriveCoreHitIntensity) and passes down a plain `ageFrac`
 * (0 = just hit, 1 = fully faded), the same age-based-not-Animated pattern
 * every other combat-feel effect in this package uses. `severe` (core below
 * 25% max health) shakes/flashes harder — a Forge Core on the brink should
 * read differently from a glancing hit.
 */
export interface CoreHitFlash {
  ageFrac: number;
  severe: boolean;
}

/** Core hit feedback lifetime, in ms — the arena screen ages `ageFrac` against this. */
export const CORE_HIT_TTL_MS = 220;

interface Props {
  core: CoreState;
  label: string;
  /** Omit (or ageFrac >= 1) for no active hit feedback. */
  hit?: CoreHitFlash;
}

export function CoreBar({ core, label, hit }: Props) {
  const pct = Math.max(0, Math.min(1, core.health / core.maxHealth));
  const tint = core.team === 'player' ? colors.player : colors.opponent;

  const hitActive = !!hit && hit.ageFrac < 1;
  // Decaying shake: a couple of oscillations that die out as ageFrac -> 1.
  // Derived purely from ageFrac each render — no Animated value, no loop.
  const shakeX = hitActive
    ? Math.sin(hit!.ageFrac * Math.PI * 3) * (1 - hit!.ageFrac) * (hit!.severe ? 5 : 2.5)
    : 0;
  const flashOpacity = hitActive ? (1 - hit!.ageFrac) * (hit!.severe ? 0.55 : 0.3) : 0;

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={`${label}: ${Math.max(0, Math.round(core.health))} of ${core.maxHealth} health`}
    >
      <View style={[styles.spriteClip, { transform: [{ translateX: shakeX }] }]}>
        <Image
          source={coreSprite(core.team, pct < DAMAGED_ART_FRACTION)}
          style={[styles.sprite, PIXELATED, pct <= 0 && styles.destroyed]}
          fadeDuration={0}
        />
        {flashOpacity > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.hitFlash,
              { opacity: flashOpacity, backgroundColor: hit!.severe ? colors.danger : '#FFFFFF' },
            ]}
          />
        )}
      </View>
      <View style={styles.bars}>
        <View style={styles.headerRow}>
          <Text style={[styles.label, { color: tint }]}>{label}</Text>
          <Text style={styles.health}>
            {Math.max(0, Math.round(core.health))} / {core.maxHealth}
          </Text>
        </View>
        <View style={styles.track}>
          {/* P7: low-health emphasis — same threshold/amber as every other
              health bar in the arena (see readability.ts's healthBarColor)
              so a core on the brink reads as "danger" before the hit-shake
              severity threshold (25%) even kicks in. */}
          <View
            style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: healthBarColor(pct, tint, colors.warning) }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  spriteClip: { position: 'relative' },
  sprite: { width: 44, height: 44 },
  destroyed: { opacity: 0.25 },
  hitFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 4,
  },
  bars: { flex: 1, gap: spacing.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { ...typography.label },
  health: { ...typography.mono, color: colors.textDim },
  track: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
});
