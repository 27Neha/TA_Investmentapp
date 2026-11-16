import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoalDto } from './dto';
import { monthsBetween, planGoal } from './goal-math';

const MAX_GOALS = 20;
const NOTE = 'Illustrative only. Assumes a constant annual return that you chose; it is not a forecast or a promise. Mutual fund investments are subject to market risks.';

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
  constructor(private readonly prisma: PrismaService) {}

  private view(g: any) {
    const months = monthsBetween(new Date(), g.targetDate);
    const plan = planGoal({ targetAmount: Number(g.targetAmount), currentSavings: Number(g.currentSavings), monthlyContribution: Number(g.monthlyContribution), expectedReturnPct: Number(g.expectedReturnPct), monthsLeft: months });
    return {
      id: g.id, name: g.name, type: g.type, status: g.status, targetAmount: Number(g.targetAmount), currentSavings: Number(g.currentSavings), monthlyContribution: Number(g.monthlyContribution),
      expectedReturnPct: Number(g.expectedReturnPct), targetDate: g.targetDate.toISOString().slice(0, 10), plan, note: NOTE,
    };
  }

  async list(uid: string) {
    const rows = await this.prisma.goal.findMany({ where: { userId: uid, status: 'ACTIVE' }, orderBy: { targetDate: 'asc' } });
    return rows.map((g) => this.view(g));
  }
  async get(uid: string, id: string) {
    const g = await this.prisma.goal.findFirst({ where: { id, userId: uid, status: 'ACTIVE' } });
    if (!g) throw new NotFoundException('Goal not found.');
    return this.view(g);
  }
  async create(uid: string, dto: GoalDto) {
    const date = parseTarget(dto.targetDate);
    if ((await this.prisma.goal.count({ where: { userId: uid, status: 'ACTIVE' } })) >= MAX_GOALS) throw new BadRequestException(`You can have up to ${MAX_GOALS} goals.`);
    const g = await this.prisma.goal.create({ data: { userId: uid, name: dto.name, type: dto.type, targetAmount: dto.targetAmount, currentSavings: dto.currentSavings, monthlyContribution: dto.monthlyContribution, expectedReturnPct: dto.expectedReturnPct, targetDate: date } });
    return this.view(g);
  }
  async update(uid: string, id: string, dto: GoalDto) {
    const date = parseTarget(dto.targetDate);
    const r = await this.prisma.goal.updateMany({ where: { id, userId: uid, status: 'ACTIVE' }, data: { name: dto.name, type: dto.type, targetAmount: dto.targetAmount, currentSavings: dto.currentSavings, monthlyContribution: dto.monthlyContribution, expectedReturnPct: dto.expectedReturnPct, targetDate: date } });
    if (!r.count) throw new NotFoundException('Goal not found.');
    return this.get(uid, id);
  }
  async remove(uid: string, id: string) {
    const r = await this.prisma.goal.updateMany({ where: { id, userId: uid, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
    if (!r.count) throw new NotFoundException('Goal not found.');
    return { removed: true };
  }
}
