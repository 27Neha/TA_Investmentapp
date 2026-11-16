import { BadRequestException, Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { verifyPassword } from '../common/password';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';

class RequestDto { @IsIn(['DEACTIVATE', 'DELETE']) kind: string; @IsOptional() @IsString() @MaxLength(300) reason?: string; @IsString() @MaxLength(128) password: string; }
const uid = (r: Request) => (r as any).user.sub as string;

/**
 * Deactivation/deletion are REQUESTS recorded for review (regulatory record-keeping may require retention); nothing is deleted automatically.
 * The user must re-enter their password. Change of email/mobile is not supported yet (needs verified OTP flows) and is stated as such in the app.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly inbox: InboxService) {}
  async request(userId: string, d: RequestDto) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !(await verifyPassword(u.passwordHash, d.password))) throw new BadRequestException({ message: 'Your password is incorrect.', code: 'WRONG_PASSWORD' });
    // Serialise per user so simultaneous taps cannot create two open requests (no schema change needed; the lock is released at commit).
    const { r, open } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'account-request:' + userId}))`;
      const existing = await tx.accountRequest.findFirst({ where: { userId, status: 'REQUESTED' } });
      if (existing) return { r: null, open: existing };
      return { r: await tx.accountRequest.create({ data: { userId, kind: d.kind, reason: d.reason?.trim() || null } }), open: null };
    });
    if (open) return this.view(open, true);
    if (!r) throw new BadRequestException('Could not record the request.');
    await this.audit.record(userId, `ACCOUNT_${d.kind}_REQUESTED`, 'AccountRequest', r.id);
    await this.inbox.notify(userId, 'ACCOUNT', 'Account request received', 'We received your request. Your account stays active until the request is reviewed, and you can cancel it from Settings.');
    return this.view(r, false);
  }
  private view(r: any, duplicate: boolean) { return { id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt, duplicate, note: 'This is a request. Nothing has been deleted or deactivated yet; records may need to be retained as required by regulations.' }; }
  async list(userId: string) { const rows = await this.prisma.accountRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }); return rows.map((r) => this.view(r, false)); }
  async cancel(userId: string, id: string) {
    const x = await this.prisma.accountRequest.updateMany({ where: { id, userId, status: 'REQUESTED' }, data: { status: 'CANCELLED' } });
    if (!x.count) throw new NotFoundException('Request not found.');
    await this.audit.record(userId, 'ACCOUNT_REQUEST_CANCELLED', 'AccountRequest', id);
    return { cancelled: true };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('v1/me/account')
export class AccountController {
  constructor(private readonly svc: AccountService) {}
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post('requests') create(@Req() r: Request, @Body() d: RequestDto) { return this.svc.request(uid(r), d); }
  @Get('requests') list(@Req() r: Request) { return this.svc.list(uid(r)); }
  @HttpCode(200) @Post('requests/:id/cancel') cancel(@Req() r: Request, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.cancel(uid(r), id); }
}

@Module({ imports: [AuthModule], controllers: [AccountController], providers: [AccountService] })
export class AccountModule {}
