import { BadRequestException, Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuitabilityService } from './suitability.service';

/** Per-user and authenticated: it reveals the caller's own risk band, so it lives under /me. Read only. */
@UseGuards(JwtAuthGuard)
@Controller('v1/me/suitability')
export class SuitabilityController {
  constructor(private readonly s: SuitabilityService) {}
  @Get(':code') check(@Req() r: Request, @Param('code') code: string) {
    if (!/^\d{3,8}$/.test(code)) throw new BadRequestException('Invalid scheme code.');
    return this.s.check((r as any).user.sub, code);
  }
}
