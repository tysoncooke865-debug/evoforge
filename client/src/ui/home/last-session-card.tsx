import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { CompletedSession } from '@/domain/session-stats';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * WHAT THE LAST WORKOUT DID — slot 2 of the Home hierarchy (Tyson,
 * 2026-08-06: "1. Today's Mission, 2. Immediate progress from the last
 * workout, 3. Next scheduled training action, ...").
 *
 * Home could tell you what to do next and what you are worth overall, and had
 * nothing between them: the session you just finished vanished the moment the
 * completion screen closed. This is the receipt.
 *
 * Reads the canonical session list (domain/session-stats.ts) — the same
 * sessions the week counter counts, so this card and that number can never
 * disagree. Self-hides when there is nothing to show; nothing here is
 * estimated or filled in.
 */
export function LastSessionCard({
  session,
  todayIso,
  xpPerSet,
  testID,
}: {
  /** The most recent completed session, or null. */
  session: CompletedSession | null;
  todayIso: string;
  xpPerSet: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  if (session === null) return null;

  const isCardio = session.kind === 'cardio';
  const when =
    session.date === todayIso ? 'TODAY' : session.date === shiftIso(todayIso, -1) ? 'YESTERDAY' : session.date;

  // XP is the app's flat rate over what was actually logged — never a stored
  // number and never a guess (domain/xp.ts owns the rate).
  const xp = isCardio ? Math.trunc(session.minutes) * 2 : session.sets * xpPerSet;

  return (
    <Pressable
      onPress={() => router.push('/progress' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Last session: ${session.name}, ${when.toLowerCase()}. Opens Progress.`}
      testID={testID}
      className="w-full rounded-xl border p-s3"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <View className="flex-row items-center justify-between">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          LAST SESSION
        </Text>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 1.2, ...pixelFont(false) }}
        >
          {when}
        </Text>
      </View>

      <Text className="mt-s1 text-sm text-text" numberOfLines={1} ellipsizeMode="tail">
        {session.name}
      </Text>

      <View className="mt-s2 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 6 }}>
        {isCardio ? (
          <Stat value={`${Math.trunc(session.minutes)}`} label="MIN" tint={colors.rare} />
        ) : (
          <>
            <Stat value={String(session.sets)} label="SETS" />
            {session.volumeKg > 0 ? (
              <Stat value={`${Math.round(session.volumeKg).toLocaleString()}`} label="KG VOLUME" tint={colors.epic} />
            ) : null}
          </>
        )}
        <Stat value={`+${xp}`} label="XP" tint={colors.accent} />
      </View>
    </Pressable>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 15, color: tint ?? colors.text, letterSpacing: 0, ...pixelFont() }}
      >
        {value}
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 7, letterSpacing: 0.8, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Local, tiny: the shared helper lives in domain/today and importing it here
 *  for one comparison is not worth the coupling. UTC-based like the rest. */
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
