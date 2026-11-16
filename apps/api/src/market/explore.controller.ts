import { BadRequestException, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Body, Req, UseGuards } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CATEGORIES, CATEGORIES_REVIEWED } from './categories';
import { INDEX_PROVIDER, IndexDataProvider, marketHours } from './index.provider';
import { MarketDataProvider, SOURCE } from './market.provider';
import { downsample, periodReturns, RANGES, sliceRange } from './nav-series';

const DISCLOSURE = 'Mutual fund investments are subject to market risks. Read all scheme related documents carefully. NAV shown is as published by the data source and is not a recommendation. Past performance does not guarantee future results.';
const uid = (r: Request) => (r as any).user.sub as string;
const CODE = /^\d{3,8}$/;
const NOT_VERIFIED = 'Expense ratio, benchmark, exit load, minimum investment, riskometer and ratings are not shown because no verified scheme-data provider is connected. Refer to the official scheme documents.';

class CodeDto { @Matches(CODE, { message: 'Invalid scheme code.' }) schemeCode: string; }

@UseGuards(JwtAuthGuard)
@Controller('v1/explore')
export class ExploreController {
  constructor(private readonly market: MarketDataProvider, private readonly prisma: PrismaService) {}

  @Get('schemes') async search(@Req() r: Request, @Query('q') q = '', @Query('plan') plan?: string, @Query('option') option?: string, @Query('amc') amc?: string) {
    const term = q.trim();
    if (term.length < 3 || term.length > 60) throw new BadRequestException('Type at least 3 characters to search.');
    if (plan && !['DIRECT', 'REGULAR'].includes(plan)) throw new BadRequestException('Invalid plan filter.');
    if (option && !['GROWTH', 'IDCW'].includes(option)) throw new BadRequestException('Invalid option filter.');
    if (amc && amc.length > 40) throw new BadRequestException('Invalid AMC filter.');
    let rows = await this.market.search(term);
    if (plan) rows = rows.filter((x) => x.plan === plan);
    if (option) rows = rows.filter((x) => x.option === option);
    if (amc) rows = rows.filter((x) => x.schemeName.toLowerCase().includes(amc.trim().toLowerCase()));
    await this.prisma.searchHistory.create({ data: { userId: uid(r), query: term } }).catch(() => undefined); // best effort
    return { results: rows.slice(0, 25), filtersNote: 'Plan, option and AMC filters match the scheme NAME text and are applied to the first 100 matches. They are not verified scheme data.', source: SOURCE, disclosure: DISCLOSURE };
  }

  @Get('schemes/:code') async detail(@Param('code') code: string) {
    if (!CODE.test(code)) throw new BadRequestException('Invalid scheme code.');
    const { detail, points } = await this.market.scheme(code);
    return { scheme: detail, returns: periodReturns(points), unverifiedFields: NOT_VERIFIED, disclosure: DISCLOSURE };
  }

  @Get('schemes/:code/history') async history(@Param('code') code: string, @Query('range') range = '1Y') {
    if (!CODE.test(code)) throw new BadRequestException('Invalid scheme code.');
    if (!(range in RANGES)) throw new BadRequestException('Invalid range.');
    const { detail, points } = await this.market.scheme(code);
    const sel = sliceRange(points, range);
    return { schemeCode: detail.schemeCode, schemeName: detail.schemeName, range, points: downsample(sel), observations: sel.length, from: sel[0]?.date ?? null, to: sel[sel.length - 1]?.date ?? null, stale: detail.stale, lastFetchedAt: detail.lastFetchedAt, source: SOURCE, disclosure: DISCLOSURE };
  }

  @Get('compare') async compare(@Query('codes') codes = '') {
    const list = [...new Set(codes.split(',').map((c) => c.trim()).filter(Boolean))];
    if (list.length < 2 || list.length > 4 || list.some((c) => !CODE.test(c))) throw new BadRequestException('Choose 2 to 4 valid schemes to compare.');
    const items = await Promise.all(list.map(async (c) => { const { detail, points } = await this.market.scheme(c); return { scheme: detail, returns: periodReturns(points) }; }));
    return { items, unverifiedFields: NOT_VERIFIED, source: SOURCE, disclosure: DISCLOSURE };
  }

  @Get('categories') categories() {
    return { reviewed: CATEGORIES_REVIEWED, items: CATEGORIES.map(({ searchTerm, ...c }) => c), disclosure: DISCLOSURE };
  }
  @Get('categories/:key/schemes') async categorySchemes(@Param('key') key: string) {
    const c = CATEGORIES.find((x) => x.key === key);
    if (!c) throw new BadRequestException('Unknown category.');
    const rows = await this.market.search(c.searchTerm);
    return { category: c.key, schemes: rows.slice(0, 25), note: 'Schemes are matched by name text from the data source and may not all belong to this SEBI category. Verify in the official scheme documents.', source: SOURCE, disclosure: DISCLOSURE };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('v1/me')
export class WatchlistController {
  constructor(private readonly market: MarketDataProvider, private readonly prisma: PrismaService) {}

  @Get('watchlist') async list(@Req() r: Request) {
    const rows = await this.prisma.watchlistItem.findMany({ where: { userId: uid(r) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((w) => ({ schemeCode: w.schemeCode, schemeName: w.schemeName, addedAt: w.createdAt }));
  }
  @HttpCode(200) @Post('watchlist') async add(@Req() r: Request, @Body() d: CodeDto) {
    const { detail } = await this.market.scheme(d.schemeCode); // validates the scheme really exists upstream
    if ((await this.prisma.watchlistItem.count({ where: { userId: uid(r) } })) >= 100) throw new BadRequestException('Your watchlist is full (100 schemes).');
    await this.prisma.watchlistItem.upsert({ where: { userId_schemeCode: { userId: uid(r), schemeCode: detail.schemeCode } }, create: { userId: uid(r), schemeCode: detail.schemeCode, schemeName: detail.schemeName }, update: {} });
    return { schemeCode: detail.schemeCode, schemeName: detail.schemeName };
  }
  @HttpCode(200) @Delete('watchlist/:code') async remove(@Req() r: Request, @Param('code') code: string) {
    if (!CODE.test(code)) throw new BadRequestException('Invalid scheme code.');
    await this.prisma.watchlistItem.deleteMany({ where: { userId: uid(r), schemeCode: code } });
    return { removed: true };
  }
  @Get('search-history') async history(@Req() r: Request) {
    const rows = await this.prisma.searchHistory.findMany({ where: { userId: uid(r) }, orderBy: { createdAt: 'desc' }, take: 40 });
    const seen = new Set<string>();
    return rows.filter((x) => { const k = x.query.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10).map((x) => ({ query: x.query, at: x.createdAt }));
  }
  @HttpCode(200) @Delete('search-history') async clear(@Req() r: Request) { await this.prisma.searchHistory.deleteMany({ where: { userId: uid(r) } }); return { cleared: true }; }
}

@UseGuards(JwtAuthGuard)
@Controller('v1/market')
export class MarketController {
  constructor(@Inject(INDEX_PROVIDER) private readonly idx: IndexDataProvider) {}
  @Get('snapshot') async snapshot() { return { ...(await this.idx.snapshot()), marketHours: marketHours(), provider: this.idx.name }; }
  @Get('history') async history(@Query('index') index = 'NIFTY50', @Query('range') range = '1Y') {
    if (!['NIFTY50', 'SENSEX'].includes(index) || !(range in RANGES)) throw new BadRequestException('Invalid index or range.');
    return this.idx.history(index, range);
  }
  @Get('news') news() { return this.idx.news(); }
  /** Market Brief: composed only from provider data; anything unavailable is reported as such. */
  @Get('brief') async brief() {
    const [snapshot, news] = await Promise.all([this.idx.snapshot(), this.idx.news()]);
    return { snapshot, news, marketHours: marketHours(), events: { available: false, reason: 'PROVIDER_NOT_CONFIGURED', items: [] }, sectors: { available: false, reason: 'PROVIDER_NOT_CONFIGURED', items: [] }, editorialNote: 'Educational articles in Learn are general information and are separate from market data and news.' };
  }
}
