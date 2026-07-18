import { Text, View } from 'react-native';

import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';
import { activityFor } from '@/ui/train/cardio/activities';

/**
 * CARDIO_REDESIGN — RECENT SESSIONS: the last few logged sessions, newest
 * first, each a compact row (activity icon, name, relative time, minutes,
 * distance). A polished empty state when none — never a big empty card.
 */
export interface RecentRow {
  id: string;
  type: string;
  minutes: number;
  distanceKm: number;
  timestamp: string;
  date: string;
}

export function RecentCardioSessions({ rows, today }: { rows: RecentRow[]; today: string }) {
  const colors = useThemeColors();

  if (rows.length === 0) {
    return (
      <GlowCard>
        <SectionLabel>RECENT SESSIONS</SectionLabel>
        <Text className="text-2xs text-text-mute">
          No cardio logged yet. Complete your first conditioning session to begin progressing.
        </Text>
      </GlowCard>
    );
  }

  const relDay = (iso: string): string => {
    const d = String(iso).slice(0, 10);
    if (d === today) return 'Today';
    const y = new Date(`${today}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    if (d === y.toISOString().slice(0, 10)) return 'Yesterday';
    return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  const timeOf = (ts: string): string => {
    // The timestamptz carries the UTC instant; render it in the athlete's
    // LOCAL time (a regex over the raw string would print the UTC wall clock).
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  return (
    <GlowCard>
      <SectionLabel>RECENT SESSIONS</SectionLabel>
      <View style={{ gap: 8 }}>
        {rows.slice(0, 5).map((r) => {
          const a = activityFor(r.type);
          const mins = Math.trunc(pyFloat(r.minutes) ?? 0);
          const dist = pyFloat(r.distanceKm) ?? 0;
          return (
            <View
              key={r.id}
              className="flex-row items-center rounded-lg border p-s3"
              style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)', gap: 12 }}
              testID={`cardio-recent-${r.id}`}
            >
              <View
                className="items-center justify-center rounded-md border"
                style={{ width: 36, height: 36, borderColor: `${colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.08)' }}
              >
                <a.Icon size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  className="text-text"
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={{ fontSize: 11, letterSpacing: 0.5, ...pixelFont() }}
                >
                  {a.label}
                </Text>
                <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
                  {relDay(r.date || r.timestamp)}
                  {timeOf(r.timestamp) ? ` · ${timeOf(r.timestamp)}` : ''}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
                  {mins}
                  <Text className="text-2xs text-text-mute"> min</Text>
                </Text>
                {dist > 0 ? <Text className="text-2xs text-text-mute">{Math.round(dist * 10) / 10} km</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </GlowCard>
  );
}
