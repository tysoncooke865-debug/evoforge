import { Linking, Pressable, Text, View } from 'react-native';

import { useCommandSummary } from '@/data/exec';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';

const COMMAND_URL = 'https://evoforge-command.vercel.app';

/**
 * THE COMMAND CENTRE, SEEN FROM THE PRODUCT.
 *
 * /exec and /insights answer "how is the product doing". The Command Centre
 * answers "what are we building, and who approved it". Keeping them apart meant
 * a founder could read a 0% activation figure on this very screen without
 * knowing an opportunity had already been raised from that exact number — so the
 * same fact got investigated twice, in two tools, sometimes reaching two
 * different decisions.
 *
 * Renders NOTHING for anyone who is not a founder. Not an error, not an empty
 * state, not a locked panel: the command_* tables are governed, and an athlete
 * has no business learning this screen has a hidden section. The gate lives in
 * the RPC rather than here, so there is exactly one copy of the rule.
 */
export function CommandBridge() {
  const colors = useThemeColors();
  const q = useCommandSummary();
  const s = q.data;

  if (q.isPending || !s?.available) return null;

  const waiting =
    (s.awaiting_founder?.proposals ?? 0) +
    (s.awaiting_founder?.releases ?? 0) +
    (s.awaiting_founder?.tasks ?? 0);

  return (
    <View className="w-full gap-s3">
      <SectionLabel size="lg">COMMAND CENTRE</SectionLabel>

      <GlowCard glow={colors.epic} padding={16}>
        {/* What needs a human is the only genuinely urgent part, so it leads. */}
        <View className="flex-row items-baseline justify-between">
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 32,
              lineHeight: 36,
              color: waiting > 0 ? colors.warn : colors.text,
              ...pixelFont(),
            }}
          >
            {waiting}
          </Text>
          <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 1 }}>
            AWAITING YOU
          </Text>
        </View>
        <Text className="mt-s1 text-xs text-text-dim">
          {waiting > 0
            ? `${s.awaiting_founder?.proposals ?? 0} proposal(s), ${s.awaiting_founder?.releases ?? 0} release(s), ${s.awaiting_founder?.tasks ?? 0} founder task(s).`
            : 'Nothing is blocked on a founder decision.'}
        </Text>

        <View className="mt-s3 flex-row flex-wrap gap-s4">
          <Stat label="IN FLIGHT" value={String(s.in_flight?.work_orders ?? 0)} sub="work orders" />
          <Stat label="MEASURING" value={String(s.outcomes?.measuring ?? 0)} sub="releases" />
          <Stat label="VALIDATED" value={String(s.outcomes?.validated ?? 0)} sub="wins" />
          {(s.outcomes?.regressed ?? 0) > 0 ? (
            <Stat label="REGRESSED" value={String(s.outcomes?.regressed ?? 0)} sub="rolled back" warn />
          ) : null}
          <Stat label="EXPERIMENTS" value={String(s.experiments?.running ?? 0)} sub="running" />
        </View>

        <Text className="mt-s2 text-2xs text-text-mute">
          {s.in_flight?.runner_online
            ? 'Studio runner connected.'
            : 'Studio runner is not connected — nothing will be built until it is.'}
        </Text>
      </GlowCard>

      {/* THE BRIDGE THAT MATTERS: this screen's numbers, already acted on. */}
      {s.top_opportunities?.length ? (
        <GlowCard padding={16}>
          <SectionLabel>RANKED OPPORTUNITIES</SectionLabel>
          <Text className="mt-s1 text-2xs text-text-mute">
            Raised from evidence and ranked by expected return. If a figure on this screen worries you, look here before
            investigating it again.
          </Text>
          {s.top_opportunities.slice(0, 3).map((o) => (
            <View key={o.ref} className="mt-s3">
              <View className="flex-row items-center gap-s2">
                <Text className="text-2xs text-text-mute" allowFontScaling={false}>
                  {o.ref}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 0.5, color: colors.epic, ...pixelFont(false) }}
                >
                  {o.classification.replace(/_/g, ' ')}
                </Text>
                <Text className="ml-auto text-2xs text-text-mute" allowFontScaling={false}>
                  ROI {Number(o.score).toFixed(2)}
                </Text>
              </View>
              <Text className="mt-s1 text-sm text-text">{o.title}</Text>
              {o.baseline ? <Text className="mt-0.5 text-2xs text-text-mute">now: {o.baseline}</Text> : null}
              <Text className="mt-0.5 text-2xs text-text-mute">
                {o.evidence_count > 0 ? `${o.evidence_count} evidence row(s)` : 'no evidence — opinion'}
              </Text>
            </View>
          ))}
        </GlowCard>
      ) : null}

      {/* What Pulse concluded from the same rows this screen is rendering. */}
      {s.recent_evidence?.length ? (
        <GlowCard padding={16}>
          <SectionLabel>WHAT THE DATA SAYS</SectionLabel>
          {s.recent_evidence.slice(0, 3).map((e, i) => (
            <View key={i} className="mt-s2">
              <Text
                allowFontScaling={false}
                style={{
                  fontSize: 9,
                  letterSpacing: 0.5,
                  color: e.kind === 'fact' ? colors.accent : colors['text-mute'],
                  ...pixelFont(false),
                }}
              >
                {e.kind === 'fact' ? 'FACT' : e.kind === 'interpretation' ? 'READING' : 'GUESS'}
              </Text>
              <Text className="text-xs text-text-dim">{e.summary}</Text>
            </View>
          ))}
        </GlowCard>
      ) : null}

      <Pressable
        onPress={() => void Linking.openURL(COMMAND_URL)}
        accessibilityRole="button"
        className="min-h-[48px] items-center justify-center rounded-xl"
        style={{ backgroundColor: `${colors.epic}18`, borderWidth: 1, borderColor: `${colors.epic}55` }}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 11, letterSpacing: 1, color: colors.epic, ...pixelFont(false) }}
        >
          OPEN COMMAND CENTRE
        </Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  const colors = useThemeColors();
  return (
    <View>
      <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 17, color: warn ? colors.warn : colors.text, ...pixelFont() }}>
        {value}
      </Text>
      <Text className="text-2xs text-text-mute">{sub}</Text>
    </View>
  );
}
