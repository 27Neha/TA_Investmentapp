import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsInt, Max, Min } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LearnService } from './learn.service';

class SubmitDto { @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(0, { each: true }) @Max(10, { each: true }) answers: number[]; }
class ChallengeDto { @IsInt() @Min(0) @Max(10) score: number; @IsInt() @Min(1) @Max(10) total: number; }
const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me/learn')
export class LearnController {
  constructor(private readonly learn: LearnService) {}
  @Get() overview(@Req() r: Request) { return this.learn.overview(uid(r)); }
  @Get('quizzes/:id') quiz(@Param('id') id: string) { return this.learn.quiz(id); }
  @HttpCode(200) @Post('quizzes/:id/submit') submit(@Req() r: Request, @Param('id') id: string, @Body() d: SubmitDto) { return this.learn.submit(uid(r), id, d.answers); }
  @HttpCode(200) @Post('challenges/:id/complete') complete(@Req() r: Request, @Param('id') id: string, @Body() d: ChallengeDto) { return this.learn.recordChallenge(uid(r), id, d.score, d.total); }
}
