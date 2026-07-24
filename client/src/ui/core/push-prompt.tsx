import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { enablePush, pushPermission } from '@/data/push';
import { usePushPromptStore } from '@/state/push-prompt-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * POST-WORKOUT PUSH OFFER — mounted once (main layout), raised by the finish
 * path from the athlete's SECOND completed workout onward.
 *
 * The promise is deliberately narrow and true: a reminder on the days their own
 * schedule says they train, naming the session. That is what
 * `training-reminder` (migration 085) actually sends. It does not promise
 * streak-saving, social pings, or anything else nothing sends.
 *
 * Mounted FIRST in the layout's prompt stack so it renders BENEATH the share
 * and save-routine sheets — the same convention those two already use with each
 * other. An athlete dismisses the others and finds this one; nobody is asked
 * three things at once on top of each other.
 */
export function PushPrompt() {
  const colors = useThemeColors();
  const pending = usePushPromptStore((s) => s.pending);
  const clear = usePushPromptStore((s) => s.clear);
  const disableForever = usePushPromptStore((s) => s.disableForever);
  const [busy, setBusy] = useState(false);

  // Never ask someone who cannot act on it: a browser without the Push API, or
  // an athlete who has already decided (granted OR denied — a denial is a
  // browser-level block that this sheet cannot undo, so re-asking is noise).
  if (!pending || pushPermission() !== 'default') return null;

  const turnOn = async () => {
    setBusy(true);
    const next = await enablePush();
    setBusy(false);
    clear();
    useToastStore.getState().push(
      next === 'granted'
        ? { kind: 'achievement', title: 'REMINDERS ON', subtitle: 'We’ll nudge you on your training days.' }
        : { kind: 'info', title: 'NOT ENABLED', subtitle: 'You can turn reminders on any time from Social → notifications.' }
    );
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={clear}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.6)' }} onPress={clear}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface }}
        >
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <View
              className="items-center justify-center rounded-lg border"
              style={{ width: 44, height: 44, borderColor: `${colors.accent}8c`, backgroundColor: `${colors.accent}14` }}
            >
              <Text style={{ fontSize: 20, color: colors.accent }}>🔔</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, color: colors.accent, ...pixelFont(false) }}>
                TWO DOWN
              </Text>
              <Text className="mt-s1 text-sm font-bold text-text">Want a nudge on your training days?</Text>
              <Text className="mt-s1 text-2xs text-text-mute">
                One reminder naming the session you have planned. Nothing else.
              </Text>
            </View>
          </View>

          <View className="mt-s3 flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NeonButton
                title={busy ? 'ASKING…' : 'REMIND ME'}
                variant="primary"
                onPress={turnOn}
                disabled={busy}
                testID="push-prompt-enable"
              />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton title="NOT NOW" variant="ghost" onPress={clear} testID="push-prompt-dismiss" />
            </View>
          </View>
          <Pressable
            onPress={disableForever}
            accessibilityRole="button"
            testID="push-prompt-never"
            className="mt-s2 items-center"
            style={{ minHeight: 32, justifyContent: 'center' }}
          >
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 0.5 }}>Don&apos;t ask again</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
