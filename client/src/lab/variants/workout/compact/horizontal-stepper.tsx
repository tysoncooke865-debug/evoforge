import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { KeyPad } from '@/ui/core/number-field';
import { USE_CUSTOM_PAD } from '@/ui/core/pad-env';

/**
 * COMPACT variant — the horizontal stepper: [ − | value | + ] as ONE fused
 * pill (req 10/11/12). The redesign's replacement for NumberField's
 * value-box-plus-vertical-pill; the GESTURES are NumberField's, verbatim:
 * press = ±step, hold = repeat every 140ms, quick double-press = bigStep
 * plate jumps from the gesture's baseline. Tapping the value opens the
 * reused KeyPad on touch screens; desktop web keeps a typeable input
 * (Playwright tours .fill() it). No animations — verify-motion clean.
 */

const REPEAT_MS = 140;
const DOUBLE_MS = 350;

function formatValue(n: number, integer: boolean): string {
  if (integer) return String(Math.max(0, Math.trunc(n)));
  const clamped = Math.max(0, Math.round(n * 100) / 100);
  return String(clamped % 1 === 0 ? Math.trunc(clamped) : clamped);
}

function StepHalf({
  glyph,
  onStep,
  onHoldStep,
  tint,
  testID,
}: {
  glyph: string;
  onStep: () => void;
  onHoldStep: () => void;
  tint: string;
  testID?: string;
}) {
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (repeat.current !== null) {
      clearInterval(repeat.current);
      repeat.current = null;
    }
  };
  return (
    <Pressable
      onPress={onStep}
      onLongPress={() => {
        stop();
        repeat.current = setInterval(onHoldStep, REPEAT_MS);
      }}
      onPressOut={stop}
      className="items-center justify-center"
      style={{ width: 32, minHeight: 44 }}
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'increase' : 'decrease'}
      testID={testID}
    >
      <Text allowFontScaling={false} style={{ fontSize: 15, color: `${tint}cc`, ...pixelFont() }}>
        {glyph}
      </Text>
    </Pressable>
  );
}

export function HorizontalStepper({
  value,
  onChange,
  step,
  bigStep,
  quickSteps,
  integer = false,
  label,
  placeholder,
  tint,
  dim = false,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  /** Double-press plate jump (weight only). */
  bigStep?: number;
  /** KeyPad quick plate chips (weight only). */
  quickSteps?: number[];
  integer?: boolean;
  /** KeyPad heading, e.g. `WEIGHT · KG`. */
  label: string;
  placeholder: string;
  tint: string;
  /** Untouched last-session prefill renders dim until edited. */
  dim?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [padOpen, setPadOpen] = useState(false);
  const gesture = useRef<{ dir: 1 | -1; at: number; baseline: number; count: number } | null>(null);

  const bump = (dir: 1 | -1, fromHold = false) => {
    const now = Date.now();
    const current = pyFloat(value) ?? 0;
    const g = gesture.current;
    if (!fromHold && bigStep && g && g.dir === dir && now - g.at < DOUBLE_MS) {
      g.count += 1;
      g.at = now;
      onChange(formatValue(g.baseline + dir * bigStep * (g.count - 1), integer));
      return;
    }
    gesture.current = fromHold ? null : { dir, at: now, baseline: current, count: 1 };
    onChange(formatValue(current + dir * step, integer));
  };

  return (
    <View
      className="flex-1 flex-row items-center overflow-hidden"
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors['surface-2'],
        minHeight: 44,
      }}
    >
      <StepHalf
        glyph="−"
        onStep={() => bump(-1)}
        onHoldStep={() => bump(-1, true)}
        tint={tint}
        testID={testID ? `${testID}-dec` : undefined}
      />
      <View
        className="flex-1"
        style={{ borderLeftWidth: 1, borderRightWidth: 1, borderColor: `${tint}22` }}
      >
        <TextInput
          className="text-center"
          style={{
            minHeight: 42,
            fontSize: 17,
            fontWeight: '700',
            color: dim ? colors['text-dim'] : colors.text,
            fontVariant: ['tabular-nums'],
            paddingHorizontal: 2,
          }}
          inputMode={USE_CUSTOM_PAD ? 'none' : integer ? 'numeric' : 'decimal'}
          placeholder=""
          value={value}
          onChangeText={onChange}
          showSoftInputOnFocus={!USE_CUSTOM_PAD}
          pointerEvents={USE_CUSTOM_PAD ? 'none' : 'auto'}
          testID={testID}
        />
        {value === '' ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 11, letterSpacing: 0.5, color: '#5c6b82' }}>{placeholder}</Text>
          </View>
        ) : null}
        {USE_CUSTOM_PAD ? (
          <Pressable
            onPress={() => setPadOpen(true)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            accessibilityRole="button"
            accessibilityLabel={`edit ${label}`}
            testID={testID ? `${testID}-tap` : undefined}
          />
        ) : null}
      </View>
      <StepHalf
        glyph="+"
        onStep={() => bump(1)}
        onHoldStep={() => bump(1, true)}
        tint={tint}
        testID={testID ? `${testID}-inc` : undefined}
      />
      {USE_CUSTOM_PAD && padOpen ? (
        <KeyPad
          label={label}
          initial={value}
          integer={integer}
          tint={tint}
          quickSteps={quickSteps}
          onDone={onChange}
          onClose={() => setPadOpen(false)}
        />
      ) : null}
    </View>
  );
}
