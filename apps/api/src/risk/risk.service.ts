import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { BAND_EXPLANATION, BAND_ORDER, RISK_FRAMEWORK, RISK_QUESTIONS, RISK_VERSION, scoreRisk } from '../me/risk';
import { PrismaService } from '../prisma/prisma.service';

const OUTDATED_DAYS = 365;
const DAY = 86_400_000;

const view = (r: any) => ({ id: r.id, version: r.version, band: r.band, score: r.score, maxScore: RISK_FRAMEWORK.maxScore, assessedAt: r.createdAt, explanation: BAND_EXPLANATION[r.band] ?? '', answers: r.answers });

/** Investor risk profile. This is NOT a scheme Riskometer. History is append-only: a retake creates a new row and never edits an old one. */
@Injectable()
export class RiskService {
  constructor(private readonly prisma: PrismaService, private readonly inbox: InboxService, private readonly audit: AuditService) {}

  framework() { return { ...RISK_FRAMEWORK, draftNotice: 'Draft questionnaire awaiting approved questions and scoring. It does not constitute investment advice, and it is not a scheme Riskometer.', questions: RISK_QUESTIONS.map((q) => ({ id: q.id, options: q.options.map((o) => o.id) })) }; }

  async status(uid: string) {
    const r = await this.prisma.riskAssessment.findFirst({ where: { userId: uid }, orderBy: { createdAt: 'desc' } });
    const draft = await this.prisma.riskDraft.findUnique({ where: { userId: uid } });
    if (!r) return { completed: false, latest: null, outdated: false, ageDays: null, draftAnswered: draft ? Object.keys(draft.answers as object).length : 0 };
    const ageDays = Math.floor((Date.now() - r.createdAt.getTime()) / DAY);
    return { completed: true, latest: view(r), outdated: ageDays > OUTDATED_DAYS, ageDays, draftAnswered: draft ? Object.keys(draft.answers as object).length : 0 };
  }

  async getDraft(uid: string) {
    const d = await this.prisma.riskDraft.findUnique({ where: { userId: uid } });
    if (!d || d.version !== RISK_VERSION) return { answers: {}, version: RISK_VERSION };
    return { answers: d.answers, version: d.version, updatedAt: d.updatedAt };
  }
  async saveDraft(uid: string, answers: Record<string, string>) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) {
      const q = RISK_QUESTIONS.find((x) => x.id === k);
      if (!q || typeof v !== 'string' || !q.options.some((o) => o.id === v)) throw new BadRequestException(`Invalid answer for "${k}".`);
      clean[k] = v;
    }
    await this.prisma.riskDraft.upsert({ where: { userId: uid }, create: { userId: uid, version: RISK_VERSION, answers: clean }, update: { version: RISK_VERSION, answers: clean } });
    return { saved: true, answered: Object.keys(clean).length, total: RISK_QUESTIONS.length };
  }

  /** Submit the given answers (or the saved draft). Always creates a NEW record; the draft is cleared only after the record exists. */
  async submit(uid: string, answers?: Record<string, string>) {
    let a = answers;
    if (!a) { const d = await this.prisma.riskDraft.findUnique({ where: { userId: uid } }); a = (d?.answers as Record<string, string>) ?? {}; }
    const res = scoreRisk(a);
    if (!res) throw new BadRequestException({ message: 'Please answer every question with a valid option.', code: 'RISK_INCOMPLETE' });
    const previous = await this.prisma.riskAssessment.findFirst({ where: { userId: uid }, orderBy: { createdAt: 'desc' } });
    const created = await this.prisma.riskAssessment.create({ data: { userId: uid, version: RISK_VERSION, answers: a, score: res.score, band: res.band } });
    await this.prisma.riskDraft.deleteMany({ where: { userId: uid } });
    await this.prisma.investorProfile.updateMany({ where: { userId: uid }, data: { confirmedAt: null } });
    await this.audit.record(uid, previous ? 'RISK_REASSESSED' : 'RISK_ASSESSED', 'RiskAssessment', created.id, { band: res.band, version: RISK_VERSION });
    await this.inbox.notify(uid, 'RISK', 'Risk profile saved', previous ? 'Your new risk profile has been saved. Your previous assessment is kept in your history. No investments were changed.' : 'Your risk profile has been saved.');
    return { current: view(created), comparison: previous ? this.compareRows(previous, created) : null };
  }

  async history(uid: string) {
    const rows = await this.prisma.riskAssessment.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map(view);
  }
  async compare(uid: string) {
    const rows = await this.prisma.riskAssessment.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' }, take: 2 });
    if (rows.length < 2) return { comparable: false, reason: rows.length ? 'ONLY_ONE_ASSESSMENT' : 'NO_ASSESSMENT', current: rows[0] ? view(rows[0]) : null, previous: null };
    return { comparable: true, ...this.compareRows(rows[1], rows[0]) };
  }
  private compareRows(prev: any, cur: any) {
    const d = BAND_ORDER.indexOf(cur.band) - BAND_ORDER.indexOf(prev.band);
    const changed = d !== 0;
    const sameVersion = prev.version === cur.version;
    return {
      previous: view(prev), current: view(cur), changed, direction: d > 0 ? 'HIGHER' : d < 0 ? 'LOWER' : 'SAME', scoreChange: cur.score - prev.score, sameFrameworkVersion: sameVersion,
      explanation: !sameVersion ? 'The questionnaire changed between these assessments, so the scores may not be directly comparable.' : changed ? `Your risk profile moved from ${prev.band.toLowerCase()} to ${cur.band.toLowerCase()}.` : 'Your risk profile category did not change.',
      reviewPrompt: changed ? ['GOALS', 'HOLDINGS'] : [], note: 'No goals or investments were changed automatically.',
    };
  }
}
