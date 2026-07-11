import { Pressable, Switch, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { usePublicIdentity, useProfile } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { rankLadder } from '@/domain/profile';
import { useSettingsStore } from '@/state/settings-store';
import tokens from '@/theme/tokens';
import { ScreenHeader } from '@/ui/screen-header';
import { ScreenShell } from '@/ui/shell';

/** Profile: who you are on the curve. The ladder is DERIVED from RANK_TIERS
 *  (rankLadder()), never restated -- the old page once hand-wrote all eight
 *  bands as text, free to drift from the function that decides the name. */
export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const identity = usePublicIdentity();
  const { summary } = useAvatarData();

  const ladder = rankLadder().slice().reverse(); // top rank first

  return (
    <ScreenShell><ScreenHeader kicker="THE ATHLETE" title="PROFILE" />
        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="text-xs text-text-mute">SIGNED IN AS</Text>
          <Text className="mb-s2 text-sm text-text" testID="user-email">
            {session?.user.email}
          </Text>
          <Text className="text-xs text-text-mute">
            Public identity:{' '}
            {identity.data?.displayName
              ? `${identity.data.displayName} · ${identity.data.isPublic ? 'visible' : 'hidden'}`
              : 'not set (see Rank tab)'}
          </Text>
          <Text className="mt-s1 text-xs text-text-mute">
            Base level {profile.data?.base_level ?? 1} · Current level {summary.level} ·{' '}
            {summary.rank}
          </Text>
        </View>

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s3 text-xs text-text-mute">THE RANK LADDER</Text>
          {ladder.map(([low, high, name]) => {
            const current = summary.level >= low && summary.level <= high;
            return (
              <View
                key={name}
                className={`mb-s1 flex-row items-center justify-between rounded-md border p-s2 ${
                  current ? 'border-border-strong bg-surface-2' : 'border-border-soft'
                }`}
              >
                <Text className={current ? 'font-bold text-text' : 'text-text-dim'}>{name}</Text>
                <Text className="text-xs text-text-mute">
                  {low === high ? `Lv ${low}` : `Lv ${low}–${high}`}
                </Text>
              </View>
            );
          })}
        </View>

        <View className="rounded-lg border border-border bg-surface p-s4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-s3">
              <Text className="text-sm font-bold text-text">Performance mode</Text>
              <Text className="text-2xs text-text-mute">
                Disables ambient animation loops (aura, float, sheen). One-shot effects like toasts
                always play — fast-forwarding them makes them invisible.
              </Text>
            </View>
            <PerfSwitch />
          </View>
        </View>

        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={signOut}
          testID="sign-out"
        >
          <Text className="font-bold text-text">SIGN OUT</Text>
        </Pressable>
    </ScreenShell>
  );
}

function PerfSwitch() {
  const perfMode = useSettingsStore((s) => s.perfMode);
  const setPerfMode = useSettingsStore((s) => s.setPerfMode);
  return (
    <Switch
      value={perfMode}
      onValueChange={setPerfMode}
      trackColor={{ true: tokens.colors['accent-deep'], false: tokens.colors['surface-3'] }}
      thumbColor={tokens.colors.accent}
      testID="perf-mode"
    />
  );
}
