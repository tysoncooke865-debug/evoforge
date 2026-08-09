import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import {
  countdown,
  formatCoins,
  raiseLockCopy,
  type DuelConfig,
  type DuelOffer,
  type RaiseState,
} from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { ChipWagerTable } from '@/ui/duel/chip-table';
import { HoldToConfirm } from '@/ui/duel/hold-to-confirm';

/**
 * RAISING THE STAKES — a negotiation, not a slider.
 *
 * Every panel in this file holds the same three promises:
 *   NOTHING MOVES ON A PROPOSAL. The copy says so on both sides, every time,
 *   because that is what makes proposing a big number a reasonable thing to do.
 *   DECLINING DOES NOT END THE DUEL. Said in the decline button's own row, so
 *   nobody has to guess whether saying no costs them the contest.
 *   COUNTER IS ALWAYS AVAILABLE. An offer you cannot afford is not a dead end;
 *   it is an opening bid, and the responder's maximum is right there.
 */

// ─────────────────────────────────────────────────────── proposing a raise

export function RaiseSheet({
  currentPot,
  perAthlete,
  balance,
  config,
  busy,
  onSend,
  onAllIn,
  onClose,
}: {
  currentPot: number;
  perAthlete: number;
  balance: number;
  config: DuelConfig;
  busy: boolean;
  onSend: (amount: number) => void;
  /** Switches to the all-in confirmation; the amount is the server's to
   *  compute, so nothing is passed. */
  onAllIn: () => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [amount, setAmount] = useState(0);
  const max = Math.max(0, Math.min(balance, config.max_raise));

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.78)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.legendary}45`, backgroundColor: colors.surface, maxHeight: 680 }}
          testID="raise-sheet"
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text
              allowFontScaling={false}
              style={{ fontSize: 20, color: colors.legendary, letterSpacing: 1, ...pixelFont() }}
            >
              RAISE THE STAKES
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              You both add the same amount. Nothing moves until they accept.
            </Text>

            <View className="mt-s3">
              <ChipWagerTable
                value={amount}
                onChange={setAmount}
                balance={balance}
                min={Math.min(config.min_stake, max)}
                max={max}
                potLabel="PROPOSED NEW POT"
                potOf={(v) => currentPot + v * 2}
                testID="raise-table"
              />
            </View>

            <View className="mt-s3 rounded-lg border p-s3" style={{ borderColor: colors.border }}>
              <Row k="CURRENT POT" v={formatCoins(currentPot)} />
              <Row k="YOU EACH HAVE IN" v={formatCoins(perAthlete)} />
              <Row k="YOUR ADDITIONAL PLEDGE" v={`+${formatCoins(amount)}`} tint={colors.accent} />
              <Row k="THEY MUST MATCH" v={`+${formatCoins(amount)}`} />
              <Row k="NEW POT" v={formatCoins(currentPot + amount * 2)} tint={colors.legendary} />
            </View>

            <View className="mt-s3">
              <NeonButton
                title={busy ? 'SENDING…' : `PROPOSE +${formatCoins(amount)} EACH`}
                size="hero"
                pixel
                disabled={amount <= 0 || busy}
                busy={busy}
                onPress={() => onSend(amount)}
                testID="raise-send"
              />
            </View>
            <Pressable
              onPress={onAllIn}
              accessibilityRole="button"
              accessibilityLabel="Go to max pledge instead"
              testID="raise-go-all-in"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text className="text-center text-2xs" style={{ color: colors.danger, letterSpacing: 0.8 }}>
                OR PUSH EVERYTHING IN ›
              </Text>
            </Pressable>
            <NeonButton title="CANCEL" variant="ghost" pixel onPress={onClose} testID="raise-cancel" />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────── all in

/**
 * ALL IN — dramatic, and impossible to do by accident.
 *
 * The amount shown is this athlete's whole ledger balance, but the SERVER
 * computes the real figure at the moment of sending: a client-supplied "my
 * whole wallet" would be a claim about a wallet, which is exactly the class of
 * number this system never accepts. If the two disagree the server's wins and
 * the sheet says what actually went out.
 */
export function AllInSheet({
  balance,
  currentPot,
  busy,
  onConfirm,
  onClose,
}: {
  balance: number;
  currentPot: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const newPot = currentPot + balance * 2;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center px-s4" style={{ backgroundColor: 'rgba(2,5,11,0.88)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-xl border p-s4"
          style={{ borderColor: `${colors.danger}66`, backgroundColor: colors.surface }}
          testID="all-in-sheet"
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: 30, lineHeight: 36, color: colors.danger, letterSpacing: 2, ...pixelFont() }}
          >
            ALL IN
          </Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            Every coin you have, on this duel. They have to accept the same number before anything moves.
          </Text>

          <View className="mt-s4 items-center">
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.6, ...pixelFont(false) }}
            >
              YOU ADD
            </Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <CoinIcon size={26} />
              <Text
                allowFontScaling={false}
                testID="all-in-amount"
                style={{ fontSize: 44, lineHeight: 50, color: colors.danger, letterSpacing: 0, ...pixelFont() }}
              >
                {formatCoins(balance)}
              </Text>
            </View>
          </View>

          <View className="mt-s3 rounded-lg border p-s3" style={{ borderColor: colors.border }}>
            <Row k="THEY MUST MATCH" v={formatCoins(balance)} />
            <Row k="NEW POT" v={formatCoins(newPot)} tint={colors.legendary} />
            <Row k="IF YOU LOSE" v={`−${formatCoins(balance)} coins`} />
            <Row k="XP · EVO · FORGE LEVEL" v="Untouched" tint={colors.success} />
          </View>

          <View className="mt-s4">
            <HoldToConfirm
              label="HOLD TO SEND MAX PLEDGE"
              holdingLabel="KEEP HOLDING…"
              onConfirm={onConfirm}
              disabled={busy || balance <= 0}
              testID="all-in-hold"
            />
          </View>
          <NeonButton title="BACK OUT" variant="ghost" pixel onPress={onClose} testID="all-in-cancel" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ───────────────────────────────────────────────────── answering an offer

export function IncomingOfferCard({
  offer,
  theirName,
  currentPot,
  balance,
  config,
  nowMs,
  busy,
  onAccept,
  onDecline,
  onCounter,
  testID,
}: {
  offer: DuelOffer;
  theirName: string;
  currentPot: number;
  balance: number;
  config: DuelConfig;
  /** The screen's clock, passed in — reading one during render is impure, and
   *  two cards each reading their own give two answers to one question. */
  nowMs: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: (amount: number) => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [countering, setCountering] = useState(false);
  const [counter, setCounter] = useState(0);

  const isCounterStake = offer.kind === 'counter_stake';
  // For a counter-stake the amount IS the new per-athlete stake; for a raise
  // it is what each side ADDS. Either way this is what I have to cover.
  const iMustCover = offer.amount;
  const canMatch = balance >= iMustCover;
  const counterMax = Math.max(0, Math.min(balance, isCounterStake ? config.max_stake : config.max_raise));

  const heading =
    offer.kind === 'all_in' ? `${theirName.toUpperCase()} IS AT MAX PLEDGE`
      : isCounterStake ? `${theirName.toUpperCase()} WANTS ${formatCoins(offer.amount)} EACH`
        : `${theirName.toUpperCase()} WANTS TO RAISE`;

  return (
    <View
      testID={testID}
      className="w-full rounded-xl border p-s3"
      style={{
        borderColor: offer.kind === 'all_in' ? `${colors.danger}6b` : `${colors.legendary}59`,
        backgroundColor: offer.kind === 'all_in' ? 'rgba(251,113,133,0.07)' : 'rgba(251,191,36,0.06)',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: 14,
          letterSpacing: 1.2,
          color: offer.kind === 'all_in' ? colors.danger : colors.legendary,
          ...pixelFont(),
        }}
      >
        {heading}
      </Text>

      <View className="mt-s2 flex-row" style={{ gap: 8 }}>
        <Figure
          label={isCounterStake ? 'PLEDGE EACH' : '+ EACH'}
          value={formatCoins(offer.amount)}
          tint={colors.text}
        />
        <Figure label="NEW POT" value={formatCoins(offer.pot_if_accepted)} tint={colors.legendary} />
        <Figure label="EXPIRES IN" value={countdown(Date.parse(offer.expires_at) - nowMs)} tint={colors['text-dim']} />
      </View>

      {!canMatch ? (
        <Text className="mt-s2 text-2xs" style={{ color: colors.warn }} testID="offer-cannot-match">
          You have {formatCoins(balance)} — you cannot cover {formatCoins(iMustCover)}. Counter with
          what you can, or decline and carry on.
        </Text>
      ) : (
        <Text className="mt-s2 text-2xs text-text-mute">
          Accepting takes {formatCoins(iMustCover)} from each of you. Declining changes nothing.
        </Text>
      )}

      {countering ? (
        <View className="mt-s3">
          <ChipWagerTable
            value={counter}
            onChange={setCounter}
            balance={balance}
            min={Math.min(config.min_stake, counterMax)}
            max={counterMax}
            potLabel={isCounterStake ? 'POOL AT YOUR NUMBER' : 'POOL IF THEY ACCEPT'}
            potOf={(v) => (isCounterStake ? v * 2 : currentPot + v * 2)}
            testID="counter-table"
          />
          <View className="mt-s3">
            <NeonButton
              title={busy ? 'SENDING…' : `COUNTER AT ${formatCoins(counter)}`}
              pixel
              disabled={counter <= 0 || busy}
              busy={busy}
              onPress={() => onCounter(counter)}
              testID="offer-counter-send"
            />
          </View>
          <NeonButton title="BACK" variant="ghost" pixel onPress={() => setCountering(false)} testID="offer-counter-back" />
        </View>
      ) : (
        <View className="mt-s3" style={{ gap: 8 }}>
          <NeonButton
            title={
              busy ? 'WORKING…'
                : !canMatch ? 'CANNOT MATCH'
                  // A counter-stake REPLACES the stake; a raise ADDS to it. The
                  // "+" is the difference between the two and must not appear
                  // on the one that is not an addition.
                  : isCounterStake ? `ACCEPT · ${formatCoins(iMustCover)} EACH`
                    : `ACCEPT · +${formatCoins(iMustCover)}`
            }
            size="hero"
            pixel
            disabled={!canMatch || busy}
            busy={busy}
            onPress={onAccept}
            testID="offer-accept"
          />
          <View className="flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NeonButton
                title={!canMatch ? `COUNTER · MAX ${formatCoins(counterMax)}` : 'COUNTER'}
                variant="ghost"
                pixel
                disabled={busy || counterMax <= 0}
                onPress={() => {
                  setCounter(Math.min(counterMax, !canMatch ? counterMax : Math.max(0, Math.floor(offer.amount / 2))));
                  setCountering(true);
                }}
                testID="offer-counter"
              />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton title="DECLINE" variant="ghost" pixel disabled={busy} onPress={onDecline} testID="offer-decline" />
            </View>
          </View>
          <Text className="text-center text-2xs text-text-mute">
            Declining keeps the duel exactly as it is.
          </Text>
        </View>
      )}
    </View>
  );
}

/** My own offer, waiting on them. */
export function PendingOfferCard({
  offer,
  theirName,
  nowMs,
  busy,
  onWithdraw,
  testID,
}: {
  offer: DuelOffer;
  theirName: string;
  nowMs: number;
  busy: boolean;
  onWithdraw: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      testID={testID}
      className="w-full rounded-xl border p-s3"
      style={{ borderColor: `${colors.legendary}40`, backgroundColor: 'rgba(251,191,36,0.05)' }}
    >
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <PulseDot />
        <Text
          allowFontScaling={false}
          style={{ fontSize: 12, letterSpacing: 1.2, color: colors.legendary, ...pixelFont() }}
        >
          {offer.kind === 'all_in' ? 'MAX PLEDGE SENT' : offer.kind === 'counter_stake' ? 'COUNTER SENT' : 'RAISE SENT'}
        </Text>
      </View>
      <Text className="mt-s2 text-2xs text-text-dim">
        Waiting on {theirName}. {offer.kind === 'counter_stake'
          ? `${formatCoins(offer.amount)} each`
          : `+${formatCoins(offer.amount)} each`} · pot would be {formatCoins(offer.pot_if_accepted)}. No coins have
        moved.
      </Text>
      <Text className="mt-s1 text-2xs text-text-mute">
        Expires in {countdown(Date.parse(offer.expires_at) - nowMs)}.
      </Text>
      <View className="mt-s2">
        <NeonButton title="TAKE IT BACK" variant="ghost" pixel disabled={busy} onPress={onWithdraw} testID="offer-withdraw" />
      </View>
    </View>
  );
}

/** The locked RAISE affordance — a button that explains itself. */
export function RaiseButton({
  state,
  myName,
  onPress,
  testID,
}: {
  state: RaiseState | null;
  myName: string;
  onPress: () => void;
  testID?: string;
}) {
  const unlocked = state?.unlocked === true;
  const copy = raiseLockCopy(state, myName);
  return (
    <View testID={testID}>
      <NeonButton
        title={unlocked ? 'RAISE THE STAKES' : 'RAISE LOCKED'}
        pixel
        disabled={!unlocked}
        onPress={onPress}
        testID="duel-raise-open"
      />
      {copy ? (
        <Text className="mt-s1 text-center text-2xs text-text-mute" testID="duel-raise-lock">
          {copy}
        </Text>
      ) : (
        <Text className="mt-s1 text-center text-2xs text-text-mute">
          You have both trained since the last one. The table is open.
        </Text>
      )}
    </View>
  );
}

function PulseDot() {
  const colors = useThemeColors();
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.legendary }} />;
}

function Row({ k, v, tint }: { k: string; v: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View className="mt-s1 flex-row items-center justify-between" style={{ gap: 12 }}>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>{k}</Text>
      <Text className="text-2xs" style={{ color: tint ?? colors.text }}>{v}</Text>
    </View>
  );
}

function Figure({ label, value, tint }: { label: string; value: string; tint: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border px-s2 py-s2"
      style={{ flex: 1, minWidth: 0, borderColor: colors.border, backgroundColor: 'rgba(4,7,14,0.5)' }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 8, letterSpacing: 1.1, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 17, color: tint, letterSpacing: 0, ...pixelFont() }}>
        {value}
      </Text>
    </View>
  );
}
