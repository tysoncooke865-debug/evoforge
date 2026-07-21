import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

import { HELP, helpKeyForPath, type HelpSection, type HelpTopic } from './help-content';

/**
 * PAGE HELP — a guided tour that actually POINTS at things. The first time a
 * screen opens (and any time the floating "?" is tapped) it steps through that
 * screen's features, spotlighting the real element each one lives on: the page
 * dims, the element is ringed, and a tooltip with an arrow explains it.
 *
 * Targeting is done by testID against the live DOM (this is a web PWA), so it
 * always points at where the element ACTUALLY rendered — no hard-coded
 * coordinates to drift. A section with no target, an element that isn't on
 * screen, or a native build falls back to a centred card for that step.
 *
 * "Seen" is one AsyncStorage set keyed by screen; auto-open waits for the
 * first-run tour so a new athlete never gets two overlays stacked on Home.
 */

const SEEN_KEY = 'evoforge-help-seen-v1';
const TOUR_KEY = 'evoforge-tutorial-done-v1'; // shared with TutorialOverlay
const isWeb = Platform.OS === 'web';

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
  // Deferred a beat so the screen paints before the tour starts.
  useEffect(() => {
    if (!topic || !key || seen === null || tourDone === null) return;
    if (!tourDone || seen.has(key)) return;
    const t = setTimeout(() => {
      setOpen(true);
      const next = new Set(seen).add(key);
      setSeen(next);
      void AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
    }, 500);
    return () => clearTimeout(t);
  }, [key, topic, seen, tourDone]);

  if (!topic) return null;

  const bottom = 54 + Math.max(insets.bottom, 4) + 12; // clear of the tab bar

  return (
    <>
      <FabButton bottom={bottom} onPress={() => setOpen(true)} />
      {open ? <HelpCoach topic={topic} onClose={() => setOpen(false)} /> : null}
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
          width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: `${colors.accent}80`, backgroundColor: 'rgba(8,14,26,0.9)',
          shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10,
        }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 16, color: colors.accent, ...pixelFont() }}>?</Text>
      </Pressable>
    </View>
  );
}

interface Rect { x: number; y: number; w: number; h: number }

/** The largest on-screen element matching a target testID (exact, or prefix if
 *  the target ends with '-'), as a viewport rect. null if none is visible. */
function measureTarget(target: string): { rect: Rect; el: HTMLElement } | null {
  if (typeof document === 'undefined') return null;
  const sel = target.endsWith('-') ? `[data-testid^="${target}"]` : `[data-testid="${target}"]`;
  const nodes = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
  let best: { rect: Rect; el: HTMLElement; area: number } | null = null;
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    const area = r.width * r.height;
    if (!best || area > best.area) best = { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, el, area };
  }
  return best ? { rect: best.rect, el: best.el } : null;
}

function HelpCoach({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [nonce, setNonce] = useState(0); // bump to re-measure (resize)
  const section = topic.sections[step];
  const last = step >= topic.sections.length - 1;

  // Resolve the current step's target, scrolling it into view and re-measuring.
  useEffect(() => {
    if (!isWeb || !section?.target) return; // native / no target → centred card
    let cancelled = false;
    let tries = 8;
    const tick = () => {
      if (cancelled) return;
      const found = measureTarget(section.target!);
      if (!found) {
        if (tries-- > 0) setTimeout(tick, 140);
        else setRect(null);
        return;
      }
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const r = found.rect;
      if (r.y < 72 || r.y + r.h > vh - 72) {
        // Off-screen — bring it to the middle, then measure where it landed.
        try { found.el.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
        setTimeout(() => {
          if (cancelled) return;
          const again = measureTarget(section.target!);
          setRect(again ? again.rect : r);
        }, 280);
        return;
      }
      setRect(r);
    };
    // Clear the old ring first (deferred so it isn't a synchronous effect set).
    const t = setTimeout(() => { setRect(null); tick(); }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [step, section, nonce]);

  // A native build or a target-less step has no spotlight to keep in sync.
  useEffect(() => {
    if (isWeb) return;
    const t = setTimeout(() => setRect(null), 0);
    return () => clearTimeout(t);
  }, [step]);

  // Re-measure on resize so the ring tracks a reflow.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setNonce((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const goNext = () => (last ? onClose() : setStep((s) => s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const nav = { step, total: topic.sections.length, last, onNext: goNext, onBack: goBack, onClose };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      {rect && section?.target ? (
        <Spotlight rect={rect} topic={topic} section={section} nav={nav} />
      ) : (
        <CentredCard topic={topic} section={section} nav={nav} />
      )}
    </Modal>
  );
}

interface Nav { step: number; total: number; last: boolean; onNext: () => void; onBack: () => void; onClose: () => void }

const DIM = 'rgba(2,5,11,0.82)';

/** The spotlight: four dim panels around a clear hole, a glowing ring on the
 *  target, and a tooltip with an arrow pointing at it. */
function Spotlight({ rect, topic, section, nav }: { rect: Rect; topic: HelpTopic; section: HelpSection; nav: Nav }) {
  const colors = useThemeColors();
  const { width: vw, height: vh } = useWindowDimensions();
  const pad = 8;
  const hole = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.w + pad * 2, h: rect.h + pad * 2 };
  const holeRight = hole.x + hole.w;
  const holeBottom = hole.y + hole.h;

  // Tooltip: below the target if there's room, else above.
  const TW = Math.min(340, vw - 24);
  const gap = 14;
  const below = vh - holeBottom > 190 || vh - holeBottom >= hole.y;
  const tx = Math.max(12, Math.min(rect.x + rect.w / 2 - TW / 2, vw - 12 - TW));
  const arrowLeft = Math.max(14, Math.min(rect.x + rect.w / 2 - tx - 7, TW - 28));

  const panel = (s: object, k: string) => (
    <Pressable key={k} onPress={nav.onNext} style={[{ position: 'absolute', backgroundColor: DIM }, s]} />
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Dim everything except the hole; tapping the dim advances. */}
      {panel({ left: 0, top: 0, right: 0, height: hole.y }, 'top')}
      {panel({ left: 0, top: holeBottom, right: 0, bottom: 0 }, 'bottom')}
      {panel({ left: 0, top: hole.y, width: hole.x, height: hole.h }, 'left')}
      {panel({ left: holeRight, top: hole.y, right: 0, height: hole.h }, 'right')}

      {/* The ring on the target. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h,
          borderRadius: 12, borderWidth: 2, borderColor: colors.accent,
          shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 14,
        }}
      />

      {/* The tooltip. */}
      <View style={{ position: 'absolute', left: tx, width: TW, ...(below ? { top: holeBottom + gap } : { top: undefined, bottom: vh - hole.y + gap }) }}>
        {below ? <Arrow left={arrowLeft} dir="up" colour={colors.surface} border={`${colors.accent}59`} /> : null}
        <TooltipCard topic={topic} section={section} nav={nav} />
        {!below ? <Arrow left={arrowLeft} dir="down" colour={colors.surface} border={`${colors.accent}59`} /> : null}
      </View>
    </View>
  );
}

function Arrow({ left, dir, colour, border }: { left: number; dir: 'up' | 'down'; colour: string; border: string }) {
  return (
    <View style={{ height: 10, marginLeft: left, width: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 14, height: 14, backgroundColor: colour, transform: [{ rotate: '45deg' }],
          borderTopWidth: dir === 'up' ? 1 : 0, borderLeftWidth: dir === 'up' ? 1 : 0,
          borderBottomWidth: dir === 'down' ? 1 : 0, borderRightWidth: dir === 'down' ? 1 : 0,
          borderColor: border, marginTop: dir === 'up' ? 5 : -5,
        }}
      />
    </View>
  );
}

function TooltipCard({ topic, section, nav }: { topic: HelpTopic; section: HelpSection; nav: Nav }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-xl border p-s4"
      style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 18 }}
      testID="page-help-overlay"
    >
      <StepHeader topic={topic} nav={nav} />
      <Text className="mt-s1 text-accent" allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 0.5, ...pixelFont() }}>
        {section.heading}
      </Text>
      <Text className="mt-s1 text-sm text-text-dim" style={{ lineHeight: 20 }}>{section.body}</Text>
      <StepNav nav={nav} />
    </View>
  );
}

/** Fallback when a step has no target, the element isn't on screen, or we're on
 *  native — the explanation, centred, still stepping through the tour. */
function CentredCard({ topic, section, nav }: { topic: HelpTopic; section: HelpSection; nav: Nav }) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: DIM }}>
      <Pressable style={{ flex: 1 }} onPress={nav.onNext} accessibilityLabel="next" />
      <View className="absolute inset-x-0" style={{ top: '30%', paddingHorizontal: 20 }}>
        <View
          className="rounded-2xl border p-s5"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface }}
          testID="page-help-overlay"
        >
          <StepHeader topic={topic} nav={nav} />
          {section ? (
            <>
              <Text className="mt-s2 text-accent" allowFontScaling={false} style={{ fontSize: 13, letterSpacing: 0.5, ...pixelFont() }}>
                {section.heading}
              </Text>
              <Text className="mt-s1 text-sm text-text-dim" style={{ lineHeight: 21 }}>{section.body}</Text>
            </>
          ) : null}
          <StepNav nav={nav} />
        </View>
      </View>
    </View>
  );
}

function StepHeader({ topic, nav }: { topic: HelpTopic; nav: Nav }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center" style={{ gap: 7 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${colors.accent}80` }}>
          <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.accent, ...pixelFont() }}>?</Text>
        </View>
        <Text className="text-text" allowFontScaling={false} style={{ fontSize: 13, letterSpacing: 0.5, ...pixelFont() }}>{topic.title}</Text>
      </View>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>{nav.step + 1}/{nav.total}</Text>
        <Pressable onPress={nav.onClose} accessibilityRole="button" accessibilityLabel="close help" testID="page-help-close" hitSlop={10} style={{ minWidth: 32, minHeight: 32, alignItems: 'flex-end', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, color: colors['text-mute'] }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StepNav({ nav }: { nav: Nav }) {
  const colors = useThemeColors();
  return (
    <View className="mt-s3 flex-row items-center" style={{ gap: 10 }}>
      {nav.step > 0 ? (
        <Pressable onPress={nav.onBack} accessibilityRole="button" testID="page-help-back" className="rounded-lg border px-s3" style={{ minHeight: 42, justifyContent: 'center', borderColor: colors.border }}>
          <Text className="text-2xs text-text-dim" style={{ letterSpacing: 1 }}>BACK</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <NeonButton title={nav.last ? 'GOT IT' : 'NEXT'} onPress={nav.onNext} testID="page-help-next" />
      </View>
    </View>
  );
}

/** Native / non-DOM fallback kept for completeness — the whole topic as a list.
 *  Currently unused on web (the coach handles native via CentredCard), but left
 *  exported-free for a future native path that wants the full sheet at once. */
export function HelpSheet({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const colors = useThemeColors();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: DIM }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View className="rounded-t-2xl border-t border-x p-s5" style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface, maxHeight: '82%' }}>
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 18, ...pixelFont() }}>{topic.title}</Text>
          <Text className="mb-s3 mt-s1 text-sm text-text-dim">{topic.tagline}</Text>
          <ScrollView>
            {topic.sections.map((s, i) => (
              <View key={i} className="mb-s3">
                <Text className="mb-s1 text-accent" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont(false) }}>{s.heading.toUpperCase()}</Text>
                <Text className="text-sm text-text-dim">{s.body}</Text>
              </View>
            ))}
          </ScrollView>
          <NeonButton title="GOT IT" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
