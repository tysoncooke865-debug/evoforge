import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useBodyfatHistory, usePhysiqueHistory } from '@/data/oracle-history';
import { physiqueTier, scanProgress, scoreOutOf100 } from '@/domain/oracle';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';

/**
 * ORACLE_REDESIGN — ORACLE HISTORY. A timeline of stored VERDICTS (never
 * photos — those are gone), newest first, each tappable to reveal its three
 * sub-scores. Above it, an honest before/current strip: the deltas from the
 * first scan to the latest. A tiny score sparkline gives the shape at a glance.
 */
export function OracleHistoryCard() {
  const colors = useThemeColors();
  const physique = usePhysiqueHistory();
  const bodyfat = useBodyfatHistory();
  const [openId, setOpenId] = useState<string | null>(null);

  if (physique.isPending) return null;

  const rows = physique.data ?? [];
  const bfRows = bodyfat.data ?? [];

  if (rows.length === 0) {
    return (
      <GlowCard glow={colors.accent}>
        <SectionLabel size='lg'>ORACLE HISTORY</SectionLabel>
        <Text className="text-2xs text-text-mute">
          No scans yet. Run your first physique analysis and your timeline begins here.
        </Text>
      </GlowCard>
    );
  }

  const progress = scanProgress(rows, bfRows.map((r) => r.bf_mid ?? 0).filter((v) => v > 0));
  const newest = [...rows].reverse();
  // The sparkline shows the recent shape — capped so a weekly scanner's rail
  // doesn't collapse into a hairline comb (the timeline below caps at 6 too).
  const scores = rows.slice(-16).map((r) => scoreOutOf100(r.physique_score ?? 0));
  const maxScore = Math.max(1, ...scores);

  const dateOf = (ts: string): string => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  const deltaText = (v: number | null, unit = ''): string =>
    v === null ? '—' : `${v > 0 ? '+' : ''}${v}${unit}`;
  const deltaColour = (v: number | null): string =>
    v === null || v === 0 ? colors['text-mute'] : v > 0 ? colors.success : colors.danger;

  return (
    <GlowCard glow={colors.accent}>
      <SectionLabel size='lg'>ORACLE HISTORY</SectionLabel>

      {/* Progress since the first scan — the honest before/current read. */}
      {progress.scans >= 2 ? (
        <View
          className="mb-s3 rounded-lg border p-s3"
          style={{ borderColor: `${colors.accent}33`, backgroundColor: 'rgba(6,12,24,0.5)' }}
        >
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            PROGRESS SINCE FIRST SCAN · {progress.scans} SCANS
          </Text>
          <View className="mt-s2 flex-row flex-wrap" style={{ gap: 10 }}>
            <DeltaTile label="MUSCULARITY" text={deltaText(progress.muscularityDelta)} colour={deltaColour(progress.muscularityDelta)} />
            <DeltaTile label="LEANNESS" text={deltaText(progress.leannessDelta)} colour={deltaColour(progress.leannessDelta)} />
            <DeltaTile label="SYMMETRY" text={deltaText(progress.symmetryDelta)} colour={deltaColour(progress.symmetryDelta)} />
            {progress.bfDelta !== null ? (
              // bfDelta is first−latest, so >0 = fat lost. Signed, like the
              // sibling tiles, under a neutral label so a gain reads sensibly.
              <DeltaTile
                label="BODY FAT"
                text={deltaText(progress.bfDelta === 0 ? 0 : -progress.bfDelta, '%')}
                colour={deltaColour(progress.bfDelta)}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Score sparkline. */}
      {scores.length >= 2 ? (
        <View className="mb-s3 flex-row items-end" style={{ height: 40, gap: 3 }}>
          {scores.map((s, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(6, (s / maxScore) * 100)}%`,
                borderRadius: 2,
                backgroundColor: i === scores.length - 1 ? colors.epic : `${colors.accent}66`,
              }}
            />
          ))}
        </View>
      ) : null}

      {/* The timeline, newest first, tap to reveal sub-scores. */}
      <View style={{ gap: 6 }}>
        {newest.slice(0, 6).map((r) => {
          const open = openId === r.id;
          const tier = physiqueTier(r.physique_score ?? 0);
          return (
            <Pressable
              key={r.id}
              onPress={() => setOpenId(open ? null : r.id)}
              accessibilityRole="button"
              accessibilityLabel={`Scan on ${dateOf(r.timestamp)}, score ${scoreOutOf100(r.physique_score ?? 0)}. ${open ? 'Collapse' : 'Expand'}.`}
              testID={`oracle-history-${r.id}`}
              className="rounded-lg border p-s3"
              style={{ borderColor: open ? `${colors.epic}45` : colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-2xs text-text-mute">{dateOf(r.timestamp)}</Text>
                <View className="flex-row items-baseline" style={{ gap: 6 }}>
                  <Text allowFontScaling={false} style={{ fontSize: 16, color: colors[tier.colourKey], ...pixelFont() }}>
                    {scoreOutOf100(r.physique_score ?? 0)}
                  </Text>
                  <Text className="text-2xs" style={{ color: colors[tier.colourKey], letterSpacing: 1 }}>
                    {tier.tier}
                  </Text>
                  <Text className="text-sm text-text-mute">{open ? '▾' : '▸'}</Text>
                </View>
              </View>
              {open ? (
                <View className="mt-s2 flex-row justify-between">
                  <SubScore label="MUS" value={r.muscularity_score} />
                  <SubScore label="LEAN" value={r.leanness_score} />
                  <SubScore label="SYM" value={r.symmetry_score} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </GlowCard>
  );
}

function DeltaTile({ label, text, colour }: { label: string; text: string; colour: string }) {
  return (
    <View style={{ minWidth: 68 }}>
      <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 15, color: colour, ...pixelFont() }}>
        {text}
      </Text>
    </View>
  );
}

function SubScore({ label, value }: { label: string; value: number | null }) {
  const colors = useThemeColors();
  return (
    <View className="items-center">
      <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 13, color: colors.text, ...pixelFont() }}>
        {value ?? '—'}
        <Text className="text-2xs text-text-mute"> / 15</Text>
      </Text>
    </View>
  );
}
