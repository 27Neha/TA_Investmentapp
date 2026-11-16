import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../common/config';
import { generateOtp, hmacOtp, safeEqualHex } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_HOUR = 5;

export type VerifyResult = { ok: true; challengeId: string; userId: string | null } | { ok: false };

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Creates a challenge and returns the raw code ONCE so the caller can deliver it. Only a hash is stored. */
  async issue(params: {
    userId: string | null;
    purpose: OtpPurpose;
    channel: OtpChannel;
    destination: string;
    now?: Date;
  }): Promise<{ challengeId: string; code: string }> {
    const now = params.now ?? new Date();
    const latest = await this.prisma.otpChallenge.findFirst({
      where: { destination: params.destination, purpose: params.purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.resendAfter > now) {
      throw new HttpException('Please wait before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const recent = await this.prisma.otpChallenge.count({
      where: {
        destination: params.destination,
        purpose: params.purpose,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    if (recent >= OTP_MAX_PER_HOUR) {
      throw new HttpException('Too many code requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // Invalidate any outstanding challenge for the same destination+purpose.
    await this.prisma.otpChallenge.updateMany({
      where: { destination: params.destination, purpose: params.purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    const code = generateOtp(6);
    const created = await this.prisma.otpChallenge.create({
      data: {
        userId: params.userId,
        purpose: params.purpose,
        channel: params.channel,
        destination: params.destination,
        codeHash: 'pending',
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        resendAfter: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
        maxAttempts: OTP_MAX_ATTEMPTS,
      },
    });
    await this.prisma.otpChallenge.update({
      where: { id: created.id },
      data: { codeHash: hmacOtp(this.cfg.otpHmacSecret, created.id, code) },
    });
    return { challengeId: created.id, code };
  }

  /** Single-use verification with bounded attempts. */
  async verify(params: {
    destination: string;
    purpose: OtpPurpose;
    code: string;
    now?: Date;
  }): Promise<VerifyResult> {
    const now = params.now ?? new Date();
    const ch = await this.prisma.otpChallenge.findFirst({
      where: { destination: params.destination, purpose: params.purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!ch || ch.expiresAt <= now || ch.attempts >= ch.maxAttempts) return { ok: false };

    const expected = hmacOtp(this.cfg.otpHmacSecret, ch.id, params.code);
    if (!safeEqualHex(expected, ch.codeHash)) {
      await this.prisma.otpChallenge.update({
        where: { id: ch.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false };
    }
    // Atomic consume: only one verifier can win.
    const res = await this.prisma.otpChallenge.updateMany({
      where: { id: ch.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (res.count !== 1) return { ok: false };
    return { ok: true, challengeId: ch.id, userId: ch.userId };
  }

  assertWellFormed(code: string) {
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('Enter the 6-digit code.');
  }
}
