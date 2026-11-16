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
