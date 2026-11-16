import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MarketDataProvider } from './market.provider';

const DISCLOSURE = 'Mutual fund investments are subject to market risks. Read all scheme related documents carefully. NAV shown is as published by the data source and is not a recommendation.';

@UseGuards(JwtAuthGuard)
@Controller('v1/explore')
export class ExploreController {
  constructor(private readonly market: MarketDataProvider) {}
  @Get('schemes') async search(@Query('q') q = '') {
    const term = q.trim();
    if (term.length < 3 || term.length > 60) throw new BadRequestException('Type at least 3 characters to search.');
    return { results: await this.market.search(term), disclosure: DISCLOSURE };
  }
  @Get('schemes/:code') async detail(@Param('code') code: string) {
    if (!/^\d{3,8}$/.test(code)) throw new BadRequestException('Invalid scheme code.');
    return { scheme: await this.market.detail(code), disclosure: DISCLOSURE };
  }
}
