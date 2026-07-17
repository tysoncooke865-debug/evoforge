import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import type { BattleMatch } from '@/data/battle/hooks';
import { formatGlyph, formatLabel } from '@/domain/battle/format';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { IconBadge, PressCard } from '@/ui/arena/battle-arena';

/** One finished (or in-flight) match, glowing the way it ended — extracted
 *  from the Arena hub so the GAME LOG page renders the identical row. */
export function HistoryRow({ match, xp }: { match: BattleMatch; xp: number | null }) {
  const colors = useThemeColors();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const settled = match.status === 'settled';
  const abandoned = match.status === 'abandoned';
  const won = settled && match.winner_user_id !== null && match.winner_user_id === userId;
  const draw = settled && match.winner_user_id === null;
  const tint = abandoned
    ? colors['text-mute']
    : !settled
      ? colors.accent
      : won
        ? colors.success
        : draw
          ? colors.rare
          : colors.danger;
  const label = abandoned ? 'CANCELLED' : !settled ? match.status.toUpperCase() : won ? 'VICTORY' : draw ? 'DRAW' : 'DEFEAT';

  return (
    <View className="mb-s2">
      <PressCard onPress={() => router.push(`/arena/battle/${match.id}`)} tint={tint} testID={`history-${match.id}`}>
        <View
          className="flex-row items-center gap-s3 rounded-xl p-s3"
          style={{
            borderWidth: 1,
            borderColor: `${tint}40`,
            backgroundColor: 'rgba(13,21,36,0.55)',
            shadowColor: settled ? tint : '#000',
            shadowOpacity: settled ? 0.22 : 0,
            shadowRadius: 14,
            elevation: settled ? 3 : 0,
          }}
        >
          <IconBadge glyph={formatGlyph(match.format)} tint={tint} size={40} />
          <View className="flex-1">
            {/* Every row used to say "Friendly Blitz" — a duel lied about
                what it was. The format decides its own name now. */}
            <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
              {formatLabel(match.format)}
              {match.invite_code ? ` · ${match.invite_code}` : ''}
            </Text>
            <Text className="text-2xs text-text-mute">{String(match.created_at).slice(0, 10)}</Text>
          </View>
          <View className="items-end">
            <Text
              allowFontScaling={false}
              style={{ fontSize: 12, color: tint, letterSpacing: 1, ...pixelFont() }}
            >
              {label}
            </Text>
            {settled && xp ? (
              <Text className="text-text-dim" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>
                +{xp} XP
              </Text>
            ) : null}
          </View>
        </View>
      </PressCard>
    </View>
  );
}
