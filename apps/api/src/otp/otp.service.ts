import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { randomUUID } from 'crypto';
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

  /** Creates a challenge and returns the raw code ONCE so the caller can deliver it. Only a hash is stored.
   *  Serialised per destination+purpose with an advisory lock so concurrent requests cannot bypass cooldown/caps. */
  async issue(params: {
    userId: string | null;
    purpose: OtpPurpose;
    channel: OtpChannel;
    destination: string;
    now?: Date;
  }): Promise<{ challengeId: string; code: string }> {
    const now = params.now ?? new Date();
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.destination + ':' + params.purpose}))`;
      const latest = await tx.otpChallenge.findFirst({
        where: { destination: params.destination, purpose: params.purpose },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.resendAfter > now) {
        throw new HttpException('Please wait before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
      }
      const recent = await tx.otpChallenge.count({
        where: {
          destination: params.destination,
          purpose: params.purpose,
          createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
        },
      });
      if (recent >= OTP_MAX_PER_HOUR) {
        throw new HttpException('Too many code requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
      await tx.otpChallenge.updateMany({
        where: { destination: params.destination, purpose: params.purpose, consumedAt: null },
        data: { consumedAt: now },
      });
      const id = randomUUID();
      const code = generateOtp(6);
      await tx.otpChallenge.create({
        data: {
          id,
          userId: params.userId,
          purpose: params.purpose,
          channel: params.channel,
          destination: params.destination,
          codeHash: hmacOtp(this.cfg.otpHmacSecret, id, code),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          resendAfter: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
          maxAttempts: OTP_MAX_ATTEMPTS,
          createdAt: now,
        },
      });
      return { challengeId: id, code };
    });
  }

  /** Single-use verification. Every guess first claims an attempt ATOMICALLY (so parallel guesses cannot exceed the limit);
   *  a correct code is then consumed atomically (so only one concurrent verifier can win). */
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
    if (!ch || ch.expiresAt <= now) return { ok: false };

    // Claim an attempt: only succeeds while attempts < maxAttempts, unconsumed and unexpired.
    const claim: { count: number } = await this.prisma.$executeRaw`
      UPDATE "OtpChallenge" SET "attempts" = "attempts" + 1
      WHERE "id" = ${ch.id} AND "consumedAt" IS NULL AND "expiresAt" > ${now} AND "attempts" < "maxAttempts"
    `.then((n: number) => ({ count: n }));
    if (claim.count !== 1) return { ok: false };

    const expected = hmacOtp(this.cfg.otpHmacSecret, ch.id, params.code);
    if (!safeEqualHex(expected, ch.codeHash)) return { ok: false };

    const res = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: now } });
    if (res.count !== 1) return { ok: false };
    return { ok: true, challengeId: ch.id, userId: ch.userId };
  }

  assertWellFormed(code: string) {
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('Enter the 6-digit code.');
  }
}
