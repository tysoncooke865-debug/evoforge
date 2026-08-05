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
 *
 * 2026-08-05 (guided scan pass): a SCAN PROGRESS strip under the frame —
 * segments per slot, filled as each photo lands, plus the completion %.
 * "Uploading files" reads like an attachment picker; a progress readout
 * that fills as the scan is PREPARED reads like the AI is already working
 * with what it has. `tint` lets the caller (Physique vs Body Fat) keep its
 * own colour identity rather than both scanners looking identical.
 */
export function BodyScanner({
  labels,
  photos,
  onPick,
  state,
  tint,
}: {
  labels: readonly string[];
  photos: readonly (string | null)[];
  onPick: (index: number) => void;
  state: ScanState;
  /** Defaults to the accent (Physique's identity); Body Fat passes its own. */
  tint?: string;
}) {
  const colors = useThemeColors();
  const colour = tint ?? colors.accent;
  const filled = photos.filter((p) => p !== null).length;
  const pct = labels.length > 0 ? Math.round((filled / labels.length) * 100) : 0;
  return (
    <ScanFrame state={state}>
      <View className="flex-row gap-s2">
        {labels.map((label, i) => (
          <PhotoSlot key={label} label={label} uri={photos[i] ?? null} onPick={() => onPick(i)} tint={colour} />
        ))}
      </View>
      <View className="mt-s3 flex-row items-center" style={{ gap: 8 }} testID="scan-progress">
        <View className="flex-1 flex-row" style={{ gap: 3 }}>
          {labels.map((label, i) => (
            <View
              key={label}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: photos[i] ? colour : colors['surface-3'],
                shadowColor: colour,
                shadowOpacity: photos[i] ? 0.6 : 0,
                shadowRadius: 4,
              }}
            />
          ))}
        </View>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 9, letterSpacing: 0.5, color: colour, ...pixelFont(false) }}
        >
          {filled}/{labels.length} · {pct}%
        </Text>
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
