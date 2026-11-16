import { BadRequestException, Controller, Headers, HttpCode, Inject, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import { INVESTMENT_PROVIDER, InvestmentProvider, WebhookRejectedError } from './investment-provider';
import { LifecycleService } from './lifecycle.service';

/**
 * Receives provider webhooks. Disabled (404) until a verified provider adapter is connected, so there is no open endpoint
 * that could be abused. The raw body is verified by the adapter BEFORE anything is parsed or stored. Duplicate events are no-ops.
 */
@Controller('v1/webhooks')
export class ProviderWebhookController {
  constructor(@Inject(INVESTMENT_PROVIDER) private readonly provider: InvestmentProvider, private readonly life: LifecycleService) {}

  @Post('investment') @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    if (!this.provider.isConnected()) throw new NotFoundException();
    if (!req.rawBody) throw new BadRequestException('Raw body unavailable.');
    let events;
    try { events = this.provider.verifyAndNormalizeWebhook(req.rawBody, headers); }
    catch (e) { if (e instanceof WebhookRejectedError) throw new UnauthorizedException(); throw new BadRequestException(); }
    const hash = createHash('sha256').update(req.rawBody).digest('hex');
    const results: string[] = [];
    for (const e of events) results.push((await this.life.applyProviderEvent(e, hash, { kind: e.kind, eventType: e.paymentEvent ?? e.mandateEvent ?? e.sipEvent })).outcome);
    return { received: events.length, results };
  }
}
