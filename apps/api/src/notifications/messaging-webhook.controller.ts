import { BadRequestException, Controller, Headers, HttpCode, Inject, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingPort, MessagingWebhookRejectedError, WHATSAPP_PORT } from './messaging';
import { NotificationService } from './notification.service';

/** Interakt delivery callbacks. Dark (404) unless the adapter has a webhook secret; the raw body is verified before parsing; duplicates are no-ops. */
@Controller('v1/webhooks')
export class MessagingWebhookController {
  constructor(@Inject(WHATSAPP_PORT) private readonly wa: MessagingPort, private readonly svc: NotificationService, private readonly prisma: PrismaService) {}

  @Post('whatsapp') @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    if (!this.wa.isConnected() || !this.wa.verifyAndNormalizeWebhook || !process.env.INTERAKT_WEBHOOK_SECRET) throw new NotFoundException();
    if (!req.rawBody) throw new BadRequestException('Raw body unavailable.');
    let events; try { events = this.wa.verifyAndNormalizeWebhook(req.rawBody, headers); }
    catch (e) { if (e instanceof MessagingWebhookRejectedError) throw new UnauthorizedException(); throw new BadRequestException(); }
    const hash = createHash('sha256').update(req.rawBody).digest('hex'); const results: string[] = [];
    for (const e of events) {
      try { await this.prisma.providerWebhookEvent.create({ data: { provider: this.wa.name, eventId: e.eventId, eventType: e.state, signatureValid: true, payloadHash: hash, payload: {} } }); }
      catch (err: any) { if (err?.code === 'P2002') { results.push('DUPLICATE_EVENT'); continue; } throw err; }
      results.push(await this.svc.applyDelivery(e));
    }
    return { received: events.length, results };
  }
}
