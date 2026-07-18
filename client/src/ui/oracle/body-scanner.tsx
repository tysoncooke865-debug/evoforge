import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelCamera } from '@/ui/core/pixel-icons';
import { ScanFrame, type ScanState } from '@/ui/train/scan-frame';
import { PhotoSlot } from '@/ui/oracle/photo-slot';

/**
 * ORACLE_REDESIGN — the body scanner: a futuristic frame (ScanFrame owns the
 * corner brackets + the real-request sweep + the status line) wrapping N
 * upload slots. When every slot is filled the frame glows cyan (the glow is
 * the caller's GlowCard `glow` prop; here the slots go solid + ticked). The
 * slot count is the caller's contract — 3 for physique, 2 for body fat.
 */
export function BodyScanner({
  labels,
  photos,
  onPick,
  state,
}: {
  labels: readonly string[];
  photos: readonly (string | null)[];
  onPick: (index: number) => void;
  state: ScanState;
}) {
  return (
    <ScanFrame state={state}>
      <View className="flex-row gap-s2">
        {labels.map((label, i) => (
          <PhotoSlot key={label} label={label} uri={photos[i] ?? null} onPick={() => onPick(i)} />
        ))}
      </View>
    </ScanFrame>
  );
}

export { PhotoSlot };

/** A minimal preview tile used when the scanner is collapsed into a summary. */
export function ScannerHint({ text }: { text: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-s2">
      <PixelCamera size={14} color={colors.accent} />
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {text}
      </Text>
    </View>
  );
}
