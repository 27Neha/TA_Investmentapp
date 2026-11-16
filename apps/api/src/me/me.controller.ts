import { Body, Controller, Get, HttpCode, Post, Put, Patch, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AcceptConsentsDto, AddressDto, BankDto, ChangePasswordDto, GuardianDto, LocaleDto, NomineesDto, NoNomineeDto, NotificationsDto, ProfileDto, RiskDto,
} from './dto';
import { MeService } from './me.service';

/** The user id ALWAYS comes from the verified access token. No endpoint accepts a user id, so cross-user access is structurally impossible. */
const uid = (req: Request) => (req as any).user.sub as string;
const ctx = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@UseGuards(JwtAuthGuard)
@Controller('v1/me')
export class MeController {
  constructor(private readonly me: MeService, private readonly auth: AuthService) {}

  @Get() get(@Req() r: Request) { return this.me.me(uid(r)); }
  @Get('onboarding') onboarding(@Req() r: Request) { return this.me.onboarding(uid(r)); }
  @HttpCode(200) @Post('onboarding/confirm') confirm(@Req() r: Request) { return this.me.confirm(uid(r)); }

  @Get('profile') profile(@Req() r: Request) { return this.me.getProfile(uid(r)); }
  @Put('profile') saveProfile(@Req() r: Request, @Body() d: ProfileDto) { return this.me.saveProfile(uid(r), d); }
  @Get('address') address(@Req() r: Request) { return this.me.getAddress(uid(r)); }
  @Put('address') saveAddress(@Req() r: Request, @Body() d: AddressDto) { return this.me.saveAddress(uid(r), d); }
  @Get('bank') bank(@Req() r: Request) { return this.me.getBank(uid(r)); }
  @Put('bank') saveBank(@Req() r: Request, @Body() d: BankDto) { return this.me.saveBank(uid(r), d); }
  @Get('nominees') nominees(@Req() r: Request) { return this.me.getNominees(uid(r)); }
  @Put('nominees') saveNominees(@Req() r: Request, @Body() d: NomineesDto) { return this.me.saveNominees(uid(r), d); }
  @HttpCode(200) @Post('nominees/opt-out') optOut(@Req() r: Request, @Body() _d: NoNomineeDto) { return this.me.optOutNominee(uid(r)); }

  @Get('risk/questions') riskQuestions() { return this.me.riskQuestions(); }
  @Get('risk') risk(@Req() r: Request) { return this.me.getRisk(uid(r)); }
  @HttpCode(200) @Post('risk') saveRisk(@Req() r: Request, @Body() d: RiskDto) { return this.me.saveRisk(uid(r), d.answers); }

  @Get('guardian') guardian(@Req() r: Request) { return this.me.getGuardian(uid(r)); }
  @Put('guardian') saveGuardian(@Req() r: Request, @Body() d: GuardianDto) { return this.me.saveGuardian(uid(r), d); }

  @Get('consents') consents(@Req() r: Request) { return this.me.consents(uid(r)); }
  @HttpCode(200) @Post('consents') accept(@Req() r: Request, @Body() d: AcceptConsentsDto) { return this.me.acceptConsents(uid(r), d.kinds, ctx(r)); }

  @Get('kyc') kyc(@Req() r: Request) { return this.me.kyc(uid(r)); }

  @Patch('locale') locale(@Req() r: Request, @Body() d: LocaleDto) { return this.me.setLocale(uid(r), d.locale); }
  @Get('notifications') notifications(@Req() r: Request) { return this.me.getNotifications(uid(r)); }
  @Put('notifications') setNotifications(@Req() r: Request, @Body() d: NotificationsDto) { return this.me.setNotifications(uid(r), d); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post('password/change')
  changePassword(@Req() r: Request, @Body() d: ChangePasswordDto) { return this.auth.changePassword(uid(r), d.currentPassword, d.newPassword, ctx(r)); }
  @Get('sessions') sessions(@Req() r: Request) { return this.auth.listSessions(uid(r)); }
  @HttpCode(200) @Post('sessions/revoke-all') revokeAll(@Req() r: Request) { return this.auth.revokeAllSessions(uid(r)); }
}
