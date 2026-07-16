import { useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { pyFloat } from '@/domain/py';
import tokens from '@/theme/tokens';
import { USE_CUSTOM_PAD } from '@/ui/core/pad-env';

/**
 * The weight/reps entry control (Tyson, 2026-07-12, iterated live):
 *   - value box with STACKED +/− to its RIGHT (both weight and reps);
 *   - single press steps (weight 2.5 kg, reps 1); HOLD repeats the small
 *     step; a quick DOUBLE-PRESS on the weight buttons jumps in 20 kg
 *     plates from where the gesture started (tap-tap = +20, tap-tap-tap
 *     = +40 — for racking big jumps without ten taps);
 *   - tapping the value on ANY touch screen (native app or phone browser)
 *     opens the in-app KEYPAD — the OS keyboard never appears
 *     (inputMode 'none'); ✕ / DONE / backdrop all close it, and a
 *     just-closed guard stops the focus bounce from reopening it;
 *   - desktop web (fine pointer, no touch) keeps a plain typeable input,
 *     which is also what the Playwright tours .fill().
 */

const REPEAT_MS = 140;
const DOUBLE_MS = 350;

function formatValue(n: number, integer: boolean): string {
  if (integer) return String(Math.max(0, Math.trunc(n)));
  const clamped = Math.max(0, Math.round(n * 100) / 100);
  return String(clamped % 1 === 0 ? Math.trunc(clamped) : clamped);
}

function StepButton({
  glyph,
  onStep,
  onHoldStep,
  tint,
  narrow = false,
  testID,
}: {
  glyph: string;
  onStep: () => void;
  onHoldStep: () => void;
  tint: string;
  narrow?: boolean;
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
      // Chrome lives on the FUSED PILL wrapper (P2 C2 item 11); the halves
      // stay bare so the pill reads as one control. Narrower + quieter than the
      // value box (Tyson 2026-07-16: the steppers must not shout over the number).
      className="items-center justify-center"
      style={{ width: narrow ? 22 : 26, height: 26 }}
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'increase' : 'decrease'}
      testID={testID}
    >
      <Text className="text-2xs font-bold" style={{ color: `${tint}cc`, lineHeight: 14 }}>
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

/** A single quick-adjust plate chip (e.g. "+10" / "−2.5") on the keypad. */
function QuickChip({ label, onPress, tint, testID }: { label: string; onPress: () => void; tint: string; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center justify-center rounded-md border"
      style={{ minHeight: 40, borderColor: `${tint}55`, backgroundColor: `${tint}14` }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text className="text-sm font-bold" style={{ color: tint }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function KeyPad({
  label,
  initial,
  integer,
  tint,
  quickSteps,
  onDone,
  onClose,
}: {
  label: string;
  initial: string;
  integer: boolean;
  tint: string;
  /** Quick +/− plate buttons (weight only), e.g. [2.5, 5, 10, 20]. */
  quickSteps?: number[];
  onDone: (v: string) => void;
  onClose: () => void;
}) {
  // Mounted fresh on every open (the parent conditions the render), so the
  // draft always seeds from the value as it was when the pad opened.
  const [draft, setDraft] = useState(initial);
  // Calculator convention: the FIRST keystroke replaces the seeded value
  // (typing 82.5 over a 70 must give 82.5, not 7082.5); backspace edits it.
  const [touched, setTouched] = useState(false);
  const press = (k: string) => {
    const base = touched ? draft : k === '⌫' ? draft : '';
    setTouched(true);
    if (k === '⌫') return setDraft(draft.slice(0, -1));
    if (k === '.') {
      if (integer || base.includes('.')) return;
      return setDraft(base === '' ? '0.' : `${base}.`);
    }
    setDraft(base === '0' ? k : base.length >= 6 ? base : `${base}${k}`);
  };
  // Quick plate adjust: bump the CURRENT draft by ±delta (clamped ≥ 0).
  const adjust = (delta: number) => {
    setTouched(true);
    const cur = pyFloat(draft) ?? 0;
    setDraft(formatValue(Math.max(0, cur + delta), integer));
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${tint}40`, backgroundColor: tokens.colors.surface }}
        >
          <View className="mb-s3 flex-row items-center justify-between">
            <Pressable
              onPress={onClose}
              className="items-center justify-center rounded-md border border-border"
              style={{ width: 44, height: 44 }}
              accessibilityRole="button"
              accessibilityLabel="close keypad"
              testID="keypad-close"
            >
              <Text className="text-base font-bold text-text-dim">✕</Text>
            </Pressable>
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {label}
            </Text>
            <Text className="text-3xl font-bold text-text" style={{ textShadowColor: `${tint}88`, textShadowRadius: 12 }}>
              {draft === '' ? '·' : draft}
            </Text>
          </View>

          {/* Quick plate adjust (weight only) — a −row and a +row. */}
          {quickSteps && quickSteps.length > 0 ? (
            <View className="mb-s2" style={{ gap: 6 }}>
              <View className="flex-row" style={{ gap: 6 }}>
                {[...quickSteps].reverse().map((s) => (
                  <QuickChip key={`m${s}`} label={`−${s}`} onPress={() => adjust(-s)} tint={tokens.colors.danger} testID={`keypad-minus-${s}`} />
                ))}
              </View>
              <View className="flex-row" style={{ gap: 6 }}>
                {quickSteps.map((s) => (
                  <QuickChip key={`p${s}`} label={`+${s}`} onPress={() => adjust(s)} tint={tint} testID={`keypad-plus-${s}`} />
                ))}
              </View>
            </View>
          ) : null}

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
            testID="keypad-done"
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
  bigStep,
  quickSteps,
  dim = false,
  narrow = false,
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
  /** Quick double-press jump (weight: 20 kg plates). Omit for reps. */
  bigStep?: number;
  /** Quick +/− plate buttons shown on the keypad (weight only), e.g. [2.5, 5, 10, 20]. */
  quickSteps?: number[];
  /** True = render the value dimmed (untouched last-session prefill). */
  dim?: boolean;
  /** Sub-360px screens: slimmer steppers (P2 sweep, iPhone SE1/5s). */
  narrow?: boolean;
  testID?: string;
}) {
  const [padOpen, setPadOpen] = useState(false);
  const gesture = useRef<{ dir: 1 | -1; at: number; baseline: number; count: number } | null>(null);

  const bump = (dir: 1 | -1, fromHold = false) => {
    const now = Date.now();
    const current = pyFloat(value) ?? 0;
    const g = gesture.current;
    if (!fromHold && bigStep && g && g.dir === dir && now - g.at < DOUBLE_MS) {
      // Double-press: the gesture becomes plate jumps from where it started.
      g.count += 1;
      g.at = now;
      onChange(formatValue(g.baseline + dir * bigStep * (g.count - 1), integer));
      return;
    }
    gesture.current = fromHold ? null : { dir, at: now, baseline: current, count: 1 };
    onChange(formatValue(current + dir * step, integer));
  };

  return (
    <View className="flex-row items-center gap-s1">
      <View>
        <TextInput
          className="rounded-md border border-border bg-surface-2 p-s2 text-center"
          // dim = untouched prefill (P2 C2 item 1.7): text-dim, NOT text-mute
          // (mute is the placeholder colour). tabular-nums keeps 137.5 and
          // 8888 from wobbling the fixed-width column (item 10).
          style={{
            width,
            minHeight: 58,
            // The number is the HERO of the row (Tyson 2026-07-16): big and
            // bold so it reads at a glance, louder than the steppers beside it.
            // Sized to still fit "137.5" in the field width.
            fontSize: narrow ? 17 : 20,
            fontWeight: '800',
            color: dim ? tokens.colors['text-dim'] : tokens.colors.text,
            fontVariant: ['tabular-nums'],
          }}
          inputMode={USE_CUSTOM_PAD ? 'none' : integer ? 'numeric' : 'decimal'}
          placeholder={placeholder}
          placeholderTextColor="#64758f"
          value={value}
          onChangeText={onChange}
          showSoftInputOnFocus={!USE_CUSTOM_PAD}
          pointerEvents={USE_CUSTOM_PAD ? 'none' : 'auto'}
          testID={testID}
        />
        {USE_CUSTOM_PAD ? (
          // On touch screens the input NEVER takes focus — this overlay owns
          // the tap and opens the pad. Focus bounce (the unclosable-pad live
          // bug) is impossible when nothing gets focused.
          <Pressable
            onPress={() => setPadOpen(true)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            accessibilityRole="button"
            accessibilityLabel={`edit ${label}`}
            testID={testID ? `${testID}-tap` : undefined}
          />
        ) : null}
      </View>
      <View
        style={{
          borderWidth: 1,
          borderColor: `${tint}26`,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: `${tint}08`,
        }}
      >
        <StepButton
          glyph="+"
          onStep={() => bump(1)}
          onHoldStep={() => bump(1, true)}
          tint={tint}
          narrow={narrow}
          testID={testID ? `${testID}-inc` : undefined}
        />
        <View style={{ height: 1, backgroundColor: `${tint}22` }} />
        <StepButton
          glyph="−"
          onStep={() => bump(-1)}
          onHoldStep={() => bump(-1, true)}
          tint={tint}
          narrow={narrow}
          testID={testID ? `${testID}-dec` : undefined}
        />
      </View>
      {USE_CUSTOM_PAD && padOpen ? (
        <KeyPad label={label} initial={value} integer={integer} tint={tint} quickSteps={quickSteps} onDone={onChange} onClose={() => setPadOpen(false)} />
      ) : null}
    </View>
  );
}
