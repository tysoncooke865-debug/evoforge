import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useCreateGym, useJoinGym, useMyGyms } from '@/data/gyms';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

/**
 * GYMS (2026-07-19, migration 068) — the Social page's group hub: the gyms you
 * belong to, plus create-a-gym and join-by-code. A gym opens its own screen
 * (/gym/[id]) with the roster, private chat and gym-vs-gym battles.
 */
export function GymsView() {
  const colors = useThemeColors();
  const gyms = useMyGyms();
  const create = useCreateGym();
  const join = useJoinGym();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  return (
    <View className="w-full gap-s3">
      {/* Your gyms. */}
      {(gyms.data ?? []).length > 0 ? (
        <View className="gap-s2">
          <Text allowFontScaling={false} style={{ fontSize: 10, color: colors['text-mute'], letterSpacing: 1.5, ...pixelFont(false) }}>
            YOUR GYMS
          </Text>
          {(gyms.data ?? []).map((g) => (
            <Pressable
              key={g.gym_id}
              onPress={() => router.push(`/gym/${g.gym_id}` as never)}
              accessibilityRole="button"
              testID={`gym-${g.gym_id}`}
              className="flex-row items-center justify-between rounded-xl border p-s3"
              style={{ borderColor: `${colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.05)' }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-sm font-bold text-text" numberOfLines={1} allowFontScaling={false} style={{ ...pixelFont() }}>
                  {g.name}
                </Text>
                <Text className="text-2xs text-text-mute" numberOfLines={1}>
                  {g.member_count} member{g.member_count === 1 ? '' : 's'} · {g.my_role === 'owner' ? 'OWNER' : 'MEMBER'} · code {g.join_code}
                </Text>
              </View>
              <Text className="text-base font-bold text-accent">›</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text className="text-2xs text-text-mute">
          No gyms yet — start one and share the code, or join with a friend&apos;s code.
        </Text>
      )}

      {/* Create. */}
      <GlowCard>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.accent, letterSpacing: 1.5, ...pixelFont(false) }}>
          START A GYM
        </Text>
        <TextInput
          className="mt-s2 min-h-[48px] rounded-md border bg-surface-2 px-s3 text-base text-text"
          style={{ borderColor: name.trim().length >= 3 ? `${colors.accent}8c` : colors.border }}
          placeholder="Gym name (3–30 chars)"
          placeholderTextColor="#64758f"
          value={name}
          onChangeText={setName}
          maxLength={30}
          testID="gym-create-name"
        />
        <View className="mt-s2">
          <NeonButton
            title="CREATE GYM"
            onPress={() => create.mutate({ name }, { onSuccess: () => setName('') })}
            busy={create.isPending}
            disabled={name.trim().length < 3}
            testID="gym-create"
          />
        </View>
      </GlowCard>

      {/* Join by code. */}
      <GlowCard>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.epic, letterSpacing: 1.5, ...pixelFont(false) }}>
          JOIN BY CODE
        </Text>
        <TextInput
          className="mt-s2 min-h-[48px] rounded-md border bg-surface-2 px-s3 text-center text-lg font-bold text-text"
          style={{ letterSpacing: 6, borderColor: code.trim().length === 6 ? `${colors.epic}8c` : colors.border }}
          placeholder="——————"
          placeholderTextColor="#64758f"
          autoCapitalize="characters"
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          maxLength={6}
          testID="gym-join-code"
        />
        <View className="mt-s2">
          <NeonButton
            title="JOIN GYM"
            variant="ghost"
            onPress={() => join.mutate(code, { onSuccess: () => setCode('') })}
            busy={join.isPending}
            disabled={code.trim().length !== 6}
            testID="gym-join"
          />
        </View>
      </GlowCard>
    </View>
  );
}
