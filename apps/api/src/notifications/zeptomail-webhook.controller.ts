import { BadRequestException, Controller, Headers, HttpCode, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../common/config';
import { maskEmail } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { parseZeptoEvents, webhookKeyOk } from './zeptomail-webhook';

/** Disabled (404) until ZEPTOMAIL_WEBHOOK_SECRET is set. Authenticated before anything is parsed or stored; duplicates are no-ops. */
@Controller('v1/webhooks')
export class ZeptoMailWebhookController {
  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Post('zeptomail') @HttpCode(200)
  hdr(@Req() req: Request & { rawBody?: Buffer }, @Headers('authorization') auth?: string) { return this.handle(req, undefined, auth); }
  @Post('zeptomail/:secret') @HttpCode(200)
  path(@Req() req: Request & { rawBody?: Buffer }, @Param('secret') secret: string, @Headers('authorization') auth?: string) { return this.handle(req, secret, auth); }

  private async handle(req: Request & { rawBody?: Buffer }, pathSecret?: string, auth?: string) {
    if (!this.cfg.zeptoWebhookSecret) throw new NotFoundException();
    if (!webhookKeyOk(this.cfg.zeptoWebhookSecret, pathSecret, auth)) throw new UnauthorizedException();
    if (!req.rawBody) throw new BadRequestException('Raw body unavailable.');
    let events; try { events = parseZeptoEvents(req.rawBody); } catch { throw new BadRequestException(); }
    const hash = createHash('sha256').update(req.rawBody).digest('hex'); const results: string[] = [];
    for (const e of events) {
      try { await this.prisma.providerWebhookEvent.create({ data: { provider: 'zeptomail', eventId: e.eventId === 'nohash:0' ? hash : e.eventId, eventType: e.kind, signatureValid: true, payloadHash: hash, payload: {} } }); }
      catch (err: any) { if (err?.code === 'P2002') { results.push('DUPLICATE_EVENT'); continue; } throw err; }
      results.push(await this.apply(e));
    }
    return { received: events.length, results };
  }

  /** Matches by the provider's request id (stored at send time), else by masked recipient among recent ACCEPTED emails. Soft bounces are retried by ZeptoMail, so they never change the status. */
  private async apply(e: { kind: string; requestId?: string; recipient?: string }): Promise<string> {
    if (e.kind === 'OTHER') return 'IGNORED';
    let log = e.requestId ? await this.prisma.emailLog.findFirst({ where: { providerMessageId: e.requestId, provider: 'zeptomail' } }) : null;
    if (!log && e.recipient) log = await this.prisma.emailLog.findFirst({ where: { provider: 'zeptomail', toMasked: maskEmail(e.recipient), status: 'ACCEPTED', createdAt: { gt: new Date(Date.now() - 48 * 3600_000) } }, orderBy: { createdAt: 'desc' } });
    if (!log) return 'UNMATCHED';
    if (e.kind === 'HARD_BOUNCE') await this.prisma.emailLog.update({ where: { id: log.id }, data: { status: 'BOUNCED', errorCode: 'HARD_BOUNCE' } });
    else if (log.status === 'ACCEPTED') await this.prisma.emailLog.update({ where: { id: log.id }, data: { errorCode: 'SOFT_BOUNCE' } });
    return 'APPLIED';
  }
}
