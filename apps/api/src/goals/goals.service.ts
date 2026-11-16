import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../inbox/inbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContributionDto, GoalDto } from './dto';
import { monthsBetween, planGoal } from './goal-math';

const MAX_GOALS = 20;
const NOTE = 'Illustrative only. Assumes a constant annual return that you chose; it is not a forecast or a promise. Mutual fund investments are subject to market risks.';
const round2 = (n: number) => Math.round(n * 100) / 100;

function parseTarget(s: string): Date {
  const d = new Date(s);
  const now = new Date();
  const max = new Date(Date.UTC(now.getUTCFullYear() + 60, now.getUTCMonth(), now.getUTCDate()));
  if (Number.isNaN(d.getTime()) || d <= now || d > max) throw new BadRequestException('Choose a target date in the future, within 60 years.');
  return d;
}

/** Every query is keyed by the authenticated user's id; a goal that belongs to someone else is indistinguishable from one that does not exist (404). */
@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Accumulated = amount the user said they already saved + contributions they have logged. All self-reported: no provider is connected. */
  view(g: any) {
    const logged = (g.contributions ?? []).reduce((s: number, c: any) => s + Number(c.amount), 0);
    const accumulated = round2(Number(g.currentSavings) + logged);
    const months = monthsBetween(new Date(), g.targetDate);
    const inflation = g.inflationPct == null ? null : Number(g.inflationPct);
    const nominal = Number(g.targetAmount);
    const effectiveTarget = inflation ? round2(nominal * Math.pow(1 + inflation / 100, months / 12)) : nominal;
    const plan = planGoal({ targetAmount: effectiveTarget, currentSavings: accumulated, monthlyContribution: Number(g.monthlyContribution), expectedReturnPct: Number(g.expectedReturnPct), monthsLeft: months });
    return {
      id: g.id, name: g.name, type: g.type, status: g.status, targetAmount: nominal, effectiveTarget, inflationPct: inflation, initialSaved: Number(g.currentSavings), loggedContributions: round2(logged),
      accumulated, progressPct: Math.min(100, Math.round((accumulated / effectiveTarget) * 1000) / 10), monthlyContribution: Number(g.monthlyContribution), expectedReturnPct: Number(g.expectedReturnPct),
      targetDate: g.targetDate.toISOString().slice(0, 10), plan, note: NOTE + (inflation ? ' The target is adjusted for the inflation you entered.' : ''), source: 'SELF_REPORTED',
    };
  }

  private include = { contributions: { select: { amount: true } } };

  async list(uid: string, status?: string) {
    const where = status === 'ARCHIVED' ? { status: 'ARCHIVED' } : status === 'PAUSED' || status === 'ACTIVE' ? { status } : { status: { in: ['ACTIVE', 'PAUSED'] } };
    const rows = await this.prisma.goal.findMany({ where: { userId: uid, ...where }, orderBy: { targetDate: 'asc' }, include: this.include });
    return rows.map((g) => this.view(g));
  }
  private async owned(uid: string, id: string, statuses = ['ACTIVE', 'PAUSED']) {
    const g = await this.prisma.goal.findFirst({ where: { id, userId: uid, status: { in: statuses } }, include: this.include });
    if (!g) throw new NotFoundException('Goal not found.');
    return g;
  }
  async get(uid: string, id: string) { return this.view(await this.owned(uid, id, ['ACTIVE', 'PAUSED', 'ARCHIVED'])); }

  async compare(uid: string, ids: string[]) {
    if (ids.length < 2 || ids.length > 4) throw new BadRequestException('Choose 2 to 4 goals to compare.');
    const rows = await this.prisma.goal.findMany({ where: { id: { in: ids }, userId: uid }, include: this.include });
    if (rows.length !== new Set(ids).size) throw new NotFoundException('Goal not found.');
    return ids.map((i) => this.view(rows.find((r) => r.id === i)));
  }

  async create(uid: string, dto: GoalDto) {
    const date = parseTarget(dto.targetDate);
    if ((await this.prisma.goal.count({ where: { userId: uid, status: { in: ['ACTIVE', 'PAUSED'] } } })) >= MAX_GOALS) throw new BadRequestException(`You can have up to ${MAX_GOALS} goals.`);
    const g = await this.prisma.goal.create({ data: { userId: uid, name: dto.name, type: dto.type, targetAmount: dto.targetAmount, currentSavings: dto.currentSavings, monthlyContribution: dto.monthlyContribution, expectedReturnPct: dto.expectedReturnPct, inflationPct: dto.inflationPct ?? null, targetDate: date }, include: this.include });
    await this.audit.record(uid, 'GOAL_CREATED', 'Goal', g.id);
    return this.view(g);
  }
  async update(uid: string, id: string, dto: GoalDto) {
    const date = parseTarget(dto.targetDate);
    const r = await this.prisma.goal.updateMany({ where: { id, userId: uid, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { name: dto.name, type: dto.type, targetAmount: dto.targetAmount, currentSavings: dto.currentSavings, monthlyContribution: dto.monthlyContribution, expectedReturnPct: dto.expectedReturnPct, inflationPct: dto.inflationPct ?? null, targetDate: date } });
    if (!r.count) throw new NotFoundException('Goal not found.');
    return this.get(uid, id);
  }
  private async setStatus(uid: string, id: string, from: string[], to: string, action: string) {
    const r = await this.prisma.goal.updateMany({ where: { id, userId: uid, status: { in: from } }, data: { status: to, pausedAt: to === 'PAUSED' ? new Date() : null } });
    if (!r.count) throw new NotFoundException('Goal not found.');
    await this.audit.record(uid, action, 'Goal', id);
    return this.get(uid, id);
  }
  pause(uid: string, id: string) { return this.setStatus(uid, id, ['ACTIVE'], 'PAUSED', 'GOAL_PAUSED'); }
  resume(uid: string, id: string) { return this.setStatus(uid, id, ['PAUSED', 'ARCHIVED'], 'ACTIVE', 'GOAL_RESUMED'); }
  archive(uid: string, id: string) { return this.setStatus(uid, id, ['ACTIVE', 'PAUSED'], 'ARCHIVED', 'GOAL_ARCHIVED'); }
  /** Permanent. The API demands an explicit confirm flag so an accidental call cannot delete data. */
  async remove(uid: string, id: string, confirm: boolean) {
    if (!confirm) throw new BadRequestException({ message: 'Deleting a goal is permanent. Confirm to continue.', code: 'CONFIRMATION_REQUIRED' });
    const r = await this.prisma.goal.deleteMany({ where: { id, userId: uid } });
    if (!r.count) throw new NotFoundException('Goal not found.');
    await this.audit.record(uid, 'GOAL_DELETED', 'Goal', id);
    return { removed: true };
  }

  // ---- contributions (self-reported log; creates no SIP and moves no money) ----
  async contributions(uid: string, id: string) {
    await this.owned(uid, id, ['ACTIVE', 'PAUSED', 'ARCHIVED']);
    const rows = await this.prisma.goalContribution.findMany({ where: { goalId: id, userId: uid }, orderBy: [{ contributedOn: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return rows.map((c) => ({ id: c.id, amount: Number(c.amount), contributedOn: c.contributedOn.toISOString().slice(0, 10), note: c.note, source: 'SELF_REPORTED' }));
  }
  async addContribution(uid: string, id: string, dto: ContributionDto) {
    await this.owned(uid, id);
    const d = new Date(dto.contributedOn);
    if (Number.isNaN(d.getTime()) || d > new Date()) throw new BadRequestException('Contribution date cannot be in the future.');
    await this.prisma.goalContribution.create({ data: { goalId: id, userId: uid, amount: dto.amount, contributedOn: d, note: dto.note ?? null } });
    return this.get(uid, id);
  }
  async removeContribution(uid: string, id: string, cid: string) {
    const r = await this.prisma.goalContribution.deleteMany({ where: { id: cid, goalId: id, userId: uid } });
    if (!r.count) throw new NotFoundException('Contribution not found.');
    return this.get(uid, id);
  }
  /** Chart data: cumulative accumulated amount over time from the initial amount and logged contributions only. */
  async progressSeries(uid: string, id: string) {
    const g = await this.owned(uid, id, ['ACTIVE', 'PAUSED', 'ARCHIVED']);
    const rows = await this.prisma.goalContribution.findMany({ where: { goalId: id, userId: uid }, orderBy: { contributedOn: 'asc' } });
    let run = Number(g.currentSavings);
    const points = [{ date: g.createdAt.toISOString().slice(0, 10), value: round2(run) }];
    for (const c of rows) { run += Number(c.amount); points.push({ date: c.contributedOn.toISOString().slice(0, 10), value: round2(run) }); }
    return { points, target: Number(g.targetAmount), source: 'SELF_REPORTED' };
  }
}
