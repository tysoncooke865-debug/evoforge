/**
 * Content loader — the single entry point through which the app and engine
 * access game content. Validates everything once and caches the report.
 */
import { AUGMENTS } from './augments';
import { BALANCE } from './balance';
import { CARDS } from './cards';
import { CHAMPIONS } from './champions';
import { SYNERGIES } from './synergies';
import {
  ContentValidationReport,
  validateAugments,
  validateBalance,
  validateCards,
  validateChampions,
  validateSynergies,
} from './validate';

export { BALANCE, BALANCE_VERSION, secondsToTicks, TICKS_PER_SECOND } from './balance';
export type { AiDifficulty, AiDifficultyConfig } from './balance';
export { ALL_AI_DIFFICULTIES } from './balance';
export { AUGMENTS, getAugmentById } from './augments';
export { CARDS, getCardById } from './cards';
export { CHAMPIONS, getChampionById, getChampionByPath, pathDisplayName } from './champions';
export { SYNERGIES } from './synergies';
export type {
  AugmentDefinition,
  CardDefinition,
  ChampionDefinition,
  SynergyDefinition,
} from './types';
export type { ContentValidationReport } from './validate';

let cachedReport: ContentValidationReport | null = null;

export function validateAllContent(): ContentValidationReport {
  if (cachedReport) return cachedReport;
  const cards = validateCards(CARDS);
  const champions = validateChampions(CHAMPIONS);
  const synergies = validateSynergies(SYNERGIES, CARDS, CHAMPIONS);
  const augments = validateAugments(AUGMENTS);
  const balance = validateBalance();
  const errors = [
    ...balance.errors,
    ...cards.errors,
    ...champions.errors,
    ...synergies.errors,
    ...augments.errors,
  ];
  const warnings = [
    ...balance.warnings,
    ...cards.warnings,
    ...champions.warnings,
    ...synergies.warnings,
    ...augments.warnings,
  ];
  cachedReport = {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      cards: CARDS.length,
      champions: CHAMPIONS.length,
      synergies: SYNERGIES.length,
      augments: AUGMENTS.length,
    },
  };
  return cachedReport;
}

/** Test-only helper to force revalidation. */
export function __resetContentValidationCache(): void {
  cachedReport = null;
}
