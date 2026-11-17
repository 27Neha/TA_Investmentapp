import { readFileSync } from 'fs';
import { SCHEME_LEVELS, SchemeLevel } from '../risk/engine/ta-risk-v1';

/**
 * Scheme-level riskometer (SEBI): a property of a SCHEME that each AMC publishes and revises (at least monthly). We never guess it.
 * The only data source implemented is a reviewed file placed by an operator (see docs/INVESTMENT-JOURNEY.md); nothing is fetched from the web
 * and no value is derived from the scheme name or category. Without data every answer is "unavailable" and suitability stays UNKNOWN.
 */
export interface SchemeRiskRecord { schemeCode: string; level: SchemeLevel; asOf: string; source: string; stale: boolean }
export interface SchemeRiskometerPort { readonly name: string; isConnected(): boolean; get(schemeCode: string): Promise<SchemeRiskRecord | null> }
export const SCHEME_RISKOMETER = Symbol('SCHEME_RISKOMETER');

export const RISKOMETER_MAX_AGE_DAYS = 62; // monthly disclosure + a grace period; older data is reported stale and not relied on

export class UnconfiguredSchemeRiskometer implements SchemeRiskometerPort {
  readonly name = 'none';
  isConnected() { return false; }
  async get(): Promise<null> { return null; }
}

export class SchemeRiskFileError extends Error {}

/** File format: { "source": "AMC/AMFI document name", "asOf": "YYYY-MM-DD", "schemes": { "<amfiCode>": "<LEVEL>" } }. Invalid files fail loudly at load. */
export class FileSchemeRiskometer implements SchemeRiskometerPort {
  readonly name = 'file';
  private readonly map = new Map<string, SchemeLevel>();
  private readonly source: string;
  private readonly asOf: string;
  constructor(json: unknown, private readonly now: () => number = Date.now) {
    const j = json as { source?: unknown; asOf?: unknown; schemes?: unknown };
    if (!j || typeof j !== 'object' || typeof j.source !== 'string' || !j.source.trim()) throw new SchemeRiskFileError('riskometer file: "source" is required');
    if (typeof j.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.asOf) || Number.isNaN(Date.parse(j.asOf))) throw new SchemeRiskFileError('riskometer file: "asOf" must be YYYY-MM-DD');
    if (!j.schemes || typeof j.schemes !== 'object' || Array.isArray(j.schemes)) throw new SchemeRiskFileError('riskometer file: "schemes" must be an object');
    for (const [code, level] of Object.entries(j.schemes as Record<string, unknown>)) {
      if (!/^\d{3,8}$/.test(code)) throw new SchemeRiskFileError(`riskometer file: bad scheme code "${code}"`);
      if (typeof level !== 'string' || !(SCHEME_LEVELS as readonly string[]).includes(level)) throw new SchemeRiskFileError(`riskometer file: bad level for ${code}`);
      this.map.set(code, level as SchemeLevel);
    }
    if (!this.map.size) throw new SchemeRiskFileError('riskometer file has no schemes');
    this.source = j.source.trim().slice(0, 200); this.asOf = j.asOf;
  }
  isConnected() { return true; }
  async get(schemeCode: string): Promise<SchemeRiskRecord | null> {
    const level = this.map.get(schemeCode);
    if (!level) return null;
    const ageDays = Math.floor((this.now() - Date.parse(this.asOf)) / 86_400_000);
    return { schemeCode, level, asOf: this.asOf, source: this.source, stale: ageDays > RISKOMETER_MAX_AGE_DAYS };
  }
}

export function createSchemeRiskometer(env: NodeJS.ProcessEnv, isProd: boolean): SchemeRiskometerPort {
  const path = env.SCHEME_RISKOMETER_FILE;
  if (!path) return new UnconfiguredSchemeRiskometer();
  try { return new FileSchemeRiskometer(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (e) { if (isProd) throw new Error(`SCHEME_RISKOMETER_FILE could not be loaded: ${(e as Error).message}`); return new UnconfiguredSchemeRiskometer(); }
}
