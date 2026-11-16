/** Pure, deterministic goal arithmetic. Every figure is ILLUSTRATIVE: it assumes a constant annual return chosen by the user and is not a forecast. */
export interface GoalInput { targetAmount: number; currentSavings: number; monthlyContribution: number; expectedReturnPct: number; monthsLeft: number }
export interface GoalPlan { monthsLeft: number; requiredMonthly: number; projectedValue: number; shortfall: number; onTrack: boolean }

const round = (n: number) => Math.round(n * 100) / 100;

export function monthsBetween(from: Date, to: Date): number {
  const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + (to.getUTCDate() > from.getUTCDate() ? 1 : 0);
  return Math.max(0, m);
}

/** Future value of a lump sum plus level monthly contributions (paid at the start of each month), monthly compounding. */
export function futureValue(lump: number, monthly: number, annualPct: number, months: number): number {
  if (months <= 0) return round(lump);
  const r = annualPct / 100 / 12;
  if (r === 0) return round(lump + monthly * months);
  const g = Math.pow(1 + r, months);
  return round(lump * g + monthly * ((g - 1) / r) * (1 + r));
}

/** Monthly amount needed so that futureValue(...) reaches the target. 0 if the current savings alone already get there. */
export function requiredMonthly(target: number, lump: number, annualPct: number, months: number): number {
  if (months <= 0) return round(Math.max(0, target - lump));
  const r = annualPct / 100 / 12;
  const needed = target - (r === 0 ? lump : lump * Math.pow(1 + r, months));
  if (needed <= 0) return 0;
  if (r === 0) return round(needed / months);
  const g = Math.pow(1 + r, months);
  return round((needed * r) / ((g - 1) * (1 + r)));
}

export function planGoal(i: GoalInput): GoalPlan {
  const projectedValue = futureValue(i.currentSavings, i.monthlyContribution, i.expectedReturnPct, i.monthsLeft);
  const req = requiredMonthly(i.targetAmount, i.currentSavings, i.expectedReturnPct, i.monthsLeft);
  return { monthsLeft: i.monthsLeft, requiredMonthly: req, projectedValue, shortfall: round(Math.max(0, i.targetAmount - projectedValue)), onTrack: projectedValue >= i.targetAmount };
}
