import { Text, View } from 'react-native';

import { useAchievements } from '@/data/hooks';
import { ACHIEVEMENTS } from '@/domain/catalogs';
import { pixelFont } from '@/theme/fonts';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

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
    <ScreenShell><ScreenHeader kicker="TROPHY HALL" title="ACHIEVEMENTS" />
        <GlowCard>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            ACHIEVEMENTS
          </Text>
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 24, ...pixelFont() }}>
            {earned} <Text className="text-lg text-text-mute">/ {entries.length}</Text>
          </Text>
        </GlowCard>

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
                <Text
                  className={`flex-1 ${unlocked ? 'text-text' : 'text-text-mute'}`}
                  allowFontScaling={false}
                  style={{ fontSize: 15, ...pixelFont() }}
                >
                  {title}
                </Text>
                {unlocked ? (
                  <Text
                    className="text-success"
                    allowFontScaling={false}
                    style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
                  >
                    {unlockedOn ?? 'UNLOCKED'}
                  </Text>
                ) : (
                  <Text
                    className="text-text-mute"
                    allowFontScaling={false}
                    style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
                  >
                    LOCKED
                  </Text>
                )}
              </View>
              <Text className={`text-xs ${unlocked ? 'text-text-dim' : 'text-text-mute'}`}>
                {description}
              </Text>
            </View>
          );
        })}
    </ScreenShell>
  );
}
