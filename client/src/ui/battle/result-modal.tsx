import { Modal, Text, View } from 'react-native';

import type { BattleRewards, BattleState } from '@/domain/battle-rpg/types';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';

/**
 * VICTORY / DEFEAT — a summary the player can act on. Never shames a loss;
 * defeat carries a tactical tip and easy paths (Train / Rematch / Arena).
 */
export function BattleResultModal({
  visible,
  state,
  rewards,
  opponentName,
  versus = false,
  tip,
  onRematch,
  onArena,
  onTrain,
}: {
  visible: boolean;
  state: BattleState;
  rewards: BattleRewards | null;
  opponentName: string;
  versus?: boolean;
  tip: string;
  onRematch: () => void;
  onArena: () => void;
  onTrain: () => void;
}) {
  const won = state.winner === 'player';
  // Versus is P1 vs P2 — the winner is a player, not "you".
  const accent = versus ? (won ? tokens.colors.accent : tokens.colors.danger) : won ? tokens.colors.success : tokens.colors.danger;
  const heading = versus ? (won ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS') : won ? 'VICTORY' : 'DEFEAT';
  const subheading = versus
    ? 'A GOOD DUEL — RUN IT BACK?'
    : won
      ? `${opponentName.toUpperCase()} WAS DEFEATED`
      : `${opponentName.toUpperCase()} STANDS`;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(2,6,14,0.86)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View className="w-full rounded-xl border p-s5" style={{ maxWidth: 380, borderColor: `${accent}66`, backgroundColor: tokens.colors.surface, shadowColor: accent, shadowOpacity: 0.4, shadowRadius: 24 }}>
          <Text style={{ fontSize: 34, textAlign: 'center', color: accent, textShadowColor: `${accent}88`, textShadowRadius: 18, ...pixelFont() }}>
            {heading}
          </Text>
          <Text style={{ textAlign: 'center', marginTop: 2, fontSize: 10, color: tokens.colors['text-mute'], fontFamily: PIXEL, letterSpacing: 1 }}>
            {subheading}
          </Text>

          <View style={{ marginTop: 14, gap: 6 }}>
            <SummaryRow label="Turns" value={`${state.turnNumber}`} />
            <SummaryRow label="Damage dealt" value={`${state.stats.playerDamage}`} />
            <SummaryRow label="Critical hits" value={`${state.stats.crits}`} />
            <SummaryRow label="HP remaining" value={`${Math.max(0, Math.round(state.player.stats.currentHealth))}/${state.player.stats.maxHealth}`} />
          </View>

          {rewards && !versus ? <RewardStrip rewards={rewards} /> : null}

          {!won && !versus ? (
            <View className="mt-s3 rounded-lg border p-s3" style={{ borderColor: `${tokens.colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.06)' }}>
              <Text style={{ fontSize: 9, color: tokens.colors.accent, fontFamily: PIXEL, letterSpacing: 1 }}>TACTICAL TIP</Text>
              <Text style={{ marginTop: 3, fontSize: 13, color: tokens.colors.text, lineHeight: 18 }}>{tip}</Text>
            </View>
          ) : null}

          <View style={{ marginTop: 16, gap: 8 }}>
            <NeonButton title="REMATCH" onPress={onRematch} pixel testID="result-rematch" />
            <View className="flex-row" style={{ gap: 8 }}>
              {!won && !versus ? (
                <View style={{ flex: 1 }}>
                  <NeonButton title="TRAIN" variant="ghost" onPress={onTrain} pixel testID="result-train" />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <NeonButton title="ARENA" variant="ghost" onPress={onArena} pixel testID="result-arena" />
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text style={{ fontSize: 12, color: tokens.colors['text-mute'] }}>{label}</Text>
      <Text style={{ fontSize: 13, color: tokens.colors.text, fontFamily: PIXEL_BOLD }}>{value}</Text>
    </View>
  );
}

function RewardStrip({ rewards }: { rewards: BattleRewards }) {
  const nothing = rewards.coins === 0 && rewards.forgeXp === 0 && !rewards.badgeId;
  return (
    <View className="mt-s3 rounded-lg border p-s3" style={{ borderColor: `${tokens.colors.legendary}45`, backgroundColor: 'rgba(251,191,36,0.06)' }}>
      <Text style={{ fontSize: 9, color: tokens.colors.legendary, fontFamily: PIXEL, letterSpacing: 1 }}>REWARDS</Text>
      {nothing ? (
        <Text style={{ marginTop: 3, fontSize: 12, color: tokens.colors['text-mute'] }}>No rewards this time — train mode is practice.</Text>
      ) : (
        <View className="mt-s1 flex-row flex-wrap items-center" style={{ gap: 12 }}>
          {rewards.coins > 0 ? (
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <CoinIcon size={13} />
              <Text style={{ fontSize: 13, color: tokens.colors.legendary, fontFamily: PIXEL_BOLD }}>+{rewards.coins}</Text>
            </View>
          ) : null}
          {rewards.forgeXp > 0 ? (
            <Text style={{ fontSize: 13, color: tokens.colors.accent, fontFamily: PIXEL_BOLD }}>+{rewards.forgeXp} FORGE XP</Text>
          ) : null}
          {rewards.badgeId ? (
            <Text style={{ fontSize: 12, color: tokens.colors.success, fontFamily: PIXEL_BOLD }}>🎖 BADGE EARNED</Text>
          ) : null}
          {rewards.firstClear ? (
            <Text style={{ fontSize: 10, color: tokens.colors.legendary, fontFamily: PIXEL }}>FIRST-CLEAR BONUS</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
