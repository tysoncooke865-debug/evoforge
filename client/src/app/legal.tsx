import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LEGAL, LEGAL_DOCS, type LegalDoc } from '@/ui/legal/legal-content';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * LEGAL — Terms of Use, Privacy Policy and the AI & Health notice, in one
 * tabbed screen. Lives at the ROOT (not under (auth)/(main)) so it's reachable
 * both before sign-in (the consent link on sign-up) and after (Profile).
 * `?doc=privacy|ai|terms` opens a specific tab.
 */
export default function LegalScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const initial = LEGAL_DOCS.findIndex((d) => d.id === doc);
  const [idx, setIdx] = useState(initial >= 0 ? initial : 0);
  const active: LegalDoc = LEGAL_DOCS[idx];

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-deep'], paddingTop: insets.top }}>
      <View className="flex-row items-center px-s4 pt-s3" style={{ gap: 8 }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="back"
          testID="legal-back"
          style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 22, color: colors.accent }}>‹</Text>
        </Pressable>
        <Text className="text-text" allowFontScaling={false} style={{ fontSize: 18, letterSpacing: 0.5, ...pixelFont() }}>
          LEGAL
        </Text>
      </View>

      {/* Doc tabs. */}
      <View className="flex-row px-s4 pt-s2" style={{ gap: 6 }}>
        {LEGAL_DOCS.map((d, i) => {
          const on = i === idx;
          return (
            <Pressable
              key={d.id}
              onPress={() => setIdx(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`legal-tab-${d.id}`}
              className="rounded-pill border px-s3"
              style={{ minHeight: 34, justifyContent: 'center', borderColor: on ? `${colors.accent}8c` : colors.border, backgroundColor: on ? `${colors.accent}1f` : colors['surface-2'] }}
            >
              <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, color: on ? colors.accent : colors['text-dim'], ...pixelFont(false) }}>
                {d.tab}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        className="flex-1 px-s4 pt-s3"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-text" allowFontScaling={false} style={{ fontSize: 20, letterSpacing: 0.5, ...pixelFont() }}>
          {active.title}
        </Text>
        <Text className="mt-s2 text-2xs text-text-mute" style={{ lineHeight: 17 }}>{active.intro}</Text>

        {active.sections.map((s) => (
          <View key={s.heading} className="mt-s4">
            <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 0.5, ...pixelFont(false) }}>
              {s.heading.toUpperCase()}
            </Text>
            <Text className="mt-s1 text-sm text-text-dim" style={{ lineHeight: 21 }}>{s.body}</Text>
          </View>
        ))}

        <Text className="mt-s5 text-2xs text-text-mute">
          {LEGAL.appName} · Questions? {LEGAL.contactEmail}
        </Text>
      </ScrollView>
    </View>
  );
}
