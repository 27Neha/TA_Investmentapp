import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto, SignupDto, VerifyEmailDto, VerifyResetOtpDto,
} from './dto';
import { AuthUser, JwtAuthGuard } from './jwt-auth.guard';

const ctx = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(STRICT) @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.auth.signup(dto, ctx(req));
  }

  @Throttle(STRICT) @HttpCode(200) @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Throttle(STRICT) @HttpCode(200) @Post('resend-verification')
  resend(@Body() dto: ForgotPasswordDto) {
    return this.auth.resendEmailVerification(dto.email);
  }

  @Throttle(STRICT) @HttpCode(200) @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, ctx(req));
  }

  @Throttle(STRICT) @HttpCode(200) @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, ctx(req));
  }

  @HttpCode(200) @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Throttle(STRICT) @HttpCode(200) @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Throttle(STRICT) @HttpCode(200) @Post('forgot-password/verify')
  verifyReset(@Body() dto: VerifyResetOtpDto) {
    return this.auth.verifyResetOtp(dto);
  }

  @Throttle(STRICT) @HttpCode(200) @Post('forgot-password/reset')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard) @Get('me')
  me(@Req() req: Request & { user: AuthUser }) {
    return { id: req.user.sub, role: req.user.role };
  }
}
