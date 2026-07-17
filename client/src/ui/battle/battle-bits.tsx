import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { STATUS_META } from '@/domain/battle-rpg/status';
import type { BattleStatus, Combatant } from '@/domain/battle-rpg/types';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playHeartbeat } from '@/ui/core/sound';

/** A labelled combat bar (health / stamina) that eases to its value.
 *  `stages` (HP bars) recolours FireRed-style — >50% green, 20–50% amber,
 *  <20% red with a pulse + a soft heartbeat on each hit while red. */
export function CombatBar({
  value,
  max,
  colour,
  label,
  height = 10,
  stages = false,
}: {
  value: number;
  max: number;
  colour: string;
  label: string;
  height?: number;
  stages?: boolean;
}) {
  const colors = useThemeColors();
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const w = useSharedValue(pct);
  const ghost = useSharedValue(pct); // trailing bar — catches up slowly on loss
  const pulse = useSharedValue(1);
  const critical = stages && pct > 0 && pct < 20;
  useEffect(() => {
    w.value = withTiming(pct, { duration: 260, easing: Easing.out(Easing.quad) });
    // On a loss the ghost lingers (the classic RPG "damage trail"); on a gain
    // it snaps ahead so the green fill leads.
    ghost.value = withTiming(pct, { duration: 620, easing: Easing.out(Easing.cubic) });
  }, [pct, w, ghost]);
  useEffect(() => {
    if (critical) {
      pulse.value = withRepeat(withSequence(withTiming(0.55, { duration: 420 }), withTiming(1, { duration: 420 })), -1);
      playHeartbeat();
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
    // Re-thump on every HP change while critical, not just on entry.
  }, [critical, pct, pulse]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value}%`, opacity: pulse.value }));
  const ghostStyle = useAnimatedStyle(() => ({ width: `${Math.max(w.value, ghost.value)}%` }));
  const low = pct <= 25;
  const stageColour = !stages ? colour : pct > 50 ? colors.success : pct > 20 ? colors.legendary : colors.danger;
  const barColour = stages ? stageColour : low ? colors.danger : colour;
  return (
    <View>
      <View className="flex-row items-center justify-between" style={{ marginBottom: 2 }}>
        <Text allowFontScaling={false} style={{ fontSize: 8, color: colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
          {label}
        </Text>
        <Text allowFontScaling={false} style={{ fontSize: 9, color: stages ? stageColour : low ? colors.danger : colour, fontFamily: PIXEL_BOLD }}>
          {Math.round(value)}/{Math.round(max)}
        </Text>
      </View>
      <View style={{ height, borderRadius: height, backgroundColor: 'rgba(120,170,220,0.12)', overflow: 'hidden' }}>
        {/* Ghost trail (whitened) sits behind the real fill. */}
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: height, backgroundColor: 'rgba(255,255,255,0.5)' }, ghostStyle]} />
        <Animated.View style={[{ height, borderRadius: height, backgroundColor: barColour, shadowColor: barColour, shadowOpacity: 0.6, shadowRadius: 6 }, fill]} />
      </View>
    </View>
  );
}

/** The row of active status chips with remaining turns. */
export function StatusRow({ statuses }: { statuses: BattleStatus[] }) {
  if (statuses.length === 0) return <View style={{ height: 16 }} />;
  return (
    <View className="flex-row flex-wrap" style={{ gap: 4, minHeight: 16 }}>
      {statuses.map((s) => (
        <StatusChip key={s.kind} status={s} />
      ))}
    </View>
  );
}

function StatusChip({ status }: { status: BattleStatus }) {
  const colors = useThemeColors();
  const meta = STATUS_META[status.kind];
  const tint = meta.good ? colors.success : colors.danger;
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withSequence(withTiming(1.08, { duration: 260 }), withTiming(1, { duration: 260 }));
  }, [status.turnsLeft, pulse]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 6, borderWidth: 1, borderColor: `${tint}66`, backgroundColor: `${tint}1a`, paddingHorizontal: 4, paddingVertical: 1 }, style]}
      accessibilityLabel={`${meta.label}, ${status.turnsLeft} turns left`}
    >
      <Text style={{ fontSize: 9 }}>{meta.icon}</Text>
      <Text allowFontScaling={false} style={{ fontSize: 7.5, color: tint, fontFamily: PIXEL_BOLD }}>
        {meta.label.toUpperCase()} {status.turnsLeft}
      </Text>
    </Animated.View>
  );
}

/** A combatant's HUD panel — name, champion, bars, statuses. */
export function CombatantHud({ combatant, powerLabel, align = 'left' }: { combatant: Combatant; powerLabel?: number; align?: 'left' | 'right' }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-xl border p-s2"
      style={{ borderColor: `${colors.accent}33`, backgroundColor: 'rgba(10,16,30,0.78)' }}
    >
      <View className={`flex-row items-center justify-between`}>
        <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 11, color: colors.text, fontFamily: PIXEL_BOLD, flexShrink: 1 }}>
          {combatant.name.toUpperCase()}
        </Text>
        {powerLabel != null ? (
          <Text allowFontScaling={false} style={{ fontSize: 8, color: colors['text-mute'], fontFamily: PIXEL }}>
            CP {powerLabel}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: 4, marginTop: 4 }}>
        <CombatBar label="HP" value={combatant.stats.currentHealth} max={combatant.stats.maxHealth} colour={colors.success} stages />
        <CombatBar label="STAMINA" value={combatant.stats.currentStamina} max={combatant.stats.maxStamina} colour={colors.accent} height={6} />
      </View>
      <View style={{ marginTop: 4 }}>
        <StatusRow statuses={combatant.statuses} />
      </View>
    </View>
  );
}

/** A floating damage/heal number over a sprite. */
export function FloatingNumber({ amount, kind, trigger }: { amount: number; kind: 'damage' | 'crit' | 'heal'; trigger: number }) {
  const colors = useThemeColors();
  const y = useSharedValue(0);
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 700 }));
    y.value = withSequence(withTiming(0, { duration: 1 }), withTiming(-42, { duration: 780, easing: Easing.out(Easing.quad) }));
  }, [trigger, y, op]);
  const style = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: y.value }] }));
  const colour = kind === 'heal' ? colors.success : kind === 'crit' ? colors.legendary : colors.danger;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, alignSelf: 'center' }, style]}>
      <Text allowFontScaling={false} style={{ fontSize: kind === 'crit' ? 26 : 20, color: colour, fontFamily: PIXEL_BOLD, textShadowColor: '#000', textShadowRadius: 4 }}>
        {kind === 'heal' ? '+' : '-'}{amount}{kind === 'crit' ? '!' : ''}
      </Text>
    </Animated.View>
  );
}
