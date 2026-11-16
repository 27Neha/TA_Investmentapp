import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GRANTABLE_SCOPES, DISABLED_SCOPES, GuardianService, RELATIONSHIPS } from './guardian.service';

class InviteDto { @IsEmail() guardianEmail!: string; @IsIn(RELATIONSHIPS as unknown as string[]) relationship!: string; }
class AcceptDto { @IsString() @Length(1, 60) consentVersion!: string; @IsBoolean() declaresAdult!: boolean; }
class RevokeDto { @IsOptional() @IsString() @Length(0, 300) reason?: string; }
class GrantDto { @IsIn([...GRANTABLE_SCOPES, ...DISABLED_SCOPES]) scope!: string; }
const uid = (r: Request) => (r as any).user.sub as string;

/** Every route is scoped to the caller (as the minor or as the linked guardian). Bodies can never set status, permissions of others, or financial actions. */
@UseGuards(JwtAuthGuard)
@Controller('v1/me/guardian')
export class GuardianController {
  constructor(private readonly s: GuardianService) {}
  @Get('status') status() { return this.s.status(); }
  @Get('links') links(@Req() r: Request) { return this.s.myLinks(uid(r)); }
  @Post('invites') @Throttle({ default: { limit: 5, ttl: 60_000 } }) invite(@Req() r: Request, @Body() b: InviteDto) { return this.s.invite(uid(r), b); }
  @Get('invites/pending') pending(@Req() r: Request) { return this.s.pendingForGuardian(uid(r)); }
  @Post('links/:id/accept') @HttpCode(200) accept(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Body() b: AcceptDto) { return this.s.accept(uid(r), id, b.consentVersion, b.declaresAdult); }
  @Post('links/:id/reject') @HttpCode(200) reject(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.reject(uid(r), id); }
  @Post('links/:id/revoke') @HttpCode(200) revoke(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Body() b: RevokeDto) { return this.s.revoke(uid(r), id, b.reason); }
  @Post('links/:id/permissions') @HttpCode(200) grant(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Body() b: GrantDto) { return this.s.grant(uid(r), id, b.scope); }
  @Delete('links/:id/permissions/:scope') revokePerm(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Param('scope') scope: string) { return this.s.revokePermission(uid(r), id, scope); }
  @Get('links/:id/audit') audit(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.audit_(uid(r), id); }
  @Get('dependents/:id/summary') summary(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.dependentSummary(uid(r), id); }
  @Get('dependents/:id/goals') goals(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.dependentGoals(uid(r), id); }
}
