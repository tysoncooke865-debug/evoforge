import { useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { evalEnergyExpression } from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { useThemeColors } from '@/theme/use-theme';
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

/** Calculator mode (the fuel converter): the four operators as pad keys.
 *  Display glyphs — evalEnergyExpression normalizes them when evaluating. */
const OPERATOR_KEYS = ['+', '−', '×', '÷'] as const;
const isOperator = (ch: string): boolean => (OPERATOR_KEYS as readonly string[]).includes(ch);

/** "435×5" → "2175": the RESULT replaces the equation once entry is done
 *  (keypad DONE / desktop blur). Null = not evaluable, leave the text alone. */
const collapseExpression = (v: string): string | null => {
  const n = evalEnergyExpression(v);
  if (n === null) return null;
  return String(Math.round(n * 100) / 100);
};

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
  calculator = false,
  onDone,
  onClose,
}: {
  label: string;
  initial: string;
  integer: boolean;
  tint: string;
  /** Quick +/− plate buttons (weight only), e.g. [2.5, 5, 10, 20]. */
  quickSteps?: number[];
  /** Expression entry (the fuel converter): adds + − × ÷ keys and lets the
   *  draft hold "435×5"-style arithmetic instead of one number. */
  calculator?: boolean;
  onDone: (v: string) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  // Mounted fresh on every open (the parent conditions the render), so the
  // draft always seeds from the value as it was when the pad opened.
  const [draft, setDraft] = useState(initial);
  // Calculator convention: the FIRST keystroke replaces the seeded value
  // (typing 82.5 over a 70 must give 82.5, not 7082.5); backspace edits it.
  // An OPERATOR as the first keystroke keeps the seed instead — "×5" after
  // opening on 435 means 435×5, not ×5.
  const [touched, setTouched] = useState(false);
  const press = (k: string) => {
    const base = touched || (calculator && isOperator(k)) ? draft : k === '⌫' ? draft : '';
    setTouched(true);
    if (k === '⌫') return setDraft(draft.slice(0, -1));
    if (calculator && isOperator(k)) {
      if (base === '') return;
      const last = base[base.length - 1];
      // No double operators: a second operator replaces the first.
      if (isOperator(last) || last === '.') return setDraft(`${base.slice(0, -1)}${k}`);
      return setDraft(base.length >= 18 ? base : `${base}${k}`);
    }
    if (k === '.') {
      if (integer) return;
      // The dot rule applies to the CURRENT number — the segment after the
      // last operator, not the whole expression.
      const segment = calculator ? base.split(/[+−×÷]/).pop() ?? '' : base;
      if (segment.includes('.')) return;
      return setDraft(base === '' || (calculator && isOperator(base[base.length - 1] ?? '')) ? `${base}0.` : `${base}.`);
    }
    setDraft(base === '0' ? k : base.length >= (calculator ? 18 : 6) ? base : `${base}${k}`);
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
          style={{ borderColor: `${tint}40`, backgroundColor: colors.surface }}
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
            <Text
              className={calculator ? 'text-xl font-bold text-text' : 'text-3xl font-bold text-text'}
              numberOfLines={1}
              style={{ textShadowColor: `${tint}88`, textShadowRadius: 12, flexShrink: 1, marginLeft: 8 }}
            >
              {draft === '' ? '·' : draft}
            </Text>
          </View>

          {/* Calculator mode: the running total, so the athlete sees the label
              maths resolve before pressing DONE. */}
          {calculator && /[+−×÷]/.test(draft) ? (
            <Text className="mb-s2 text-right text-sm font-bold" style={{ color: tint }} testID="keypad-result">
              = {(() => { const r = evalEnergyExpression(draft); return r === null ? '·' : String(Math.round(r * 10) / 10); })()}
            </Text>
          ) : null}

          {/* Calculator mode: the four operators. */}
          {calculator ? (
            <View className="mb-s2 flex-row gap-s2">
              {OPERATOR_KEYS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => press(k)}
                  className="flex-1 items-center justify-center rounded-md border"
                  style={{ minHeight: 44, borderColor: `${tint}55`, backgroundColor: `${tint}14` }}
                  accessibilityRole="button"
                  accessibilityLabel={`operator ${k}`}
                  testID={`keypad-op-${k}`}
                >
                  <Text className="text-xl font-bold" style={{ color: tint }}>
                    {k}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Quick plate adjust (weight only) — a −row and a +row. */}
          {quickSteps && quickSteps.length > 0 ? (
            <View className="mb-s2" style={{ gap: 6 }}>
              <View className="flex-row" style={{ gap: 6 }}>
                {[...quickSteps].reverse().map((s) => (
                  <QuickChip key={`m${s}`} label={`−${s}`} onPress={() => adjust(-s)} tint={colors.danger} testID={`keypad-minus-${s}`} />
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
              // Calculator: DONE hands back the RESULT, not the equation —
              // the field (and anything logged from it) carries the number.
              onDone(calculator ? (collapseExpression(draft) ?? draft) : draft);
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
  tint: tintProp,
  width = 68,
  bigStep,
  quickSteps,
  dim = false,
  narrow = false,
  calculator = false,
  big = false,
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
  /** Expression entry (the fuel converter) — see KeyPad. Steppers act on the
   *  EVALUATED result, collapsing the expression (calculator convention). */
  calculator?: boolean;
  /** The card's ONE number (the quick log's energy): taller box, bigger face. */
  big?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const tint = tintProp ?? colors.accent;
  const [padOpen, setPadOpen] = useState(false);
  const gesture = useRef<{ dir: 1 | -1; at: number; baseline: number; count: number } | null>(null);

  const bump = (dir: 1 | -1, fromHold = false) => {
    const now = Date.now();
    const current = (calculator ? evalEnergyExpression(value) : pyFloat(value)) ?? 0;
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
            minHeight: big ? 62 : 54,
            // A clear, confident number — larger than the steppers beside it,
            // but NOT oversized (Tyson 2026-07-16: 800/20px read as amateur).
            fontSize: big ? 24 : narrow ? 16 : 18,
            fontWeight: '700',
            color: dim ? colors['text-dim'] : colors.text,
            fontVariant: ['tabular-nums'],
          }}
          inputMode={USE_CUSTOM_PAD ? 'none' : calculator ? 'text' : integer ? 'numeric' : 'decimal'}
          onBlur={
            calculator
              ? () => {
                  // Entry finished: the RESULT replaces the equation.
                  const collapsed = collapseExpression(value);
                  if (collapsed !== null && collapsed !== value) onChange(collapsed);
                }
              : undefined
          }
          // The native placeholder inherits the big value font and reads like a
          // value; render a small, quiet hint of our own instead (below).
          placeholder=""
          value={value}
          onChangeText={onChange}
          showSoftInputOnFocus={!USE_CUSTOM_PAD}
          pointerEvents={USE_CUSTOM_PAD ? 'none' : 'auto'}
          testID={testID}
        />
        {value === '' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, letterSpacing: 0.5, color: '#5c6b82' }}>{placeholder}</Text>
          </View>
        ) : null}
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
        <KeyPad label={label} initial={value} integer={integer} tint={tint} quickSteps={quickSteps} calculator={calculator} onDone={onChange} onClose={() => setPadOpen(false)} />
      ) : null}
    </View>
  );
}
