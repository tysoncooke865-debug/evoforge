import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { useSharePromptStore } from '@/state/share-prompt-store';
import { splitWorkoutName } from '@/domain/workout-estimates';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelPeople } from '@/ui/core/pixel-icons';
import { CreatePostModal } from '@/ui/social/create-post';
import { socialFeatures } from '@/ui/social/social-features';

/**
 * POST-WORKOUT SHARE PROMPT — mounted once (main layout). When a workout is
 * finished, `useFinishWorkout` offers it here; a small, dismissible sheet asks
 * to share. NOTHING publishes automatically — SHARE only opens the composer
 * (pre-loaded with that workout), which the athlete still confirms. NOT NOW
 * dismisses; "Don't ask again" flips the persisted preference so the finish
 * path stops offering. Hidden entirely when the social feed is off.
 */
export function SharePrompt() {
  const colors = useThemeColors();
  const pending = useSharePromptStore((s) => s.pending);
  const clear = useSharePromptStore((s) => s.clear);
  const disableForever = useSharePromptStore((s) => s.disableForever);
  const [composerFor, setComposerFor] = useState<{ workout: string; date: string } | null>(null);

  // The composer, once opened, outlives the prompt sheet.
  if (composerFor) {
    return <CreatePostModal initialWorkout={composerFor} onClose={() => setComposerFor(null)} />;
  }

  if (!socialFeatures.feedEnabled || !pending) return null;

  const name = splitWorkoutName(pending.workout);

  const share = () => {
    const target = pending;
    clear();
    setComposerFor(target);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={clear}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.6)' }} onPress={clear}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.epic}59`, backgroundColor: colors.surface }}
        >
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <View className="items-center justify-center rounded-lg border" style={{ width: 44, height: 44, borderColor: `${colors.success}8c`, backgroundColor: `${colors.success}14` }}>
              <Text style={{ fontSize: 20, color: colors.success }}>✓</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, color: colors.success, ...pixelFont(false) }}>
                WORKOUT COMPLETE
              </Text>
              <Text className="mt-s1 text-sm font-bold text-text" numberOfLines={1}>
                Share {name.title} with your friends?
              </Text>
            </View>
            <PixelPeople size={20} color={colors.epic} />
          </View>

          <View className="mt-s3 flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NeonButton title="SHARE" variant="epic" onPress={share} testID="share-prompt-share" />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton title="NOT NOW" variant="ghost" onPress={clear} testID="share-prompt-dismiss" />
            </View>
          </View>
          <Pressable
            onPress={disableForever}
            accessibilityRole="button"
            testID="share-prompt-never"
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
