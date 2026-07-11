import { Text, View } from 'react-native';

import { COIN_LABELS, useCoinHistory, useCoinTotal } from '@/data/coins';
import tokens from '@/theme/tokens';
import { ScreenHeader } from '@/ui/screen-header';
import { ScreenShell } from '@/ui/shell';

/** IMPROVEMENT_PLAN #12: the transaction history. The balance renders "—"
 *  on any read failure — a failure shown as 0 reads as a wiped wallet. */
export default function CoinsScreen() {
  const total = useCoinTotal();
  const history = useCoinHistory();

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="THE VAULT"
        title="COINS"
        right={
          <Text
            className="text-3xl font-bold"
            style={{ color: tokens.colors.legendary, textShadowColor: 'rgba(251,191,36,0.5)', textShadowRadius: 14 }}
            testID="coin-balance"
          >
            {total.data === null || total.data === undefined ? '—' : total.data}
          </Text>
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
              <Text className="text-xs font-bold text-text">{COIN_LABELS[e.kind] ?? e.kind}</Text>
              <Text className="text-2xs text-text-mute">
                {String(e.created_at).slice(0, 10)}
                {e.source_id && e.kind === 'streak_milestone' ? ` · ${e.source_id.split(':')[0]}-day streak` : ''}
              </Text>
            </View>
            <Text
              className="text-sm font-bold"
              style={{ color: e.amount > 0 ? tokens.colors.legendary : tokens.colors.danger }}
            >
              {e.amount > 0 ? `+${e.amount}` : e.amount}
            </Text>
          </View>
        ))
      )}
    </ScreenShell>
  );
}
