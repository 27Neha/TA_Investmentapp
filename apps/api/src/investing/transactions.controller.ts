import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlagsService } from '../flags/flags.service';
import { MeService } from '../me/me.service';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSACTION_PROVIDER, TransactionProvider } from './transaction.provider';

export const TX_TYPES = ['PURCHASE', 'REDEMPTION', 'SIP', 'SIP_CANCELLATION', 'MANDATE', 'PAYMENT', 'REFUND', 'OTHER'];
export const TX_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED'];
const uid = (r: Request) => (r as any).user.sub as string;

/** Read-only. Rows exist only if a verified provider integration wrote them; the app can neither create nor edit transactions. */
@UseGuards(JwtAuthGuard)
@Controller('v1/me')
export class TransactionsController {
  constructor(private readonly prisma: PrismaService, private readonly me: MeService, private readonly flags: FlagsService, @Inject(TRANSACTION_PROVIDER) private readonly provider: TransactionProvider) {}

  private view(t: any) { return { id: t.id, type: t.type, status: t.status, amount: Number(t.amount), schemeCode: t.schemeCode, schemeName: t.schemeName, providerRef: t.providerRef, failureReason: t.failureReason, occurredAt: t.occurredAt }; }

  @Get('transactions') async list(@Req() r: Request, @Query('type') type?: string, @Query('status') status?: string) {
    if (type && !TX_TYPES.includes(type)) throw new BadRequestException('Invalid type.');
    if (status && !TX_STATUSES.includes(status)) throw new BadRequestException('Invalid status.');
    const rows = await this.prisma.transaction.findMany({ where: { userId: uid(r), ...(type ? { type } : {}), ...(status ? { status } : {}) }, orderBy: { occurredAt: 'desc' }, take: 100 });
    return { providerConnected: this.provider.isConnected(), items: rows.map((t) => this.view(t)), types: TX_TYPES, statuses: TX_STATUSES, emptyReason: rows.length ? null : this.provider.isConnected() ? 'NO_TRANSACTIONS' : 'PROVIDER_NOT_CONNECTED' };
  }
  @Get('transactions/:id') async one(@Req() r: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    const t = await this.prisma.transaction.findFirst({ where: { id, userId: uid(r) } });
    if (!t) throw new NotFoundException('Transaction not found.');
    return this.view(t);
  }

  /** Withdrawal is findable but DISABLED until a verified provider exists. There is intentionally no endpoint that starts a withdrawal. */
  @Get('withdrawals/availability') async withdrawal(@Req() r: Request) {
    const [kyc, live] = await Promise.all([this.me.kyc(uid(r)), this.flags.isEnabled('investing.live')]);
    const reasons: string[] = [];
    if (!this.provider.isConnected()) reasons.push('PROVIDER_NOT_CONNECTED');
    if (kyc.status !== 'VERIFIED') reasons.push('KYC_NOT_VERIFIED');
    if (!live) reasons.push('INVESTING_FLAG_OFF');
    return {
      enabled: false, reasons,
      plannedFlow: ['Select an eligible folio', 'Choose full or partial withdrawal', 'Review verified redeemable amount, exit load and tax information', 'Confirm bank account', 'Authenticate and confirm', 'Track status (pending, successful, failed, rejected)'],
      statement: 'Withdrawals are not available yet. A withdrawal is reported as successful only after the provider confirms it. Nothing is simulated.',
    };
  }
}
