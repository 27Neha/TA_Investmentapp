import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Educational content for ArthaVerse. Only published rows are served; unreviewed rows are labelled so the app can show a DRAFT marker. */
@Controller('v1/content')
export class ContentController {
  constructor(private readonly prisma: PrismaService) {}

  private where(locale: string, category?: string) {
    return { publishedAt: { lte: new Date() }, locale, ...(category ? { category } : {}) };
  }
  private async pick(locale: string, category?: string) {
    const rows = await this.prisma.contentItem.findMany({ where: this.where(locale, category), orderBy: { publishedAt: 'desc' }, take: 50 });
    return rows.length || locale === 'en' ? rows : this.prisma.contentItem.findMany({ where: this.where('en', category), orderBy: { publishedAt: 'desc' }, take: 50 });
  }

  @Get() async list(@Query('locale') locale = 'en', @Query('category') category?: string) {
    if (!/^[a-z]{2,3}$/.test(locale)) throw new BadRequestException('Invalid locale.');
    const rows = await this.pick(locale, category);
    return rows.map((r) => ({ slug: r.slug, title: r.title, summary: r.summary, category: r.category, readMinutes: r.readMinutes, reviewed: Boolean(r.reviewedBy) }));
  }
  @Get(':slug') async one(@Param('slug') slug: string) {
    const r = await this.prisma.contentItem.findFirst({ where: { slug, publishedAt: { lte: new Date() } } });
    if (!r) return { notFound: true };
    return { slug: r.slug, title: r.title, summary: r.summary, body: r.body, category: r.category, readMinutes: r.readMinutes, reviewed: Boolean(r.reviewedBy) };
  }
}
