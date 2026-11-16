import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { cleanSeries, deriveFacets, isStale, NavPoint, parseDdMmYyyy } from './nav-series';

export interface SchemeSummary { schemeCode: string; schemeName: string; plan?: string | null; option?: string | null }
export interface SchemeDetail extends SchemeSummary {
  fundHouse: string | null; category: string | null; schemeType: string | null; latestNav: number; navDate: string; navDateIso: string;
  stale: boolean; lastFetchedAt: string; observations: number; droppedObservations: number; source: string; facetsDerivedFromName: boolean;
}
export interface SchemeData { detail: SchemeDetail; points: NavPoint[] }

const UNAVAILABLE = { message: 'Fund data is temporarily unavailable. Please try again later.', code: 'UPSTREAM_UNAVAILABLE' };
export const SOURCE = 'MFAPI (mfapi.in), derived from AMFI NAV data';

/**
 * Public mutual-fund NAV data via MFAPI. Boundary only: unreachable upstream or an unexpected body => 503 UPSTREAM_UNAVAILABLE; we never fabricate NAVs.
 * Response shapes follow MFAPI's public docs and have NOT been verified live from the build sandbox. Requests are cached (10 min) and spaced to respect rate limits.
 */
@Injectable()
export class MarketDataProvider {
  private readonly base = (process.env.MFAPI_BASE ?? 'https://api.mfapi.in').replace(/\/$/, '');
  private readonly timeoutMs = Number(process.env.MARKET_TIMEOUT_MS ?? 6000);
  private readonly spacingMs = Number(process.env.MARKET_MIN_SPACING_MS ?? 120);
  private cache = new Map<string, { at: number; v: any }>();
  private readonly ttlMs = 10 * 60_000;
  private nextSlot = 0;

  private async spaced() {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.spacingMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  private async getJson(path: string): Promise<{ v: any; fetchedAt: number }> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < this.ttlMs) return { v: hit.v, fetchedAt: hit.at };
    await this.spaced();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = await res.json();
      if (this.cache.size > 300) this.cache.clear();
      const at = Date.now();
      this.cache.set(path, { at, v });
      return { v, fetchedAt: at };
    } catch { throw new ServiceUnavailableException(UNAVAILABLE); } finally { clearTimeout(timer); }
  }

  async search(q: string, limit = 100): Promise<SchemeSummary[]> {
    const { v } = await this.getJson(`/mf/search?q=${encodeURIComponent(q)}`);
    if (!Array.isArray(v)) throw new ServiceUnavailableException(UNAVAILABLE);
    return v.slice(0, limit).filter((r) => r && r.schemeCode != null && r.schemeName).map((r) => ({ schemeCode: String(r.schemeCode), schemeName: String(r.schemeName), ...deriveFacets(String(r.schemeName)) }));
  }

  /** Full scheme record with a validated, sorted, de-duplicated NAV series. */
  async scheme(code: string): Promise<SchemeData> {
    const { v: j, fetchedAt } = await this.getJson(`/mf/${encodeURIComponent(code)}`);
    const { points, dropped } = cleanSeries(j?.data);
    if (!j?.meta || !points.length) throw new ServiceUnavailableException(UNAVAILABLE);
    const last = points[points.length - 1];
    const original = (Array.isArray(j.data) ? j.data : []).find((r: any) => parseDdMmYyyy(r?.date) === last.date);
    const name = String(j.meta.scheme_name ?? '');
    return {
      points,
      detail: {
        schemeCode: String(j.meta.scheme_code ?? code), schemeName: name, ...deriveFacets(name), fundHouse: j.meta.fund_house ?? null, category: j.meta.scheme_category ?? null, schemeType: j.meta.scheme_type ?? null,
        latestNav: last.nav, navDate: String(original?.date ?? last.date), navDateIso: last.date, stale: isStale(last.date), lastFetchedAt: new Date(fetchedAt).toISOString(),
        observations: points.length, droppedObservations: dropped, source: SOURCE, facetsDerivedFromName: true,
      },
    };
  }
  async detail(code: string): Promise<SchemeDetail> { return (await this.scheme(code)).detail; }
}
