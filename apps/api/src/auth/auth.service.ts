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
export const STAFF_SESSION_MS = 8 * 60 * 60 * 1000; // admin/staff sessions expire after 8h
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
    // Account + consent are already committed. If delivery fails the user recovers via "Resend code" — never a dead end.
    const emailSent = await this.sendEmailOtp(user, OtpPurpose.EMAIL_VERIFY, 'Verify your TechArtha email').then(() => true, () => false);
    return {
      message: emailSent
        ? 'Account created. Enter the code we emailed to verify your address.'
        : 'Account created, but we could not send the email just now. Tap "Resend code" to try again.',
      emailSent,
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
      // Atomic increment: concurrent wrong guesses cannot undercount.
      const upd = await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
      if (upd.failedLogins >= MAX_FAILED_LOGINS) {
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } });
      }
      throw bad();
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ message: 'Please verify your email before logging in.', code: 'EMAIL_NOT_VERIFIED' });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    if (user.role !== Role.INVESTOR) {
      await this.prisma.adminAuditEvent.create({ data: { actorId: user.id, action: 'STAFF_LOGIN', ipHash: ctx.ip ? sha256(ctx.ip) : null } }).catch(() => undefined);
    }
    return this.issueTokens(user, randomUUID(), ctx);
  }

  /** Rotating refresh tokens with reuse detection. The old token is claimed ATOMICALLY first, so two concurrent
   *  refreshes can never both succeed; a replay of a rotated token revokes the whole family. */
  async refresh(rawToken: string, ctx: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const expired = () => new UnauthorizedException('Session expired. Please log in again.');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
    if (!row) throw expired();
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw expired();
    }
    if (row.expiresAt <= new Date() || row.user.status !== 'ACTIVE') throw expired();
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw expired();
    }
    const pair = await this.issueTokens(row.user, row.familyId, ctx);
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { replacedBy: sha256(pair.refreshToken) } });
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

    const passwordHash = await hashPassword(dto.newPassword);
    // Claim + password update + session revocation are ONE transaction. Single-use still holds (the claim is atomic),
    // but if anything fails after the claim, the whole thing rolls back and the user can retry until the token expires.
    await this.prisma.$transaction(async (tx: any) => {
      const claimed = await tx.otpChallenge.updateMany({
        where: { id: payload.cid, userId: payload.sub, purpose: OtpPurpose.PASSWORD_RESET, resetUsedAt: null },
        data: { resetUsedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException('Reset session expired. Please start again.');
      await tx.user.update({ where: { id: payload.sub }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
      await tx.otpChallenge.updateMany({ where: { userId: payload.sub, purpose: OtpPurpose.PASSWORD_RESET, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.refreshToken.updateMany({ where: { userId: payload.sub, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { message: 'Password updated. Please log in.' };
  }

  // ---- helpers ----

  private findDisclosure(kind: string, version: string, locale: string) {
    return this.prisma.disclosureVersion
      .findFirst({ where: { kind, version, locale } })
      .then((d) => d ?? this.prisma.disclosureVersion.findFirst({ where: { kind, version, locale: 'en' } }));
  }

  private async sendEmailOtp(user: User, purpose: OtpPurpose, subject: string) {
    const { code, challengeId } = await this.otp.issue({
      userId: user.id,
      purpose,
      channel: OtpChannel.EMAIL,
      destination: user.email,
    });
    const result = await this.email.send(
      {
        to: user.email,
        subject,
        text: `Your TechArtha verification code is ${code}. It expires in 5 minutes. Never share this code with anyone — TechArtha will never ask for it.`,
      },
      { userId: user.id, purpose },
    );
    if (!result.accepted) {
      // The user never received this code, so do not make them sit out the resend cooldown.
      await this.prisma.otpChallenge.update({ where: { id: challengeId }, data: { resendAfter: new Date() } }).catch(() => undefined);
      throw new Error(`Email provider rejected OTP for ${maskEmail(user.email)}`);
    }
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
        expiresAt: new Date(Date.now() + (user.role === Role.INVESTOR ? this.cfg.refreshTtlDays * 86_400_000 : STAFF_SESSION_MS)),
        userAgent: ctx.userAgent?.slice(0, 200) ?? null,
        ipHash: ctx.ip ? sha256(ctx.ip) : null,
      },
    });
    return { accessToken, refreshToken, expiresIn: this.cfg.accessTtl };
  }
}
