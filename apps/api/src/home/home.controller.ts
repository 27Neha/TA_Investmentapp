import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlagsService } from '../flags/flags.service';
import { GoalsService } from '../goals/goals.service';
import { MeService } from '../me/me.service';
import { RiskService } from '../risk/risk.service';
import { InboxService } from '../inbox/inbox.service';
import { INDEX_PROVIDER, IndexDataProvider, marketHours } from '../market/index.provider';
import { PrismaService } from '../prisma/prisma.service';

const uid = (r: Request) => (r as any).user.sub as string;

@UseGuards(JwtAuthGuard)
@Controller('v1/me')
export class HomeController {
  constructor(private readonly prisma: PrismaService, private readonly me: MeService, private readonly goals: GoalsService, private readonly flags: FlagsService, private readonly risk: RiskService, private readonly inbox: InboxService, @Inject(INDEX_PROVIDER) private readonly idx: IndexDataProvider) {}

  /** Aggregated Home data. Everything is real or explicitly absent: no placeholder figures. */
  @Get('home') async home(@Req() r: Request) {
    const id = uid(r);
    const [profile, onboarding, allGoals, learn, risk, unread, watch, market, lastContrib] = await Promise.all([
      this.me.me(id), this.me.onboarding(id), this.goals.list(id),
      this.prisma.contentItem.findMany({ where: { publishedAt: { lte: new Date() }, locale: 'en' }, orderBy: { publishedAt: 'desc' }, take: 3 }),
      this.risk.status(id), this.inbox.unreadCount(id), this.prisma.watchlistItem.count({ where: { userId: id } }), this.idx.snapshot(),
      this.prisma.goalContribution.findFirst({ where: { userId: id }, orderBy: { contributedOn: 'desc' } }),
    ]);
    const active = allGoals.filter((g) => g.status === 'ACTIVE');
    const nearest = active[0];
    const insights: { key: string; text: string }[] = [];
    if (onboarding.nextStep) insights.push({ key: 'ONBOARDING_INCOMPLETE', text: 'Your profile is not complete yet. Finish it to unlock more of the app.' });
    if (!(risk as any).latest) insights.push({ key: 'RISK_PENDING', text: 'You have not completed a risk assessment yet.' });
    else if ((risk as any).outdated) insights.push({ key: 'RISK_OUTDATED', text: 'Your risk assessment is over a year old. Consider reassessing.' });
    const behind = active.filter((g) => g.plan.onTrack === false);
    if (behind.length) insights.push({ key: 'GOALS_BEHIND', text: `${behind.length} goal${behind.length > 1 ? 's need' : ' needs'} a higher monthly amount to reach the target by the date, based on your own assumptions.` });
    if (active.length && (!lastContrib || Date.now() - lastContrib.contributedOn.getTime() > 30 * 86_400_000)) insights.push({ key: 'NO_RECENT_CONTRIBUTION', text: 'No goal contribution logged in the last 30 days.' });
    return {
      firstName: profile.fullName.split(' ')[0], fullName: profile.fullName,
      onboarding: { nextStep: onboarding.nextStep, kycStatus: onboarding.kyc.status },
      goals: { count: active.length, top: active.slice(0, 3).map((g) => ({ id: g.id, name: g.name, type: g.type, targetDate: g.targetDate, progressPct: g.progressPct, onTrack: g.plan.onTrack, monthsLeft: g.plan.monthsLeft })), nearest: nearest ? { id: nearest.id, name: nearest.name, targetDate: nearest.targetDate, onTrack: nearest.plan.onTrack, monthsLeft: nearest.plan.monthsLeft } : null },
      portfolio: { connected: false, message: 'Portfolio connection pending', summary: null },
      risk,
      notifications: { unread },
      watchlistCount: watch,
      market: { ...market, marketHours: marketHours() },
      insights,
      learn: learn.map((c) => ({ slug: c.slug, title: c.title, summary: c.summary, readMinutes: c.readMinutes, reviewed: Boolean(c.reviewedBy) })),
    };
  }

  /** Holdings come only from the transaction provider (Cybrilla, M4). Until it is connected and the user is verified there is nothing to show — and we say so. */
  @Get('portfolio') async portfolio(@Req() r: Request) {
    const id = uid(r);
    const [kyc, live] = await Promise.all([this.me.kyc(id), this.flags.isEnabled('investing.live')]);
    const reason = kyc.status !== 'VERIFIED' ? 'KYC_NOT_VERIFIED' : !live ? 'INVESTING_DISABLED' : 'PROVIDER_NOT_CONNECTED';
    const snaps = await this.prisma.portfolioSnapshot.findMany({ where: { userId: id }, orderBy: { asOf: 'asc' }, take: 365 });
    return { connected: false, reason, message: 'Portfolio connection pending', holdings: [], totalValue: null, investingEnabled: false, summary: null, allocation: { asset: [], category: [], amc: [] }, growth: snaps.map((x: any) => ({ date: x.asOf, value: Number(x.currentValue), invested: Number(x.invested) })), sections: ['holdings', 'allocation', 'goalLinked', 'transactions', 'folios', 'sips', 'mandates', 'family'] };
  }
}
