import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RiskService } from './risk.service';

class AnswersDto { @IsObject() answers: Record<string, string>; }
class SubmitDto { @IsOptional() @IsObject() answers?: Record<string, string>; }
const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me/risk')
export class RiskController {
  constructor(private readonly risk: RiskService) {}
  @Get('framework') framework() { return this.risk.framework(); }
  @Get('status') status(@Req() r: Request) { return this.risk.status(uid(r)); }
  @Get('draft') draft(@Req() r: Request) { return this.risk.getDraft(uid(r)); }
  @Put('draft') saveDraft(@Req() r: Request, @Body() d: AnswersDto) { return this.risk.saveDraft(uid(r), d.answers); }
  @HttpCode(200) @Post('submit') submit(@Req() r: Request, @Body() d: SubmitDto) { return this.risk.submit(uid(r), d.answers); }
  @Get('history') history(@Req() r: Request) { return this.risk.history(uid(r)); }
  @Get('compare') compare(@Req() r: Request) { return this.risk.compare(uid(r)); }
}
