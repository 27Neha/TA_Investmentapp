export interface NavPoint { date: string; nav: number } // date = YYYY-MM-DD
export const RANGES: Record<string, number | null> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60, MAX: null };

/** MFAPI dates are DD-MM-YYYY. Returns an ISO date, or null if the string is not a real calendar date. */
export function parseDdMmYyyy(s: unknown): string | null {
  const m = typeof s === 'string' ? s.match(/^(\d{2})-(\d{2})-(\d{4})$/) : null;
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Validates numeric NAVs (finite, > 0), drops unparseable rows, sorts ascending by date, removes duplicate dates (first occurrence wins). */
export function cleanSeries(raw: unknown): { points: NavPoint[]; dropped: number } {
  const rows = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: NavPoint[] = [];
  let dropped = 0;
  for (const r of rows) {
    const date = parseDdMmYyyy(r?.date);
    const nav = typeof r?.nav === 'number' ? r.nav : Number(String(r?.nav ?? '').trim());
    if (!date || !Number.isFinite(nav) || nav <= 0 || seen.has(date)) { dropped++; continue; }
    seen.add(date);
    out.push({ date, nav });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { points: out, dropped };
}

const addMonths = (iso: string, m: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function sliceRange(points: NavPoint[], range: string): NavPoint[] {
  const m = RANGES[range];
  if (m == null || !points.length) return points;
  const from = addMonths(points[points.length - 1].date, m);
  return points.filter((p) => p.date >= from);
}

/** Evenly thins a series for charting while keeping the first and last observation. Never invents points. */
export function downsample(points: NavPoint[], max = 250): NavPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: NavPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Point-to-point returns using the last NAV on or before (latest date minus N months). Null when history is too short. Annualised only for >= 1 year. Historical only. */
export function periodReturns(points: NavPoint[]) {
  if (!points.length) return [];
  const last = points[points.length - 1];
  return (['1M', '3M', '6M', '1Y', '3Y', '5Y'] as const).map((p) => {
    const target = addMonths(last.date, RANGES[p] as number);
    let base: NavPoint | undefined;
    for (let i = points.length - 1; i >= 0; i--) if (points[i].date <= target) { base = points[i]; break; }
    if (!base) return { period: p, available: false as const };
    const pct = (last.nav / base.nav - 1) * 100;
    const days = daysBetween(base.date, last.date);
    const annualised = (RANGES[p] as number) >= 12 && days > 0 ? (Math.pow(last.nav / base.nav, 365.25 / days) - 1) * 100 : null;
    return { period: p, available: true as const, fromDate: base.date, toDate: last.date, fromNav: base.nav, toNav: last.nav, returnPct: Math.round(pct * 100) / 100, annualisedPct: annualised == null ? null : Math.round(annualised * 100) / 100 };
  });
}

/** Plan/option facets are DERIVED from the scheme name text only; they are not verified scheme data. */
export function deriveFacets(name: string) {
  const n = name.toLowerCase();
  const plan = /\bdirect\b/.test(n) ? 'DIRECT' : /\bregular\b/.test(n) ? 'REGULAR' : null;
  const option = /\b(idcw|dividend|payout|reinvest)/.test(n) ? 'IDCW' : /\bgrowth\b/.test(n) ? 'GROWTH' : null;
  return { plan, option, derivedFromName: true };
}

export function isStale(navIso: string, now = new Date(), days = 5): boolean { return daysBetween(navIso, now.toISOString().slice(0, 10)) > days; }
