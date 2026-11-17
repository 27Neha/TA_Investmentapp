import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { ENGINES, ACTIVE_ENGINE } from './engine/registry';
import { BAND_UPPER, BANDS, CAPACITY_MARGIN, CONSISTENCY_CEILING, DIMENSION_WEIGHTS, QUESTIONS, RiskAnswerError, scoreV1, TA_RISK_V1, validatePartial } from './engine/ta-risk-v1';

const OUTDATED_DAYS = 365;
const DAY = 864e5;
const fail = (e: unknown): never => {
  if (e instanceof RiskAnswerError) throw new BadRequestException({ message: e.code === 'INCOMPLETE' ? 'Please answer every question.' : 'One or more answers are not valid.', code: `RISK_${e.code}`, questions: e.detail });
  throw e;
};

/** Recomputes the result from stored answers with the stored version: the stored score is never trusted from, or supplied by, a client. */
function present(r: { id: string; version: string; answers: any; score: number; band: string; createdAt: Date }) {
  const engine = ENGINES[r.version];
  const result = engine ? engine(r.answers) : null;
  return {
    id: r.id, version: r.version, assessedAt: r.createdAt, score: r.score, band: r.band, maxScore: 100,
    reproducible: Boolean(result) && result!.score === r.score && result!.band === r.band, // false would signal tampering or a methodology drift
    breakdown: result ? { dimensions: result.dimensions, caps: result.caps, flags: result.flags, needsReview: result.needsReview, strengths: result.strengths, concerns: result.concerns, minHorizonYears: result.minHorizonYears, categoryGuidance: result.categoryGuidance, guidanceApproved: result.guidanceApproved } : null,
    notice: 'This describes your own answers. It is not investment advice, not a scheme Riskometer, and not regulator-approved.',
  };
}

@Injectable()
export class AssessmentService {
  constructor(private readonly prisma: PrismaService, private readonly inbox: InboxService, private readonly audit: AuditService) {}

  framework() {
    return {
      version: ACTIVE_ENGINE, approved: false,
      questions: QUESTIONS.map((q) => ({ id: q.id, no: q.no, dimension: q.dimension, options: q.options })), // wording lives in the app's translation files
      dimensionWeights: DIMENSION_WEIGHTS, capacityMargin: CAPACITY_MARGIN, bandUpper: BAND_UPPER, bands: BANDS, consistencyCeiling: CONSISTENCY_CEILING,
      notice: 'Original, unapproved methodology awaiting compliance review. Not investment advice.',
    };
  }

  async getDraft(uid: string) {
    const d = await this.prisma.riskDraft.findUnique({ where: { userId: uid } });
    if (!d || d.version !== TA_RISK_V1) return { version: TA_RISK_V1, answers: {}, answered: 0, total: QUESTIONS.length };
    return { version: d.version, answers: d.answers, answered: Object.keys(d.answers as object).length, total: QUESTIONS.length, updatedAt: d.updatedAt };
  }
  async saveDraft(uid: string, answers: unknown) {
    try { validatePartial(answers); } catch (e) { fail(e); }
    const a = answers as Record<string, string>;
    await this.prisma.riskDraft.upsert({ where: { userId: uid }, create: { userId: uid, version: TA_RISK_V1, answers: a }, update: { version: TA_RISK_V1, answers: a } });
    return { saved: true, answered: Object.keys(a).length, total: QUESTIONS.length };
  }

  /** Always creates a NEW record; earlier assessments are never overwritten. */
  async submit(uid: string, answers?: unknown) {
    let a = answers;
    if (a === undefined) { const d = await this.prisma.riskDraft.findUnique({ where: { userId: uid } }); a = d?.version === TA_RISK_V1 ? d.answers : {}; }
    let result; try { result = scoreV1(a as any); } catch (e) { return fail(e); }
    const previous = await this.prisma.riskAssessment.findFirst({ where: { userId: uid, version: TA_RISK_V1 }, orderBy: { createdAt: 'desc' } });
    const created = await this.prisma.riskAssessment.create({ data: { userId: uid, version: TA_RISK_V1, answers: a as any, score: result.score, band: result.band } });
    await this.prisma.riskDraft.deleteMany({ where: { userId: uid } });
    await this.prisma.investorProfile.updateMany({ where: { userId: uid }, data: { confirmedAt: null } });
    await this.audit.record(uid, previous ? 'RISK_REASSESSED' : 'RISK_ASSESSED', 'RiskAssessment', created.id, { band: result.band, version: TA_RISK_V1, needsReview: result.needsReview });
    await this.inbox.notify(uid, 'RISK', 'Risk profile saved', previous ? 'Your new risk profile has been saved. Your previous assessment is kept in your history. No investments were changed.' : 'Your risk profile has been saved.');
    return { current: present(created), previous: previous ? { id: previous.id, score: previous.score, band: previous.band, assessedAt: previous.createdAt } : null };
  }

  async latest(uid: string) {
    const r = await this.prisma.riskAssessment.findFirst({ where: { userId: uid, version: TA_RISK_V1 }, orderBy: { createdAt: 'desc' } });
    if (!r) throw new NotFoundException('No assessment yet.');
    const ageDays = Math.floor((Date.now() - r.createdAt.getTime()) / DAY);
    return { ...present(r), outdated: ageDays > OUTDATED_DAYS, ageDays, canRetake: true };
  }
  async history(uid: string) {
    return (await this.prisma.riskAssessment.findMany({ where: { userId: uid, version: TA_RISK_V1 }, orderBy: { createdAt: 'desc' }, take: 50 })).map((r) => ({ id: r.id, version: r.version, score: r.score, band: r.band, assessedAt: r.createdAt }));
  }
}
