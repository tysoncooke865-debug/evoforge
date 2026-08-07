import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * ONE PROGRESSION STORY, told in three beats.
 *
 * The PR, the evolution and the attribute projection were three unrelated
 * cards in a stack. They are not unrelated — they are the same sentence:
 *
 *     I hit this lift  →  my form advanced  →  this is where I am heading
 *
 * A spine down the left edge and one heading say so. NOTHING WAS ADDED: the
 * three sections are the same components carrying the same data, connected
 * rather than merged, because merging them would have cost the breathing room
 * each needs and the brief asks for restraint, not compression.
 *
 * The connector is a hairline at low opacity — present enough to read as
 * continuity, quiet enough that it never becomes chrome competing with the
 * content it is joining.
 */
export function ProgressHub({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useThemeColors();
  const steps = Array.isArray(children) ? children.filter(Boolean) : [children];

  return (
    <View testID={testID}>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 2, ...pixelFont(false) }}
      >
        YOUR PROGRESSION
      </Text>

      <View className="mt-s2" style={{ position: 'relative' }}>
        {/* THE SPINE. Inset so it runs beside the cards rather than under
            them, and stopped short at both ends so it reads as a thread
            between the beats, not a border around them. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 3,
            top: 14,
            bottom: 14,
            width: 1,
            backgroundColor: `${colors.epic}33`,
          }}
        />
        {steps.map((step, i) => (
          <View
            key={i}
            className={i === 0 ? '' : 'mt-s3'}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
          >
            {/* One node per beat, on the spine. */}
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                marginTop: 16,
                backgroundColor: colors.epic,
                opacity: 0.55,
              }}
            />
            <View style={{ flex: 1, minWidth: 0 }}>{step}</View>
          </View>
        ))}
      </View>
    </View>
  );
}
