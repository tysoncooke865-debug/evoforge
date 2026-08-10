import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useOpenPool } from '@/data/callout-pool';
import { useFriends } from '@/data/social';
import { poolShare } from '@/domain/forge-pool';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * ASK FRIENDS TO TAKE A SIDE — the athlete's half of a pool.
 *
 * THE ATHLETE IS ALWAYS THE ONE WHO OPENS IT. Nobody can put coins on somebody
 * else's set uninvited: this sheet is the only way an invitation is ever issued, and
 * `callout_pool_join` (181) refuses anyone not on the list. That is not a UI
 * convenience, it is the discovery model — there is no browsable feed of open pools
 * anywhere in the product, and migration 182 asserts none exists server-side.
 *
 * ONLY FRIENDS APPEAR HERE, and the server re-checks friendship at open AND at join,
 * because it can end in between.
 *
 * NO NUMBERS ARE PROMISED ON THIS SCREEN. What each side would take depends on who
 * joins and how much, none of which is known yet. Quoting a return before anybody has
 * taken a side would be inventing one.
 */
export function PoolOpenSheet({
  calloutId,
  exercise,
  targetLabel,
  stake,
  backTotal,
  pushTotal,
  joiners,
  alreadyOpen,
  onClose,
}: {
  calloutId: string;
  exercise: string;
  targetLabel: string;
  stake: number;
  backTotal: number;
  pushTotal: number;
  joiners: number;
  alreadyOpen: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const friends = useFriends();
  const open = useOpenPool();
  const [picked, setPicked] = useState<string[]>([]);

  const list = friends.data ?? [];
  const { backPct, pushPct } = poolShare({ back: backTotal, push: pushTotal });
  // Eight people maximum (§4): the athlete, the opponent, and six others.
  const roomLeft = Math.max(0, 6 - joiners);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < roomLeft ? [...p, id] : p));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
        onPress={onClose}
        accessibilityLabel="Close"
      >
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.legendary}45`, backgroundColor: colors.surface, maxHeight: 560 }}
          testID="pool-open-sheet"
        >
          <Text
            allowFontScaling={false}
            className="text-text-mute"
            numberOfLines={1}
            style={{ fontSize: 8, letterSpacing: 1.6 }}
          >
            ASK FRIENDS · {exercise.toUpperCase()}
          </Text>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 22, lineHeight: 26, color: colors.legendary, ...pixelFont() }}
          >
            {targetLabel}
          </Text>
          <Text className="mt-s1 text-2xs text-text-mute">
            They pick a side on this set. You still just do the set — your {stake} is already in.
          </Text>

          {alreadyOpen && joiners > 0 ? (
            <Text className="mt-s2 text-2xs text-text-dim" testID="pool-open-state">
              {joiners} {joiners === 1 ? 'friend' : 'friends'} in · {backPct}% backing you,{' '}
              {pushPct}% against.
            </Text>
          ) : null}

          <ScrollView showsVerticalScrollIndicator={false} className="mt-s3">
            {list.length === 0 ? (
              <Text className="text-2xs text-text-mute">
                Add a friend and they can take a side on your sets.
              </Text>
            ) : (
              list.map((f) => {
                const on = picked.includes(f.id);
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => toggle(f.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Ask ${f.display_name} to take a side`}
                    testID={`pool-ask-${f.id}`}
                    className="mb-s1 flex-row items-center justify-between rounded-lg border px-s3"
                    style={{
                      minHeight: 44,
                      borderColor: on ? colors.accent : colors.border,
                      backgroundColor: on ? 'rgba(34,211,238,0.1)' : 'rgba(13,21,36,0.5)',
                    }}
                  >
                    <Text
                      allowFontScaling={false}
                      className="text-2xs font-bold"
                      numberOfLines={1}
                      style={{ color: on ? colors.accent : colors['text-dim'] }}
                    >
                      {f.display_name.toUpperCase()}
                    </Text>
                    <Text allowFontScaling={false} className="text-2xs text-text-mute">
                      {on ? '✓' : '+'}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View className="mt-s2">
            <NeonButton
              title={
                open.isPending
                  ? 'ASKING…'
                  : picked.length === 0
                    ? 'PICK WHO TO ASK'
                    : `ASK ${picked.length}`
              }
              size="hero"
              pixel
              disabled={picked.length === 0 || open.isPending}
              busy={open.isPending}
              onPress={() =>
                open.mutate({ calloutId, invitees: picked }, { onSuccess: onClose })
              }
              testID="pool-open-ask"
            />
            <Text className="mt-s1 text-center text-2xs text-text-mute">
              {roomLeft > 0
                ? `Room for ${roomLeft} more. Nobody is told twice.`
                : 'This pool is full.'}
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
