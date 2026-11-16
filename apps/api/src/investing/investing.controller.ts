import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlagsService } from '../flags/flags.service';
import { MeService } from '../me/me.service';
import { TRANSACTION_PROVIDER, TransactionProvider } from './transaction.provider';

@UseGuards(JwtAuthGuard)
@Controller('v1/me/investing')
export class InvestingController {
  constructor(private readonly me: MeService, private readonly flags: FlagsService, @Inject(TRANSACTION_PROVIDER) private readonly provider: TransactionProvider) {}

  /** Reports exactly why investing is unavailable. There is intentionally no order/SIP/purchase endpoint until a verified provider exists. */
  @Get('status') async status(@Req() r: Request) {
    const id = (r as any).user.sub as string;
    const [kyc, live, sip, onetime] = await Promise.all([this.me.kyc(id), this.flags.isEnabled('investing.live'), this.flags.isEnabled('investing.sip'), this.flags.isEnabled('investing.onetime')]);
    const blockers: string[] = [];
    if (!this.provider.isConnected()) blockers.push('PROVIDER_NOT_CONNECTED');
    if (kyc.status !== 'VERIFIED') blockers.push('KYC_NOT_VERIFIED');
    if (!live) blockers.push('INVESTING_FLAG_OFF');
    return { available: false, provider: { name: this.provider.name, environment: this.provider.environment, connected: this.provider.isConnected() }, flags: { live, sip, onetime }, kycStatus: kyc.status, blockers };
  }
}
