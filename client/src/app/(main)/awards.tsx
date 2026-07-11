import { ScrollView, Text, View } from 'react-native';

import { useAchievements } from '@/data/hooks';
import { ACHIEVEMENTS } from '@/domain/catalogs';
import { ScreenHeader } from '@/ui/screen-header';

/** All 64 achievements, earned ones lit. The catalog is the generated one the
 *  parity suite pins, so this grid cannot drift from what the sweep grants. */
export default function AwardsScreen() {
  const achievements = useAchievements();
  const held = new Map(
    (achievements.data ?? []).map((r) => [String(r.achievement_id), r.date_unlocked])
  );
  const entries = Object.entries(ACHIEVEMENTS);
  const earned = entries.filter(([id]) => held.has(id)).length;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px]">
        <ScreenHeader kicker="TROPHY HALL" title="ACHIEVEMENTS" />
        <View className="mb-s4 rounded-lg border border-border bg-surface p-s4">
          <Text className="text-xs text-text-mute">ACHIEVEMENTS</Text>
          <Text className="text-2xl font-bold text-accent">
            {earned} <Text className="text-lg text-text-mute">/ {entries.length}</Text>
          </Text>
        </View>

        {entries.map(([id, [title, description]]) => {
          const unlockedOn = held.get(id);
          const unlocked = held.has(id);
          return (
            <View
              key={id}
              className={`mb-s2 rounded-md border p-s3 ${
                unlocked ? 'border-border-strong bg-surface-2' : 'border-border-soft'
              }`}
            >
              <View className="flex-row items-center justify-between">
                <Text className={`flex-1 font-bold ${unlocked ? 'text-text' : 'text-text-mute'}`}>
                  {title}
                </Text>
                {unlocked ? (
                  <Text className="text-2xs text-success">{unlockedOn ?? 'UNLOCKED'}</Text>
                ) : (
                  <Text className="text-2xs text-text-mute">LOCKED</Text>
                )}
              </View>
              <Text className={`text-xs ${unlocked ? 'text-text-dim' : 'text-text-mute'}`}>
                {description}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
