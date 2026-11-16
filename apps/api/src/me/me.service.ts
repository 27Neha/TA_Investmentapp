import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../common/config';
import { normaliseMobile } from '../common/crypto';
import { decryptField, encryptField } from '../common/field-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AddressDto, BankDto, GuardianDto, NomineesDto, NotificationsDto, ProfileDto } from './dto';
import { RISK_QUESTIONS, RISK_VERSION, scoreRisk } from './risk';

const REQUIRED_CONSENTS = ['TERMS', 'PRIVACY'];
const LOCKED_KYC: KycStatus[] = [KycStatus.PENDING_PROVIDER, KycStatus.VERIFIED];

function ageOn(dob: Date, now = new Date()): number {
  let a = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) a--;
  return a;
}
export const isMinorDob = (dob: Date | null | undefined) => (dob ? ageOn(dob) < 18 : false);
const parseDob = (s: string): Date => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d > new Date() || ageOn(d) > 120) throw new BadRequestException('Enter a valid date of birth.');
  return d;
};

/** Every method takes the authenticated user's id (from the verified JWT) and only ever reads/writes rows keyed by it. */
@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private async user(uid: string) {
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u || u.status !== 'ACTIVE') throw new UnauthorizedException();
    return u;
  }
  private touchConfirm(uid: string) {
    return this.prisma.investorProfile.updateMany({ where: { userId: uid }, data: { confirmedAt: null } });
  }
  private async assertKycUnlocked(uid: string) {
    const k = await this.prisma.kycRecord.findUnique({ where: { userId: uid } });
    if (k && LOCKED_KYC.includes(k.status)) {
      throw new ConflictException({ message: 'These details are locked because they were submitted for verification. Contact support to change them.', code: 'KYC_LOCKED' });
    }
  }

  async me(uid: string) {
    const u = await this.user(uid);
    return { id: u.id, email: u.email, mobile: u.mobile, fullName: u.fullName, dateOfBirth: u.dateOfBirth?.toISOString().slice(0, 10) ?? null, locale: u.locale, role: u.role, emailVerified: Boolean(u.emailVerifiedAt), isMinor: isMinorDob(u.dateOfBirth) };
  }

  // ---- Personal details ----
  async getProfile(uid: string) {
    const u = await this.user(uid);
    const p = await this.prisma.investorProfile.findUnique({ where: { userId: uid } });
    return { fullName: u.fullName, dateOfBirth: u.dateOfBirth?.toISOString().slice(0, 10) ?? null, isMinor: isMinorDob(u.dateOfBirth), gender: p?.gender ?? null, occupation: p?.occupation ?? null, incomeBand: p?.incomeBand ?? null, panMasked: p?.panLast4 ? `XXXXXX${p.panLast4}` : null, taxResidentIndia: p?.taxResidentIndia ?? null, pepDeclared: p?.pepDeclared ?? null };
  }

  async saveProfile(uid: string, dto: ProfileDto) {
    await this.user(uid);
    await this.assertKycUnlocked(uid);
    const dob = parseDob(dto.dateOfBirth);
    const data = { gender: dto.gender, occupation: dto.occupation, incomeBand: dto.incomeBand, panEnc: encryptField(this.cfg.fieldEncryptionKey, dto.pan), panLast4: dto.pan.slice(-4), taxResidentIndia: dto.taxResidentIndia, pepDeclared: dto.pepDeclared, confirmedAt: null };
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: uid }, data: { fullName: dto.fullName, dateOfBirth: dob } }),
      this.prisma.investorProfile.upsert({ where: { userId: uid }, create: { userId: uid, ...data }, update: data }),
      this.prisma.kycRecord.upsert({ where: { userId: uid }, create: { userId: uid, status: KycStatus.IN_PROGRESS }, update: { status: KycStatus.IN_PROGRESS } }),
    ]);
    return this.getProfile(uid);
  }

  // ---- Address ----
  async getAddress(uid: string) {
    const a = await this.prisma.address.findUnique({ where: { userId: uid } });
    return a ? { line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode, country: a.country } : null;
  }
  async saveAddress(uid: string, dto: AddressDto) {
    await this.user(uid);
    await this.assertKycUnlocked(uid);
    const data = { line1: dto.line1, line2: dto.line2 ?? null, city: dto.city, state: dto.state, pincode: dto.pincode };
    await this.prisma.address.upsert({ where: { userId: uid }, create: { userId: uid, ...data }, update: data });
    await this.touchConfirm(uid);
    return this.getAddress(uid);
  }

  // ---- Bank (never verified here: status stays UNVERIFIED until a penny-drop/provider integration exists) ----
  async getBank(uid: string) {
    const b = await this.prisma.bankAccount.findUnique({ where: { userId: uid } });
    return b ? { holderName: b.holderName, accountMasked: `XXXXXX${b.accountLast4}`, ifsc: b.ifsc, accountType: b.accountType, status: b.status } : null;
  }
  async saveBank(uid: string, dto: BankDto) {
    await this.user(uid);
    await this.assertKycUnlocked(uid);
    const data = { holderName: dto.holderName, accountEnc: encryptField(this.cfg.fieldEncryptionKey, dto.accountNumber), accountLast4: dto.accountNumber.slice(-4), ifsc: dto.ifsc, accountType: dto.accountType, status: 'UNVERIFIED' as const };
    await this.prisma.bankAccount.upsert({ where: { userId: uid }, create: { userId: uid, ...data }, update: data });
    await this.touchConfirm(uid);
    return this.getBank(uid);
  }

  // ---- Nominees ----
  async getNominees(uid: string) {
    const [rows, p] = await Promise.all([
      this.prisma.nominee.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
      this.prisma.investorProfile.findUnique({ where: { userId: uid }, select: { nomineeOptOut: true } }),
    ]);
    return { optOut: p?.nomineeOptOut ?? false, nominees: rows.map((n) => ({ name: n.name, relationship: n.relationship, dateOfBirth: n.dateOfBirth.toISOString().slice(0, 10), sharePercent: n.sharePercent })) };
  }
  async saveNominees(uid: string, dto: NomineesDto) {
    await this.user(uid);
    await this.assertKycUnlocked(uid);
    if (dto.nominees.reduce((s, n) => s + n.sharePercent, 0) !== 100) throw new BadRequestException('Nominee shares must add up to exactly 100%.');
    const rows = dto.nominees.map((n) => ({ userId: uid, name: n.name, relationship: n.relationship, dateOfBirth: parseDob(n.dateOfBirth), sharePercent: n.sharePercent }));
    await this.prisma.$transaction([
      this.prisma.nominee.deleteMany({ where: { userId: uid } }),
      this.prisma.nominee.createMany({ data: rows }),
      this.prisma.investorProfile.upsert({ where: { userId: uid }, create: { userId: uid, nomineeOptOut: false }, update: { nomineeOptOut: false, confirmedAt: null } }),
    ]);
    return this.getNominees(uid);
  }
  async optOutNominee(uid: string) {
    await this.user(uid);
    await this.assertKycUnlocked(uid);
    await this.prisma.$transaction([
      this.prisma.nominee.deleteMany({ where: { userId: uid } }),
      this.prisma.investorProfile.upsert({ where: { userId: uid }, create: { userId: uid, nomineeOptOut: true }, update: { nomineeOptOut: true, confirmedAt: null } }),
    ]);
    return this.getNominees(uid);
  }

  // ---- Risk (draft questionnaire) ----
  riskQuestions() { return { version: RISK_VERSION, draft: true, questions: RISK_QUESTIONS.map((q) => ({ id: q.id, options: q.options.map((o) => o.id) })) }; }
  async getRisk(uid: string) {
    const r = await this.prisma.riskAssessment.findFirst({ where: { userId: uid }, orderBy: { createdAt: 'desc' } });
    return r ? { version: r.version, score: r.score, band: r.band, answers: r.answers, assessedAt: r.createdAt } : null;
  }
  async saveRisk(uid: string, answers: Record<string, string>) {
    await this.user(uid);
    const res = scoreRisk(answers);
    if (!res) throw new BadRequestException('Please answer every question with a valid option.');
    await this.prisma.riskAssessment.create({ data: { userId: uid, version: RISK_VERSION, answers, score: res.score, band: res.band } });
    await this.touchConfirm(uid);
    return this.getRisk(uid);
  }

  // ---- Guardian (minors) — captures details only; verification is an operations workflow (Phase 2) ----
  async getGuardian(uid: string) {
    const g = await this.prisma.guardianLink.findUnique({ where: { userId: uid } });
    return g ? { guardianName: g.guardianName, relationship: g.relationship, guardianMobile: g.guardianMobile, status: g.status } : null;
  }
  async saveGuardian(uid: string, dto: GuardianDto) {
    const u = await this.user(uid);
    if (!isMinorDob(u.dateOfBirth)) throw new BadRequestException('A guardian is only required for investors under 18.');
    const m = normaliseMobile(dto.guardianMobile);
    if (!m) throw new BadRequestException("Enter a valid 10-digit mobile number for the guardian.");
    const data = { guardianName: dto.guardianName, relationship: dto.relationship, guardianMobile: m, status: 'PENDING_VERIFICATION' as const };
    await this.prisma.guardianLink.upsert({ where: { userId: uid }, create: { userId: uid, ...data }, update: data });
    return this.getGuardian(uid);
  }

  // ---- Consents ----
  private async latestDisclosure(kind: string, locale: string) {
    const where = { kind, effectiveFrom: { lte: new Date() } };
    return (await this.prisma.disclosureVersion.findFirst({ where: { ...where, locale }, orderBy: { effectiveFrom: 'desc' } })) ??
      (await this.prisma.disclosureVersion.findFirst({ where: { ...where, locale: 'en' }, orderBy: { effectiveFrom: 'desc' } }));
  }
  async consents(uid: string) {
    const u = await this.user(uid);
    const out: any[] = [];
    for (const kind of ['TERMS', 'PRIVACY', 'RISK', 'DISTRIBUTOR']) {
      const d = await this.latestDisclosure(kind, u.locale);
      if (!d) continue;
      const accepted = await this.prisma.consentRecord.findFirst({ where: { userId: uid, accepted: true, disclosure: { kind, version: d.version } } });
      out.push({ kind, version: d.version, title: d.title, reviewed: Boolean(d.reviewedBy), required: REQUIRED_CONSENTS.includes(kind), accepted: Boolean(accepted) });
    }
    return out;
  }
  async acceptConsents(uid: string, kinds: string[], ctx: { ip?: string; userAgent?: string }) {
    const u = await this.user(uid);
    for (const kind of kinds) {
      const d = await this.latestDisclosure(kind, u.locale);
      if (!d) throw new BadRequestException(`No ${kind} document is available to accept.`);
      await this.prisma.consentRecord.create({ data: { userId: uid, disclosureId: d.id, accepted: true, locale: d.locale, userAgent: ctx.userAgent?.slice(0, 200) ?? null } });
    }
    return this.consents(uid);
  }

  // ---- Onboarding status / confirmation ----
  async onboarding(uid: string) {
    const u = await this.user(uid);
    const [p, addr, bank, nominees, risk, consents, kyc, guardian] = await Promise.all([
      this.prisma.investorProfile.findUnique({ where: { userId: uid } }),
      this.prisma.address.findUnique({ where: { userId: uid } }),
      this.prisma.bankAccount.findUnique({ where: { userId: uid } }),
      this.prisma.nominee.count({ where: { userId: uid } }),
      this.prisma.riskAssessment.findFirst({ where: { userId: uid } }),
      this.consents(uid),
      this.prisma.kycRecord.findUnique({ where: { userId: uid } }),
      this.prisma.guardianLink.findUnique({ where: { userId: uid } }),
    ]);
    const minor = isMinorDob(u.dateOfBirth);
    const steps = [
      { key: 'personal', done: Boolean(p?.panEnc && p.gender && p.occupation && p.incomeBand && p.taxResidentIndia != null && p.pepDeclared != null) },
      ...(minor ? [{ key: 'guardian', done: guardian?.status === 'VERIFIED' }] : []),
      { key: 'address', done: Boolean(addr) },
      { key: 'bank', done: Boolean(bank) },
      { key: 'nominee', done: nominees > 0 || Boolean(p?.nomineeOptOut) },
      { key: 'risk', done: Boolean(risk) },
      { key: 'consent', done: REQUIRED_CONSENTS.every((k) => consents.find((c) => c.kind === k)?.accepted) },
    ];
    const missing = steps.filter((s) => !s.done).map((s) => s.key);
    return {
      steps, nextStep: missing[0] ?? (p?.confirmedAt ? null : 'review'), isMinor: minor,
      guardianStatus: guardian?.status ?? null, confirmed: Boolean(p?.confirmedAt),
      kyc: { status: kyc?.status ?? 'NOT_STARTED', verified: kyc?.status === 'VERIFIED' },
      bankStatus: bank?.status ?? null,
    };
  }

  /** Records that the user reviewed and confirmed their details and queues them for KYC. This is NOT verification: status becomes PENDING_PROVIDER. */
  async confirm(uid: string) {
    const o = await this.onboarding(uid);
    const incomplete = o.steps.filter((s) => !s.done).map((s) => s.key);
    if (o.isMinor && incomplete.includes('guardian')) {
      throw new ForbiddenException({ message: 'A verified guardian is required before an investor under 18 can complete onboarding.', code: 'GUARDIAN_REQUIRED' });
    }
    if (incomplete.length) throw new BadRequestException({ message: 'Complete every step before confirming.', code: 'ONBOARDING_INCOMPLETE', missing: incomplete });
    await this.prisma.$transaction([
      this.prisma.investorProfile.update({ where: { userId: uid }, data: { confirmedAt: new Date() } }),
      this.prisma.kycRecord.upsert({
        where: { userId: uid },
        create: { userId: uid, status: KycStatus.PENDING_PROVIDER, submittedAt: new Date(), note: 'Details captured. Identity verification has not been performed.' },
        update: { status: KycStatus.PENDING_PROVIDER, submittedAt: new Date(), note: 'Details captured. Identity verification has not been performed.' },
      }),
    ]);
    return this.onboarding(uid);
  }

  // ---- KYC status (read-only for users; only a verified provider integration may set VERIFIED) ----
  async kyc(uid: string) {
    const k = await this.prisma.kycRecord.findUnique({ where: { userId: uid } });
    return { status: k?.status ?? 'NOT_STARTED', submittedAt: k?.submittedAt ?? null, note: k?.note ?? null, providerIntegration: 'NOT_CONNECTED' };
  }

  // ---- Settings ----
  async setLocale(uid: string, locale: string) {
    await this.user(uid);
    await this.prisma.user.update({ where: { id: uid }, data: { locale } });
    return { locale };
  }
  async getNotifications(uid: string) {
    const n = await this.prisma.notificationPreference.findUnique({ where: { userId: uid } });
    return { transactionalEmail: true, emailMarketing: n?.emailMarketing ?? false, pushEnabled: n?.pushEnabled ?? true, whatsappUpdates: n?.whatsappUpdates ?? false };
  }
  async setNotifications(uid: string, dto: NotificationsDto) {
    await this.user(uid);
    await this.prisma.notificationPreference.upsert({ where: { userId: uid }, create: { userId: uid, ...dto }, update: dto });
    return this.getNotifications(uid);
  }

  /** Test/diagnostic helper: not exposed over HTTP. */
  async _decryptPan(uid: string): Promise<string> {
    const p = await this.prisma.investorProfile.findUnique({ where: { userId: uid } });
    if (!p?.panEnc) throw new NotFoundException();
    return decryptField(this.cfg.fieldEncryptionKey, p.panEnc);
  }
}
