import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { track } from '@/data/analytics';
import { useMyDropTier } from '@/data/forge-drop';
import { useDropSession } from '@/data/forge-drop-session';
import { columnsFor, formatMultiplier } from '@/domain/forge-drop';
import {
  chipOffers,
  laneFor,
  rackBlocker,
  type LaneChoice,
} from '@/domain/forge-drop-session';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useRestClock } from '@/ui/train/rest-timer';

import { ChipRack } from './chip-rack';
import { DropBoard, type BoardPuck } from './drop-board';

/**
 * FORGE DROP, DURING A REST.
 *
 * Ninety seconds between sets is real dead time, and this fills it. It is also
 * the easiest place in the whole app to do harm, so the rules are strict and
 * most of them are about what it must NOT do:
 *
 *   IT NEVER OPENS ITSELF. There is a button on the rest timer. Nothing else
 *   opens this — not finishing a set, not a personal record, not a streak.
 *   A gambling surface that appears unbidden after every set is a slot machine
 *   attached to a barbell.
 *
 *   IT NEVER TOUCHES THE CLOCK. It reads `useRestClock()` and writes nothing.
 *   It cannot pause, extend or reset a rest, so the training stays the thing
 *   the timer is timing. It also closes ITSELF when rest ends, rather than
 *   waiting to be dismissed — the next set is the point.
 *
 *   IT NEVER BLOCKS THE NEXT SET. `pointerEvents="box-none"` throughout, and it
 *   sits above the tab bar rather than over the logger, so LOG is always one
 *   tap away. The workout's own state is untouched: this is a sibling overlay
 *   that shares nothing with the logger but the screen.
 *
 *   IT STOPS BEFORE THE REST DOES. New drops are refused in the final ten
 *   seconds, so nobody is mid-throw when it is time to lift. Chips already
 *   falling settle in the background and are waiting on the Forge Drop screen
 *   afterwards — a settled wager is never lost to a closing panel.
 */

interface RestDropState {
  open: boolean;
  setOpen: (v: boolean) => void;
  reset: () => void;
}

/** Session-lifetime only, and reset on sign-out like every store. */
export const useRestDropStore = create<RestDropState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  reset: () => set({ open: false }),
}));

/** New drops stop with this much rest left. Long enough to finish watching a
 *  chip land, short enough that nobody is choosing a stake when the buzzer
 *  goes. */
export const LOCKOUT_SECONDS = 10;

/** Fewer than the standalone screen allows. A rest is not a session. */
export const REST_MAX_DROPS = 3;

export function RestDropPanel() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const clock = useRestClock();
  const open = useRestDropStore((s) => s.open);
  const setOpen = useRestDropStore((s) => s.setOpen);

  const { tier, ready } = useMyDropTier();
  const session = useDropSession(open && ready ? tier : null);
  const { play, reveal, drops, balance, loading } = session;

  const [chip, setChip] = useState<number | null>(null);
  const [laneChoice, setLaneChoice] = useState<LaneChoice>('centre');
  const [announce, setAnnounce] = useState('');

  const restOver = clock === null || clock.over;
  const closing = clock !== null && !clock.over && clock.remaining <= LOCKOUT_SECONDS;

  /**
   * REST ENDS, THE PANEL GOES. Not a nag, not a "are you sure" — the next set
   * is the point, and anything still falling settles on its own.
   */
  useEffect(() => {
    if (open && restOver) setOpen(false);
  }, [open, restOver, setOpen]);

  const lane = laneFor(laneChoice, tier);
  const offers = chipOffers(tier, balance, REST_MAX_DROPS);
  const lockedOut = closing ? 'Rest is nearly over — back to the bar' : null;
  const blocker = lockedOut ?? rackBlocker(tier, balance, REST_MAX_DROPS);

  const selected = useMemo(() => {
    if (chip !== null && offers.some((o) => o.value === chip && o.enabled)) return chip;
    return offers.find((o) => o.enabled)?.value ?? null;
  }, [chip, offers]);

  const pucks = useMemo(() => {
    const out: BoardPuck[] = [];
    for (const d of drops) {
      if (d.phase !== 'falling' || !d.path) continue;
      const columns = columnsFor({ lane: d.lane, path: d.path, slot: d.slot ?? -1 }, tier.rows);
      if (columns) out.push({ key: d.key, stake: d.stake, columns });
    }
    return out;
  }, [drops, tier.rows]);

  const highlights = drops.filter((d) => d.phase === 'revealed').slice(-3).map((d) => d.slot ?? 0);

  if (!open || clock === null) return null;

  const onSettled = (key: string) => {
    const d = drops.find((x) => x.key === key);
    reveal(key);
    if (d) {
      const net = d.net ?? 0;
      setAnnounce(
        `${formatMultiplier(d.multiplier ?? 1)}, ` +
        `${net > 0 ? `up ${net}` : net === 0 ? 'even' : `down ${Math.abs(net)}`} coins.`
      );
    }
  };

  // Narrow enough to leave the logger visible beside it on anything wide, and
  // capped so the board never eats a phone screen.
  const panelWidth = Math.min(width - 24, 340);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: Math.max(insets.bottom, 8) + 56,
        alignItems: 'center',
      }}
      testID="rest-drop-panel"
    >
      <View
        style={{
          width: panelWidth,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: `${colors.accent}55`,
          backgroundColor: 'rgba(8,17,28,0.97)',
          padding: 10,
          shadowColor: colors.accent,
          shadowOpacity: 0.3,
          shadowRadius: 14,
          elevation: 8,
        }}
      >
        <View
          accessibilityLiveRegion="polite"
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}
        >
          <Text>{announce}</Text>
        </View>

        <View className="flex-row items-center justify-between">
          <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: colors.accent }}>
            FORGE DROP · {tier.label}
          </Text>
          <Pressable
            onPress={() => { setOpen(false); track('forge_drop_rest_closed', {}); }}
            accessibilityRole="button"
            accessibilityLabel="Close Forge Drop and return to your workout"
            testID="rest-drop-close"
            style={{ minHeight: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 14, color: colors['text-dim'] }}>✕</Text>
          </Pressable>
        </View>

        <View className="mt-s1">
          <DropBoard
            tier={tier}
            lane={lane}
            pucks={pucks}
            highlights={highlights}
            onSettled={onSettled}
            testID="rest-drop-board"
          />
        </View>

        <View className="mt-s1 flex-row items-center justify-between">
          <Text allowFontScaling={false} className="text-2xs text-text-mute">
            {loading ? '—' : `${balance.available} coins`}
            {balance.reserved > 0 ? ` · ${balance.reserved} in play` : ''}
          </Text>
          <Text
            allowFontScaling={false}
            className="text-2xs"
            style={{ color: closing ? colors.danger : colors['text-mute'] }}
            testID="rest-drop-clock"
          >
            {clock.mm}:{clock.ss} REST
          </Text>
        </View>

        <View className="mt-s1">
          <ChipRack
            offers={offers.map((o) => (lockedOut ? { ...o, enabled: false, reason: lockedOut } : o))}
            selected={selected}
            onSelect={setChip}
            onThrow={(v, c) => { setLaneChoice(c); setChip(v); void play(v, c); }}
            blocker={blocker}
            compact
            testID="rest-chip-rack"
          />
        </View>

        {/* The tap path, compact. Three lanes, one drop button — everything the
            flick does, for a thumb that would rather not. */}
        <View className="mt-s1 flex-row" style={{ gap: 6 }}>
          {(['left', 'centre', 'right'] as const).map((c) => {
            const on = c === laneChoice;
            return (
              <Pressable
                key={c}
                onPress={() => setLaneChoice(c)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Drop from the ${c} lane`}
                testID={`rest-drop-lane-${c}`}
                style={{
                  flex: 1,
                  minHeight: 34,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: on ? colors.accent : colors.border,
                  backgroundColor: on ? 'rgba(34,211,238,0.12)' : 'transparent',
                }}
              >
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 9, color: on ? colors.accent : colors['text-dim'] }}
                >
                  {on ? '● ' : ''}{c.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => { if (selected !== null && !blocker) void play(selected, laneChoice); }}
          disabled={selected === null || blocker !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: selected === null || blocker !== null }}
          accessibilityLabel={
            blocker ?? `Drop ${selected} coins from the ${laneChoice} lane`
          }
          testID="rest-drop-play"
          style={{
            marginTop: 6,
            minHeight: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: blocker ? colors.border : colors.legendary,
            backgroundColor: blocker ? 'transparent' : 'rgba(251,191,36,0.12)',
          }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 12,
              color: blocker ? colors['text-mute'] : colors.legendary,
              ...pixelFont(),
            }}
          >
            {blocker ? 'PAUSED' : `DROP ${selected}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
