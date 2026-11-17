import { ENGINES } from './registry';
import { Answers, BAND_UPPER, bandFor, CONTRADICTIONS, DIMENSION_WEIGHTS, QUESTIONS, RiskAnswerError, scoreV1, suitabilityFlag, validateAnswers } from './ta-risk-v1';

/** Builds an answer set at one score level (0..3) for every question, then applies overrides. */
const at = (level: number, over: Answers = {}): Answers => ({ ...Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[level]])), ...over });
// A neutral baseline that cannot trigger any contradiction or hard cap.
const mid = (over: Answers = {}) => at(2, over);

describe('ta-risk-v1: definition', () => {
  it('has exactly 12 questions with 4 options each, ids unique, covering the required dimensions', () => {
    expect(QUESTIONS).toHaveLength(12);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(12);
    expect(QUESTIONS.map((q) => q.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const q of QUESTIONS) { expect(q.options).toHaveLength(4); expect(new Set(q.options).size).toBe(4); }
  });
  it('weights inside each dimension sum to 1 and dimension weights sum to 1', () => {
    for (const d of ['WILLINGNESS', 'CAPACITY', 'KNOWLEDGE'] as const) expect(QUESTIONS.filter((q) => q.dimension === d).reduce((s, q) => s + q.weight, 0)).toBeCloseTo(1, 10);
    expect(Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it('every contradiction rule refers to real questions and options', () => {
    for (const [, qa, oa, qb, ob] of CONTRADICTIONS) { expect(QUESTIONS.find((q) => q.id === qa)!.options).toContain(oa); expect(QUESTIONS.find((q) => q.id === qb)!.options).toContain(ob); }
  });
});

describe('ta-risk-v1: every question is scored and monotone', () => {
  for (const q of QUESTIONS) {
    it(`question ${q.no} (${q.id}): each option is accepted and a higher option never lowers the dimension score`, () => {
      let prev = -1;
      for (const [i, o] of q.options.entries()) {
        const r = scoreV1(mid({ [q.id]: o }));
        const dim = q.dimension === 'WILLINGNESS' ? r.dimensions.willingness : q.dimension === 'CAPACITY' ? r.dimensions.capacity : r.dimensions.knowledge;
        expect(dim).toBeGreaterThanOrEqual(prev); prev = dim;
        expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100);
        expect(i).toBe(q.options.indexOf(o));
      }
    });
  }
});

describe('ta-risk-v1: formula', () => {
  it('all-minimum answers give 0 and all-maximum give 100 (before any cap, flags excluded)', () => {
    expect(scoreV1(at(0)).dimensions).toEqual({ willingness: 0, capacity: 0, knowledge: 0 });
    const hi = scoreV1(at(3));
    expect(hi.dimensions).toEqual({ willingness: 100, capacity: 100, knowledge: 100 });
  });
  it('all-maximum answers form a coherent aggressive profile with no flags', () => {
    const r = scoreV1(at(3));
    expect(r.flags).toEqual([]); expect(r.score).toBe(100); expect(r.band).toBe('AGGRESSIVE');
  });
  it('base = 0.5*W + 0.35*C + 0.15*K, checked by hand on a mixed profile', () => {
    // W questions all 2 -> 66.67, C all 1 -> 33.33, K all 3 -> 100
    const a = at(1, { objective: 'balanced_growth', decline_reaction: 'hold', loss_tolerance: '10to20', return_vs_risk: 'moderate_swings', experience: 'diversified_5y', knowledge: 'advanced' });
    const r = scoreV1(a);
    expect(r.dimensions.willingness).toBeCloseTo(66.67, 1); expect(r.dimensions.capacity).toBeCloseTo(33.33, 1); expect(r.dimensions.knowledge).toBe(100);
    expect(r.base).toBeCloseTo(0.5 * 66.67 + 0.35 * 33.33 + 0.15 * 100, 1);
  });
  it('is deterministic and independent of key order', () => {
    const a = mid(); const b = Object.fromEntries(Object.entries(a).reverse());
    expect(scoreV1(a)).toEqual(scoreV1(b));
  });
  it('the registry reproduces a stored result exactly', () => {
    const a = mid(); expect(ENGINES['ta-risk-v1'](a)).toEqual(scoreV1(a));
  });
});

describe('ta-risk-v1: band boundaries (0-20, 21-40, 41-60, 61-80, 81-100)', () => {
  const cases: [number, string][] = [[0, 'VERY_CONSERVATIVE'], [20, 'VERY_CONSERVATIVE'], [21, 'CONSERVATIVE'], [40, 'CONSERVATIVE'], [41, 'MODERATE'], [60, 'MODERATE'], [61, 'MODERATELY_AGGRESSIVE'], [80, 'MODERATELY_AGGRESSIVE'], [81, 'AGGRESSIVE'], [100, 'AGGRESSIVE']];
  for (const [s, b] of cases) it(`score ${s} -> ${b}`, () => expect(bandFor(s)).toBe(b));
  it('thresholds object matches the documented table', () => expect(BAND_UPPER).toEqual({ VERY_CONSERVATIVE: 20, CONSERVATIVE: 40, MODERATE: 60, MODERATELY_AGGRESSIVE: 80, AGGRESSIVE: 100 }));
});

describe('ta-risk-v1: capacity prevents an excessively aggressive result', () => {
  it('maximum willingness and knowledge with minimum capacity cannot exceed capacity + 15 and is not Moderately Aggressive/Aggressive', () => {
    const a = at(0, { objective: 'long_term_growth', decline_reaction: 'buy_more', loss_tolerance: 'gt20', return_vs_risk: 'large_swings_high', experience: 'diversified_5y', knowledge: 'advanced' });
    const r = scoreV1(a);
    expect(r.dimensions.willingness).toBe(100); expect(r.dimensions.capacity).toBe(0);
    expect(r.score).toBeLessThanOrEqual(15);
    expect(['VERY_CONSERVATIVE', 'CONSERVATIVE']).toContain(r.band);
    expect(r.caps.map((c) => c.code)).toContain('CAPACITY_LIMIT');
    expect(r.concerns).toEqual(expect.arrayContaining(['LIMITED_CAPACITY', 'WILLINGNESS_EXCEEDS_CAPACITY']));
  });
  it('no emergency fund caps at 60; horizon under 1 year caps at 40; all money needed within a year caps at 60', () => {
    expect(scoreV1(at(3, { emergency: 'none' })).score).toBeLessThanOrEqual(60);
    expect(scoreV1(at(3, { horizon: 'lt1', objective: 'regular_income' })).score).toBeLessThanOrEqual(40);
    expect(scoreV1(at(3, { liquidity: 'all_within_1y', horizon: 'gt7' })).score).toBeLessThanOrEqual(60);
  });
  it('higher knowledge alone does not push someone into a higher band than their capacity allows', () => {
    const low = scoreV1(at(0, { knowledge: 'advanced', experience: 'diversified_5y' }));
    expect(low.band).toBe('VERY_CONSERVATIVE');
  });
});

describe('ta-risk-v1: contradictory answers', () => {
  for (const [code, qa, oa, qb, ob] of CONTRADICTIONS) {
    it(`${code} is flagged, needs review, and the score is held to Moderate at most`, () => {
      const r = scoreV1(at(3, { [qa]: oa, [qb]: ob }));
      expect(r.flags).toContain(code); expect(r.needsReview).toBe(true); expect(r.score).toBeLessThanOrEqual(60);
      expect(r.concerns).toContain('ANSWERS_NEED_REVIEW');
    });
  }
  it('consistent answers produce no flags', () => expect(scoreV1(mid()).flags).toEqual([]));
});

describe('ta-risk-v1: validation', () => {
  it('rejects every missing answer, one at a time', () => {
    for (const q of QUESTIONS) { const a = mid(); delete a[q.id]; expect(() => scoreV1(a)).toThrow(RiskAnswerError); try { scoreV1(a); } catch (e: any) { expect(e.code).toBe('INCOMPLETE'); expect(e.detail).toEqual([q.id]); } }
  });
  it('rejects invalid options, unknown questions, non-strings and non-objects', () => {
    expect(() => scoreV1(mid({ horizon: 'forever' }))).toThrow(/INVALID/);
    expect(() => scoreV1({ ...mid(), score: '100' } as any)).toThrow(/INVALID/); // a client-supplied score is not an answer
    expect(() => scoreV1({ ...mid(), band: 'AGGRESSIVE' } as any)).toThrow(/INVALID/);
    expect(() => scoreV1({ ...mid(), horizon: 3 } as any)).toThrow(/INVALID/);
    expect(() => validateAnswers(null)).toThrow(); expect(() => validateAnswers([])).toThrow(); expect(() => validateAnswers('x')).toThrow();
    expect(() => scoreV1({} as any)).toThrow(/INCOMPLETE/);
  });
  it('never mutates its input', () => { const a = mid(); const copy = JSON.stringify(a); scoreV1(a); expect(JSON.stringify(a)).toBe(copy); });
});

describe('ta-risk-v1: scheme riskometer suitability flag', () => {
  it('never guesses when verified scheme data is missing', () => expect(suitabilityFlag('AGGRESSIVE', 100, null).status).toBe('UNKNOWN'));
  it('flags schemes above the profile and above low capacity, otherwise consistent', () => {
    expect(suitabilityFlag('CONSERVATIVE', 80, 'HIGH').status).toBe('ABOVE_PROFILE');
    expect(suitabilityFlag('AGGRESSIVE', 20, 'VERY_HIGH').status).toBe('ABOVE_CAPACITY');
    expect(suitabilityFlag('MODERATE', 60, 'MODERATE').status).toBe('CONSISTENT');
    expect(suitabilityFlag('MODERATE', 60, 'MODERATE').note).toBe('NOT_A_RECOMMENDATION');
  });
});
