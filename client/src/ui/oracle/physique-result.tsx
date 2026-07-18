import { Text, View } from 'react-native';

import type { PhysiqueResult } from '@/data/ai';
import {
  attributeLines,
  mainWeakness,
  physiqueTier,
  scoreOutOf100,
  topStrength,
} from '@/domain/oracle';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { AttributeBar } from '@/ui/oracle/attribute-bar';
import { useCountUp, useReveal } from '@/ui/oracle/oracle-anim';

/**
 * ORACLE_REDESIGN — the physique verdict, revealed like a game result: a
 * "SCANNING…" beat, then the big tiered score counting up, then the three
 * real attribute bars filling, then the read-out (Top Strength / Main
 * Weakness / Recommended Priority). Everything shown is derived from the
 * verdict's own /15 numbers — no fabricated sub-scores.
 */
export function PhysiqueReveal({ result }: { result: PhysiqueResult }) {
  const colors = useThemeColors();
  const phase = useReveal(true);
  const done = phase === 'done';

  const lines = attributeLines(result);
  const strength = topStrength(lines);
  const weakness = mainWeakness(lines);
  const tier = physiqueTier(result.physique_score);
  const tierColour = colors[tier.colourKey];
  const face = scoreOutOf100(result.physique_score);
  const shownFace = useCountUp(face, done, 1000);

  const noteFor = (key: string): string | undefined => {
    // The AI's weak_points/improvements are the "small explanation" lines —
    // attach the first that plausibly names the attribute, else leave bare.
    const pool = [...(result.weak_points ?? []), ...(result.improvements ?? [])];
    const hit = pool.find((p) => p.toLowerCase().includes(key));
    return hit;
  };

  if (phase !== 'done') {
    return (
      <View
        className="mt-s4 items-center rounded-xl p-s5"
        style={{ borderWidth: 1, borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 14, letterSpacing: 3, color: phase === 'complete' ? colors.success : colors.accent, ...pixelFont() }}
        >
          {phase === 'complete' ? '✓ ANALYSIS COMPLETE' : 'SCANNING…'}
        </Text>
      </View>
    );
  }

  return (
    <View
      className="mt-s4 rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
      testID="physique-result"
    >
      {/* The overall — big, tiered. */}
      <View className="items-center">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 2, ...pixelFont(false) }}
        >
          OVERALL PHYSIQUE SCORE
        </Text>
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 52,
              lineHeight: 58,
              color: tierColour,
              textShadowColor: `${tierColour}99`,
              textShadowRadius: 20,
              ...pixelFont(),
            }}
          >
            {Math.round(shownFace)}
          </Text>
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont(false) }}>
            / 100
          </Text>
        </View>
        <View
          className="mt-s1 rounded-pill border px-s3 py-s1"
          style={{ borderColor: `${tierColour}8c`, backgroundColor: `${tierColour}1a` }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 2, color: tierColour, ...pixelFont() }}>
            {tier.tier}
          </Text>
        </View>
      </View>

      <View className="my-s3" style={{ height: 1, backgroundColor: colors['border-soft'] }} />

      {/* The three real attributes, filling. */}
      {lines.map((l, i) => (
        <AttributeBar
          key={l.key}
          label={l.label}
          value={l.value}
          colour={colors[l.colourKey]}
          note={noteFor(l.key)}
          reveal={done}
          delayMs={i * 120}
        />
      ))}

      {result.summary ? <Text className="mt-s1 text-xs text-text-dim">{result.summary}</Text> : null}

      {/* The read-out. */}
      <View className="mt-s3 gap-s2">
        {strength ? (
          <ReadRow label="TOP STRENGTH" value={strength.label} colour={colors.success} />
        ) : null}
        {weakness ? (
          <ReadRow label="MAIN WEAKNESS" value={weakness.label} colour={colors.warn} />
        ) : null}
        {result.improvements?.[0] ? (
          <ReadRow label="RECOMMENDED PRIORITY" value={result.improvements[0]} colour={colors.accent} wrap />
        ) : null}
      </View>
    </View>
  );
}

function ReadRow({
  label,
  value,
  colour,
  wrap = false,
}: {
  label: string;
  value: string;
  colour: string;
  wrap?: boolean;
}) {
  return (
    <View className="flex-row items-start justify-between gap-s2">
      <Text
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1, color: colour, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text
        className="flex-1 text-right text-2xs text-text-dim"
        numberOfLines={wrap ? 3 : 1}
        style={{ textTransform: wrap ? 'none' : 'capitalize' }}
      >
        {value}
      </Text>
    </View>
  );
}
