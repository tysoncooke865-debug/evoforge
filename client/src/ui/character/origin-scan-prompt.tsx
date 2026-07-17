import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { ORIGIN_FLAGS, useOriginStatus } from '@/data/origin';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * ORIGIN SCAN PROMPT (Tyson 2026-07-17): from now on, every sign-in without an
 * assigned Origin asks for an EvoGuide scan — the scan feeds the Evo Rating,
 * the rating crosses the confidence gate, and the Origin reveal on the Forge
 * assigns the character. Once per app launch, never blocking: LATER dismisses.
 */
let promptedThisLaunch = false;

export function OriginScanPrompt() {
  const status = useOriginStatus();
  const [open, setOpen] = useState(false);

  const eligible =
    ORIGIN_FLAGS.originRevealEnabled && status.data != null && status.data.origin_path == null;

  useEffect(() => {
    if (!eligible || promptedThisLaunch) return;
    // Give the tutorial overlay / boot moment the first few seconds.
    const t = setTimeout(() => {
      promptedThisLaunch = true;
      setOpen(true);
    }, 4000);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!open) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View className="flex-1 items-center justify-center px-s5" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }}>
        <View className="w-full max-w-[360px] rounded-xl border p-s5" style={{ borderColor: `${tokens.colors.legendary}59`, backgroundColor: tokens.colors.surface }}>
          <Text allowFontScaling={false} style={{ fontSize: 11, color: tokens.colors.legendary, letterSpacing: 2, ...pixelFont(false) }}>
            ✦ DISCOVER YOUR ORIGIN
          </Text>
          <Text className="mt-s2 text-sm text-text">
            Run an EvoGuide scan and EvoForge will read your physique, assign your Origin Path, and
            forge your champion from who you actually are.
          </Text>
          <Text className="mt-s1 text-2xs text-text-mute">
            Two photos and your bodyweight — the waist is optional. Your current champion and
            progress will not change.
          </Text>
          <View className="mt-s4 gap-s2">
            <NeonButton
              title="SCAN NOW"
              pixel
              onPress={() => {
                setOpen(false);
                router.push('/evo-scan' as never);
              }}
              testID="origin-scan-now"
            />
            <NeonButton title="LATER" variant="ghost" onPress={() => setOpen(false)} testID="origin-scan-later" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
