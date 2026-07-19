import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { useSaveRoutine } from '@/data/routines';
import { splitWorkoutName } from '@/domain/workout-estimates';
import { useSaveRoutinePromptStore } from '@/state/save-routine-prompt-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { TextField } from '@/ui/core/text-field';

/**
 * 065 — POST-QUICK-WORKOUT SAVE PROMPT. Mounted once (main layout). When an
 * ad-hoc workout finishes, workout.tsx offers it here; a three-step sheet:
 *
 *   ask      "Save this workout as a routine?"      SAVE / NOT NOW
 *   name     name it (defaults to the ad-hoc name)  → useSaveRoutine
 *   schedule "Add it to your schedule?"             YES → /schedule?add=name
 *
 * Every step is a choice; dismissing anywhere abandons the rest. A duplicate
 * name keeps the name step open (the mutation already toasts the reason).
 */
export function SaveRoutinePrompt() {
  const colors = useThemeColors();
  const router = useRouter();
  const pending = useSaveRoutinePromptStore((s) => s.pending);
  const clear = useSaveRoutinePromptStore((s) => s.clear);
  const saveRoutine = useSaveRoutine();
  const [step, setStep] = useState<'ask' | 'name' | 'schedule'>('ask');
  const [name, setName] = useState<string | null>(null); // null = untouched → default
  const [savedName, setSavedName] = useState('');

  if (!pending) return null;

  const title = splitWorkoutName(pending.name).title;
  const draft = name ?? pending.name;

  const close = () => {
    clear();
    setStep('ask');
    setName(null);
    setSavedName('');
  };

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 2) return;
    saveRoutine.mutate(
      { name: trimmed, exercises: pending.exercises },
      { onSuccess: () => { setSavedName(trimmed); setStep('schedule'); } }
    );
  };

  const toSchedule = () => {
    const target = savedName;
    close();
    router.push(`/schedule?add=${encodeURIComponent(target)}` as never);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.6)' }} onPress={close}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface }}
        >
          {step === 'ask' ? (
            <>
              <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, color: colors.success, ...pixelFont(false) }}>
                WORKOUT COMPLETE
              </Text>
              <Text className="mt-s1 text-sm font-bold text-text" numberOfLines={2}>
                Save {title} as a routine?
              </Text>
              <Text className="mt-s1 text-2xs text-text-mute">
                {pending.exercises.length} exercise{pending.exercises.length === 1 ? '' : 's'} — do it again any time.
              </Text>
              <View className="mt-s3 flex-row" style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <NeonButton title="SAVE" onPress={() => setStep('name')} testID="save-routine-yes" />
                </View>
                <View style={{ flex: 1 }}>
                  <NeonButton title="NOT NOW" variant="ghost" onPress={close} testID="save-routine-dismiss" />
                </View>
              </View>
            </>
          ) : null}

          {step === 'name' ? (
            <>
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                NAME THIS ROUTINE
              </Text>
              <TextField
                value={draft}
                onChange={setName}
                placeholder="e.g. Ab Circuit"
                label="ROUTINE NAME"
                testID="save-routine-name"
              />
              <View className="mt-s3 flex-row" style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <NeonButton
                    title="SAVE ROUTINE"
                    onPress={save}
                    busy={saveRoutine.isPending}
                    disabled={draft.trim().length < 2}
                    testID="save-routine-confirm"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <NeonButton title="CANCEL" variant="ghost" onPress={close} testID="save-routine-cancel" />
                </View>
              </View>
            </>
          ) : null}

          {step === 'schedule' ? (
            <>
              <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, color: colors.success, ...pixelFont(false) }}>
                ROUTINE SAVED
              </Text>
              <Text className="mt-s1 text-sm font-bold text-text" numberOfLines={2}>
                Add {savedName} to your schedule?
              </Text>
              <Text className="mt-s1 text-2xs text-text-mute">
                It becomes an extra workout on a day you pick — you confirm on the schedule page.
              </Text>
              <View className="mt-s3 flex-row" style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <NeonButton title="ADD TO SCHEDULE" onPress={toSchedule} testID="save-routine-schedule" />
                </View>
                <View style={{ flex: 1 }}>
                  <NeonButton title="NO THANKS" variant="ghost" onPress={close} testID="save-routine-no-schedule" />
                </View>
              </View>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
