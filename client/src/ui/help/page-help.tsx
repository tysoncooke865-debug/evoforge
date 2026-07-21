import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

import { HELP, helpKeyForPath, type HelpSection, type HelpTopic } from './help-content';

/**
 * PAGE HELP — a guided tour that POINTS at things. The first time a screen opens
 * (and any time the floating "?" is tapped) it steps through that screen's
 * features, spotlighting the real element each lives on: the page dims, the
 * element is ringed, and a tooltip explains it.
 *
 * Targeting is by testID against the live DOM (this is a web PWA), so it points
 * where the element ACTUALLY rendered. Two things this file guarantees, because
 * they bit us on iPhone:
 *   1. The ring is RE-MEASURED on an interval, so it tracks a target that
 *      animates (the floating champion) or lays out late instead of going stale.
 *   2. The tooltip is ALWAYS fully inside the safe viewport — clamped
 *      horizontally, height-capped to the space above/below the target, with the
 *      nav buttons pinned so they're never pushed off-screen. If the target
 *      fills the screen (no room either side) it becomes a bottom sheet.
 *
 * "Seen" is one AsyncStorage set keyed by screen; auto-open waits for the
 * first-run tour so a new athlete never gets two overlays stacked on Home.
 */

const SEEN_KEY = 'evoforge-help-seen-v1';
const TOUR_KEY = 'evoforge-tutorial-done-v1'; // shared with TutorialOverlay
const isWeb = Platform.OS === 'web';
const DIM = 'rgba(2,5,11,0.82)';

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

function viewport(): { vw: number; vh: number } {
  if (typeof window === 'undefined') return { vw: 390, vh: 800 };
  // visualViewport is the source of truth on mobile Safari (toolbars, zoom).
  const vv = window.visualViewport;
  return { vw: vv?.width ?? window.innerWidth, vh: vv?.height ?? window.innerHeight };
}

/** The largest on-screen element matching a testID (exact, or prefix when the
 *  target ends with '-'), as a viewport rect. null if none is visible. */
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

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

/** Keep a live rect for the current step's target: scroll it into view once,
 *  then re-measure on an interval so the ring follows animation / reflow. */
function useTargetRect(target: string | undefined, stepKey: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    let alive = true;
    const apply = (r: Rect | null) => { if (alive) setRect((prev) => (sameRect(prev, r) ? prev : r)); };
    if (!isWeb || !target) {
      const t = setTimeout(() => apply(null), 0);
      return () => { alive = false; clearTimeout(t); };
    }
    let scrolled = false;
    const measure = () => {
      const found = measureTarget(target);
      if (!found) { apply(null); return; }
      const { vh } = viewport();
      const r = found.rect;
      if (!scrolled && (r.y < 72 || r.y + r.h > vh - 72)) {
        scrolled = true;
        try { found.el.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
        return; // the next tick reads the settled position
      }
      apply(r);
    };
    const t0 = setTimeout(measure, 0);
    const iv = setInterval(measure, 250);
    return () => { alive = false; clearTimeout(t0); clearInterval(iv); };
  }, [target, stepKey]);
  return rect;
}

/** Re-render on viewport changes so positions stay correct through rotation,
 *  toolbar show/hide and keyboard. */
function useViewport(): { vw: number; vh: number } {
  const [vp, setVp] = useState(viewport);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setVp(viewport());
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    window.visualViewport?.addEventListener('scroll', on);
    return () => {
      window.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('scroll', on);
    };
  }, []);
  return vp;
}

interface Nav { step: number; total: number; last: boolean; onNext: () => void; onBack: () => void; onClose: () => void }

function HelpCoach({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const section = topic.sections[step];
  const rect = useTargetRect(section?.target, step);
  const last = step >= topic.sections.length - 1;
  const nav: Nav = {
    step, total: topic.sections.length, last,
    onNext: () => (last ? onClose() : setStep((s) => s + 1)),
    onBack: () => setStep((s) => Math.max(0, s - 1)),
    onClose,
  };
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70 }}>
      <Overlay topic={topic} section={section} nav={nav} rect={rect} />
    </View>
  );
}

function Overlay({ topic, section, nav, rect }: { topic: HelpTopic; section: HelpSection; nav: Nav; rect: Rect | null }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { vw, vh } = useViewport();

  const safeTop = insets.top + 8;
  const safeBottom = vh - insets.bottom - 8;
  const gap = 14;
  const MIN = 150; // a tooltip needs at least this much room to sit beside a target
  const TW = Math.min(360, vw - insets.left - insets.right - 24);

  // Space reserved for the header + nav + padding, so only the body scrolls.
  const CHROME = 132;
  const sheetMax = safeBottom - safeTop - 8;

  // No target (or off-screen / native): a bottom sheet, always readable.
  if (!rect) {
    return (
      <View style={{ flex: 1, backgroundColor: DIM }}>
        <Pressable style={{ flex: 1 }} onPress={nav.onNext} accessibilityLabel="next" />
        <Card
          topic={topic} section={section} nav={nav} bodyMax={Math.max(48, sheetMax - CHROME)}
          style={{ position: 'absolute', left: insets.left + 12, right: insets.right + 12, bottom: insets.bottom + 12, maxHeight: sheetMax }}
        />
      </View>
    );
  }

  const pad = 8;
  const hole = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.w + pad * 2, h: rect.h + pad * 2 };
  const holeRight = hole.x + hole.w;
  const holeBottom = hole.y + hole.h;
  // Circle small near-square targets (avatar, menu, icons); a tidy rounded
  // rectangle for larger blocks so a tall card doesn't become an ellipse.
  const squareish = Math.abs(hole.w - hole.h) < Math.max(hole.w, hole.h) * 0.4;
  const small = Math.min(hole.w, hole.h) < 160;
  const ringRadius = squareish && small ? Math.min(hole.w, hole.h) / 2 + 2 : 14;

  const spaceBelow = safeBottom - (holeBottom + gap);
  const spaceAbove = hole.y - gap - safeTop;
  const mode: 'below' | 'above' | 'sheet' =
    spaceBelow >= MIN && spaceBelow >= spaceAbove ? 'below' : spaceAbove >= MIN ? 'above' : 'sheet';
  const cardMax = mode === 'below' ? spaceBelow : mode === 'above' ? spaceAbove : sheetMax;
  const bodyMax = Math.max(48, cardMax - CHROME);

  const tx = clamp(rect.x + rect.w / 2 - TW / 2, insets.left + 12, vw - insets.right - 12 - TW);
  const arrowLeft = clamp(rect.x + rect.w / 2 - tx - 7, 16, TW - 30);

  const panel = (s: object, k: string) => (
    <Pressable key={k} onPress={nav.onNext} style={[{ position: 'absolute', backgroundColor: DIM }, s]} />
  );

  const cardPos =
    mode === 'below'
      ? { left: tx, width: TW, top: holeBottom + gap, maxHeight: spaceBelow }
      : mode === 'above'
        ? { left: tx, width: TW, bottom: vh - (hole.y - gap), maxHeight: spaceAbove }
        : { left: insets.left + 12, right: insets.right + 12, bottom: insets.bottom + 12, maxHeight: safeBottom - safeTop - 8 };

  return (
    <View style={{ flex: 1 }}>
      {/* Dim everything but the hole. Tapping the dim advances. */}
      {panel({ left: 0, top: 0, right: 0, height: hole.y }, 'top')}
      {panel({ left: 0, top: holeBottom, right: 0, bottom: 0 }, 'bottom')}
      {panel({ left: 0, top: hole.y, width: hole.x, height: hole.h }, 'left')}
      {panel({ left: holeRight, top: hole.y, right: 0, height: hole.h }, 'right')}

      {/* The ring on the target. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h,
          borderRadius: ringRadius, borderWidth: 2, borderColor: colors.accent,
          shadowColor: colors.accent, shadowOpacity: 0.85, shadowRadius: 14,
        }}
      />

      {mode !== 'sheet' ? (
        <View style={{ position: 'absolute', ...cardPos }}>
          {mode === 'below' ? <Arrow left={arrowLeft} dir="up" colour={colors.surface} border={`${colors.accent}59`} /> : null}
          <Card topic={topic} section={section} nav={nav} bodyMax={bodyMax} style={{ flexShrink: 1 }} />
          {mode === 'above' ? <Arrow left={arrowLeft} dir="down" colour={colors.surface} border={`${colors.accent}59`} /> : null}
        </View>
      ) : (
        <Card topic={topic} section={section} nav={nav} bodyMax={bodyMax} style={{ position: 'absolute', ...cardPos }} />
      )}
    </View>
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));

function Arrow({ left, dir, colour, border }: { left: number; dir: 'up' | 'down'; colour: string; border: string }) {
  return (
    <View style={{ height: 10, marginLeft: left, width: 16, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
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

/** The explanation card. Header + nav are fixed; only the body scrolls, so the
 *  NEXT button is reachable no matter how tall the text or how small the space. */
function Card({ topic, section, nav, style, bodyMax }: { topic: HelpTopic; section: HelpSection; nav: Nav; style?: object; bodyMax: number }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-2xl border p-s4"
      style={[{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 18, overflow: 'hidden' }, style]}
      testID="page-help-overlay"
    >
      <StepHeader topic={topic} nav={nav} />
      <ScrollView style={{ flexShrink: 1, maxHeight: bodyMax }} contentContainerStyle={{ paddingVertical: 2 }} showsVerticalScrollIndicator={false}>
        {section ? (
          <>
            <Text className="mt-s1 text-accent" allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 0.5, ...pixelFont() }}>
              {section.heading}
            </Text>
            <Text className="mt-s1 text-sm text-text-dim" style={{ lineHeight: 20 }}>{section.body}</Text>
          </>
        ) : null}
      </ScrollView>
      <StepNav nav={nav} />
    </View>
  );
}

function StepHeader({ topic, nav }: { topic: HelpTopic; nav: Nav }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center" style={{ gap: 7, flex: 1, minWidth: 0 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${colors.accent}80` }}>
          <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.accent, ...pixelFont() }}>?</Text>
        </View>
        <Text className="text-text" numberOfLines={1} allowFontScaling={false} style={{ fontSize: 13, letterSpacing: 0.5, ...pixelFont() }}>{topic.title}</Text>
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
