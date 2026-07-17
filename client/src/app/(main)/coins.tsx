import { Text, View } from 'react-native';

import { COIN_LABELS, useCoinHistory, useCoinTotal } from '@/data/coins';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/** IMPROVEMENT_PLAN #12: the transaction history. The balance renders "—"
 *  on any read failure — a failure shown as 0 reads as a wiped wallet. */
export default function CoinsScreen() {
  const colors = useThemeColors();
  const total = useCoinTotal();
  const history = useCoinHistory();

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="THE VAULT"
        title="COINS"
        right={
          <View className="flex-row items-center gap-s2">
            <CoinIcon size={40} />
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 30,
                lineHeight: 36,
                color: colors.legendary,
                textShadowColor: 'rgba(251,191,36,0.5)',
                textShadowRadius: 14,
                ...pixelFont(),
              }}
              testID="coin-balance"
            >
              {total.data === null || total.data === undefined ? '—' : total.data}
            </Text>
          </View>
        }
      />
      <Text className="text-2xs text-text-mute">
        Every coin is server-verified: workout complete +25, PR +50, streak milestones 10× the
        milestone, plus the 100-coin starting bonus. Spending arrives with the shop.
      </Text>
      {(history.data ?? []).length === 0 ? (
        <Text className="text-center text-2xs text-text-mute">Nothing banked yet — go train.</Text>
      ) : (
        (history.data ?? []).map((e) => (
          <View
            key={e.id}
            className="flex-row items-center justify-between rounded-md border border-border p-s3"
            style={{ backgroundColor: 'rgba(8,14,26,0.55)' }}
          >
            <View className="flex-1">
              <Text className="text-text" allowFontScaling={false} style={{ fontSize: 13, ...pixelFont() }}>
                {COIN_LABELS[e.kind] ?? e.kind}
              </Text>
              <Text className="text-2xs text-text-mute">
                {String(e.created_at).slice(0, 10)}
                {e.source_id && e.kind === 'streak_milestone' ? ` · ${e.source_id.split(':')[0]}-day streak` : ''}
              </Text>
            </View>
            <View className="flex-row items-center gap-s1">
              <CoinIcon size={16} />
              <Text
                allowFontScaling={false}
                style={{ fontSize: 14, color: e.amount > 0 ? colors.legendary : colors.danger, ...pixelFont() }}
              >
                {e.amount > 0 ? `+${e.amount}` : e.amount}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScreenShell>
  );
}
