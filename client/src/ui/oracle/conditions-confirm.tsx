import { Text, View } from 'react-native';

import type { PhotoConditions } from '@/data/ai';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';

const LIGHTING_OPTIONS = ['flattering', 'neutral', 'unflattering'] as const;
const PUMP_OPTIONS = ['none', 'mild', 'moderate', 'strong'] as const;

/**
 * ORACLE_REDESIGN — the estimate→confirm step (IMPROVEMENT_PLAN #6), extracted
 * so physique and body-fat share one truth. The AI's guess at the photo
 * conditions arrives pre-selected; confirming unchanged saves the provisional
 * verdict (cache hit, no second model call); correcting re-judges.
 */
export function ConditionsConfirm({
  estimate,
  lighting,
  pump,
  onLighting,
  onPump,
  corrected,
  busy,
  onConfirm,
}: {
  estimate: PhotoConditions | null;
  lighting: string;
  pump: string;
  onLighting: (v: string) => void;
  onPump: (v: string) => void;
  corrected: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="mt-s3 rounded-xl p-s3"
      style={{ borderWidth: 1, borderColor: `${colors.warn}45`, backgroundColor: 'rgba(6,12,24,0.5)' }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, color: colors.warn, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        THE ORACLE READ THE CONDITIONS AS…
      </Text>
      {estimate?.estimated === false ? (
        <Text className="mt-s1 text-2xs text-text-mute">
          Estimate unavailable — defaults shown; correct them if needed.
        </Text>
      ) : null}
      <Text className="mb-s1 mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
        LIGHTING
      </Text>
      <View className="flex-row flex-wrap gap-s2">
        {LIGHTING_OPTIONS.map((o) => (
          <Chip
            key={o}
            label={o.toUpperCase()}
            active={lighting === o}
            onPress={() => onLighting(o)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          />
        ))}
      </View>
      <Text className="mb-s1 mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
        PUMP
      </Text>
      <View className="flex-row flex-wrap gap-s2">
        {PUMP_OPTIONS.map((o) => (
          <Chip
            key={o}
            label={o.toUpperCase()}
            active={pump === o}
            onPress={() => onPump(o)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          />
        ))}
      </View>
      <View className="mt-s3">
        <NeonButton
          title={corrected ? 'RE-JUDGE WITH MY CORRECTIONS' : 'LOOKS RIGHT · SAVE VERDICT'}
          onPress={onConfirm}
          busy={busy}
          testID="conditions-confirm"
        />
      </View>
    </View>
  );
}
