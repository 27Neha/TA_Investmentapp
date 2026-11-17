import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssessmentService } from './assessment.service';

/** Bodies carry ANSWERS ONLY. Any score/band/dimension field is rejected by the whitelist validation, so clients cannot influence the result. */
class AnswersDto { @IsObject() answers!: Record<string, string>; }
class SubmitDto { @IsOptional() @IsObject() answers?: Record<string, string>; }
const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me/risk/assessment')
export class AssessmentController {
  constructor(private readonly s: AssessmentService) {}
  @Get('framework') framework() { return this.s.framework(); }
  @Get('draft') draft(@Req() r: Request) { return this.s.getDraft(uid(r)); }
  @Put('draft') saveDraft(@Req() r: Request, @Body() b: AnswersDto) { return this.s.saveDraft(uid(r), b.answers); }
  @HttpCode(200) @Post('submit') submit(@Req() r: Request, @Body() b: SubmitDto) { return this.s.submit(uid(r), b.answers); }
  @Get('latest') latest(@Req() r: Request) { return this.s.latest(uid(r)); }
  @Get('history') history(@Req() r: Request) { return this.s.history(uid(r)); }
}
