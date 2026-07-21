import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

import { HELP, helpKeyForPath, type HelpTopic } from './help-content';

/**
 * PAGE HELP — a single global affordance mounted in the authed layout. It reads
 * the current route, and if that screen has a help topic it:
 *   • auto-opens the coach-mark the FIRST time you land on that screen, and
 *   • leaves a floating "?" so you can reopen it any time.
 *
 * "Seen" is one AsyncStorage set keyed by screen, so each screen explains itself
 * exactly once unprompted. Auto-open waits until the first-run tour is done, so
 * a brand-new athlete isn't hit with two overlays at once on Home.
 */

const SEEN_KEY = 'evoforge-help-seen-v1';
const TOUR_KEY = 'evoforge-tutorial-done-v1'; // shared with TutorialOverlay

export function PageHelp() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const key = helpKeyForPath(pathname);
  const topic = key ? HELP[key] : null;

  const [seen, setSeen] = useState<Set<string> | null>(null); // null = loading
  const [tourDone, setTourDone] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [rawSeen, rawTour] = await AsyncStorage.multiGet([SEEN_KEY, TOUR_KEY]);
        const arr = rawSeen[1] ? (JSON.parse(rawSeen[1]) as string[]) : [];
        setSeen(new Set(Array.isArray(arr) ? arr : []));
        setTourDone(Boolean(rawTour[1]));
      } catch {
        setSeen(new Set());
        setTourDone(true); // never let a storage error suppress help forever
      }
    })();
  }, []);

  // First visit to a screen with a topic auto-opens it (once the tour is done).
  // Deferred a beat so the screen paints before the sheet rises over it.
  useEffect(() => {
    if (!topic || !key || seen === null || tourDone === null) return;
    if (!tourDone || seen.has(key)) return;
    const t = setTimeout(() => {
      setOpen(true);
      const next = new Set(seen).add(key);
      setSeen(next);
      void AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
    }, 450);
    return () => clearTimeout(t);
  }, [key, topic, seen, tourDone]);

  if (!topic) return null;

  // Sit clear of the tab bar (54 + safe-area, per the layout's tabBarStyle).
  const bottom = 54 + Math.max(insets.bottom, 4) + 12;

  return (
    <>
      <FabButton bottom={bottom} onPress={() => setOpen(true)} />
      {open ? <HelpSheet topic={topic} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function FabButton({ bottom, onPress }: { bottom: number; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: 14, bottom, zIndex: 45 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Help for this page"
        testID="page-help-fab"
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: `${colors.accent}80`,
          backgroundColor: 'rgba(8,14,26,0.9)',
          shadowColor: colors.accent,
          shadowOpacity: 0.45,
          shadowRadius: 10,
        }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 16, color: colors.accent, ...pixelFont() }}>?</Text>
      </Pressable>
    </View>
  );
}

function HelpSheet({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const colors = useThemeColors();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.8)' }}>
        {/* Tap the scrim to dismiss. */}
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="close help" />
        <View
          className="rounded-t-2xl border-t border-x p-s5"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface, maxHeight: '82%' }}
          testID="page-help-overlay"
        >
          <View className="mb-s2 flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${colors.accent}80` }}>
                <Text allowFontScaling={false} style={{ fontSize: 12, color: colors.accent, ...pixelFont() }}>?</Text>
              </View>
              <Text
                className="text-text"
                allowFontScaling={false}
                style={{ fontSize: 18, letterSpacing: 1, textShadowColor: 'rgba(34,211,238,0.4)', textShadowRadius: 12, ...pixelFont() }}
              >
                {topic.title}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="close" testID="page-help-close" hitSlop={10} style={{ minWidth: 40, minHeight: 40, alignItems: 'flex-end', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: colors['text-mute'] }}>✕</Text>
            </Pressable>
          </View>

          <Text className="mb-s3 text-sm text-text-dim">{topic.tagline}</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {topic.sections.map((s, i) => (
              <View key={i} className="mb-s3">
                <Text className="mb-s1 text-accent" allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 0.5, ...pixelFont(false) }}>
                  {s.heading.toUpperCase()}
                </Text>
                <Text className="text-sm text-text-dim" style={{ lineHeight: 20 }}>{s.body}</Text>
              </View>
            ))}
          </ScrollView>

          <View className="mt-s2">
            <NeonButton title="GOT IT" onPress={onClose} testID="page-help-got-it" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
