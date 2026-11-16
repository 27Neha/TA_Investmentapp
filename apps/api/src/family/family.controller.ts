import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyService } from './family.service';

class CreateDto { @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(2, 60) name: string; }
class InviteDto { @IsEmail() @MaxLength(254) email: string; @IsString() @MaxLength(20) role: string; }
class SharingDto { @IsBoolean() shareGoals: boolean; @IsBoolean() shareHoldings: boolean; }
const uid = (r: Request) => (r as any).user.sub as string;
const UUID = new ParseUUIDPipe();

@UseGuards(JwtAuthGuard)
@Controller('v1/me/family')
export class FamilyController {
  constructor(private readonly f: FamilyService) {}
  @Get() mine(@Req() r: Request) { return this.f.mine(uid(r)); }
  @Post() create(@Req() r: Request, @Body() d: CreateDto) { return this.f.create(uid(r), d.name); }
  @HttpCode(200) @Delete() disband(@Req() r: Request) { return this.f.disband(uid(r)); }
  @Get('overview') overview(@Req() r: Request) { return this.f.overview(uid(r)); }
  @Get('members/:id') member(@Req() r: Request, @Param('id', UUID) id: string) { return this.f.memberView(uid(r), id); }
  @HttpCode(200) @Delete('members/:id') remove(@Req() r: Request, @Param('id', UUID) id: string) { return this.f.removeMember(uid(r), id); }
  @HttpCode(200) @Post('leave') leave(@Req() r: Request) { return this.f.leave(uid(r)); }
  @HttpCode(200) @Put('sharing') sharing(@Req() r: Request, @Body() d: SharingDto) { return this.f.setMySharing(uid(r), d.shareGoals, d.shareHoldings); }
  @Post('invites') invite(@Req() r: Request, @Body() d: InviteDto) { return this.f.invite(uid(r), d.email, d.role); }
  @HttpCode(200) @Delete('invites/:id') revoke(@Req() r: Request, @Param('id', UUID) id: string) { return this.f.revokeInvite(uid(r), id); }
  @Get('invitations') mine_inv(@Req() r: Request) { return this.f.myInvitations(uid(r)); }
  @HttpCode(200) @Post('invitations/:id/accept') accept(@Req() r: Request, @Param('id', UUID) id: string) { return this.f.accept(uid(r), id); }
  @HttpCode(200) @Post('invitations/:id/decline') decline(@Req() r: Request, @Param('id', UUID) id: string) { return this.f.decline(uid(r), id); }
}
