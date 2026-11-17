/**
 * Boundary for LIVE market indices, index history and market news. No licensed/verified provider has been selected or credentialled,
 * and MFAPI must NOT be used to derive index values. Until one is bound, every call reports `available:false` — the app shows an
 * "unavailable" state, never a made-up number or chart. To activate: implement IndexDataProvider for the chosen licensed vendor,
 * verify it, and bind it in MarketModule (documented in docs/PRODUCT-BUILD-STATUS.md).
 */
export interface IndexQuote { index: 'NIFTY50' | 'SENSEX'; value: number; change: number; changePct: number; asOf: string }
export interface IndexSnapshot { available: boolean; reason?: string; source?: string; quotes: IndexQuote[]; asOf?: string }
export interface IndexHistory { available: boolean; reason?: string; source?: string; points: { date: string; value: number }[] }
export interface NewsItem { headline: string; summary: string; category: string; source: string; publishedAt: string; url: string }
export interface NewsFeed { available: boolean; reason?: string; items: NewsItem[] }

export interface IndexDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  snapshot(): Promise<IndexSnapshot>;
  history(index: string, range: string): Promise<IndexHistory>;
  news(): Promise<NewsFeed>;
}
export const INDEX_PROVIDER = Symbol('INDEX_PROVIDER');

export class UnconfiguredIndexProvider implements IndexDataProvider {
  readonly name = 'none';
  isConfigured() { return false; }
  async snapshot(): Promise<IndexSnapshot> { return { available: false, reason: 'PROVIDER_NOT_CONFIGURED', quotes: [] }; }
  async history(): Promise<IndexHistory> { return { available: false, reason: 'PROVIDER_NOT_CONFIGURED', points: [] }; }
  async news(): Promise<NewsFeed> { return { available: false, reason: 'PROVIDER_NOT_CONFIGURED', items: [] }; }
}

/** Regular NSE/BSE equity session is 09:15–15:30 IST, Mon–Fri. Exchange holidays are NOT known here, so this is indicative only. */
export function marketHours(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
  return { state: open ? 'OPEN_HOURS' : 'CLOSED_HOURS', basis: 'regular trading hours (09:15–15:30 IST, Mon–Fri)', holidaysConsidered: false };
}
