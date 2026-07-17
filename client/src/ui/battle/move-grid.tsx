import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { RECOVER_MOVE } from '@/domain/battle-rpg/moves';
import { STYLE_META, styleOfMove } from '@/domain/battle-rpg/style';
import type { BattleMove, Combatant } from '@/domain/battle-rpg/types';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playSelect } from '@/ui/core/sound';

/**
 * The 2×2 move grid + an optional battle-item row + a full-width Recover
 * fallback. A move the player can't afford (or that's on cooldown) is visibly
 * disabled with its cost shown — it can never be selected. Long-press opens
 * the description (style, priority, power).
 */
export function MoveGrid({
  moves,
  player,
  disabled,
  onSelect,
  items = [],
}: {
  moves: BattleMove[];
  player: Combatant;
  disabled: boolean;
  onSelect: (moveId: string) => void;
  /** Battle items (Phase C) — once per battle each, cost the turn. */
  items?: BattleMove[];
}) {
  const colors = useThemeColors();
  const [info, setInfo] = useState<BattleMove | null>(null);
  return (
    <View style={{ gap: 6 }}>
      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
        {moves.map((m) => (
          <MoveButton key={m.id} move={m} player={player} disabled={disabled} onSelect={onSelect} onInfo={setInfo} width="49%" />
        ))}
      </View>
      {/* Items + Recover share ONE row (one-screen layout). */}
      <View className="flex-row" style={{ gap: 6 }}>
        {items.map((m) => (
          <View key={m.id} style={{ flex: 1 }}>
            <MoveButton move={m} player={player} disabled={disabled} onSelect={onSelect} onInfo={setInfo} width="100%" recover />
          </View>
        ))}
        <View style={{ flex: 1.15 }}>
          <MoveButton move={RECOVER_MOVE} player={player} disabled={disabled} onSelect={onSelect} onInfo={setInfo} width="100%" recover />
        </View>
      </View>

      <Modal visible={info !== null} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <Pressable onPress={() => setInfo(null)} style={{ flex: 1, backgroundColor: 'rgba(2,6,14,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {info ? (
            <View className="rounded-xl border p-s4" style={{ maxWidth: 340, borderColor: `${colors.accent}59`, backgroundColor: colors.surface }}>
              <Text style={{ fontSize: 14, color: colors.accent, fontFamily: PIXEL_BOLD }}>{info.name.toUpperCase()}</Text>
              <Text style={{ marginTop: 2, fontSize: 9, color: colors['text-mute'], fontFamily: PIXEL, letterSpacing: 1 }}>
                {info.category.toUpperCase()} · {info.staminaCost} STAMINA{info.basePower > 0 ? ` · PWR ${info.basePower}` : ''}
              </Text>
              {info.basePower > 0 || info.priority > 0 ? (
                <Text style={{ marginTop: 3, fontSize: 9, fontFamily: PIXEL, letterSpacing: 1 }}>
                  {info.basePower > 0 ? (
                    <Text style={{ color: STYLE_META[styleOfMove(info)].color }}>
                      {STYLE_META[styleOfMove(info)].icon} {STYLE_META[styleOfMove(info)].label}
                    </Text>
                  ) : null}
                  {info.basePower > 0 && info.priority > 0 ? <Text style={{ color: colors['text-mute'] }}> · </Text> : null}
                  {info.priority > 0 ? <Text style={{ color: colors.legendary }}>⚑ FIRST STRIKE +{info.priority}</Text> : null}
                </Text>
              ) : null}
              <Text style={{ marginTop: 8, fontSize: 13, color: colors.text, lineHeight: 18 }}>{info.description}</Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function MoveButton({
  move,
  player,
  disabled,
  onSelect,
  onInfo,
  width,
  recover = false,
}: {
  move: BattleMove;
  player: Combatant;
  disabled: boolean;
  onSelect: (id: string) => void;
  onInfo: (m: BattleMove) => void;
  width: '48%' | '49%' | '100%';
  recover?: boolean;
}) {
  const colors = useThemeColors();
  const cooling = (player.cooldowns[move.id] ?? 0) > 0;
  const affordable = move.staminaCost <= player.stats.currentStamina;
  const usable = !disabled && affordable && !cooling;
  const tint = (colors as Record<string, string>)[move.theme] ?? colors.accent;
  return (
    <Pressable
      onPress={() => {
        if (!usable) return;
        playSelect();
        onSelect(move.id);
      }}
      onLongPress={() => onInfo(move)}
      delayLongPress={220}
      disabled={!usable}
      accessibilityRole="button"
      accessibilityLabel={`${move.name}, ${move.staminaCost} stamina${usable ? '' : cooling ? `, cooling down ${player.cooldowns[move.id]} turns` : ', not enough stamina'}`}
      testID={`move-${move.id}`}
      style={{
        width,
        minHeight: recover ? 40 : 52,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: usable ? `${tint}8c` : 'rgba(120,170,220,0.14)',
        backgroundColor: usable ? `${tint}14` : 'rgba(13,21,36,0.5)',
        paddingHorizontal: 9,
        paddingVertical: 6,
        opacity: usable ? 1 : 0.5,
        justifyContent: 'center',
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 11, color: usable ? tint : colors['text-mute'], fontFamily: PIXEL_BOLD, flexShrink: 1 }}>
          {move.name.toUpperCase()}
        </Text>
        {move.staminaCost > 0 ? (
          <Text allowFontScaling={false} style={{ fontSize: 8, color: affordable ? colors.accent : colors.danger, fontFamily: PIXEL }}>
            ⚡{move.staminaCost}
          </Text>
        ) : (
          <Text allowFontScaling={false} style={{ fontSize: 8, color: colors.success, fontFamily: PIXEL }}>FREE</Text>
        )}
      </View>
      <View className="flex-row items-center justify-between" style={{ marginTop: 2 }}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 7.5, color: colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5, flexShrink: 1 }}>
          {cooling
            ? move.isItem
              ? 'USED'
              : `COOLDOWN ${player.cooldowns[move.id]}`
            : move.isItem
              ? 'ITEM · 1×'
              : recover
                ? 'RESTORE STAMINA'
                : `${move.basePower > 0 ? `${STYLE_META[styleOfMove(move)].icon} ` : ''}${move.category.toUpperCase()}${move.priority > 0 ? ' · ⚑FIRST' : ''}`}
        </Text>
        {!recover && !cooling && move.basePower > 0 ? (
          <Text allowFontScaling={false} style={{ fontSize: 8, color: usable ? tint : colors['text-mute'], fontFamily: PIXEL_BOLD }}>
            {'⚔'} {move.basePower}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
