import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContributionDto, GoalDto } from './dto';
import { GoalsService } from './goals.service';

const uid = (r: Request) => (r as any).user.sub as string;
const UUID = new ParseUUIDPipe();

@UseGuards(JwtAuthGuard)
@Controller('v1/me/goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}
  @Get() list(@Req() r: Request, @Query('status') status?: string) { return this.goals.list(uid(r), status); }
  @Post() create(@Req() r: Request, @Body() d: GoalDto) { return this.goals.create(uid(r), d); }
  @Get('compare') compare(@Req() r: Request, @Query('ids') ids = '') {
    const list = ids.split(',').filter(Boolean);
    if (list.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) throw new BadRequestException('Invalid goal id.');
    return this.goals.compare(uid(r), list);
  }
  @Get(':id') get(@Req() r: Request, @Param('id', UUID) id: string) { return this.goals.get(uid(r), id); }
  @Put(':id') update(@Req() r: Request, @Param('id', UUID) id: string, @Body() d: GoalDto) { return this.goals.update(uid(r), id, d); }
  @HttpCode(200) @Delete(':id') remove(@Req() r: Request, @Param('id', UUID) id: string, @Query('confirm') confirm?: string) { return this.goals.remove(uid(r), id, confirm === 'yes'); }
  @HttpCode(200) @Post(':id/pause') pause(@Req() r: Request, @Param('id', UUID) id: string) { return this.goals.pause(uid(r), id); }
  @HttpCode(200) @Post(':id/resume') resume(@Req() r: Request, @Param('id', UUID) id: string) { return this.goals.resume(uid(r), id); }
  @HttpCode(200) @Post(':id/archive') archive(@Req() r: Request, @Param('id', UUID) id: string) { return this.goals.archive(uid(r), id); }
  @Get(':id/contributions') contributions(@Req() r: Request, @Param('id', UUID) id: string) { return this.goals.contributions(uid(r), id); }
  @Post(':id/contributions') addContribution(@Req() r: Request, @Param('id', UUID) id: string, @Body() d: ContributionDto) { return this.goals.addContribution(uid(r), id, d); }
  @HttpCode(200) @Delete(':id/contributions/:cid') removeContribution(@Req() r: Request, @Param('id', UUID) id: string, @Param('cid', UUID) cid: string) { return this.goals.removeContribution(uid(r), id, cid); }
  @Get(':id/progress') progress(@Req() r: Request, @Param('id', UUID) id: string) { return this.goals.progressSeries(uid(r), id); }
}
