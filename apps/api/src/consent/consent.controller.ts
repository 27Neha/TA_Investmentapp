import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Public: latest effective disclosure text for a kind + locale (falls back to English). */
@Controller('v1/disclosures')
export class ConsentController {
  constructor(private readonly prisma: PrismaService) {}

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
    return d ? { kind: d.kind, version: d.version, locale: d.locale, title: d.title, body: d.body, reviewed: Boolean(d.reviewedBy) } : null;
  }
}
