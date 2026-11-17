import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MAX_ATTACHMENT_BYTES } from '../integrations/security/attachments';
import { SUPPORT_PORT, SupportPort, SupportWebhookRejectedError } from '../integrations/support/support.port';
import { CATEGORIES, SupportService } from './support.service';

class TicketDto {
  @IsIn(CATEGORIES as unknown as string[]) category!: string;
  @IsString() @Length(3, 140) subject!: string;
  @IsString() @Length(5, 4000) message!: string;
  @IsString() @Length(8, 64) @Matches(/^[A-Za-z0-9_-]+$/) clientRequestId!: string;
}
class MessageDto { @IsString() @Length(1, 4000) body!: string; }
const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me/support')
export class SupportController {
  constructor(private readonly s: SupportService) {}
  @Get('status') status() { return this.s.status(); }
  @Get('tickets') list(@Req() r: Request) { return this.s.list(uid(r)); }
  @Post('tickets') @Throttle({ default: { limit: 10, ttl: 60_000 } }) create(@Req() r: Request, @Body() b: TicketDto) { return this.s.createTicket(uid(r), b); }
  @Get('tickets/:id') get(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.get(uid(r), id); }
  @Post('tickets/:id/messages') @Throttle({ default: { limit: 20, ttl: 60_000 } }) message(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @Body() b: MessageDto) { return this.s.addMessage(uid(r), id, b.body); }
  @Post('tickets/:id/attachments') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }))
  attach(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: any, @Body() b: { messageId?: string }) {
    if (b?.messageId !== undefined && !/^[0-9a-f-]{36}$/i.test(String(b.messageId))) throw new BadRequestException('messageId must be a UUID.');
    return this.s.addAttachment(uid(r), id, file, b?.messageId);
  }
  @Get('attachments/:id/url') url(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.s.attachmentUrl(uid(r), id); }
}

/** Disabled (404) until the desk adapter provides a verified webhook implementation. */
@Controller('v1/webhooks')
export class SupportWebhookController {
  constructor(@Inject(SUPPORT_PORT) private readonly desk: SupportPort, private readonly s: SupportService) {}
  @Post('support') @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    if (!this.desk.isConnected() || !this.desk.verifyAndNormalizeWebhook) throw new NotFoundException();
    if (!req.rawBody) throw new BadRequestException('Raw body unavailable.');
    let events;
    try { events = this.desk.verifyAndNormalizeWebhook(req.rawBody, headers); }
    catch (e) { if (e instanceof SupportWebhookRejectedError) throw new UnauthorizedException(); throw new BadRequestException(); }
    const hash = createHash('sha256').update(req.rawBody).digest('hex'); const results: string[] = [];
    for (const e of events) results.push((await this.s.applyInbound(e, hash)).outcome);
    return { received: events.length, results };
  }
}
