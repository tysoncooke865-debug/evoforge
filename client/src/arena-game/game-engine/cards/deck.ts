/**
 * Deck, hand and card cycle — deterministic and part of battle state.
 *
 * Rules (Clash Royale-style):
 *  - A deck is exactly BALANCE.cards.deckSize (8) distinct, existing cards.
 *  - The battle starts with the deck shuffled by the battle's own RNG
 *    (deterministic per seed), hand = first handSize (4), queue = the rest.
 *  - Playing a card removes it from hand, pushes it to the queue tail and
 *    draws the queue head into the same hand slot.
 *  - Invariant: hand ∪ queue is always the full deck, no losses, no dupes.
 */
import { getCardById } from '../../content/cards';
import type { BalanceConfig } from '../../content/balance';
import type { SeededRng } from '../random/rng';

export interface TeamCardsState {
  hand: string[];
  queue: string[];
}

/** Structural deck validation shared by the deck builder, AI and engine. */
export function validateDeck(cardIds: readonly string[], balance: BalanceConfig): string[] {
  const errors: string[] = [];
  if (cardIds.length !== balance.cards.deckSize) {
    errors.push(`deck must have exactly ${balance.cards.deckSize} cards (has ${cardIds.length})`);
  }
  const seen = new Set<string>();
  for (const id of cardIds) {
    if (seen.has(id)) errors.push(`duplicate card '${id}'`);
    seen.add(id);
    if (!getCardById(id)) errors.push(`unknown card '${id}'`);
  }
  return errors;
}

/**
 * Builds the initial shuffled cards-state for one team.
 * Caller must have validated the deck; throws on structural violations to
 * surface programmer error early (replay loaders pre-validate).
 */
export function initTeamCards(
  deckCardIds: readonly string[],
  balance: BalanceConfig,
  rng: SeededRng
): TeamCardsState {
  const errors = validateDeck(deckCardIds, balance);
  if (errors.length > 0) {
    throw new Error(`invalid deck: ${errors.join('; ')}`);
  }
  const shuffled = rng.shuffle(deckCardIds);
  return {
    hand: shuffled.slice(0, balance.cards.handSize),
    queue: shuffled.slice(balance.cards.handSize),
  };
}

/**
 * Cycles a played card: hand slot is refilled from the queue head, the played
 * card goes to the queue tail. Returns false if the card is not in hand
 * (callers treat that as a rejected command).
 */
export function cycleCard(cards: TeamCardsState, cardId: string): boolean {
  const slot = cards.hand.indexOf(cardId);
  if (slot === -1) return false;
  const drawn = cards.queue.shift();
  if (drawn === undefined) {
    // Queue can only be empty if deckSize <= handSize — configuration error.
    return false;
  }
  cards.hand[slot] = drawn;
  cards.queue.push(cardId);
  return true;
}

/** Deck-cycle invariant check used by the battle invariant suite. */
export function checkCardsInvariant(
  cards: TeamCardsState,
  balance: BalanceConfig
): string[] {
  const violations: string[] = [];
  if (cards.hand.length !== balance.cards.handSize)
    violations.push(`hand size ${cards.hand.length} != ${balance.cards.handSize}`);
  const all = [...cards.hand, ...cards.queue];
  if (all.length !== balance.cards.deckSize)
    violations.push(`deck cycle lost/gained cards (${all.length} != ${balance.cards.deckSize})`);
  if (new Set(all).size !== all.length) violations.push('duplicate cards in cycle');
  return violations;
}
