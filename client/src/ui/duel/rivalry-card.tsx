import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatCoins, type Rivalry } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE RIVALRY — what these two have done to each other, collapsed by default.
 *
 * COLLAPSED IS THE POINT. The brief's rule is "Do not let this dominate the
 * main screen", and it is right: a history is a reason to reflect, and the
 * duel above it is a reason to act. Closed, it is one line that still carries
 * the score (12–9) — which is the part that makes the next duel feel like it
 * matters — and everything else is one tap away.
 *
 * Every number is COMPUTED from the settled duels by forge_rivalry(), not
 * stored. A stored tally is a second copy of the truth, and second copies
 * drift; this one cannot disagree with the history it summarises.
 */
export function RivalryCard({
  rivalry,
  myName,
  testID,
}: {
  rivalry: Rivalry;
  myName: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  if (rivalry.total === 0) return null;

  const leadTint =
    rivalry.wins > rivalry.losses ? colors.success
      : rivalry.wins < rivalry.losses ? colors.danger
        : colors['text-dim'];

  return (
    <View
      testID={testID}
      className="w-full rounded-xl border"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Rivalry with ${rivalry.other_name}: ${rivalry.wins} wins, ${rivalry.losses} losses, ${rivalry.draws} draws. ${open ? 'Collapse' : 'Expand'}.`}
        testID="rivalry-toggle"
        className="flex-row items-center px-s3"
        style={{ gap: 10, minHeight: 52 }}
      >
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.4, ...pixelFont(false) }}
        >
          RIVALRY
        </Text>
        <View style={{ flex: 1, minWidth: 0 }} className="flex-row items-center" >
          <Text allowFontScaling={false} style={{ fontSize: 18, color: leadTint, letterSpacing: 0, ...pixelFont() }}>
            {rivalry.wins}
          </Text>
          <Text className="text-text-mute" style={{ marginHorizontal: 6 }}>–</Text>
          <Text allowFontScaling={false} style={{ fontSize: 18, color: colors.text, letterSpacing: 0, ...pixelFont() }}>
            {rivalry.losses}
          </Text>
          {rivalry.draws > 0 ? (
            <Text className="ml-s2 text-2xs text-text-mute">{rivalry.draws} drawn</Text>
          ) : null}
        </View>
        <Streak recent={rivalry.recent} />
        <Text className="text-base" style={{ color: colors['text-dim'] }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {open ? (
        <View className="border-t px-s3 pb-s3 pt-s3" style={{ borderColor: colors.border }}>
          <View className="flex-row flex-wrap" style={{ columnGap: 20, rowGap: 10 }}>
            <Stat label="YOU" value={String(rivalry.wins)} tint={colors.success} />
            <Stat label={rivalry.other_name.toUpperCase().slice(0, 10)} value={String(rivalry.losses)} />
            <Stat label="DRAWN" value={String(rivalry.draws)} />
            <Stat label="STREAK" value={String(rivalry.streak)} tint={rivalry.streak > 0 ? colors.legendary : undefined} />
          </View>
          <View className="mt-s3 flex-row flex-wrap" style={{ columnGap: 20, rowGap: 10 }}>
            <Stat label="DUELS" value={String(rivalry.total)} />
            <Stat label="BIGGEST POOL" value={formatCoins(rivalry.biggest_pot)} tint={colors.legendary} />
            <Stat
              label="NET COINS"
              value={`${rivalry.net_coins >= 0 ? '+' : ''}${formatCoins(rivalry.net_coins)}`}
              tint={rivalry.net_coins >= 0 ? colors.success : colors['text-dim']}
            />
          </View>
          {/* Net coins is shown AS IT IS and can be negative. A record that
              only ever counts up is not a record. */}
          <Text className="mt-s3 text-2xs text-text-mute">
            Against {rivalry.other_name}. A draw keeps a run alive — only a loss resets it.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The last five, newest first — the shape everyone already reads as form. */
function Streak({ recent }: { recent: Rivalry['recent'] }) {
  const colors = useThemeColors();
  if (recent.length === 0) return null;
  return (
    <View className="flex-row" style={{ gap: 4 }} accessibilityLabel={`Last ${recent.length}: ${recent.map((r) => r.result).join(', ')}`}>
      {recent.map((r) => (
        <View
          key={r.id}
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor:
              r.result === 'won' ? `${colors.success}8c`
                : r.result === 'lost' ? colors.border
                  : `${colors.legendary}66`,
            backgroundColor: r.result === 'won' ? 'rgba(52,211,153,0.12)' : 'transparent',
          }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 8,
              color:
                r.result === 'won' ? colors.success
                  : r.result === 'drew' ? colors.legendary
                    : colors['text-mute'],
              ...pixelFont(),
            }}
          >
            {r.result === 'won' ? 'W' : r.result === 'lost' ? 'L' : 'D'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View>
      <Text allowFontScaling={false} style={{ fontSize: 19, color: tint ?? colors.text, letterSpacing: 0, ...pixelFont() }}>
        {value}
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </View>
  );
}
