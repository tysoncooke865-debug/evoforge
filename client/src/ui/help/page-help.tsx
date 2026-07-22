import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
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
 * where the element ACTUALLY rendered. The measurement model (useSpotlight) is
 * built to feel calm, not janky:
 *   • it locks the ring ONCE per step — after any scroll-into-view has settled —
 *     rather than chasing the element on a timer (the old jank);
 *   • it never shows the bottom-sheet fallback WHILE measuring, so a step no
 *     longer flashes at the bottom and jumps to place;
 *   • the previous spotlight stays on screen during the hand-off, and the ring
 *     GLIDES to the next element (CSS transition on web);
 *   • the tooltip is always clamped fully inside the safe viewport, height-capped
 *     with the nav pinned, and falls back to a bottom sheet only when the target
 *     genuinely fills the screen.
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
type Phase = 'measuring' | 'spotlight' | 'sheet';
interface SpotState { phase: Phase; rect: Rect | null; forStep: number }

function viewport(): { vw: number; vh: number } {
  if (typeof window === 'undefined') return { vw: 390, vh: 800 };
  const vv = window.visualViewport;
  return { vw: vv?.width ?? window.innerWidth, vh: vv?.height ?? window.innerHeight };
}

/** The element matching a testID (exact, or prefix when the target ends with
 *  '-') that is MOST VISIBLE in the viewport — critical because carousels
 *  render many same-testid cards, most scrolled off-screen; raw-area would pick
 *  an off-screen one and the ring would land on nothing. Falls back to the
 *  largest element if none is on screen yet (so it can be scrolled in). Accepts
 *  a fallback CHAIN — the first target with any match wins. */
function measureTarget(target: string | string[]): { rect: Rect; el: HTMLElement } | null {
  if (typeof document === 'undefined') return null;
  const { vw, vh } = viewport();
  for (const t of Array.isArray(target) ? target : [target]) {
    const sel = t.endsWith('-') ? `[data-testid^="${t}"]` : `[data-testid="${t}"]`;
    const nodes = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
    let visible: { rect: Rect; el: HTMLElement; vis: number } | null = null;
    let anyLargest: { rect: Rect; el: HTMLElement; area: number } | null = null;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      const area = r.width * r.height;
      const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const vis = visW * visH;
      if (!anyLargest || area > anyLargest.area) anyLargest = { rect, el, area };
      if (vis > 0 && (!visible || vis > visible.vis)) visible = { rect, el, vis };
    }
    const chosen = visible ?? anyLargest;
    if (chosen) return { rect: chosen.rect, el: chosen.el };
  }
  return null;
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

/**
 * Resolve the current step's target to a stable rect. Locks ONCE per step (after
 * scroll-into-view settles), with a few late re-measures to catch reflow — no
 * perpetual timer, so the ring doesn't jitter. `forStep` lags the step index
 * until the new rect is locked, which is how the caller keeps the previous
 * spotlight on screen (and hides the new card) during the hand-off.
 */
function useSpotlight(target: string | string[] | undefined, step: number, resizeTick: number): SpotState {
  const [state, setState] = useState<SpotState>({ phase: 'measuring', rect: null, forStep: -1 });
  useEffect(() => {
    let alive = true;
    // Native or a target-less step: a bottom sheet, resolved on the next tick
    // (deferred so this isn't a synchronous setState inside the effect).
    if (!isWeb || !target) {
      const t = setTimeout(() => { if (alive) setState({ phase: 'sheet', rect: null, forStep: step }); }, 0);
      return () => { alive = false; clearTimeout(t); };
    }
    let raf = 0;
    let frames = 0;
    let scrolled = false;
    let settleFrame = 0;
    const followups: ReturnType<typeof setTimeout>[] = [];
    const loop = () => {
      if (!alive) return;
      frames += 1;
      const found = measureTarget(target);
      if (!found) {
        // ~0.6s of retries for a slow-rendering target, then fall back to the
        // sheet — long enough for late layout, short enough that a genuinely
        // absent target doesn't strand the previous ring on screen.
        if (frames > 36) setState({ phase: 'sheet', rect: null, forStep: step });
        else raf = requestAnimationFrame(loop);
        return;
      }
      const r = found.rect;
      const { vw, vh } = viewport();
      // Off-screen in EITHER axis: centre it, then let the scroll settle two
      // frames before measuring where it landed. The horizontal case matters on
      // the Train day-carousel — on iOS its initialScrollIndex often doesn't
      // land on today, so today's card sits off to the side; inline:'center'
      // scrolls the carousel (and the page) to bring it into view before we
      // lock, instead of ringing an off-screen card.
      const offV = r.y < 60 || r.y + r.h > vh - 60;
      const offH = r.x + r.w < 60 || r.x > vw - 60;
      if (!scrolled && (offV || offH)) {
        scrolled = true;
        settleFrame = frames;
        // Scroll each axis ONLY when the target is actually off-screen on that
        // axis. Passing inline:'center' for a horizontally-visible target (the
        // Home case — home-level-module is centred but below the fold) forces
        // the browser to re-centre it sideways, sliding Home off to the left.
        // 'nearest' is a no-op when the axis is already in view.
        try {
          found.el.scrollIntoView({ block: offV ? 'center' : 'nearest', inline: offH ? 'center' : 'nearest', behavior: 'auto' });
        } catch { /* ignore */ }
        raf = requestAnimationFrame(loop);
        return;
      }
      if (scrolled && frames - settleFrame < 2) { raf = requestAnimationFrame(loop); return; }

      // Lock it. Then a few late re-measures glide the ring to its final spot if
      // images/fonts reflow the page after we lock.
      setState({ phase: 'spotlight', rect: r, forStep: step });
      for (const ms of [120, 260, 440]) {
        followups.push(setTimeout(() => {
          if (!alive) return;
          const again = measureTarget(target);
          if (again) setState((s) => (s.forStep === step && !sameRect(s.rect, again.rect) ? { ...s, rect: again.rect } : s));
        }, ms));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); followups.forEach(clearTimeout); };
  }, [target, step, resizeTick]);
  return state;
}

interface Nav { step: number; total: number; last: boolean; onNext: () => void; onBack: () => void; onClose: () => void }

function HelpCoach({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);
  const section = topic.sections[step];
  const s = useSpotlight(section?.target, step, resizeTick);

  // Re-measure the current step on rotation / toolbar show-hide.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setResizeTick((n) => n + 1);
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); window.visualViewport?.removeEventListener('resize', on); };
  }, []);

  const last = step >= topic.sections.length - 1;
  const nav: Nav = {
    step, total: topic.sections.length, last,
    onNext: () => (last ? onClose() : setStep((v) => v + 1)),
    onBack: () => setStep((v) => Math.max(0, v - 1)),
    onClose,
  };

  const cardReady = s.forStep === step;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70 }}>
      <Overlay state={s} cardReady={cardReady} topic={topic} section={section} nav={nav} />
    </View>
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));

function Overlay({ state, cardReady, topic, section, nav }: { state: SpotState; cardReady: boolean; topic: HelpTopic; section: HelpSection; nav: Nav }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { vw, vh } = viewport();

  // The ring rect can LAG the step during a hand-off (previous spotlight stays
  // up while the next is measured), which is what keeps the transition smooth.
  const rect = state.rect;
  const glide = isWeb && !reduced
    ? { transitionProperty: 'all', transitionDuration: '170ms', transitionTimingFunction: 'cubic-bezier(0.22,1,0.36,1)' } as unknown as object
    : {};

  // No rect at all (very first step, or a sheet step): full dim, sheet card when ready.
  if (!rect) {
    const safeMax = vh - insets.top - insets.bottom - 24;
    return (
      <View style={{ flex: 1, backgroundColor: DIM }}>
        <Pressable style={{ flex: 1 }} onPress={nav.onNext} accessibilityLabel="next" />
        {cardReady && state.phase === 'sheet' ? (
          <Fade step={nav.step}>
            <Card topic={topic} section={section} nav={nav} bodyMax={Math.max(48, safeMax - 132)}
              style={{ position: 'absolute', left: insets.left + 12, right: insets.right + 12, bottom: insets.bottom + 12, maxHeight: safeMax }} />
          </Fade>
        ) : null}
      </View>
    );
  }

  const pad = 8;
  const hole = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.w + pad * 2, h: rect.h + pad * 2 };
  const holeRight = hole.x + hole.w;
  const holeBottom = hole.y + hole.h;
  const squareish = Math.abs(hole.w - hole.h) < Math.max(hole.w, hole.h) * 0.4;
  const small = Math.min(hole.w, hole.h) < 160;
  const ringRadius = squareish && small ? Math.min(hole.w, hole.h) / 2 + 2 : 14;

  const safeTop = insets.top + 8;
  const safeBottom = vh - insets.bottom - 8;
  const gap = 14;
  const MIN = 150;
  const CHROME = 132;
  const TW = Math.min(360, vw - insets.left - insets.right - 24);
  const spaceBelow = safeBottom - (holeBottom + gap);
  const spaceAbove = hole.y - gap - safeTop;
  const mode: 'below' | 'above' | 'sheet' =
    spaceBelow >= MIN && spaceBelow >= spaceAbove ? 'below' : spaceAbove >= MIN ? 'above' : 'sheet';
  const cardMax = mode === 'below' ? spaceBelow : mode === 'above' ? spaceAbove : safeBottom - safeTop - 8;
  const bodyMax = Math.max(48, cardMax - CHROME);
  const tx = clamp(rect.x + rect.w / 2 - TW / 2, insets.left + 12, vw - insets.right - 12 - TW);
  const arrowLeft = clamp(rect.x + rect.w / 2 - tx - 7, 16, TW - 30);

  const panel = (st: object, k: string) => (
    <Pressable key={k} onPress={nav.onNext} style={[{ position: 'absolute', backgroundColor: DIM }, glide, st]} />
  );

  return (
    <View style={{ flex: 1 }}>
      {panel({ left: 0, top: 0, right: 0, height: hole.y }, 'top')}
      {panel({ left: 0, top: holeBottom, right: 0, bottom: 0 }, 'bottom')}
      {panel({ left: 0, top: hole.y, width: hole.x, height: hole.h }, 'left')}
      {panel({ left: holeRight, top: hole.y, right: 0, height: hole.h }, 'right')}

      {/* The ring on the target — glides on web when the rect changes. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h,
          borderRadius: ringRadius, borderWidth: 2, borderColor: colors.accent,
          shadowColor: colors.accent, shadowOpacity: 0.85, shadowRadius: 14, ...glide,
        }}
      />

      {/* The card — only once the CURRENT step is locked, so it never shows at a
          stale position. */}
      {cardReady ? (
        mode !== 'sheet' ? (
          <Fade step={nav.step} style={{ position: 'absolute', left: tx, width: TW, ...(mode === 'below' ? { top: holeBottom + gap } : { bottom: vh - (hole.y - gap) }) }}>
            {mode === 'below' ? <Arrow left={arrowLeft} dir="up" colour={colors.surface} border={`${colors.accent}59`} /> : null}
            <Card topic={topic} section={section} nav={nav} bodyMax={bodyMax} style={{ flexShrink: 1 }} />
            {mode === 'above' ? <Arrow left={arrowLeft} dir="down" colour={colors.surface} border={`${colors.accent}59`} /> : null}
          </Fade>
        ) : (
          <Fade step={nav.step} style={{ position: 'absolute', left: insets.left + 12, right: insets.right + 12, bottom: insets.bottom + 12 }}>
            <Card topic={topic} section={section} nav={nav} bodyMax={bodyMax} style={{ maxHeight: cardMax }} />
          </Fade>
        )
      ) : null}
    </View>
  );
}

/** Fades its children in on mount; re-keyed per step so each step fades fresh. */
function Fade({ step, style, children }: { step: number; style?: object; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    o.value = reduced ? 1 : withTiming(1, { duration: 150 });
  }, [o, reduced, step]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

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
