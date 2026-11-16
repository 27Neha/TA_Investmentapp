import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/common/config';
import { EmailService } from '../src/notifications/email.provider';
import { PrismaService } from '../src/prisma/prisma.service';

export const hasDb = Boolean(process.env.TEST_DATABASE_URL);

/** Test-only delivery channel: captures what would be emailed so tests can read OTPs. Real DB is used for everything else. */
export class CapturingEmail {
  sent: { to: string; subject: string; text: string; purpose: string }[] = [];
  failNext = false;
  async send(msg: any, meta: any) {
    if (this.failNext) { this.failNext = false; return { accepted: false, attempts: 3, errorCode: 'HTTP_503' }; }
    this.sent.push({ ...msg, purpose: meta.purpose });
    return { accepted: true, attempts: 1 };
  }
  lastCode(to: string, purpose?: string): string {
    const m = [...this.sent].reverse().find((x) => x.to === to && (!purpose || x.purpose === purpose));
    if (!m) throw new Error('no email captured for ' + to);
    return m.text.match(/(\d{6})/)![1];
  }
}

export async function makeApp(opts: { throttle?: boolean } = {}) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
  if (opts.throttle) delete process.env.THROTTLE_DISABLED; else process.env.THROTTLE_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  const email = new CapturingEmail();
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EmailService).useValue(email).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureApp(app, loadConfig());
  await app.init();
  return { app: app as INestApplication, email, prisma: app.get(PrismaService) };
}

export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('TRUNCATE "AdminAuditEvent","EmailLog","ConsentRecord","OtpChallenge","RefreshToken","DisclosureVersion","FeatureFlag","User" CASCADE');
  for (const kind of ['TERMS', 'PRIVACY']) {
    await prisma.disclosureVersion.create({ data: { kind, version: 'it-1', locale: 'en', title: kind, body: 'test', effectiveFrom: new Date(Date.now() - 1000) } });
  }
}

export const PW = 'Correct#Horse9';
export const signupBody = (email: string, extra: any = {}) => ({
  fullName: 'Test User', email, mobile: '9876543210', dateOfBirth: '1990-05-20', password: PW, locale: 'en',
  acceptTerms: true, acceptPrivacy: true, termsVersion: 'it-1', privacyVersion: 'it-1', ...extra,
});
