import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useCreateGym, useDiscoverGyms, useJoinGym, useMyGyms } from '@/data/gyms';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

/**
 * GYMS (2026-07-19, migration 068; discovery 076) — the Social page's group hub:
 * the gyms you belong to, create-a-gym, and BROWSE/SEARCH public gyms to join (no
 * code). A gym opens its own screen (/gym/[id]) with roster, chat and battles.
 */
export function GymsView() {
  const colors = useThemeColors();
  const gyms = useMyGyms();
  const create = useCreateGym();
  const join = useJoinGym();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const found = useDiscoverGyms(debounced);
  const myIds = new Set((gyms.data ?? []).map((g) => g.gym_id));

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
                  {g.member_count} member{g.member_count === 1 ? '' : 's'} · {g.my_role === 'owner' ? 'OWNER' : 'MEMBER'} · {g.is_public ? 'PUBLIC' : 'PRIVATE'}
                </Text>
              </View>
              <Text className="text-base font-bold text-accent">›</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text className="text-2xs text-text-mute">
          No gyms yet — start one below, or find a public gym to join.
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

      {/* Find a gym — browse/search public gyms and join (no code). */}
      <GlowCard>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.epic, letterSpacing: 1.5, ...pixelFont(false) }}>
          FIND A GYM
        </Text>
        <Text className="mt-s1 text-2xs text-text-mute">Search public gyms by name — or leave blank to browse the biggest.</Text>
        <TextInput
          className="mt-s2 min-h-[48px] rounded-md border bg-surface-2 px-s3 text-base text-text"
          style={{ borderColor: search.trim().length >= 1 ? `${colors.epic}8c` : colors.border }}
          placeholder="Search gyms…"
          placeholderTextColor="#64758f"
          autoCapitalize="none"
          autoCorrect={false}
          value={search}
          onChangeText={setSearch}
          maxLength={30}
          testID="gym-search"
        />
        <View className="mt-s2 gap-s2">
          {found.isPending ? (
            <Text className="text-2xs text-text-mute">Searching…</Text>
          ) : (found.data ?? []).filter((g) => !myIds.has(g.gym_id)).length === 0 ? (
            <Text className="text-2xs text-text-mute" testID="gym-search-empty">
              {debounced.trim() ? 'No public gyms match that name.' : 'No public gyms to show yet — start one above.'}
            </Text>
          ) : (
            (found.data ?? [])
              .filter((g) => !myIds.has(g.gym_id))
              .map((g) => (
                <View
                  key={g.gym_id}
                  className="flex-row items-center justify-between rounded-xl border p-s3"
                  style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
                  testID={`gym-hit-${g.gym_id}`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text className="text-sm font-bold text-text" numberOfLines={1}>{g.name}</Text>
                    <Text className="text-2xs text-text-mute" numberOfLines={1}>
                      {g.member_count}/30 · led by {g.owner_name}
                    </Text>
                  </View>
                  {g.is_full ? (
                    <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>FULL</Text>
                  ) : (
                    <Pressable
                      onPress={() => join.mutate({ gymId: g.gym_id })}
                      accessibilityRole="button"
                      accessibilityLabel={`join ${g.name}`}
                      disabled={join.isPending}
                      testID={`gym-join-${g.gym_id}`}
                      className="items-center justify-center rounded-lg border px-s3"
                      style={{ minHeight: 40, borderColor: `${colors.epic}8c`, backgroundColor: 'rgba(168,85,247,0.1)' }}
                    >
                      <Text className="text-epic" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}>+ JOIN</Text>
                    </Pressable>
                  )}
                </View>
              ))
          )}
        </View>
      </GlowCard>
    </View>
  );
}
