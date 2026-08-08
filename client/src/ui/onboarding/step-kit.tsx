/**
 * ONBOARDING V3 — the step primitives (docs/ONBOARDING_V3_SPEC.md §2).
 *
 * V3 is one screen per question instead of one scroll containing all of
 * them. That is the whole design: a form you can see the end of is a form
 * you answer, and four of the fourteen athletes who opened v2's form never
 * submitted it.
 *
 * These are deliberately dumb — every decision lives in domain/onboarding-v3
 * or in the screen's step machine. Nothing here reads a query or a store.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { AmbientLight } from '@/ui/core/shell';

/** The ambient light rig every creation screen sits on. */
export function CreationBackdrop() {
  return (
    <>
      <AmbientLight />
    </>
  );
}

/**
 * One step: a progress rail, a back door, a question, and a footer that
 * holds the single action.
 *
 * `onBack` is null on the first step — rendering a dead back arrow teaches
 * an athlete that the controls lie.
 */
export function StepFrame({
  step,
  total,
  kicker,
  title,
  subtitle,
  onBack,
  children,
  footer,
  testID,
}: {
  step: number;
  total: number;
  kicker?: string;
  title: string;
  subtitle?: string;
  onBack: (() => void) | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-1" style={{ backgroundColor: colors['bg-deep'] }} testID={testID}>
      <CreationBackdrop />
      <ScrollView className="flex-1" contentContainerClassName="items-center p-s6">
        <View className="w-full max-w-[480px]">
          <View className="mb-s4 flex-row items-center gap-s3">
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
                testID="onboard-back"
                hitSlop={12}
                style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
              >
                <Text allowFontScaling={false} style={{ fontSize: 16, color: colors['text-dim'], ...pixelFont() }}>
                  ‹ BACK
                </Text>
              </Pressable>
            ) : (
              <View style={{ minHeight: 44 }} />
            )}
            <View className="flex-1 items-end">
              <Text
                className="text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
              >
                {step} / {total}
              </Text>
            </View>
          </View>

          <ProgressRail step={step} total={total} />

          {kicker ? (
            <Text
              className="mt-s4 text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              {kicker}
            </Text>
          ) : null}
          <Text
            className="mb-s2 mt-s1 text-accent"
            allowFontScaling={false}
            style={{
              fontSize: 26,
              lineHeight: 32,
              letterSpacing: 0,
              textShadowColor: 'rgba(34,211,238,0.5)',
              textShadowRadius: 16,
              ...pixelFont(),
            }}
          >
            {title}
          </Text>
          {subtitle ? <Text className="mb-s4 text-sm text-text-dim">{subtitle}</Text> : <View className="mb-s2" />}

          {children}

          {footer ? <View className="mt-s5 gap-s2">{footer}</View> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function ProgressRail({ step, total }: { step: number; total: number }) {
  const colors = useThemeColors();
  return (
    <View className="h-[4px] w-full flex-row gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i < step ? colors.accent : 'rgba(148,163,184,0.18)',
          }}
        />
      ))}
    </View>
  );
}

/**
 * A full-width answer. Big enough to hit without looking, with the hint on
 * the row rather than in a legend somewhere else.
 */
export function OptionRow({
  label,
  hint,
  selected,
  onPress,
  tone = 'accent',
  testID,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  tone?: 'accent' | 'epic';
  testID?: string;
}) {
  const colors = useThemeColors();
  const tint = tone === 'epic' ? colors.epic : colors.accent;
  const fill = tone === 'epic' ? 'rgba(168,85,247,0.10)' : 'rgba(34,211,238,0.10)';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      className="mb-s2 w-full rounded-xl border px-s4 py-s3"
      style={{
        minHeight: 56,
        justifyContent: 'center',
        borderColor: selected ? `${tint}a0` : colors.border,
        backgroundColor: selected ? fill : 'rgba(13,21,36,0.6)',
      }}
    >
      <View className="flex-row items-center gap-s3">
        <Text
          allowFontScaling={false}
          style={{ fontSize: 14, color: selected ? tint : colors.text, ...pixelFont() }}
        >
          {selected ? '✓ ' : ''}
          {label.toUpperCase()}
        </Text>
      </View>
      {hint ? <Text className="mt-s1 text-2xs text-text-mute">{hint}</Text> : null}
    </Pressable>
  );
}

/** A compact horizontal choice — days per week, session length, weekdays. */
export function PillRow({
  options,
  isSelected,
  onToggle,
  testIDPrefix,
}: {
  options: { key: string; label: string }[];
  isSelected: (key: string) => boolean;
  onToggle: (key: string) => void;
  testIDPrefix: string;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap gap-s2">
      {options.map((o) => {
        const on = isSelected(o.key);
        return (
          <Pressable
            key={o.key}
            onPress={() => onToggle(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`${testIDPrefix}-${o.key}`}
            className="rounded-lg border px-s3"
            style={{
              minHeight: 44,
              minWidth: 52,
              alignItems: 'center',
              justifyContent: 'center',
              borderColor: on ? `${colors.accent}a0` : colors.border,
              backgroundColor: on ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
            }}
          >
            <Text
              allowFontScaling={false}
              style={{ fontSize: 12, color: on ? colors.accent : colors['text-dim'], ...pixelFont() }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
