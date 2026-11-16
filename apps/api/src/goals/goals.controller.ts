import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GoalDto } from './dto';
import { GoalsService } from './goals.service';

const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me/goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}
  @Get() list(@Req() r: Request) { return this.goals.list(uid(r)); }
  @Post() create(@Req() r: Request, @Body() d: GoalDto) { return this.goals.create(uid(r), d); }
  @Get(':id') get(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.goals.get(uid(r), id); }
  @Put(':id') update(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Body() d: GoalDto) { return this.goals.update(uid(r), id, d); }
  @HttpCode(200) @Delete(':id') remove(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.goals.remove(uid(r), id); }
}
