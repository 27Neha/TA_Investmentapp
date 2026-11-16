import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlagsService } from '../flags/flags.service';
import { GoalsService } from '../goals/goals.service';
import { MeService } from '../me/me.service';
import { PrismaService } from '../prisma/prisma.service';

const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me')
export class HomeController {
  constructor(private readonly prisma: PrismaService, private readonly me: MeService, private readonly goals: GoalsService, private readonly flags: FlagsService) {}

  /** Aggregated Home data. Everything is real or explicitly absent: no placeholder figures. */
  @Get('home') async home(@Req() r: Request) {
    const id = uid(r);
    const [profile, onboarding, goals, learn] = await Promise.all([
      this.me.me(id), this.me.onboarding(id), this.goals.list(id),
      this.prisma.contentItem.findMany({ where: { publishedAt: { lte: new Date() }, locale: 'en' }, orderBy: { publishedAt: 'desc' }, take: 3 }),
    ]);
    const nearest = goals[0];
    return {
      firstName: profile.fullName.split(' ')[0],
      onboarding: { nextStep: onboarding.nextStep, kycStatus: onboarding.kyc.status },
      goals: { count: goals.length, nearest: nearest ? { id: nearest.id, name: nearest.name, targetDate: nearest.targetDate, onTrack: nearest.plan.onTrack, monthsLeft: nearest.plan.monthsLeft } : null },
      portfolio: { connected: false },
      learn: learn.map((c) => ({ slug: c.slug, title: c.title, summary: c.summary, readMinutes: c.readMinutes, reviewed: Boolean(c.reviewedBy) })),
    };
  }

  /** Holdings come only from the transaction provider (Cybrilla, M4). Until it is connected and the user is verified there is nothing to show — and we say so. */
  @Get('portfolio') async portfolio(@Req() r: Request) {
    const id = uid(r);
    const [kyc, live] = await Promise.all([this.me.kyc(id), this.flags.isEnabled('investing.live')]);
    const reason = kyc.status !== 'VERIFIED' ? 'KYC_NOT_VERIFIED' : !live ? 'INVESTING_DISABLED' : 'PROVIDER_NOT_CONNECTED';
    return { connected: false, reason, holdings: [], totalValue: null, investingEnabled: false };
  }
}
