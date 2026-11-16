/**
 * TechArtha original risk-assessment methodology, version `ta-risk-v1`.
 * NOT regulator-approved and NOT a copy of any other platform's questions or method. Thresholds, weights and caps below are
 * proposals for compliance review. Any change to this file's numbers MUST create a new version id (e.g. ta-risk-v2) and leave
 * this one untouched, so that every stored assessment can be recomputed exactly. Full write-up: docs/RISK-SCORING-METHODOLOGY.md.
 * Everything is calculated on the server from the answers only; the client never supplies a score, band or sub-score.
 */
export const TA_RISK_V1 = 'ta-risk-v1';

export type Dimension = 'WILLINGNESS' | 'CAPACITY' | 'KNOWLEDGE';
export interface RiskQuestion { id: string; no: number; dimension: Dimension; weight: number; /** option ids ordered by score 0,1,2,3 (more risk-tolerant / more capable = higher) */ options: readonly string[] }

export const QUESTIONS: readonly RiskQuestion[] = [
  { id: 'objective', no: 1, dimension: 'WILLINGNESS', weight: 0.20, options: ['capital_preservation', 'regular_income', 'balanced_growth', 'long_term_growth'] },
  { id: 'horizon', no: 2, dimension: 'CAPACITY', weight: 0.22, options: ['lt1', '1to3', '3to7', 'gt7'] },
  { id: 'income', no: 3, dimension: 'CAPACITY', weight: 0.12, options: ['lt25k', '25to75k', '75kto2l', 'gt2l'] },
  { id: 'surplus', no: 4, dimension: 'CAPACITY', weight: 0.16, options: ['lt5', '5to15', '15to30', 'gt30'] },
  { id: 'experience', no: 5, dimension: 'KNOWLEDGE', weight: 0.50, options: ['none', 'deposits_only', 'some_mf_or_equity', 'diversified_5y'] },
  { id: 'emergency', no: 6, dimension: 'CAPACITY', weight: 0.18, options: ['none', 'lt3m', '3to6m', 'gt6m'] },
  { id: 'liabilities', no: 7, dimension: 'CAPACITY', weight: 0.16, options: ['heavy', 'significant', 'moderate', 'low'] },
  { id: 'knowledge', no: 8, dimension: 'KNOWLEDGE', weight: 0.50, options: ['none', 'basic', 'good', 'advanced'] },
  { id: 'decline_reaction', no: 9, dimension: 'WILLINGNESS', weight: 0.30, options: ['sell_all', 'sell_some', 'hold', 'buy_more'] },
  { id: 'loss_tolerance', no: 10, dimension: 'WILLINGNESS', weight: 0.25, options: ['lt5', '5to10', '10to20', 'gt20'] },
  { id: 'liquidity', no: 11, dimension: 'CAPACITY', weight: 0.16, options: ['all_within_1y', 'part_1to3y', 'rarely', 'not_needed'] },
  { id: 'return_vs_risk', no: 12, dimension: 'WILLINGNESS', weight: 0.25, options: ['stable_low', 'small_swings', 'moderate_swings', 'large_swings_high'] },
] as const;

/** Overall = W*WEIGHTS.W + C*WEIGHTS.C + K*WEIGHTS.K, each sub-score on 0..100. */
export const DIMENSION_WEIGHTS = { WILLINGNESS: 0.5, CAPACITY: 0.35, KNOWLEDGE: 0.15 } as const;
/** Score may never exceed capacity + CAPACITY_MARGIN: willingness alone cannot buy an aggressive profile. */
export const CAPACITY_MARGIN = 15;
/** Upper bounds (inclusive, on the rounded 0..100 score): 0-20, 21-40, 41-60, 61-80, 81-100. Proposed; compliance to review. */
export const BAND_UPPER = { VERY_CONSERVATIVE: 20, CONSERVATIVE: 40, MODERATE: 60, MODERATELY_AGGRESSIVE: 80, AGGRESSIVE: 100 } as const;
export type Band = keyof typeof BAND_UPPER;
export const BANDS: Band[] = ['VERY_CONSERVATIVE', 'CONSERVATIVE', 'MODERATE', 'MODERATELY_AGGRESSIVE', 'AGGRESSIVE'];

/** Hard caps from single answers (ceiling on the final score). */
export const HARD_CAPS: { code: string; question: string; option: string; ceiling: number }[] = [
  { code: 'NEAR_TERM_HORIZON', question: 'horizon', option: 'lt1', ceiling: 40 },
  { code: 'NO_EMERGENCY_FUND', question: 'emergency', option: 'none', ceiling: 60 },
  { code: 'ALL_MONEY_NEEDED_WITHIN_1Y', question: 'liquidity', option: 'all_within_1y', ceiling: 60 },
];
/** Ceiling applied when any contradiction is detected, until the user reviews their answers. */
export const CONSISTENCY_CEILING = 60;

/** Contradictory pairs: [flag code, question A, option A, question B, option B]. */
export const CONTRADICTIONS: readonly [string, string, string, string, string][] = [
  ['SELLS_ON_DECLINE_BUT_EXPECTS_HIGH_RETURN', 'decline_reaction', 'sell_all', 'return_vs_risk', 'large_swings_high'],
  ['SELLS_ON_DECLINE_BUT_HIGH_LOSS_TOLERANCE', 'decline_reaction', 'sell_all', 'loss_tolerance', 'gt20'],
  ['GROWTH_GOAL_BUT_SHORT_HORIZON', 'objective', 'long_term_growth', 'horizon', 'lt1'],
  ['NEEDS_ALL_MONEY_SOON_BUT_LONG_HORIZON', 'liquidity', 'all_within_1y', 'horizon', 'gt7'],
  ['PRESERVATION_GOAL_BUT_HIGH_RETURN_EXPECTATION', 'objective', 'capital_preservation', 'return_vs_risk', 'large_swings_high'],
  ['HEAVY_LIABILITIES_BUT_HIGH_RISK_APPETITE', 'liabilities', 'heavy', 'return_vs_risk', 'large_swings_high'],
];

export const MIN_HORIZON_YEARS: Record<Band, number> = { VERY_CONSERVATIVE: 1, CONSERVATIVE: 3, MODERATE: 5, MODERATELY_AGGRESSIVE: 7, AGGRESSIVE: 10 };
/** Category-level guidance only; NOT approved. It is shown with a compliance notice and never triggers a transaction. */
export const CATEGORY_GUIDANCE: Record<Band, string[]> = {
  VERY_CONSERVATIVE: ['LIQUID_OVERNIGHT', 'SHORT_DURATION_DEBT'],
  CONSERVATIVE: ['SHORT_DURATION_DEBT', 'CONSERVATIVE_HYBRID', 'BANKING_PSU_DEBT'],
  MODERATE: ['BALANCED_HYBRID', 'LARGE_CAP_INDEX', 'DYNAMIC_ASSET_ALLOCATION'],
  MODERATELY_AGGRESSIVE: ['FLEXI_CAP', 'LARGE_AND_MID_CAP', 'AGGRESSIVE_HYBRID'],
  AGGRESSIVE: ['MID_CAP', 'SMALL_CAP', 'SECTORAL_THEMATIC'],
};

export type Answers = Record<string, string>;
export class RiskAnswerError extends Error { constructor(readonly code: 'INCOMPLETE' | 'INVALID', readonly detail: string[]) { super(`${code}: ${detail.join(', ')}`); } }

export interface RiskResult {
  version: string; score: number; band: Band; base: number;
  dimensions: { willingness: number; capacity: number; knowledge: number };
  caps: { code: string; ceiling: number }[]; flags: string[]; needsReview: boolean;
  strengths: string[]; concerns: string[]; minHorizonYears: number; categoryGuidance: string[]; guidanceApproved: false;
}

export const optionScore = (q: RiskQuestion, optionId: string) => q.options.indexOf(optionId); // 0..3, -1 if invalid
export const normalize = (s: number) => (s / 3) * 100;

export function validateAnswers(a: unknown): asserts a is Answers {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new RiskAnswerError('INVALID', ['answers']);
  const ans = a as Record<string, unknown>;
  const unknown = Object.keys(ans).filter((k) => !QUESTIONS.some((q) => q.id === k));
  const invalid = QUESTIONS.filter((q) => q.id in ans && (typeof ans[q.id] !== 'string' || optionScore(q, ans[q.id] as string) < 0)).map((q) => q.id);
  if (unknown.length || invalid.length) throw new RiskAnswerError('INVALID', [...unknown, ...invalid]);
  const missing = QUESTIONS.filter((q) => !(q.id in ans)).map((q) => q.id);
  if (missing.length) throw new RiskAnswerError('INCOMPLETE', missing);
}
/** Validates a possibly partial set (for saved progress): only known questions with valid options. */
export function validatePartial(a: unknown): asserts a is Answers {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new RiskAnswerError('INVALID', ['answers']);
  const bad = Object.entries(a as Record<string, unknown>).filter(([k, v]) => { const q = QUESTIONS.find((x) => x.id === k); return !q || typeof v !== 'string' || optionScore(q, v) < 0; }).map(([k]) => k);
  if (bad.length) throw new RiskAnswerError('INVALID', bad);
}

export function bandFor(score: number): Band { return BANDS.find((b) => score <= BAND_UPPER[b])!; }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreV1(answers: Answers): RiskResult {
  validateAnswers(answers);
  const sum: Record<Dimension, number> = { WILLINGNESS: 0, CAPACITY: 0, KNOWLEDGE: 0 };
  for (const q of QUESTIONS) sum[q.dimension] += q.weight * normalize(optionScore(q, answers[q.id]));
  const W = sum.WILLINGNESS, C = sum.CAPACITY, K = sum.KNOWLEDGE;
  const base = W * DIMENSION_WEIGHTS.WILLINGNESS + C * DIMENSION_WEIGHTS.CAPACITY + K * DIMENSION_WEIGHTS.KNOWLEDGE;

  const caps: { code: string; ceiling: number }[] = [{ code: 'CAPACITY_LIMIT', ceiling: C + CAPACITY_MARGIN }];
  for (const h of HARD_CAPS) if (answers[h.question] === h.option) caps.push({ code: h.code, ceiling: h.ceiling });
  const flags = CONTRADICTIONS.filter(([, qa, oa, qb, ob]) => answers[qa] === oa && answers[qb] === ob).map(([c]) => c);
  if (flags.length) caps.push({ code: 'CONSISTENCY_REVIEW', ceiling: CONSISTENCY_CEILING });

  const ceiling = Math.min(...caps.map((c) => c.ceiling));
  const score = Math.max(0, Math.min(100, Math.round(Math.min(base, ceiling))));
  const applied = caps.filter((c) => c.ceiling < base).map((c) => ({ code: c.code, ceiling: round2(c.ceiling) }));
  const band = bandFor(score);
  const sc = (id: string) => optionScore(QUESTIONS.find((q) => q.id === id)!, answers[id]);

  const strengths: string[] = [];
  if (W >= 67) strengths.push('COMFORTABLE_WITH_VOLATILITY');
  if (C >= 67) strengths.push('STRONG_FINANCIAL_CAPACITY');
  if (K >= 67) strengths.push('GOOD_KNOWLEDGE');
  if (sc('emergency') >= 2) strengths.push('HAS_EMERGENCY_FUND');
  if (sc('horizon') >= 2) strengths.push('LONGER_HORIZON');
  const concerns: string[] = [];
  if (C <= 33) concerns.push('LIMITED_CAPACITY');
  if (sc('emergency') === 0) concerns.push('NO_EMERGENCY_FUND');
  if (W - C >= 30) concerns.push('WILLINGNESS_EXCEEDS_CAPACITY');
  if (K <= 33) concerns.push('LIMITED_KNOWLEDGE');
  if (sc('liabilities') === 0) concerns.push('HIGH_LIABILITIES');
  if (sc('liquidity') === 0) concerns.push('NEAR_TERM_LIQUIDITY_NEED');
  if (flags.length) concerns.push('ANSWERS_NEED_REVIEW');

  return {
    version: TA_RISK_V1, score, band, base: round2(base),
    dimensions: { willingness: round2(W), capacity: round2(C), knowledge: round2(K) },
    caps: applied, flags, needsReview: flags.length > 0, strengths, concerns,
    minHorizonYears: MIN_HORIZON_YEARS[band], categoryGuidance: CATEGORY_GUIDANCE[band], guidanceApproved: false,
  };
}

/** SEBI scheme-riskometer levels (a property of a SCHEME, not of the investor). Used only to flag a mismatch; never to place or recommend an order. */
export const SCHEME_LEVELS = ['LOW', 'LOW_TO_MODERATE', 'MODERATE', 'MODERATELY_HIGH', 'HIGH', 'VERY_HIGH'] as const;
export type SchemeLevel = (typeof SCHEME_LEVELS)[number];
const MAX_SCHEME_LEVEL: Record<Band, number> = { VERY_CONSERVATIVE: 1, CONSERVATIVE: 2, MODERATE: 3, MODERATELY_AGGRESSIVE: 4, AGGRESSIVE: 5 };
export function suitabilityFlag(band: Band, capacity: number, scheme: SchemeLevel | null | undefined): { status: 'UNKNOWN' | 'CONSISTENT' | 'ABOVE_PROFILE' | 'ABOVE_CAPACITY'; note: 'NOT_A_RECOMMENDATION' } {
  if (!scheme) return { status: 'UNKNOWN', note: 'NOT_A_RECOMMENDATION' }; // no verified scheme riskometer data: never guess
  const lvl = SCHEME_LEVELS.indexOf(scheme);
  if (lvl > MAX_SCHEME_LEVEL[band]) return { status: 'ABOVE_PROFILE', note: 'NOT_A_RECOMMENDATION' };
  if (capacity <= 33 && lvl >= 4) return { status: 'ABOVE_CAPACITY', note: 'NOT_A_RECOMMENDATION' };
  return { status: 'CONSISTENT', note: 'NOT_A_RECOMMENDATION' };
}
