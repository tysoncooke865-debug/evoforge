import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { potChips } from '@/domain/callouts';
import { FORGE_CHIPS } from '@/domain/forge-duel';
import { useSettingsStore } from '@/state/settings-store';
import { useReducedMotion } from 'react-native-reanimated';
import { ChipSurface } from '@/ui/duel/physics/chip-surface';
import { useChipTable } from '@/ui/duel/physics/use-chip-table';
import { playPotLock, primeChipAudio } from '@/ui/duel/physics/chip-audio';
import { potLockHaptic } from '@/ui/duel/physics/chip-haptics';

/**
 * THE MICRO POT — the same chips, ~96px tall.
 *
 * Used on an incoming offer card and on a verification card, where the whole
 * point is that the other athlete's money is ALREADY ON THE TABLE. A static
 * picture of chips would say the same words and none of the same thing: when
 * the doubter's chip lands, real bodies collide, the audio fires from the
 * collision itself, and the pot reads 100. That moment is the feature.
 *
 * THREE THINGS KEEP IT CHEAP:
 *   it only exists while a card is on screen (one at a time, ever);
 *   `maxBodies` is small — a micro pot showing eight discs is a pot;
 *   `locked` means the phone's tilt does not steer it, so the sensor is not
 *   even subscribed. The loop still sleeps itself once the pile settles.
 *
 * AND THE RULE THE WHOLE SYSTEM RESTS ON: the physics is a picture of the
 * number. `amount` comes from the server row. Nothing here can change it —
 * `onAmountChange` is a no-op on purpose, and `locked` stops the surface
 * handing chips back.
 */
export function MicroPot({
  /** Coins currently on the table, from the row. */
  amount,
  /** Coins that arrive with a CLACK when this flips true (the doubt landing). */
  incoming = 0,
  height = 96,
  testID,
}: {
  amount: number;
  incoming?: number;
  height?: number;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const calm = reduced || perfMode;

  const table = useChipTable({
    amount,
    // THE MONEY IS NOT THIS COMPONENT'S TO CHANGE. A micro pot is a read.
    onAmountChange: () => undefined,
    denominations: FORGE_CHIPS,
    ownerId: 'pot',
    calm,
    maxBodies: perfMode ? 8 : 12,
    locked: true,
  });

  /**
   * SEED THE POT THAT IS ALREADY ON THE TABLE.
   *
   * `useChipTable` initialises `ownAmount` to the amount it is handed, which is
   * exactly right for the duel (its table starts empty and the athlete fills
   * it) and exactly wrong here: a micro pot OPENS holding the caller's stake,
   * so the "amount changed from outside" effect sees no change and never draws
   * a chip. The incoming card rendered "Throw chips in." where fifty coins of
   * somebody else's money were supposed to be sitting — the one thing the card
   * exists to show. Only a screenshot caught it; every structural assertion
   * passed on an empty table.
   *
   * Reconcile once the surface has a real width, because that is when the world
   * exists to spawn bodies into.
   */
  const seeded = useRef(-1);
  useEffect(() => {
    if (table.size.width < 40 || seeded.current === amount) return;
    seeded.current = amount;
    for (const value of potChips(amount, 6)) {
      table.commit({ value, source: 'quick', vy: 200 });
    }
    // `table` is rebuilt every render; the ref is what makes this fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, table.size.width]);

  // The arrival. Drop the doubter's chips in and knock the table once, so the
  // pot is heard as well as read.
  const landed = useRef(0);
  useEffect(() => {
    if (incoming <= 0 || landed.current === incoming) return;
    landed.current = incoming;
    primeChipAudio();
    for (const value of potChips(incoming, 6)) {
      table.commit({ value, source: 'quick', vy: 320 });
    }
    table.jolt(0.8);
    playPotLock();
    potLockHaptic();
    // `table` is rebuilt each render; the ref is what makes this fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  return (
    <View style={{ width: '100%' }}>
      <ChipSurface table={table} height={height} locked testID={testID} />
    </View>
  );
}
