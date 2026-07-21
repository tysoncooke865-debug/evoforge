import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * AI TRANSPARENCY — the visible "this was made by a machine" markers. Wherever a
 * result is produced or assisted by AI we show one of these, so a user always
 * knows an estimate came from a model rather than a measurement. Both link to
 * the AI & Health notice for the full disclosure.
 */

/** A compact "✦ AI" pill to sit beside an AI-generated value or heading. */
export function AiBadge({ label = 'AI', testID }: { label?: string; testID?: string }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push('/legal?doc=ai' as never)}
      accessibilityRole="button"
      accessibilityLabel="AI-generated — learn more"
      testID={testID ?? 'ai-badge'}
      className="flex-row items-center rounded-pill border px-s2"
      style={{ minHeight: 22, gap: 3, borderColor: `${colors.accent}66`, backgroundColor: `${colors.accent}14` }}
    >
      <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.accent }}>✦</Text>
      <Text allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 1, color: colors.accent, ...pixelFont(false) }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A one-line notice under an AI result: what it is, and a tap to the notice. */
export function AiNotice({ text = 'AI estimate — a rough guide, not medical advice.', testID }: { text?: string; testID?: string }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push('/legal?doc=ai' as never)}
      accessibilityRole="button"
      testID={testID ?? 'ai-notice'}
      className="flex-row items-center"
      style={{ gap: 5, minHeight: 28 }}
    >
      <View style={{ width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${colors.accent}66` }}>
        <Text allowFontScaling={false} style={{ fontSize: 8, color: colors.accent }}>✦</Text>
      </View>
      <Text className="flex-1 text-2xs" style={{ color: colors['text-mute'], lineHeight: 15 }}>
        {text} <Text style={{ color: colors.accent }}>Learn more</Text>
      </Text>
    </Pressable>
  );
}
