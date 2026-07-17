/**
 * ORIGIN ONBOARDING — recommendation copy (v5).
 *
 * reasonText() is the ONLY source of candidate reason copy
 * (ORIGIN_CALIBRATION_SPEC.md §5): components never invent strings, and the
 * vitest C-8 check pins a non-empty string for every code in the closed
 * vocabulary. Keep copy concise — it renders on a card chip row.
 */

import type { OriginReasonCode } from './types';

const REASON_TEXT: Record<OriginReasonCode, string> = {
  HIGH_RELATIVE_STRENGTH: 'Your lifts are already relatively heavy for your bodyweight',
  HIGH_MUSCLE_SIZE: 'Your frame already carries serious muscle',
  HIGH_CARDIO_CAPACITY: 'Your engine is your proven strength',
  HIGH_LEANNESS: 'You are already carrying stage-ready leanness',
  HIGH_AESTHETIC_BALANCE: 'Your proportions and balance are your edge',
  BALANCED_ATHLETE: 'A balanced all-round starting point',
  CUTTING_PHASE_HIGH_BF: 'You are cutting from a high start — the redemption arc fits',
  STRENGTH_PRIMARY_GOAL: 'You said you want raw strength',
  MUSCLE_GAIN_PRIMARY_GOAL: 'You said you want to build size',
  FAT_LOSS_PRIMARY_GOAL: 'You said you want to cut fat',
  CARDIO_PRIMARY_GOAL: 'You said you want a bigger engine',
  AESTHETIC_PRIMARY_GOAL: 'You said you want the aesthetic look',
  PHASE_INFERRED_GOAL: 'Inferred from your current nutrition phase',
  POWER_PLAYSTYLE: 'You prefer overwhelming power in battle',
  PRECISION_PLAYSTYLE: 'You prefer technical precision in battle',
  TEMPO_PLAYSTYLE: 'You prefer relentless tempo in battle',
  UNTAPPED_STRENGTH: 'Hidden strength potential your training has not tapped yet',
  UNTAPPED_SIZE: 'Frame potential your training has not filled out yet',
  UNTAPPED_CARDIO: 'An engine you have never trained is waiting',
  UNTAPPED_LEANNESS: 'A leaner version of you is within reach',
  UNTAPPED_AESTHETICS: 'Aesthetic potential your current training overlooks',
  CONTRAST_PATH: 'The road less travelled — a deliberate contrast to your strengths',
};

export function reasonText(code: OriginReasonCode): string {
  return REASON_TEXT[code];
}
