/** DRAFT risk questionnaire — structure only. Wording, scoring and band labels need compliance approval before production use. */
export const RISK_VERSION = 'draft-0.1';
export const RISK_QUESTIONS: { id: string; options: { id: string; points: number }[] }[] = [
  { id: 'horizon', options: [{ id: 'lt1', points: 1 }, { id: '1to3', points: 2 }, { id: '3to7', points: 3 }, { id: 'gt7', points: 4 }] },
  { id: 'reaction', options: [{ id: 'sell', points: 1 }, { id: 'wait', points: 2 }, { id: 'hold', points: 3 }, { id: 'buymore', points: 4 }] },
  { id: 'income', options: [{ id: 'unstable', points: 1 }, { id: 'somewhat', points: 2 }, { id: 'stable', points: 3 }, { id: 'verystable', points: 4 }] },
  { id: 'experience', options: [{ id: 'none', points: 1 }, { id: 'little', points: 2 }, { id: 'some', points: 3 }, { id: 'lots', points: 4 }] },
  { id: 'goal', options: [{ id: 'preserve', points: 1 }, { id: 'income', points: 2 }, { id: 'balanced', points: 3 }, { id: 'growth', points: 4 }] },
];

export function scoreRisk(answers: Record<string, string>): { score: number; band: string } | null {
  const ids = Object.keys(answers);
  if (ids.length !== RISK_QUESTIONS.length) return null;
  let score = 0;
  for (const q of RISK_QUESTIONS) {
    const o = q.options.find((x) => x.id === answers[q.id]);
    if (!o) return null;
    score += o.points;
  }
  return { score, band: score <= 9 ? 'CONSERVATIVE' : score <= 15 ? 'MODERATE' : 'AGGRESSIVE' };
}

/** Transparent, replaceable framework description. Replace RISK_QUESTIONS/thresholds with the approved set; bump RISK_VERSION so history stays comparable. */
export const RISK_FRAMEWORK = {
  version: RISK_VERSION,
  approved: false,
  dimensions: ['investment horizon', 'reaction to a fall in value', 'income stability', 'investment experience', 'main objective'],
  maxScore: RISK_QUESTIONS.length * 4,
  bands: [
    { band: 'CONSERVATIVE', rule: 'score of 9 or less' },
    { band: 'MODERATE', rule: 'score of 10 to 15' },
    { band: 'AGGRESSIVE', rule: 'score of 16 or more' },
  ],
};
export const BAND_EXPLANATION: Record<string, string> = {
  CONSERVATIVE: 'Your answers suggest you prefer stability and may be uncomfortable with large swings in value. This describes your own preferences; it is not a recommendation.',
  MODERATE: 'Your answers suggest you can accept some ups and downs in exchange for the chance of growth. This describes your own preferences; it is not a recommendation.',
  AGGRESSIVE: 'Your answers suggest you are comfortable with larger swings in value for the chance of higher growth. This describes your own preferences; it is not a recommendation.',
};
export const BAND_ORDER = ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'];
