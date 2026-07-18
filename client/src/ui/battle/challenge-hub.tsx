import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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

/**
 * VERSUS BY CODE (Tyson) — CREATE-ONLY since 2026-07-19 (improvement doc
 * §7.3): games MINT codes; every code is ENTERED in exactly one place, the
 * Arena hub's universal JOIN BATTLE box, which probes the code's kind and
 * routes here with ?code=… for the auto-join. The old in-hub JOIN tab
 * duplicated that box and is gone. A "same device" pass-and-play link is
 * kept for two people on one phone.
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
  /** A code handed over by the Arena's universal join box — auto-joins on
   *  mount. The ONLY join path into a challenge (§7.3). */
  initialCode?: string;
}) {
  const colors = useThemeColors();
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const create = useCreateChallenge();
  const join = useJoinChallenge();

  // Arrived via the universal code box — the arena already verified the
  // challenge exists, so join it without a second press. Once only: if it
  // fails (deleted between probe and join), the inline error below explains
  // and points back at the one join box.
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
      {/* §7.1: explicit — router.back() pops the TAB history and lands on
          Home, not the Arena that pushed this screen. */}
      <ScreenHeader kicker="ARENA" title="VERSUS" onBack={() => router.replace('/arena' as never)} />
      <Text className="text-2xs text-text-mute">
        Build a champion, mint a code, share it. Friends join from the Arena&apos;s JOIN BATTLE box.
      </Text>

      {join.data === null ? (
        <View
          className="mt-s3 rounded-xl border p-s3"
          style={{ borderColor: `${colors.danger}59`, backgroundColor: 'rgba(244,63,94,0.06)' }}
        >
          <Text className="text-2xs text-danger">
            That code didn&apos;t match a challenge any more. Codes are entered in the Arena&apos;s
            JOIN BATTLE box — ask your friend for a fresh one.
          </Text>
        </View>
      ) : null}

      <View className="mt-s3">
        {createdCode ? (
          <View className="rounded-xl border p-s5 items-center" style={{ borderColor: `${colors.accent}66`, backgroundColor: 'rgba(34,211,238,0.06)' }}>
            <Text style={{ fontSize: 10, color: colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>YOUR CHALLENGE CODE</Text>
            <Text selectable style={{ marginTop: 8, fontSize: 40, color: colors.text, letterSpacing: 8, ...pixelFont() }} testID="challenge-code">{createdCode}</Text>
            <Text className="mt-s2 text-center text-2xs text-text-mute">Share it with a friend. They enter it in the Arena&apos;s JOIN BATTLE box and fight your {CHAMPIONS[champion].name}. Come back to see how it holds up.</Text>
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
