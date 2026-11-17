import { BadRequestException, Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { Role } from '@prisma/client';
import { AuthUser, JwtAuthGuard, Roles } from '../auth/jwt-auth.guard';
import { FlagsService } from './flags.service';

class SetFlagDto { @IsBoolean() enabled: boolean; }

@Controller('v1/admin/flags')
@UseGuards(JwtAuthGuard)
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Roles(Role.ADMIN, Role.COMPLIANCE, Role.OPERATIONS) @Get()
  list() { return this.flags.list(); }

  // Only admins can toggle; every change is audited.
  @Roles(Role.ADMIN) @Put(':key')
  async set(@Param('key') key: string, @Body() dto: SetFlagDto, @Req() req: { user: AuthUser }) {
    try { return await this.flags.set(key, dto.enabled, req.user.sub); }
    catch { throw new BadRequestException('Unknown flag'); }
  }
}
