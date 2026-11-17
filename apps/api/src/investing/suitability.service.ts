import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Band, scoreV1, suitabilityFlag, TA_RISK_V1 } from '../risk/engine/ta-risk-v1';
import { SCHEME_RISKOMETER, SchemeRiskometerPort } from './scheme-riskometer';

const OUTDATED_DAYS = 365;
export const SUITABILITY_POLICY = 'ta-suit-v1';

export type SuitabilityStatus = 'CONSISTENT' | 'ABOVE_PROFILE' | 'ABOVE_CAPACITY' | 'UNKNOWN';
export interface SuitabilityView {
  status: SuitabilityStatus;
  /** Why the result is UNKNOWN (never a guess): NO_ASSESSMENT | ASSESSMENT_OUTDATED | RISKOMETER_UNAVAILABLE | RISKOMETER_STALE */
  reasons: string[];
  scheme: { level: string; asOf: string; source: string } | null;
  profile: { band: string } | null;
  policyVersion: string;
  /** The band->maximum-scheme-level table has not been signed off by compliance; this is a mismatch flag, never advice or a recommendation. */
  policyReviewed: false;
  note: 'NOT_A_RECOMMENDATION';
}

/** Links a user's server-scored risk profile to a scheme's published riskometer. Pure read; it never places or recommends an order. */
@Injectable()
export class SuitabilityService {
  constructor(private readonly prisma: PrismaService, @Inject(SCHEME_RISKOMETER) private readonly riskometer: SchemeRiskometerPort) {}

  async check(userId: string, schemeCode: string): Promise<SuitabilityView> {
    const base = { policyVersion: SUITABILITY_POLICY, policyReviewed: false as const, note: 'NOT_A_RECOMMENDATION' as const };
    const [a, rec] = await Promise.all([
      this.prisma.riskAssessment.findFirst({ where: { userId, version: TA_RISK_V1 }, orderBy: { createdAt: 'desc' } }),
      this.riskometer.get(schemeCode),
    ]);
    const reasons: string[] = [];
    if (!a) reasons.push('NO_ASSESSMENT');
    else if (Date.now() - a.createdAt.getTime() > OUTDATED_DAYS * 86_400_000) reasons.push('ASSESSMENT_OUTDATED');
    if (!rec) reasons.push('RISKOMETER_UNAVAILABLE'); else if (rec.stale) reasons.push('RISKOMETER_STALE');
    const scheme = rec && !rec.stale ? { level: rec.level, asOf: rec.asOf, source: rec.source } : null;
    const profile = a ? { band: a.band } : null;
    if (reasons.length || !a || !rec) return { ...base, status: 'UNKNOWN', reasons, scheme: rec ? { level: rec.level, asOf: rec.asOf, source: rec.source } : null, profile };
    let capacity = 100; // recomputed from the stored answers; if they cannot be scored the result is UNKNOWN, not CONSISTENT
    try { capacity = scoreV1(a.answers as any).dimensions.capacity; } catch { return { ...base, status: 'UNKNOWN', reasons: ['NO_ASSESSMENT'], scheme, profile }; }
    const f = suitabilityFlag(a.band as Band, capacity, rec.level);
    return { ...base, status: f.status, reasons: [], scheme, profile };
  }
}
