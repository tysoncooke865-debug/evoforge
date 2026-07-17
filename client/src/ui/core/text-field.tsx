import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useThemeColors } from '@/theme/use-theme';
import { USE_CUSTOM_PAD } from '@/ui/core/pad-env';

/**
 * The free-text sibling of NumberField (Tyson, 2026-07-16: "a similar themed
 * keyboard when pressing notes"). On touch screens tapping the field opens an
 * in-app QWERTY that matches the weight KEYPAD's bottom-sheet look — the OS
 * keyboard never appears (inputMode 'none', the input takes no focus). Desktop
 * web keeps a plain typeable box so the Playwright tours can .fill() it.
 */

const LETTERS: readonly (readonly string[])[] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
const SYMBOLS: readonly (readonly string[])[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['.', ',', '?', '!', "'", '%', '+', '*'],
];

function KeyCap({
  label,
  onPress,
  flex = 1,
  tint: tintProp,
  bg = 'rgba(13,21,36,0.7)',
  small = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  flex?: number;
  tint?: string;
  bg?: string;
  small?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const tint = tintProp ?? colors.text;
  return (
    <Pressable
      onPress={onPress}
      className="items-center justify-center rounded-md border border-border"
      style={{ flex, minHeight: 46, marginHorizontal: 2, backgroundColor: bg }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text className="font-bold" style={{ color: tint, fontSize: small ? 12 : 17 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function TextPad({
  label,
  initial,
  tint,
  onDone,
  onClose,
}: {
  label: string;
  initial: string;
  tint: string;
  onDone: (v: string) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [draft, setDraft] = useState(initial);
  const [shift, setShift] = useState(false);
  const [mode, setMode] = useState<'abc' | 'sym'>('abc');
  const rows = mode === 'abc' ? LETTERS : SYMBOLS;

  const type = (k: string) => {
    const ch = mode === 'abc' && shift ? k.toUpperCase() : k;
    setDraft((d) => (d.length >= 240 ? d : d + ch));
    if (shift) setShift(false);
  };
  const backspace = () => setDraft((d) => d.slice(0, -1));

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s3"
          style={{ borderColor: `${tint}40`, backgroundColor: colors.surface }}
        >
          <View className="mb-s2 flex-row items-center justify-between px-[2px]">
            <Pressable
              onPress={onClose}
              className="items-center justify-center rounded-md border border-border"
              style={{ width: 40, height: 40 }}
              accessibilityRole="button"
              accessibilityLabel="close keyboard"
              testID="textpad-close"
            >
              <Text className="text-base font-bold text-text-dim">✕</Text>
            </Pressable>
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {label}
            </Text>
            <Text className="text-2xs text-text-mute">{draft.length}/240</Text>
          </View>

          {/* Draft area — shows what's typed with a caret. */}
          <View
            className="mb-s3 rounded-md border bg-surface-2 px-s2 py-s2"
            style={{ minHeight: 56, borderColor: `${tint}55` }}
          >
            <Text className="text-base text-text" testID="textpad-draft">
              {draft}
              <Text style={{ color: tint }}>▌</Text>
            </Text>
          </View>

          {rows.map((row, i) => (
            <View key={i} className="mb-s2 flex-row justify-center">
              {/* Row 3 gets shift (abc) and backspace on the ends. */}
              {i === 2 ? (
                <KeyCap
                  label={mode === 'abc' ? (shift ? '⇪' : '⇧') : '='}
                  onPress={() => (mode === 'abc' ? setShift((s) => !s) : undefined)}
                  flex={1.5}
                  tint={shift ? tint : colors.text}
                  bg={shift ? `${tint}22` : 'rgba(13,21,36,0.7)'}
                  testID="textpad-shift"
                />
              ) : null}
              {row.map((k) => (
                <KeyCap key={k} label={mode === 'abc' && shift ? k.toUpperCase() : k} onPress={() => type(k)} testID={`textpad-key-${k}`} />
              ))}
              {i === 2 ? <KeyCap label="⌫" onPress={backspace} flex={1.5} testID="textpad-backspace" /> : null}
            </View>
          ))}

          {/* Bottom row: mode switch · space · done. */}
          <View className="mb-s1 flex-row justify-center">
            <KeyCap
              label={mode === 'abc' ? '?123' : 'ABC'}
              onPress={() => setMode((m) => (m === 'abc' ? 'sym' : 'abc'))}
              flex={1.6}
              small
              testID="textpad-mode"
            />
            <KeyCap label="space" onPress={() => setDraft((d) => (d.length >= 240 ? d : d + ' '))} flex={5} small testID="textpad-space" />
            <Pressable
              onPress={() => {
                onDone(draft);
                onClose();
              }}
              className="items-center justify-center rounded-md"
              style={{ flex: 1.8, minHeight: 46, marginHorizontal: 2, backgroundColor: tint, shadowColor: tint, shadowOpacity: 0.5, shadowRadius: 10 }}
              testID="textpad-done"
            >
              <Text className="text-2xs font-bold text-accent-ink" style={{ letterSpacing: 1 }}>
                DONE
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  label,
  tint: tintProp,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Keyboard heading, e.g. "NOTES". */
  label: string;
  tint?: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const tint = tintProp ?? colors.accent;
  const [padOpen, setPadOpen] = useState(false);
  return (
    <View>
      <TextInput
        className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
        placeholder={placeholder}
        placeholderTextColor="#64758f"
        value={value}
        onChangeText={onChange}
        inputMode={USE_CUSTOM_PAD ? 'none' : 'text'}
        showSoftInputOnFocus={!USE_CUSTOM_PAD}
        multiline
        pointerEvents={USE_CUSTOM_PAD ? 'none' : 'auto'}
        testID={testID}
      />
      {USE_CUSTOM_PAD ? (
        <Pressable
          onPress={() => setPadOpen(true)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityRole="button"
          accessibilityLabel={`edit ${label}`}
          testID={testID ? `${testID}-tap` : undefined}
        />
      ) : null}
      {USE_CUSTOM_PAD && padOpen ? (
        <TextPad label={label} initial={value} tint={tint} onDone={onChange} onClose={() => setPadOpen(false)} />
      ) : null}
    </View>
  );
}
