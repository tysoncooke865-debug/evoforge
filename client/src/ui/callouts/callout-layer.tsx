import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/data/auth-context';
import { useCalloutsEnabled } from '@/data/callout-prefs';
import { useMyCallouts, useRespondCallout, useVerifyCallout } from '@/data/callouts';
import { calloutHeadline, type CalloutRow } from '@/domain/callouts';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useNow } from '@/ui/duel/duel-hud';

import { MicroPot } from './micro-pot';
import { CalloutSettleOverlay } from './settle-overlay';

/**
 * THE LAYER THAT MUST NEVER INTERRUPT A WORKOUT.
 *
 * §16 is the hardest constraint in this feature: when Tyson calls a set, Jesse
 * is under a bar with 220 kg on it. A modal over his logger would be, briefly,
 * the worst thing this app has ever done.
 *
 * So this is the `FloatingRestTimer` shape, not the prompt-sheet shape:
 * `pointerEvents="box-none"` over the bottom of the screen, one card at a time,
 * every input underneath it still live. Nothing here dims the app, nothing
 * blocks a tap, and dismissing is one tap that costs nothing — the offer
 * survives in the bell and on the Challenges hub until it expires.
 *
 * ONE CARD AT A TIME, chosen by urgency: a settled result (it is about to
 * vanish anyway), then a verification somebody is waiting on, then an incoming
 * offer with a clock running.
 */
export function CalloutLayer() {
  const { session } = useAuth();
  const myId = session?.user?.id ?? null;
  // Gated by the SETTING, not by the reveal. An athlete who has barely trained
  // does not get the ◉ — but if a friend has already put coins on them, they
  // must be able to see it and answer, or those coins sit in a dead offer.
  const { enabled } = useCalloutsEnabled();
  const insets = useSafeAreaInsets();
  const { data } = useMyCallouts();
  const nowMs = useNow(10_000);
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [seenSettled, setSeenSettled] = useState<Record<string, true>>({});

  // A settled call out is only worth celebrating in the moment it settles.
  // Remember which ones have already played so a refetch cannot replay them,
  // and only consider ones settled in the last minute so opening the app
  // tomorrow does not throw confetti at yesterday.
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const c of data ?? []) {
      if (c.status !== 'settled') known.current.delete(c.id);
    }
  }, [data]);

  if (!enabled || !myId) return null;
  const list = data ?? [];

  // A ticking clock rather than a bare Date.now(): reading the wall clock
  // during render is impure, and the settle window genuinely has to age out
  // even if nothing else on the screen changes.
  const fresh = (iso: string | null) => iso != null && nowMs - Date.parse(iso) < 60_000;

  const settled = list.find(
    (c) => c.status === 'settled' && c.result != null && fresh(c.settled_at) && !seenSettled[c.id]
  );
  const toVerify = list.find(
    (c) => c.status === 'awaiting_verification' && !c.i_am_athlete && !dismissed[c.id]
  );
  const incoming = list.find((c) => c.status === 'offered' && !c.i_am_athlete && !dismissed[c.id]);

  const card = settled ?? toVerify ?? incoming;
  if (!card) return null;

  return (
    <View
      // box-none: this container never receives a touch, only its children do.
      // That is the difference between a floating card and a full-screen wall.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + 8,
        alignItems: 'center',
      }}
      testID="callout-layer"
    >
      <View pointerEvents="box-none" style={{ width: '100%', maxWidth: 560 }}>
        {settled ? (
          <CalloutSettleOverlay
            callout={settled}
            onDone={() => setSeenSettled((s) => ({ ...s, [settled.id]: true }))}
          />
        ) : toVerify ? (
          <VerifyCard callout={toVerify} onDismiss={() => setDismissed((d) => ({ ...d, [toVerify.id]: true }))} />
        ) : incoming ? (
          <IncomingCard callout={incoming} onDismiss={() => setDismissed((d) => ({ ...d, [incoming.id]: true }))} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * "TYSON CALLED IT."
 *
 * His chips are already on the table — that is what the micro pot is for. One
 * tap doubts it; his chip is joined by yours, they collide, and the card
 * collapses. Dismiss costs nothing.
 */
function IncomingCard({ callout, onDismiss }: { callout: CalloutRow; onDismiss: () => void }) {
  const colors = useThemeColors();
  const respond = useRespondCallout();
  // WHEN THE CARD APPEARED — for the "how fast does a doubt land?" measurement.
  // Stamped in an effect, not during render: reading the clock while rendering
  // is impure, and this only has to be approximately the moment they saw it.
  const shown = useRef(0);
  useEffect(() => {
    shown.current = Date.now();
  }, []);
  const [accepted, setAccepted] = useState(false);

  return (
    <Card testID="callout-incoming" tint={colors.legendary}>
      <Head
        title={calloutHeadline(callout)}
        onDismiss={onDismiss}
        dismissLabel="Dismiss this call out for now"
        testID="callout-incoming-dismiss"
      />
      <Text className="text-xs font-bold text-text-dim" numberOfLines={1}>
        {callout.exercise.toUpperCase()}
      </Text>
      <Text
        allowFontScaling={false}
        testID="callout-incoming-target"
        style={{ fontSize: 20, lineHeight: 24, color: colors.legendary, ...pixelFont() }}
      >
        {callout.target_label}
      </Text>
      <Text className="text-2xs text-text-mute">
        {callout.stake} ON {callout.athlete_name.toUpperCase()}
      </Text>

      {/* NO ODDS STRIP. It used to quote a hit percentage here, which v5 §4 bans
          outright — "never display anything as odds". The settlement was always
          fixed and symmetric, so the number informed nothing and framed a training
          set as a proposition with a price. */}
      <MicroPot
        amount={callout.stake}
        incoming={accepted ? callout.stake : 0}
        testID="callout-incoming-pot"
      />

      <Pressable
        onPress={() => {
          setAccepted(true);
          respond.mutate({ id: callout.id, accept: true, msToAccept: Date.now() - shown.current });
        }}
        disabled={respond.isPending}
        accessibilityRole="button"
        accessibilityLabel={`Doubt it for ${callout.stake} coins`}
        testID="callout-doubt"
        className="mt-s2 items-center justify-center rounded-lg"
        style={{ minHeight: 48, backgroundColor: colors.legendary }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 16, color: '#04121a', ...pixelFont() }}>
          {respond.isPending ? '…' : `PUSH ${callout.stake}`}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => respond.mutate({ id: callout.id, accept: false })}
        accessibilityRole="button"
        accessibilityLabel="Pass on this call out"
        testID="callout-pass"
        style={{ minHeight: 40, justifyContent: 'center' }}
      >
        <Text className="text-center text-2xs text-text-mute">Not this one</Text>
      </Pressable>
    </Card>
  );
}

/**
 * "VERIFY TYSON."
 *
 * The opponent is shown what was CALLED and what was LOGGED, and asked one
 * question: did that happen. They never type a number — the athlete's logger
 * already wrote it and the server read it off the row.
 *
 * It can also wait. Dismiss puts it back in the bell; nothing here blocks the
 * verifier's own workout, and no timeout ever turns their silence into a payout
 * for either side.
 */
function VerifyCard({ callout, onDismiss }: { callout: CalloutRow; onDismiss: () => void }) {
  const colors = useThemeColors();
  const verify = useVerifyCallout();

  return (
    <Card testID="callout-verify" tint={colors.accent}>
      <Head
        title={calloutHeadline(callout)}
        onDismiss={onDismiss}
        dismissLabel="Verify later"
        testID="callout-verify-dismiss"
      />
      <Text className="text-xs font-bold text-text-dim" numberOfLines={1}>
        {callout.exercise.toUpperCase()}
      </Text>
      <View className="mt-s1 flex-row" style={{ gap: 16 }}>
        <Figure k="CALLED" v={callout.target_label} tint={colors['text-dim']} />
        <Figure
          k="LOGGED"
          v={callout.actual_reps == null ? '—' : `${callout.actual_reps} REPS`}
          tint={colors.accent}
          testID="callout-verify-logged"
        />
      </View>

      <Pressable
        onPress={() => verify.mutate({ id: callout.id, verdict: 'verify' })}
        disabled={verify.isPending}
        accessibilityRole="button"
        accessibilityLabel="Verify that this happened"
        testID="callout-verify-yes"
        className="mt-s2 items-center justify-center rounded-lg"
        style={{ minHeight: 48, backgroundColor: colors.accent }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 16, color: '#04121a', ...pixelFont() }}>
          {verify.isPending ? '…' : '✓ VERIFY'}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => verify.mutate({ id: callout.id, verdict: 'dispute', reason: 'Did not see it' })}
        accessibilityRole="button"
        accessibilityLabel="You did not see the set"
        testID="callout-verify-dispute"
        style={{ minHeight: 40, justifyContent: 'center' }}
      >
        <Text className="text-center text-2xs text-text-mute">Didn&apos;t see it</Text>
      </Pressable>
    </Card>
  );
}

function Card({
  children,
  tint,
  testID,
}: {
  children: React.ReactNode;
  tint: string;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      // The CARD is interactive; the layer around it is not.
      pointerEvents="auto"
      testID={testID}
      className="mx-s3 rounded-xl border p-s3"
      style={{
        borderColor: `${tint}59`,
        // OPAQUE. This floats over a live workout, and at 94% the set rows and
        // the ADD AN EXERCISE bar read straight through the proposition — the
        // one line the card exists to state. A card that is hard to read is a
        // card somebody dismisses rather than answers.
        backgroundColor: colors['bg-deep'],
        gap: 2,
        // Lift it off the logger so the edge is unambiguous on both themes.
        shadowColor: '#000',
        shadowOpacity: 0.6,
        shadowRadius: 18,
        elevation: 12,
      }}
    >
      {children}
    </View>
  );
}

function Head({
  title,
  onDismiss,
  dismissLabel,
  testID,
}: {
  title: string;
  onDismiss: () => void;
  dismissLabel: string;
  testID: string;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text
        allowFontScaling={false}
        className="text-text-mute"
        style={{ fontSize: 8, letterSpacing: 1.6, flex: 1 }}
        numberOfLines={1}
      >
        {title}
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        testID={testID}
        style={{ minWidth: 44, minHeight: 32, alignItems: 'flex-end', justifyContent: 'center' }}
      >
        <Text className="text-sm text-text-mute">✕</Text>
      </Pressable>
    </View>
  );
}

function Figure({ k, v, tint, testID }: { k: string; v: string; tint: string; testID?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 8, letterSpacing: 1.2 }}>
        {k}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} testID={testID} style={{ fontSize: 15, color: tint, ...pixelFont() }}>
        {v}
      </Text>
    </View>
  );
}
