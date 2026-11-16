import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadConfig } from '../common/config';
import { hashPassword } from '../common/password';
import { sha256 } from '../common/crypto';
import { AuthService, GENERIC_OTP_MESSAGE, MAX_FAILED_LOGINS } from './auth.service';

const cfg = loadConfig({ NODE_ENV: 'test' } as any);
const jwt = new JwtService({});

function setup(user: any | null, extra: any = {}) {
  const prisma: any = {
    user: { findUnique: jest.fn(async () => user), update: jest.fn(async () => user), findFirst: jest.fn(async () => null) },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    otpChallenge: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    ...extra,
  };
  const otp: any = { issue: jest.fn(async () => ({ code: '123456', challengeId: 'c1' })), verify: jest.fn() };
  const email: any = { send: jest.fn(async () => ({ accepted: true })) };
  return { svc: new AuthService(prisma, jwt, otp, email, cfg), prisma, otp, email };
}

const activeUser = async (over: any = {}) => ({
  id: 'u1', email: 'a@b.com', status: 'ACTIVE', role: 'INVESTOR', failedLogins: 0, lockedUntil: null,
  emailVerifiedAt: new Date(), passwordHash: await hashPassword('Correct#Horse9'), ...over,
});

describe('AuthService.login', () => {
  it('logs in and returns tokens', async () => {
    const { svc, prisma } = setup(await activeUser());
    const t = await svc.login({ email: 'a@b.com', password: 'Correct#Horse9' }, {});
    expect(t.accessToken).toBeTruthy();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    // raw refresh token is never stored
    expect(JSON.stringify(prisma.refreshToken.create.mock.calls)).not.toContain(t.refreshToken);
  });
  it('same error for unknown user and wrong password', async () => {
    const a = await setup(null).svc.login({ email: 'x@y.com', password: 'whatever' }, {}).catch((e) => e);
    const b = await setup(await activeUser()).svc.login({ email: 'a@b.com', password: 'wrong' }, {}).catch((e) => e);
    expect(a).toBeInstanceOf(UnauthorizedException);
    expect(b.message).toBe(a.message);
  });
  it('locks account after repeated failures', async () => {
    const { svc, prisma } = setup(await activeUser({ failedLogins: MAX_FAILED_LOGINS - 1 }));
    await expect(svc.login({ email: 'a@b.com', password: 'nope' }, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update.mock.calls[0][0].data.lockedUntil).toBeInstanceOf(Date);
  });
  it('refuses while locked', async () => {
    const { svc } = setup(await activeUser({ lockedUntil: new Date(Date.now() + 60000) }));
    await expect(svc.login({ email: 'a@b.com', password: 'Correct#Horse9' }, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires verified email', async () => {
    const { svc } = setup(await activeUser({ emailVerifiedAt: null }));
    await expect(svc.login({ email: 'a@b.com', password: 'Correct#Horse9' }, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuthService.forgotPassword', () => {
  it('returns the identical generic response for registered and unknown emails', async () => {
    const known = await setup(await activeUser()).svc.forgotPassword({ email: 'a@b.com' });
    const unknown = await setup(null).svc.forgotPassword({ email: 'no@one.com' });
    expect(known).toEqual(unknown);
    expect(known.message).toBe(GENERIC_OTP_MESSAGE);
  });
  it('only sends mail for real accounts', async () => {
    const s = setup(null);
    await s.svc.forgotPassword({ email: 'no@one.com' });
    expect(s.email.send).not.toHaveBeenCalled();
  });
  it('swallows cooldown errors so status is not leaked', async () => {
    const s = setup(await activeUser());
    s.otp.issue.mockRejectedValueOnce(new Error('cooldown'));
    await expect(s.svc.forgotPassword({ email: 'a@b.com' })).resolves.toEqual({ message: GENERIC_OTP_MESSAGE });
  });
});

describe('password reset', () => {
  it('verify -> reset updates password, kills sessions, and the token is single-use', async () => {
    const s = setup(await activeUser());
    s.otp.verify.mockResolvedValue({ ok: true, challengeId: 'c1', userId: 'u1' });
    const { resetToken } = await s.svc.verifyResetOtp({ email: 'a@b.com', code: '123456' });

    s.prisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(s.svc.resetPassword({ resetToken, newPassword: 'Brand#NewPass1' })).resolves.toBeDefined();
    expect(s.prisma.refreshToken.updateMany).toHaveBeenCalled(); // sessions revoked

    s.prisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 }); // already claimed
    await expect(s.svc.resetPassword({ resetToken, newPassword: 'Brand#NewPass1' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects a normal access token as reset authorisation', async () => {
    const s = setup(await activeUser());
    const access = await jwt.signAsync({ sub: 'u1', role: 'INVESTOR' }, { secret: cfg.accessSecret });
    await expect(s.svc.resetPassword({ resetToken: access, newPassword: 'Brand#NewPass1' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects weak new passwords', async () => {
    const s = setup(await activeUser());
    await expect(s.svc.resetPassword({ resetToken: 'x', newPassword: 'weak' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects invalid OTP', async () => {
    const s = setup(await activeUser());
    s.otp.verify.mockResolvedValue({ ok: false });
    await expect(s.svc.verifyResetOtp({ email: 'a@b.com', code: '000000' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('refresh token rotation', () => {
  it('replaying a rotated token revokes the whole family', async () => {
    const s = setup(null);
    s.prisma.refreshToken.findUnique.mockResolvedValue({ id: 'r1', familyId: 'f1', revokedAt: new Date(), user: { status: 'ACTIVE' } });
    await expect(s.svc.refresh('stolen', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(s.prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: 'f1', revokedAt: null } }));
  });
  it('rotates a valid token', async () => {
    const u = await activeUser();
    const s = setup(u);
    s.prisma.refreshToken.findUnique.mockResolvedValue({ id: 'r1', familyId: 'f1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: u });
    const pair = await s.svc.refresh('good', {});
    expect(s.prisma.refreshToken.update.mock.calls[0][0].data.replacedBy).toBe(sha256(pair.refreshToken));
  });
});
