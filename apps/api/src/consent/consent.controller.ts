import { Controller, Get, Logger, NotFoundException, OnApplicationBootstrap, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Public: latest effective disclosure text for a kind + locale (falls back to English). */
@Controller('v1/disclosures')
export class ConsentController implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  /** Development aid: a missing Terms/Privacy row is the most common reason the app's signup screen is blocked. Read-only; never writes. */
  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const n = await this.prisma.disclosureVersion.count({ where: { kind: { in: ['TERMS', 'PRIVACY'] } } });
      if (n < 2) new Logger('Consent').warn('Terms/Privacy documents are missing: signup will be blocked. Run `npm run seed` (apps/api) on a LOCAL database.');
    } catch { /* database not reachable yet: health checks report that */ }
  }

  /** Public index of the current legal documents (version + effective date), for Profile > Legal and Disclosures. */
  @Get() async index(@Query('locale') locale = 'en') {
    const out: any[] = [];
    for (const kind of ['TERMS', 'PRIVACY', 'RISK', 'DISTRIBUTOR', 'SCHEME']) {
      const where = { kind, effectiveFrom: { lte: new Date() } };
      const d = (await this.prisma.disclosureVersion.findFirst({ where: { ...where, locale }, orderBy: { effectiveFrom: 'desc' } })) ?? (await this.prisma.disclosureVersion.findFirst({ where: { ...where, locale: 'en' }, orderBy: { effectiveFrom: 'desc' } }));
      if (d) out.push({ kind: d.kind, version: d.version, title: d.title, effectiveFrom: d.effectiveFrom, locale: d.locale, reviewed: Boolean(d.reviewedBy) });
    }
    return out;
  }

  @Get('latest')
  async latest(@Query('kind') kind = 'TERMS', @Query('locale') locale = 'en') {
    const where = { kind, effectiveFrom: { lte: new Date() } };
    const d =
      (await this.prisma.disclosureVersion.findFirst({ where: { ...where, locale }, orderBy: { effectiveFrom: 'desc' } })) ??
      (await this.prisma.disclosureVersion.findFirst({ where: { ...where, locale: 'en' }, orderBy: { effectiveFrom: 'desc' } }));
    // An honest 404 (never an empty 200): the app must not mistake "nothing published" for a loaded document.
    if (!d) throw new NotFoundException({ statusCode: 404, code: 'LEGAL_NOT_AVAILABLE', message: 'This legal document has not been published yet.' });
    return { kind: d.kind, version: d.version, locale: d.locale, title: d.title, body: d.body, effectiveFrom: d.effectiveFrom, reviewed: Boolean(d.reviewedBy) };
  }
}
