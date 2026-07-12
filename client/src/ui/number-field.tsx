import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { pyFloat } from '@/domain/py';
import tokens from '@/theme/tokens';

/**
 * The weight/reps entry control (Tyson, 2026-07-12: "the default iOS
 * keyboard looks unprofessional and messy"). Three ways in, zero OS
 * keyboard on the phone:
 *   [−] / [+]  steppers — the common gym flow is "same as last time ± a
 *              plate"; hold to repeat. Weight steps 2.5 kg, reps step 1.
 *   the value  on NATIVE opens the in-app KEYPAD (styled, dark, big keys —
 *              the system keyboard never appears: showSoftInputOnFocus is
 *              false). On WEB it stays a normal typeable input — desktop
 *              keyboards are fine and the Playwright tours .fill() it.
 * The repeat interval only ticks while a finger holds the button —
 * user-driven and transient, not ambient frame-driving (the rendering
 * contract concerns continuous loops, not interactions).
 */

const REPEAT_MS = 140;

function formatValue(n: number, integer: boolean): string {
  if (integer) return String(Math.max(0, Math.trunc(n)));
  const clamped = Math.max(0, Math.round(n * 100) / 100);
  return String(clamped % 1 === 0 ? Math.trunc(clamped) : clamped);
}

function StepButton({ glyph, onStep, tint, testID }: { glyph: string; onStep: () => void; tint: string; testID?: string }) {
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
        repeat.current = setInterval(onStep, REPEAT_MS);
      }}
      onPressOut={stop}
      className="items-center justify-center rounded-md border"
      style={{ width: 28, minHeight: 44, borderColor: `${tint}45`, backgroundColor: `${tint}12` }}
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'increase' : 'decrease'}
      testID={testID}
    >
      <Text className="text-base font-bold" style={{ color: tint }}>
        {glyph}
      </Text>
    </Pressable>
  );
}

const KEYS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

function KeyPad({
  label,
  initial,
  integer,
  tint,
  onDone,
  onClose,
}: {
  label: string;
  initial: string;
  integer: boolean;
  tint: string;
  onDone: (v: string) => void;
  onClose: () => void;
}) {
  // Mounted fresh on every open (the parent conditions the render), so the
  // draft always seeds from the value as it was when the pad opened.
  const [draft, setDraft] = useState(initial);
  const press = (k: string) => {
    if (k === '⌫') return setDraft((d) => d.slice(0, -1));
    if (k === '.') {
      if (integer || draft.includes('.')) return;
      return setDraft((d) => (d === '' ? '0.' : `${d}.`));
    }
    setDraft((d) => (d === '0' ? k : d.length >= 6 ? d : `${d}${k}`));
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${tint}40`, backgroundColor: tokens.colors.surface }}
        >
          <View className="mb-s3 flex-row items-baseline justify-between">
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {label}
            </Text>
            <Text className="text-3xl font-bold text-text" style={{ textShadowColor: `${tint}88`, textShadowRadius: 12 }}>
              {draft === '' ? '·' : draft}
            </Text>
          </View>
          {KEYS.map((row, i) => (
            <View key={i} className="mb-s2 flex-row gap-s2">
              {row.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => press(k)}
                  disabled={k === '.' && integer}
                  className="flex-1 items-center justify-center rounded-md border border-border"
                  style={{ minHeight: 52, backgroundColor: 'rgba(13,21,36,0.7)', opacity: k === '.' && integer ? 0.3 : 1 }}
                >
                  <Text className="text-xl font-bold text-text">{k}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          <Pressable
            onPress={() => {
              onDone(draft);
              onClose();
            }}
            className="mt-s1 items-center justify-center rounded-md"
            style={{ minHeight: 52, backgroundColor: tint, shadowColor: tint, shadowOpacity: 0.5, shadowRadius: 12 }}
          >
            <Text className="text-base font-bold text-accent-ink" style={{ letterSpacing: 2 }}>
              DONE
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function NumberField({
  value,
  onChange,
  step,
  placeholder,
  label,
  integer = false,
  tint = tokens.colors.accent,
  width = 68,
  steppers = true,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  placeholder: string;
  /** Keypad heading, e.g. "WEIGHT · KG". */
  label: string;
  integer?: boolean;
  tint?: string;
  width?: number;
  /** False = keypad/typing only (reps: nobody plates-math a rep count). */
  steppers?: boolean;
  testID?: string;
}) {
  const [padOpen, setPadOpen] = useState(false);
  const native = Platform.OS !== 'web';
  const bump = (dir: 1 | -1) => {
    const current = pyFloat(value) ?? 0;
    onChange(formatValue(current + dir * step, integer));
  };
  return (
    <View className="flex-row items-center gap-s1">
      {steppers ? (
        <StepButton glyph="−" onStep={() => bump(-1)} tint={tint} testID={testID ? `${testID}-dec` : undefined} />
      ) : null}
      <TextInput
        className="rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
        style={{ width, minHeight: 44 }}
        inputMode={integer ? 'numeric' : 'decimal'}
        placeholder={placeholder}
        placeholderTextColor="#64758f"
        value={value}
        onChangeText={onChange}
        showSoftInputOnFocus={!native}
        onPressIn={native ? () => setPadOpen(true) : undefined}
        testID={testID}
      />
      {steppers ? (
        <StepButton glyph="+" onStep={() => bump(1)} tint={tint} testID={testID ? `${testID}-inc` : undefined} />
      ) : null}
      {native && padOpen ? (
        <KeyPad
          label={label}
          initial={value}
          integer={integer}
          tint={tint}
          onDone={onChange}
          onClose={() => setPadOpen(false)}
        />
      ) : null}
    </View>
  );
}
