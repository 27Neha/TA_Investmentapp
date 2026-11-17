import { futureValue, monthsBetween, planGoal, requiredMonthly } from './goal-math';

describe('goal math (illustrative projections)', () => {
  it('required monthly reaches the target (round trip)', () => {
    for (const [t, lump, r, m] of [[1_000_000, 0, 12, 120], [500_000, 100_000, 8, 60], [2_500_000, 250_000, 10, 240]] as const) {
      const p = requiredMonthly(t, lump, r, m);
      expect(Math.abs(futureValue(lump, p, r, m) - t)).toBeLessThan(m * 0.01 + 1);
    }
  });
  it('known value: 12% p.a., 10 years, 10 lakh target', () => { expect(requiredMonthly(1_000_000, 0, 12, 120)).toBeCloseTo(4304.1, 0); });
  it('zero return is simple division', () => {
    expect(requiredMonthly(120_000, 0, 0, 12)).toBe(10_000);
    expect(futureValue(1000, 100, 0, 10)).toBe(2000);
  });
  it('needs nothing when current savings already grow past the target', () => { expect(requiredMonthly(100_000, 100_000, 6, 12)).toBe(0); });
  it('past or current target date: only the remaining gap, no negative or NaN values', () => {
    expect(requiredMonthly(50_000, 20_000, 10, 0)).toBe(30_000);
    expect(futureValue(20_000, 500, 10, 0)).toBe(20_000);
  });
  it('plan reports on-track and shortfall consistently', () => {
    const a = planGoal({ targetAmount: 1_000_000, currentSavings: 0, monthlyContribution: 1000, expectedReturnPct: 8, monthsLeft: 120 });
    expect(a.onTrack).toBe(false);
    expect(a.shortfall).toBeGreaterThan(0);
    expect(a.projectedValue + a.shortfall).toBeCloseTo(1_000_000, 0);
    const b = planGoal({ targetAmount: 100_000, currentSavings: 0, monthlyContribution: 50_000, expectedReturnPct: 0, monthsLeft: 12 });
    expect(b.onTrack).toBe(true);
    expect(b.shortfall).toBe(0);
  });
  it('months between dates rounds partial months up', () => {
    expect(monthsBetween(new Date('2026-11-16'), new Date('2027-11-16'))).toBe(12);
    expect(monthsBetween(new Date('2026-11-16'), new Date('2027-11-20'))).toBe(13);
    expect(monthsBetween(new Date('2026-11-16'), new Date('2026-01-01'))).toBe(0);
  });
});
