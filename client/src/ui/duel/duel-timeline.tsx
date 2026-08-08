import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { describeEvent, eventTone, type DuelEvent } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE DUEL'S OWN TIMELINE — what happened, in order, one line each.
 *
 * DELIBERATELY NOT A FEED. The brief's rule is "Do not turn it into a social
 * messaging app", and the shape enforces it: no avatars, no threading, no
 * replies, no free text anywhere. A whole training session is one line; a raise
 * negotiation is three. The dot on the left is the only colour, and it says
 * which KIND of thing happened — money, the lead, or training — so a glance
 * finds the interesting rows without reading them.
 *
 * Five rows by default, because between sessions that is the whole story. The
 * rest is one tap away for anyone auditing a result.
 */
export function DuelTimeline({
  events,
  myId,
  myName,
  loading = false,
  testID,
}: {
  events: readonly DuelEvent[];
  myId: string;
  myName: string;
  loading?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events.slice(0, 40) : events.slice(0, 5);

  if (loading) {
    return (
      <Text className="text-2xs text-text-mute" testID={testID ? `${testID}-loading` : undefined}>
        Loading the duel history…
      </Text>
    );
  }
  if (events.length === 0) {
    return (
      <Text className="text-2xs text-text-mute" testID={testID ? `${testID}-empty` : undefined}>
        Nothing has happened yet. Log a session and this fills in.
      </Text>
    );
  }

  const toneColor = {
    money: colors.legendary,
    lead: colors.success,
    training: colors.accent,
    quiet: colors['text-mute'],
  } as const;

  return (
    <View testID={testID}>
      {shown.map((e, i) => {
        const tone = eventTone(e.kind);
        return (
          <View key={e.id} className="flex-row" style={{ gap: 10, marginTop: i === 0 ? 0 : 10 }}>
            <View style={{ width: 8, alignItems: 'center', paddingTop: 5 }}>
              <View
                style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: toneColor[tone] }}
              />
              {i < shown.length - 1 ? (
                <View style={{ flex: 1, width: 1, marginTop: 3, backgroundColor: colors.border }} />
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <Text className="text-2xs text-text" numberOfLines={2}>
                {describeEvent(e, { me: myName, myId })}
              </Text>
              <Text className="text-2xs text-text-mute" style={{ fontSize: 10 }}>
                {relative(e.created_at)}
              </Text>
            </View>
          </View>
        );
      })}
      {events.length > 5 ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? 'Show fewer duel events' : 'Show the full duel history'}
          testID="duel-timeline-toggle"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text className="text-2xs" style={{ color: colors.accent, letterSpacing: 0.8 }}>
            {expanded ? 'SHOW LESS ›' : `ALL ${events.length} EVENTS ›`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "just now" · "12m" · "4h" · "3d". Terse on purpose — a timeline row should
 *  fit on one line on the narrowest phone. */
function relative(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The pixel section heading used inside duel cards. */
export function DuelCardLabel({ children }: { children: string }) {
  return (
    <Text
      className="text-text-mute"
      allowFontScaling={false}
      style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}
