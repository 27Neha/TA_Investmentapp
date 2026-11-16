import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface SchemeSummary { schemeCode: string; schemeName: string }
export interface SchemeDetail extends SchemeSummary { fundHouse: string | null; category: string | null; schemeType: string | null; latestNav: number; navDate: string }

/**
 * Public mutual-fund NAV data via MFAPI (https://www.mfapi.in). Boundary only: if the upstream is unreachable or returns something unexpected
 * we answer 503 UPSTREAM_UNAVAILABLE — we never fabricate NAVs. Response shapes follow MFAPI's public docs and have NOT been verified live from the build sandbox.
 */
@Injectable()
export class MarketDataProvider {
  private readonly base = (process.env.MFAPI_BASE ?? 'https://api.mfapi.in').replace(/\/$/, '');
  private readonly timeoutMs = Number(process.env.MARKET_TIMEOUT_MS ?? 6000);
  private cache = new Map<string, { at: number; v: any }>();
  private readonly ttlMs = 10 * 60_000;

  private async getJson(path: string): Promise<any> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.v;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = await res.json();
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(path, { at: Date.now(), v });
      return v;
    } catch {
      throw new ServiceUnavailableException({ message: 'Fund data is temporarily unavailable. Please try again later.', code: 'UPSTREAM_UNAVAILABLE' });
    } finally { clearTimeout(timer); }
  }

  async search(q: string): Promise<SchemeSummary[]> {
    const rows = await this.getJson(`/mf/search?q=${encodeURIComponent(q)}`);
    if (!Array.isArray(rows)) throw new ServiceUnavailableException({ message: 'Fund data is temporarily unavailable. Please try again later.', code: 'UPSTREAM_UNAVAILABLE' });
    return rows.slice(0, 25).filter((r) => r && r.schemeCode != null && r.schemeName).map((r) => ({ schemeCode: String(r.schemeCode), schemeName: String(r.schemeName) }));
  }

  async detail(code: string): Promise<SchemeDetail> {
    const j = await this.getJson(`/mf/${encodeURIComponent(code)}`);
    const latest = Array.isArray(j?.data) ? j.data[0] : null;
    const nav = latest ? Number(latest.nav) : NaN;
    if (!j?.meta || !latest || !Number.isFinite(nav)) throw new ServiceUnavailableException({ message: 'Fund data is temporarily unavailable. Please try again later.', code: 'UPSTREAM_UNAVAILABLE' });
    return { schemeCode: String(j.meta.scheme_code ?? code), schemeName: String(j.meta.scheme_name ?? ''), fundHouse: j.meta.fund_house ?? null, category: j.meta.scheme_category ?? null, schemeType: j.meta.scheme_type ?? null, latestNav: nav, navDate: String(latest.date) };
  }
}
