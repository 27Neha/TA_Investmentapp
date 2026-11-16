import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpChannel, OtpPurpose, Role, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../common/config';
import { maskEmail, normaliseMobile, randomToken, sha256 } from '../common/crypto';
import { hashPassword, PASSWORD_RULES, validatePasswordStrength, verifyPassword } from '../common/password';
import { EmailService } from '../notifications/email.provider';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto, SignupDto, VerifyEmailDto, VerifyResetOtpDto } from './dto';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const RESET_TOKEN_TTL = '10m';
export const GENERIC_OTP_MESSAGE = 'If this email is registered, a verification code has been sent.';
const MIN_AGE_YEARS_FOR_SELF_ACCOUNT = 18;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export function isMinor(dob: Date, now = new Date()): boolean {
  const age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthday =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  return (hadBirthday ? age : age - 1) < MIN_AGE_YEARS_FOR_SELF_ACCOUNT;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async signup(dto: SignupDto, ctx: { ip?: string; userAgent?: string }) {
    if (!dto.acceptTerms || !dto.acceptPrivacy) {
      throw new BadRequestException('You must accept the Terms and Privacy Policy to continue.');
    }
    if (!validatePasswordStrength(dto.password)) throw new BadRequestException(PASSWORD_RULES);
    const mobile = normaliseMobile(dto.mobile);
    if (!mobile) throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
    const dob = new Date(dto.dateOfBirth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new BadRequestException('Enter a valid date of birth.');

    const [terms, privacy] = await Promise.all([
      this.findDisclosure('TERMS', dto.termsVersion, dto.locale),
      this.findDisclosure('PRIVACY', dto.privacyVersion, dto.locale),
    ]);
    if (!terms || !privacy) {
      throw new BadRequestException('Legal documents are not available. Please try again later.');
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { mobile }] },
      select: { id: true },
    });
    if (existing) throw new ConflictException('An account with these details may already exist. Try logging in.');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        mobile,
        fullName: dto.fullName.trim(),
        dateOfBirth: dob,
        passwordHash: await hashPassword(dto.password),
        locale: dto.locale,
        role: Role.INVESTOR,
        consents: {
          create: [terms, privacy].map((d) => ({
            disclosureId: d.id,
            accepted: true,
            locale: dto.locale,
            ipHash: ctx.ip ? sha256(ctx.ip) : null,
            userAgent: ctx.userAgent?.slice(0, 200) ?? null,
          })),
        },
      },
    });
    await this.sendEmailOtp(user, OtpPurpose.EMAIL_VERIFY, 'Verify your TechArtha email');
    return {
      message: 'Account created. Enter the code we emailed to verify your address.',
      requiresGuardian: isMinor(dob), // minor/guardian onboarding is enforced in Phase 2 before any investing
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const res = await this.otp.verify({ destination: dto.email, purpose: OtpPurpose.EMAIL_VERIFY, code: dto.code });
    if (!res.ok || !res.userId) throw new BadRequestException('Invalid or expired code.');
    await this.prisma.user.update({ where: { id: res.userId }, data: { emailVerifiedAt: new Date() } });
    return { message: 'Email verified. You can now log in.' };
  }

  async resendEmailVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      await this.sendEmailOtp(user, OtpPurpose.EMAIL_VERIFY, 'Verify your TechArtha email').catch(() => undefined);
    }
    return { message: GENERIC_OTP_MESSAGE };
  }

  async login(dto: LoginDto, ctx: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const bad = () => new UnauthorizedException('Incorrect email or password.');
    if (!user || user.status !== 'ACTIVE') {
      // Equalise timing a little for unknown accounts.
      await hashPassword(dto.password).catch(() => undefined);
      throw bad();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Too many attempts. Try again in a few minutes.');
    }
    if (!(await verifyPassword(user.passwordHash, dto.password))) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLogins: failed },
      });
      throw bad();
    }
    if (!user.emailVerifiedAt) throw new ForbiddenException('Please verify your email before logging in.');
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    return this.issueTokens(user, randomUUID(), ctx);
  }

  /** Rotating refresh tokens with reuse detection: replaying a rotated token revokes the whole family. */
  async refresh(rawToken: string, ctx: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!row) throw new UnauthorizedException('Session expired. Please log in again.');
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    if (row.expiresAt <= new Date() || row.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    const pair = await this.issueTokens(row.user, row.familyId, ctx);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedBy: sha256(pair.refreshToken) },
    });
    return pair;
  }

  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out.' };
  }

  // ---- Forgot password: email -> 6-digit OTP -> verify -> reset ----

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user && user.status === 'ACTIVE') {
      // Errors (cooldown etc.) are swallowed so the response never reveals registration status.
      await this.sendEmailOtp(user, OtpPurpose.PASSWORD_RESET, 'Your TechArtha password reset code').catch(() => undefined);
    }
    return { message: GENERIC_OTP_MESSAGE };
  }

  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const res = await this.otp.verify({ destination: dto.email, purpose: OtpPurpose.PASSWORD_RESET, code: dto.code });
    if (!res.ok || !res.userId) throw new BadRequestException('Invalid or expired code.');
    // Short-lived, purpose-bound, single-use authorisation. Signed with a dedicated secret, never the login JWT secret.
    const resetToken = await this.jwt.signAsync(
      { sub: res.userId, purpose: 'password-reset', cid: res.challengeId },
      { secret: this.cfg.resetSecret, expiresIn: RESET_TOKEN_TTL },
    );
    return { resetToken };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (!validatePasswordStrength(dto.newPassword)) throw new BadRequestException(PASSWORD_RULES);
    let payload: { sub: string; purpose: string; cid: string };
    try {
      payload = await this.jwt.verifyAsync(dto.resetToken, { secret: this.cfg.resetSecret });
    } catch {
      throw new BadRequestException('Reset session expired. Please start again.');
    }
    if (payload.purpose !== 'password-reset') throw new BadRequestException('Reset session expired. Please start again.');

    // Single-use: atomically mark the challenge's reset authorisation as used.
    const claimed = await this.prisma.otpChallenge.updateMany({
      where: { id: payload.cid, userId: payload.sub, purpose: OtpPurpose.PASSWORD_RESET, resetUsedAt: null },
      data: { resetUsedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BadRequestException('Reset session expired. Please start again.');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: payload.sub },
        data: { passwordHash: await hashPassword(dto.newPassword), failedLogins: 0, lockedUntil: null },
      }),
      // Invalidate outstanding reset OTPs and every active session.
      this.prisma.otpChallenge.updateMany({
        where: { userId: payload.sub, purpose: OtpPurpose.PASSWORD_RESET, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password updated. Please log in.' };
  }

  // ---- helpers ----

  private findDisclosure(kind: string, version: string, locale: string) {
    return this.prisma.disclosureVersion
      .findFirst({ where: { kind, version, locale } })
      .then((d) => d ?? this.prisma.disclosureVersion.findFirst({ where: { kind, version, locale: 'en' } }));
  }

  private async sendEmailOtp(user: User, purpose: OtpPurpose, subject: string) {
    const { code } = await this.otp.issue({
      userId: user.id,
      purpose,
      channel: OtpChannel.EMAIL,
      destination: user.email,
    });
    const result = await this.email.send({
      to: user.email,
      subject,
      text: `Your TechArtha verification code is ${code}. It expires in 5 minutes. Never share this code with anyone — TechArtha will never ask for it.`,
    });
    if (!result.accepted) throw new Error(`Email provider rejected OTP for ${maskEmail(user.email)}`);
  }

  private async issueTokens(user: User, familyId: string, ctx: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: this.cfg.accessSecret, expiresIn: this.cfg.accessTtl },
    );
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.cfg.refreshTtlDays * 86_400_000),
        userAgent: ctx.userAgent?.slice(0, 200) ?? null,
        ipHash: ctx.ip ? sha256(ctx.ip) : null,
      },
    });
    return { accessToken, refreshToken, expiresIn: this.cfg.accessTtl };
  }
}
