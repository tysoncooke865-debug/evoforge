import { Text, View } from 'react-native';

import type { DayState } from '@/domain/scheduled-streak';
import tokens from '@/theme/tokens';

/**
 * The month grid (IMPROVEMENT_PLAN #11): completed filled, missed hollow
 * red, rest dim, today ringed, future empty. Pure presentation over the
 * computed day map.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function StreakCalendar({
  year,
  month, // 0-11
  days,
  todayIso,
}: {
  year: number;
  month: number;
  days: Map<string, DayState>;
  todayIso: string;
}) {
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(Date.UTC(year, month, i + 1));
      return d.toISOString().slice(0, 10);
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = first.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

  return (
    <View
      className="rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(8,14,26,0.6)' }}
    >
      <Text className="mb-s3 text-center text-xs font-bold text-text" style={{ letterSpacing: 2 }}>
        {monthName.toUpperCase()} {year}
      </Text>
      <View className="mb-s1 flex-row">
        {WEEKDAYS.map((d, i) => (
          <Text key={i} className="flex-1 text-center text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} className="flex-row">
          {cells.slice(row * 7, row * 7 + 7).map((iso, col) => (
            <View key={col} className="flex-1 items-center py-s1">
              {iso ? <DayDot iso={iso} state={days.get(iso) ?? (iso > todayIso ? 'future' : 'rest')} today={iso === todayIso} /> : <View style={{ width: 28, height: 28 }} />}
            </View>
          ))}
        </View>
      ))}
      <View className="mt-s2 flex-row flex-wrap justify-center gap-s3">
        <Legend colour={tokens.colors.success} label="done" filled />
        <Legend colour={tokens.colors.danger} label="missed" />
        <Legend colour={tokens.colors['text-mute']} label="rest" dim />
      </View>
    </View>
  );
}

function DayDot({ iso, state, today }: { iso: string; state: DayState; today: boolean }) {
  const styles: Record<DayState, { bg: string; border: string; text: string; opacity?: number }> = {
    completed: { bg: `${tokens.colors.success}33`, border: tokens.colors.success, text: tokens.colors.success },
    missed: { bg: 'transparent', border: `${tokens.colors.danger}8c`, text: tokens.colors.danger },
    rest: { bg: 'transparent', border: 'transparent', text: tokens.colors['text-mute'], opacity: 0.55 },
    pending: { bg: 'transparent', border: `${tokens.colors.accent}8c`, text: tokens.colors.text },
    future: { bg: 'transparent', border: 'transparent', text: tokens.colors['text-mute'], opacity: 0.35 },
  };
  const s = styles[state];
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: today ? 2 : state === 'missed' || state === 'completed' || state === 'pending' ? 1 : 0,
        borderColor: today ? tokens.colors.accent : s.border,
        backgroundColor: s.bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: s.opacity ?? 1,
        shadowColor: state === 'completed' ? tokens.colors.success : 'transparent',
        shadowOpacity: state === 'completed' ? 0.4 : 0,
        shadowRadius: 6,
      }}
    >
      <Text className="text-2xs font-bold" style={{ color: s.text, fontSize: 10 }}>
        {Number(iso.slice(8, 10))}
      </Text>
    </View>
  );
}

function Legend({ colour, label, filled, dim }: { colour: string; label: string; filled?: boolean; dim?: boolean }) {
  return (
    <View className="flex-row items-center gap-s1" style={{ opacity: dim ? 0.6 : 1 }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: colour,
          backgroundColor: filled ? `${colour}33` : 'transparent',
        }}
      />
      <Text className="text-2xs text-text-mute">{label}</Text>
    </View>
  );
}
