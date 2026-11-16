import { Inject, Injectable } from '@nestjs/common';
import { isMinor } from '../auth/auth.service';
import { FlagsService } from '../flags/flags.service';
import { MeService } from '../me/me.service';
import { PrismaService } from '../prisma/prisma.service';
import { INVESTMENT_PROVIDER, InvestmentProvider } from './investment-provider';

export type GateKind = 'LUMPSUM' | 'SIP';

/** Single source of truth for "can this user start a financial operation right now". Fails closed and lists every reason. */
@Injectable()
export class InvestingGate {
  constructor(private readonly prisma: PrismaService, private readonly me: MeService, private readonly flags: FlagsService, @Inject(INVESTMENT_PROVIDER) private readonly provider: InvestmentProvider) {}

  async check(userId: string, kind: GateKind) {
    const [u, kyc, live, specific, bank] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } }),
      this.me.kyc(userId),
      this.flags.isEnabled('investing.live'),
      this.flags.isEnabled(kind === 'SIP' ? 'investing.sip' : 'investing.onetime'),
      this.prisma.bankAccount.findUnique({ where: { userId }, select: { userId: true } }),
    ]);
    const reasons: string[] = [];
    if (!this.provider.isConnected()) reasons.push('PROVIDER_NOT_CONNECTED');
    if (!live) reasons.push('INVESTING_FLAG_OFF');
    if (!specific) reasons.push(kind === 'SIP' ? 'SIP_FLAG_OFF' : 'ONETIME_FLAG_OFF');
    if (kyc.status !== 'VERIFIED') reasons.push('KYC_NOT_VERIFIED');
    if (u?.dateOfBirth && isMinor(u.dateOfBirth)) reasons.push('MINOR_INVESTING_DISABLED'); // minors never invest; guardians cannot transact for them
    if (!bank) reasons.push('BANK_NOT_LINKED');
    return { enabled: reasons.length === 0, reasons };
  }
}
