import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InboxService } from './inbox.service';

const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me/inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}
  @Get() list(@Req() r: Request, @Query('unread') unread?: string) { return this.inbox.list(uid(r), unread === 'true'); }
  @Get('unread-count') async count(@Req() r: Request) { return { unread: await this.inbox.unreadCount(uid(r)) }; }
  @HttpCode(200) @Post('read-all') readAll(@Req() r: Request) { return this.inbox.markAllRead(uid(r)); }
  @HttpCode(200) @Post(':id/read') read(@Req() r: Request, @Param('id', ParseUUIDPipe) id: string) { return this.inbox.markRead(uid(r), id); }
}
