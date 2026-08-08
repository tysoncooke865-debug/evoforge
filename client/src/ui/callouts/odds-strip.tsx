import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CalloutEvidence } from '@/domain/callouts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * EVO ODDS — informative, and visually SECOND.
 *
 * The main message is always "Tyson says he hits 8". The percentages are
 * context and hype; they get one small line and the accent is on the number
 * that matters, not on the odds. Tapping opens the receipt.
 *
 * NO GREEN. Sportsbook green and casino red are exactly the two colours this
 * feature must not borrow — a call out is competitive training, not a betting
 * slip. HIT takes the app's accent cyan, MISS takes muted text, and the
 * feature's gold is reserved for the POT, which is where the drama is.
 */
export function OddsStrip({
  hit,
  early,
  evidence,
  testID = 'callout-odds',
}: {
  hit: number;
  early?: boolean;
  evidence?: CalloutEvidence | null;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const hitPct = Math.round(hit * 100);
  const missPct = 100 - hitPct;
  const hasWhy = Boolean(evidence && Object.values(evidence).some((v) => v != null));

  return (
    <View>
      <Pressable
        onPress={hasWhy ? () => setOpen((o) => !o) : undefined}
        accessibilityRole={hasWhy ? 'button' : undefined}
        accessibilityLabel={`Evo odds: ${hitPct} percent hit, ${missPct} percent miss`}
        testID={testID}
        // The 44pt floor: hitSlop does nothing on react-native-web, so the BOX
        // has to clear it even though the strip reads as one thin line.
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text
            allowFontScaling={false}
            className="text-text-mute"
            style={{ fontSize: 8, letterSpacing: 1.4 }}
          >
            EVO ODDS
          </Text>
          <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: colors.accent }}>
            HIT {hitPct}%
          </Text>
          <Text allowFontScaling={false} className="text-2xs text-text-mute">
            · MISS {missPct}%
          </Text>
          {early ? (
            <View
              className="rounded-pill border px-s2"
              style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
            >
              <Text
                allowFontScaling={false}
                className="text-text-mute"
                style={{ fontSize: 8, letterSpacing: 1 }}
                testID="callout-odds-early"
              >
                EARLY ESTIMATE
              </Text>
            </View>
          ) : null}
          {hasWhy ? (
            <Text allowFontScaling={false} className="text-2xs text-text-mute">
              {open ? '▴' : 'WHY?'}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {/* THE RECEIPT. Four lines, not a dashboard — this is a workout screen,
          and an athlete between sets is not reading a statistics panel. */}
      {open && evidence ? (
        <View
          className="mt-s1 rounded-lg border px-s3 py-s2"
          style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
          testID="callout-odds-why"
        >
          {evidence.recent_best ? <Why k="RECENT BEST" v={evidence.recent_best} /> : null}
          {evidence.today && evidence.today.length > 0 ? (
            <Why k="TODAY" v={evidence.today.join(' · ')} />
          ) : null}
          {evidence.target ? <Why k="CALLED" v={evidence.target} /> : null}
          {evidence.trend ? <Why k="TREND" v={evidence.trend.toUpperCase()} /> : null}
          {evidence.recent_best == null ? (
            <Text className="text-2xs text-text-mute">
              Nothing logged on this lift yet — that is why the estimate sits near the middle.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Why({ k, v }: { k: string; v: string }) {
  return (
    <View className="flex-row items-center justify-between py-[2px]" style={{ gap: 12 }}>
      <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 8, letterSpacing: 1.2 }}>
        {k}
      </Text>
      <Text allowFontScaling={false} className="text-2xs font-bold text-text-dim" numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}
