import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { useMyBattles, useMyBattleScores } from '@/data/battle/hooks';
import { newestFirst } from '@/domain/battle/format';
import { HistoryRow } from '@/ui/arena/history-row';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/**
 * GAME LOG — every arena match on record, newest first, in the hub's own
 * row style (the hub itself shows only the last five). Live and inviting
 * matches render too: HistoryRow labels them by status, so the log doubles
 * as the complete record, not just the finished one.
 *
 * NOTE: useMyBattles caps the query at the newest 50 rows — "every match"
 * means those 50 until an athlete actually outgrows it.
 */
export default function GameLogScreen() {
  const router = useRouter();
  const battles = useMyBattles();
  const results = useMyBattleScores();
  const rows = newestFirst(battles.data ?? []);

  return (
    <ScreenShell>
      <ScreenHeader kicker="EVERY MATCH ON RECORD" title="GAME LOG" onBack={() => router.replace('/arena' as never)} />
      {rows.length === 0 ? (
        <View className="items-center py-s5" style={{ gap: 12 }}>
          <Text className="text-center text-2xs text-text-mute">
            No battles yet. Find a live opponent and start your record.
          </Text>
          <View style={{ width: '100%', maxWidth: 280 }}>
            <NeonButton title="⚔ FIND A DUEL" onPress={() => router.replace('/arena' as never)} testID="game-log-cta" />
          </View>
        </View>
      ) : (
        rows.map((m) => <HistoryRow key={m.id} match={m} xp={results.data?.[m.id]?.xp ?? null} />)
      )}
    </ScreenShell>
  );
}
