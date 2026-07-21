import { describe, expect, it } from 'vitest';

// The meal-scan edge function's deterministic layer — a pure, import-free
// module, so the client suite can pin it even though it ships to Deno.
// If this import ever breaks the client toolchain, fall back to the curl
// matrix in the function's header and delete this file.
import {
  matchFood,
  parseQualifiers,
} from '../../../../supabase/functions/meal-scan/food-match';

describe('parseQualifiers', () => {
  it('reads preparation state', () => {
    expect(parseQualifiers('raw beef mince').state).toBe('raw');
    expect(parseQualifiers('grilled chicken').state).toBe('cooked');
    expect(parseQualifiers('dry pasta').state).toBe('raw');
    expect(parseQualifiers('beef mince').state).toBeNull();
  });

  it('reads fat percent in all three phrasings', () => {
    expect(parseQualifiers('10% beef mince').fatPct).toBe(10);
    expect(parseQualifiers('90/10 ground beef').fatPct).toBe(10);
    expect(parseQualifiers('95% lean mince').fatPct).toBe(5);
    // A plain % ≥ 50 is a LEAN figure ("93% mince" means 93% lean).
    expect(parseQualifiers('93% mince').fatPct).toBe(7);
  });

  it('rejects nonsense percentages', () => {
    expect(parseQualifiers('0% mince').fatPct).toBeNull();
  });
});

describe('matchFood — the raw-mince bug and the doctrine around it', () => {
  it('THE BUG: "raw 10% beef mince" resolves to the raw-10% variant, not cooked base', () => {
    const hit = matchFood('raw 10% beef mince');
    expect(hit).not.toBeNull();
    expect(hit!.key).toBe('ground beef (raw 10%)');
    expect(hit!.per100.kcal).toBe(176); // 500 g → 880 kcal, not 1250
  });

  it('unqualified names keep the old doctrine exactly', () => {
    expect(matchFood('beef mince')!.per100.kcal).toBe(250);
    expect(matchFood('mince')!.key).toBe('ground beef');
    expect(matchFood('grilled chicken breast')!.per100.kcal).toBe(165);
  });

  it('a qualifier on a food with no meta still matches (raw banana is a banana)', () => {
    expect(matchFood('raw banana')!.key).toBe('banana');
  });

  it('cooked variants and unstated-fat defaults', () => {
    expect(matchFood('cooked 5% beef mince')!.per100.kcal).toBe(174);
    // Fat unstated → the variant closest to the base row's own fat level.
    expect(matchFood('raw beef mince')!.key).toBe('ground beef (raw 15%)');
    expect(matchFood('raw chicken breast')!.per100.kcal).toBe(120);
    expect(matchFood('dry rice')!.per100.kcal).toBe(365);
    expect(matchFood('cooked oats')!.per100.kcal).toBe(71);
  });

  it('qualified beyond the table → null (caller falls back to the AI estimate)', () => {
    expect(matchFood('raw 30% beef mince')).toBeNull();
    expect(matchFood('raw salmon')).toBeNull(); // farmed-vs-wild ambiguity on purpose
  });

  it('the fallback text supplies qualifiers only when the name has none', () => {
    expect(matchFood('beef mince', '500g of raw 10% beef mince')!.key).toBe('ground beef (raw 10%)');
    // A qualifier in the name wins over the fallback: "cooked" agrees with the
    // base row's own state, so the base answers and "raw" never gets a vote.
    expect(matchFood('cooked beef mince', 'raw mince')!.key).toBe('ground beef');
  });

  it('a fat % with no state reads as the label (raw) figure', () => {
    expect(matchFood('10% beef mince')!.key).toBe('ground beef (raw 10%)');
  });
});
