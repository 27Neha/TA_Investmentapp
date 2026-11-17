import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard, Roles } from '../auth/jwt-auth.guard';
import { KYC_KINDS, KYC_PROVIDER, KycKind, KycProvider, KycWebhookRejectedError } from '../integrations/kyc/kyc.port';
import { hashRaw, KYC_CONSENT_VERSION, KycService, PURPOSE_FOR } from './kyc.service';

class ConsentDto { @IsIn(Object.values(PURPOSE_FOR)) purpose!: string; @IsString() @Length(1, 60) consentVersion!: string; }
class StartDto { @IsIn(KYC_KINDS) kind!: KycKind; @IsUUID() consentId!: string; @IsString() @Length(8, 64) @Matches(/^[A-Za-z0-9_-]+$/) clientRequestId!: string; }
class DecisionDto { @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT'; @IsString() @Length(5, 500) note!: string; }
const uid = (r: Request) => (r as any).user.sub as string;

/** Bodies never carry a status or verified flag: the server decides everything from provider-verified events. */
@UseGuards(JwtAuthGuard)
@Controller('v1/me/kyc')
export class KycController {
  constructor(private readonly s: KycService) {}
  @Get('verification') status(@Req() r: Request) { return this.s.status(uid(r)); }
  @Get('consent-version') consentVersion() { return { version: KYC_CONSENT_VERSION, textStatus: 'PENDING_LEGAL_APPROVAL', purposes: PURPOSE_FOR }; }
  @Post('consents') @Throttle({ default: { limit: 20, ttl: 60_000 } }) consent(@Req() r: Request, @Body() b: ConsentDto) { return this.s.grantConsent(uid(r), b.purpose, b.consentVersion); }
  @Post('consents/:id/revoke') @HttpCode(200) revoke(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.revokeConsent(uid(r), id); }
  @Get('verifications') list(@Req() r: Request) { return this.s.list(uid(r)); }
  @Post('verifications') @Throttle({ default: { limit: 10, ttl: 60_000 } }) start(@Req() r: Request, @Body() b: StartDto) { return this.s.start(uid(r), b); }
  @Get('verifications/:id') get(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.get(uid(r), id); }
  @Post('verifications/:id/cancel') @HttpCode(200) cancel(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.cancel(uid(r), id); }
}

@UseGuards(JwtAuthGuard)
@Controller('v1/admin/kyc')
export class KycAdminController {
  constructor(private readonly s: KycService) {}
  @Roles(Role.ADMIN, Role.COMPLIANCE, Role.OPERATIONS) @Get('reviews') queue() { return this.s.reviewQueue(); }
  @Roles(Role.ADMIN, Role.COMPLIANCE) @Post('reviews/:id/decision') @HttpCode(200) decide(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Body() b: DecisionDto) { return this.s.decide(uid(r), id, b.decision, b.note); }
}

/** Disabled (404) until a verified provider is connected. Raw-body signature verification by the adapter happens before anything else. */
@Controller('v1/webhooks')
export class KycWebhookController {
  constructor(@Inject(KYC_PROVIDER) private readonly provider: KycProvider, private readonly s: KycService) {}
  @Post('kyc') @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    if (!this.provider.isConnected()) throw new NotFoundException();
    if (!req.rawBody) throw new BadRequestException('Raw body unavailable.');
    let results;
    try { results = this.provider.verifyAndNormalizeWebhook(req.rawBody, headers); }
    catch (e) { if (e instanceof KycWebhookRejectedError) throw new UnauthorizedException(); throw new BadRequestException(); }
    const hash = hashRaw(req.rawBody); const out: string[] = [];
    for (const r of results) out.push((await this.s.applyProviderResult(r, hash)).outcome);
    return { received: results.length, results: out };
  }
}
