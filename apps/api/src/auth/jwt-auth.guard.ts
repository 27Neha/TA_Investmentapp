import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  sub: string;
  /** Always the CURRENT role from the database, never the (possibly stale) claim in the token. */
  role: Role;
  /** Session id: the refresh-token family this access token belongs to. */
  fid: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), { secret: this.cfg.accessSecret });
    } catch {
      throw new UnauthorizedException();
    }
    // A signed token is not enough: the session must still be live and the user ACTIVE. One indexed lookup
    // (User primary key + RefreshToken.familyId index) makes logout, revoke-all, password change, refresh-token reuse
    // detection, suspension and role changes take effect immediately instead of after the 15-minute token lifetime.
    // Tokens without a session id (issued before this check existed) are refused; clients transparently refresh.
    if (typeof payload.fid !== 'string' || !payload.sub) throw new UnauthorizedException();
    const live = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        status: 'ACTIVE',
        refreshTokens: { some: { familyId: payload.fid, revokedAt: null, expiresAt: { gt: new Date() } } },
      },
      select: { role: true },
    });
    if (!live) throw new UnauthorizedException();
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (required?.length && !required.includes(live.role)) throw new UnauthorizedException();
    req.user = { sub: payload.sub, role: live.role, fid: payload.fid } satisfies AuthUser;
    return true;
  }
}
