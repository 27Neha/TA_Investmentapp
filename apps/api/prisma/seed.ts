/* Seeds placeholder disclosures (clearly NOT legally reviewed) + default feature flags (all OFF). */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_FLAGS } from '../src/flags/flags.service';
import { hashPassword, validatePasswordStrength } from '../src/common/password';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  const TITLES: Record<string, string> = { TERMS: 'Terms of Use', PRIVACY: 'Privacy Policy', RISK: 'Mutual Fund Risk Disclosure', DISTRIBUTOR: 'Distributor Disclosure', SCHEME: 'Scheme-related Disclosures' };
  for (const kind of ['TERMS', 'PRIVACY', 'RISK', 'DISTRIBUTOR', 'SCHEME']) {
    await prisma.disclosureVersion.upsert({
      where: { kind_version_locale: { kind, version: '0.1-draft', locale: 'en' } },
      update: {},
      create: {
        kind, version: '0.1-draft', locale: 'en', effectiveFrom: new Date(),
        title: `${TITLES[kind]} (DRAFT — pending legal review)`,
        body: 'PLACEHOLDER. Replace with counsel-approved text before release. reviewedBy must be set once reviewed.',
      },
    });
  }
  const GENERAL = 'General educational information only. It is not investment advice or a recommendation. Mutual fund investments are subject to market risks. Read all scheme related documents carefully.';
  const ARTICLES: [string, string, string, string, string][] = [
    ['what-is-a-sip', 'BASICS', 'What is a SIP?', 'A SIP lets you invest a fixed amount at regular intervals.', 'A Systematic Investment Plan (SIP) is a way of investing a fixed amount in a mutual fund scheme at regular intervals, for example every month. Because you invest on a schedule, you buy more units when the price is lower and fewer when it is higher. A SIP does not guarantee profit or protect against loss.'],
    ['what-is-nav', 'BASICS', 'What is NAV?', 'NAV is the per-unit value of a mutual fund scheme.', 'Net Asset Value (NAV) is the value of one unit of a scheme, calculated by dividing the scheme\'s net assets by the number of units outstanding. A lower NAV does not mean a scheme is cheaper or better; what matters is how the underlying investments perform relative to your goal and time horizon.'],
    ['time-horizon-and-risk', 'PLANNING', 'Time horizon and risk', 'Why the length of time you can stay invested matters.', 'Different goals have different time horizons. Money you may need soon is usually kept in lower-risk options because markets can fall in the short term. Money for goals many years away can usually tolerate more ups and downs. Your own comfort with losses is as important as the numbers.'],
    ['start-with-a-goal', 'PLANNING', 'Start with a goal', 'Give every rupee a purpose before choosing where to invest.', 'Begin by writing down what you are saving for, roughly how much you will need, and when. The Goals section of the app can show an illustrative monthly amount based on a return you assume. These are not forecasts; actual outcomes can be higher or lower.'],
  ];
  for (const [slug, category, title, summary, body] of ARTICLES) {
    await prisma.contentItem.upsert({
      where: { slug }, update: {},
      create: { slug, category, title, summary, body: `${body}\n\n${GENERAL}`, locale: 'en', readMinutes: 2, publishedAt: new Date() }, // reviewedBy left null => shown as DRAFT until compliance review
    });
  }
  for (const [key, description] of Object.entries(DEFAULT_FLAGS)) {
    await prisma.featureFlag.upsert({ where: { key }, update: {}, create: { key, description, enabled: false } });
  }
}
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return console.log('ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap');
  if (!validatePasswordStrength(pw)) throw new Error('ADMIN_PASSWORD fails the password policy');
  await prisma.user.upsert({
    where: { email }, update: {},
    create: { email, fullName: 'TechArtha Admin', passwordHash: await hashPassword(pw), role: 'ADMIN', emailVerifiedAt: new Date(), locale: 'en' },
  });
  console.log(`Admin ready: ${email} (change the password after first login)`);
}
main().then(seedAdmin).finally(() => prisma.$disconnect());
