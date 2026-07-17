import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { CHAMPIONS } from '@/domain/battle-rpg/champions';
import type { ChampionId } from '@/domain/battle-rpg/types';
import type { PlayerCombatInput } from '@/domain/battle-rpg/stat-scaler';
import {
  useCreateChallenge,
  useJoinChallenge,
  type ChallengeSnapshot,
} from '@/data/battle-rpg-challenge';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ChampionPicker } from '@/ui/battle/champion-picker';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';

/**
 * VERSUS BY CODE (Tyson) — create a challenge from your champion (get a code
 * to share) or join a friend's by code and battle their champion. Async,
 * cross-device, no real-time. A "same device" pass-and-play link is kept for
 * two people on one phone.
 */
export function ChallengeHub({
  champion,
  input,
  ownerName,
  unlocked,
  requirementFor,
  onPick,
  onJoined,
  initialCode,
}: {
  champion: ChampionId;
  input: PlayerCombatInput;
  ownerName: string;
  unlocked: Set<ChampionId>;
  requirementFor: (id: ChampionId) => string;
  onPick: (id: ChampionId) => void;
  onJoined: (snap: ChallengeSnapshot) => void;
  /** A code handed over by the Arena's universal join box — lands on the
   *  JOIN tab prefilled and joins without a second button press. */
  initialCode?: string;
}) {
  const colors = useThemeColors();
  const [tab, setTab] = useState<0 | 1>(initialCode ? 1 : 0);
  const [code, setCode] = useState(initialCode ?? '');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const create = useCreateChallenge();
  const join = useJoinChallenge();

  // Arrived via the universal code box — the arena already verified the
  // challenge exists, so join it without a second press. Once only: if it
  // fails (deleted between probe and join), the hub sits on the JOIN tab,
  // code prefilled, with the existing inline error explaining why.
  const autoRef = useRef(false);
  useEffect(() => {
    if (!initialCode || autoRef.current) return;
    autoRef.current = true;
    join.mutate(initialCode, {
      onSuccess: (snap) => {
        if (snap) onJoined(snap);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title="VERSUS" onBack={() => router.back()} />
      <Text className="text-2xs text-text-mute">Battle a friend by code — build a champion for them to beat, or take on theirs.</Text>

      <View className="mt-s2">
        <SegmentedTabs left="⚔ CREATE" right="🔑 JOIN CODE" active={tab} onChange={(i) => setTab(i)} testIDPrefix="challenge-tab" />
      </View>

      {tab === 0 ? (
        <View className="mt-s3">
          {createdCode ? (
            <View className="rounded-xl border p-s5 items-center" style={{ borderColor: `${colors.accent}66`, backgroundColor: 'rgba(34,211,238,0.06)' }}>
              <Text style={{ fontSize: 10, color: colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>YOUR CHALLENGE CODE</Text>
              <Text selectable style={{ marginTop: 8, fontSize: 40, color: colors.text, letterSpacing: 8, ...pixelFont() }} testID="challenge-code">{createdCode}</Text>
              <Text className="mt-s2 text-center text-2xs text-text-mute">Share it with a friend. They join by code and fight your {CHAMPIONS[champion].name}. Come back to see how it holds up.</Text>
              <View className="mt-s4 w-full">
                <NeonButton title="DONE · BACK TO ARENA" variant="ghost" onPress={() => router.replace('/arena')} pixel testID="challenge-done" />
              </View>
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 10, color: colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>CHOOSE YOUR CHALLENGER</Text>
              <View className="mt-s2">
                <ChampionPicker picked={champion} unlocked={unlocked} requirementFor={requirementFor} testPrefix="champion" onPick={onPick} />
              </View>
              <View className="mt-s4">
                <NeonButton
                  title="CREATE CHALLENGE · GET CODE"
                  onPress={() => create.mutate({ champion, ownerName, input }, { onSuccess: setCreatedCode })}
                  busy={create.isPending}
                  pixel
                  size="hero"
                  testID="challenge-create"
                />
              </View>
            </>
          )}
        </View>
      ) : (
        <View className="mt-s3">
          <Text style={{ fontSize: 10, color: colors.epic, fontFamily: PIXEL, letterSpacing: 1.5 }}>ENTER A FRIEND&apos;S CODE</Text>
          <TextInput
            className="mt-s2 min-h-[54px] rounded-xl border bg-surface-2 p-s3 text-center text-2xl font-bold text-text"
            style={{ letterSpacing: 10, borderColor: code.trim().length === 6 ? `${colors.epic}8c` : colors.border }}
            placeholder="——————"
            placeholderTextColor="#64758f"
            autoCapitalize="characters"
            maxLength={6}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            testID="challenge-code-input"
          />
          <View className="mt-s4">
            <NeonButton
              title="JOIN BATTLE"
              onPress={() =>
                join.mutate(code, {
                  onSuccess: (snap) => {
                    if (snap) onJoined(snap);
                  },
                })
              }
              busy={join.isPending}
              disabled={code.trim().length !== 6}
              pixel
              size="hero"
              testID="challenge-join"
            />
          </View>
          {join.data === null ? (
            <Text className="mt-s2 text-center text-2xs text-danger">No challenge with that code.</Text>
          ) : null}
        </View>
      )}

      {/* Same-device fallback. */}
      <Pressable
        onPress={() => router.replace('/battle?mode=versus' as never)}
        accessibilityRole="button"
        testID="challenge-passplay"
        className="mt-s5 flex-row items-center justify-center rounded-lg border px-s3 py-s2"
        style={{ gap: 6, borderColor: colors.border }}
      >
        <Text style={{ fontSize: 13 }}>📱</Text>
        <Text allowFontScaling={false} style={{ fontSize: 9, color: colors['text-mute'], fontFamily: PIXEL_BOLD, letterSpacing: 0.5 }}>OR PLAY PASS-AND-PLAY ON ONE DEVICE</Text>
      </Pressable>
    </ScreenShell>
  );
}
