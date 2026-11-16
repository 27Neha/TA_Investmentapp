import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CHALLENGES, QUIZZES } from './quizzes';

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/** Learning is educational only: scores, streaks and badges. Nothing here is linked to money, investing or rewards. */
@Injectable()
export class LearnService {
  constructor(private readonly prisma: PrismaService) {}

  /** Consecutive days with learning activity, counted back from today (or yesterday if today has none yet). */
  static streak(days: string[], today = new Date()): { current: number; longest: number } {
    const set = new Set(days);
    let cur = 0;
    const d = new Date(`${dayStr(today)}T00:00:00Z`);
    if (!set.has(dayStr(d))) d.setUTCDate(d.getUTCDate() - 1);
    while (set.has(dayStr(d))) { cur++; d.setUTCDate(d.getUTCDate() - 1); }
    const sorted = [...set].sort();
    let longest = 0, run = 0, prev: string | null = null;
    for (const s of sorted) {
      run = prev && Date.parse(`${s}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === 86_400_000 ? run + 1 : 1;
      longest = Math.max(longest, run); prev = s;
    }
    return { current: cur, longest };
  }

  private async markToday(uid: string) {
    await this.prisma.learnDay.upsert({ where: { userId_day: { userId: uid, day: new Date(`${dayStr(new Date())}T00:00:00Z`) } }, create: { userId: uid, day: new Date(`${dayStr(new Date())}T00:00:00Z`) }, update: {} });
  }

  async overview(uid: string) {
    const [prog, days] = await Promise.all([this.prisma.learnProgress.findMany({ where: { userId: uid } }), this.prisma.learnDay.findMany({ where: { userId: uid } })]);
    const best = (key: string) => { const r = prog.filter((p) => p.activityKey === key); if (!r.length) return null; const top = r.reduce((a, b) => (b.score / b.total > a.score / a.total ? b : a)); return { score: top.score, total: top.total, attempts: r.length }; };
    const streak = LearnService.streak(days.map((d) => dayStr(d.day)));
    const quizzes = QUIZZES.map((q) => ({ id: q.id, title: q.title, description: q.description, questionCount: q.questions.length, best: best(q.id) }));
    const badges = [
      { id: 'FIRST_QUIZ', title: 'First quiz completed', earned: prog.some((p) => QUIZZES.some((q) => q.id === p.activityKey)) },
      { id: 'PERFECT_SCORE', title: 'Perfect score', earned: prog.some((p) => p.score === p.total && QUIZZES.some((q) => q.id === p.activityKey)) },
      { id: 'ALL_QUIZZES', title: 'Tried every quiz', earned: QUIZZES.every((q) => prog.some((p) => p.activityKey === q.id)) },
      { id: 'STREAK_3', title: '3-day learning streak', earned: streak.longest >= 3 },
      { id: 'STREAK_7', title: '7-day learning streak', earned: streak.longest >= 7 },
    ];
    return { quizzes, challenges: CHALLENGES.map((c) => ({ ...c, completed: prog.filter((p) => p.activityKey === c.id).length })), streak, badges, note: 'Learning is for education only. There are no cash rewards and nothing here is linked to investing.', reviewed: false };
  }

  quiz(id: string) {
    const q = QUIZZES.find((x) => x.id === id);
    if (!q) throw new NotFoundException('Quiz not found.');
    return { id: q.id, title: q.title, description: q.description, questions: q.questions.map((x) => ({ q: x.q, options: x.options })) };
  }

  async submit(uid: string, id: string, answers: number[]) {
    const q = QUIZZES.find((x) => x.id === id);
    if (!q) throw new NotFoundException('Quiz not found.');
    if (!Array.isArray(answers) || answers.length !== q.questions.length || answers.some((a, i) => !Number.isInteger(a) || a < 0 || a >= q.questions[i].options.length)) throw new BadRequestException('Answer every question with a valid option.');
    const results = q.questions.map((x, i) => ({ correct: answers[i] === x.answer, correctIndex: x.answer, yourIndex: answers[i], explanation: x.explain }));
    const score = results.filter((r) => r.correct).length;
    await this.prisma.learnProgress.create({ data: { userId: uid, activityKey: id, score, total: q.questions.length } });
    await this.markToday(uid);
    return { score, total: q.questions.length, results };
  }

  /** Records completion of a client-side calculator challenge. Only whitelisted keys; no outcome is rewarded. */
  async recordChallenge(uid: string, key: string, score: number, total: number) {
    if (!CHALLENGES.some((c) => c.id === key)) throw new NotFoundException('Challenge not found.');
    if (!Number.isInteger(score) || !Number.isInteger(total) || total < 1 || total > 10 || score < 0 || score > total) throw new BadRequestException('Invalid result.');
    await this.prisma.learnProgress.create({ data: { userId: uid, activityKey: key, score, total } });
    await this.markToday(uid);
    return { recorded: true };
  }
}
