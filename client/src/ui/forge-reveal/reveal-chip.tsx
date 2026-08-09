import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import type { BankedReveal } from '@/domain/forge-reveal';
import { useClaimReveal, useMyReveals } from '@/data/forge-reveal';
import { bankedLabel } from '@/domain/forge-reveal';
import { useThemeColors } from '@/theme/use-theme';

import { RevealSheet } from './reveal-sheet';

/**
 * "A REVEAL IS READY" — the only two places it is ever said (Spec v5 §3).
 *
 *   `<RevealChip />`     the quiet Home chip
 *   `<RevealClaimCard />` the post-workout summary card
 *
 * WHAT MAKES IT QUIET, AND WHY EACH PART IS DELIBERATE:
 *
 *   * it renders NOTHING when nothing is banked. No empty state, no "train to earn
 *     one" teaser — that would be soliciting, which §3 and the physiotherapist test
 *     both refuse.
 *   * no badge count animation, no pulse, no colour that reads as an alert. A
 *     banked reveal never expires, so there is nothing to be urgent about, and
 *     manufacturing urgency for a chance feature is the exact pattern §8 calls a
 *     compliance defect rather than a style choice.
 *   * no notification is sent from anywhere for this. §3 says banked reveals never
 *     notify; the chip IS the entire surfacing mechanism.
 *
 * MID-WORKOUT, NEITHER OF THESE IS MOUNTED. The workout logger, the set controls
 * and the rest timer carry no reveal affordance at all — a PR grants one silently
 * and it waits for the summary. That is enforced by where these are rendered, so
 * the rule to keep is: never mount this inside `(main)/workout` or its children.
 */

/** Shared claim flow: pick one, open the sheet, key it so state is per-reveal. */
function useRevealFlow() {
  // Per-user query keys, per the client's doctrine: a reveal belonging to the last
  // athlete must not survive a sign-out into the next one's cache.
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const state = useMyReveals(userId);
  const claim = useClaimReveal(userId);
  /**
   * THE OPEN REVEAL IS HELD, NOT LOOKED UP (Tyson, 2026-08-09: "I dont think it
   * plays the animations properly").
   *
   * It used to be `banked.find(b => b.id === openId)`. `banked` holds only
   * UNCLAIMED reveals, so the instant a claim succeeded and the query invalidated,
   * the reveal left `banked`, `current` became null, and the sheet UNMOUNTED —
   * mid-claim, before the ingot had fallen a single pixel.
   *
   * The athlete pressed CLAIM and the sheet vanished. No pour, no landing, no
   * number, no balance, and on Home the chip disappeared too. The coins were
   * always paid; measuring it showed `forge_reveal_claim` returning 200 while the
   * screen showed nothing at all. It read as a broken feature because everything
   * that was supposed to say "you earned 40" was unmounted before it could.
   *
   * Holding the reveal makes the sheet's lifetime the athlete's decision — it
   * closes when they press DONE — instead of a side effect of a cache
   * invalidation. `key={current.id}` still gives each reveal its own state.
   */
  const [openReveal, setOpenReveal] = useState<BankedReveal | null>(null);
  const banked = state.data?.banked ?? [];
  const table = state.data?.table ?? [];
  return {
    banked,
    table,
    current: openReveal,
    open: (reveal: BankedReveal) => setOpenReveal(reveal),
    close: () => setOpenReveal(null),
    claim: claim.mutateAsync,
  };
}

/** The Home chip. One line, no ornament. */
export function RevealChip() {
  const colors = useThemeColors();
  const { banked, table, current, open, close, claim } = useRevealFlow();

  /**
   * THE EARLY RETURN IS CONDITIONAL ON THE SHEET, and that is the whole fix.
   *
   * `if (banked.length === 0) return null` unmounted this component the moment a
   * claim succeeded — because a claimed reveal leaves `banked`, and the sheet is
   * this component's CHILD. It took the ceremony down with it, roughly 150ms after
   * CLAIM was pressed: no pour, no landing, no number, no balance.
   *
   * Holding the open reveal in state was necessary but not sufficient; a parent
   * that returns null takes its children with it wherever their state lives. Both
   * halves are needed, which is why the browser measurement mattered — the first
   * fix looked right and changed nothing on screen.
   */
  if (banked.length === 0 && !current) return null;

  return (
    <>
      {banked.length > 0 ? (
      <Pressable
        onPress={() => open(banked[0])}
        accessibilityRole="button"
        accessibilityLabel={`${bankedLabel(banked.length)}. Open the forge.`}
        testID="home-reveal-chip"
        className="mb-s3 flex-row items-center justify-between rounded-lg px-s3 py-s2"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: 'rgba(13,21,36,0.6)',
        }}
      >
        <Text allowFontScaling={false} className="text-2xs text-text-dim">
          <Text style={{ color: colors.legendary }}>◈</Text>  {bankedLabel(banked.length)}
        </Text>
        <Text allowFontScaling={false} className="text-2xs text-text-mute">
          OPEN
        </Text>
      </Pressable>
      ) : null}
      {current ? (
        <RevealSheet
          key={current.id}
          visible
          reveal={current}
          table={table}
          onClaim={claim}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/**
 * The post-workout summary card — §3's primary claim surface.
 *
 * Rendered by the summary sheet AFTER the workout is finished and the numbers are
 * settled, never during it. Two banked reveals read as one card saying "2 reveals
 * ready" rather than two competing cards.
 */
export function RevealClaimCard() {
  const colors = useThemeColors();
  const { banked, table, current, open, close, claim } = useRevealFlow();

  /**
   * THE EARLY RETURN IS CONDITIONAL ON THE SHEET, and that is the whole fix.
   *
   * `if (banked.length === 0) return null` unmounted this component the moment a
   * claim succeeded — because a claimed reveal leaves `banked`, and the sheet is
   * this component's CHILD. It took the ceremony down with it, roughly 150ms after
   * CLAIM was pressed: no pour, no landing, no number, no balance.
   *
   * Holding the open reveal in state was necessary but not sufficient; a parent
   * that returns null takes its children with it wherever their state lives. Both
   * halves are needed, which is why the browser measurement mattered — the first
   * fix looked right and changed nothing on screen.
   */
  if (banked.length === 0 && !current) return null;

  return (
    <>
      {banked.length > 0 ? (
      <Pressable
        onPress={() => open(banked[0])}
        accessibilityRole="button"
        accessibilityLabel={`${bankedLabel(banked.length)}. Open the forge to claim.`}
        testID="summary-reveal-card"
        className="mb-s3 rounded-lg p-s3"
        style={{
          borderWidth: 1,
          borderColor: colors.accent,
          backgroundColor: 'rgba(34,211,238,0.07)',
        }}
      >
        <Text
          allowFontScaling={false}
          className="text-2xs"
          style={{ color: colors.legendary, letterSpacing: 1 }}
        >
          ◈ THE FORGE
        </Text>
        <Text allowFontScaling={false} className="mt-s1 text-sm font-bold text-text">
          {bankedLabel(banked.length)}
        </Text>
        {/* The producer, so it is obvious what earned it — and no urgency. */}
        <Text allowFontScaling={false} className="mt-s1 text-2xs text-text-mute">
          {banked.length === 1 && banked[0].producer === 'pr'
            ? 'Earned by a personal record. Claim whenever you like.'
            : 'Earned by finishing your workout. Claim whenever you like.'}
        </Text>
      </Pressable>
      ) : null}
      {current ? (
        <RevealSheet
          key={current.id}
          visible
          reveal={current}
          table={table}
          onClaim={claim}
          onClose={close}
        />
      ) : null}
    </>
  );
}
