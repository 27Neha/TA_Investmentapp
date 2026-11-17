import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Regulated / unfinished capabilities. All default to OFF; enabling requires an admin + audit entry. */
export const DEFAULT_FLAGS: Record<string, string> = {
  'investing.live': 'Live order placement (needs Cybrilla production access + compliance approval)',
  'investing.sip': 'SIP creation and lifecycle',
  'investing.onetime': 'One-time purchases',
  'minor.accounts': 'Minor / guardian investing',
  'risk.personalised_buckets': 'Assessment-based bucket display (compliance review required)',
  'assistant.llm': 'AI assistant answers beyond approved help content',
  'guardian.accounts': 'Guardian invite/link/permission actions (compliance approval required before enabling in production; financial actions stay disabled regardless)',
  'kyc.admin_approval': 'Reviewer may approve a flagged name/DOB mismatch on top of a provider-verified document (compliance decision required)',
  'support.whatsapp_inbox': 'WhatsApp two-way inbox (needs verified webhook)',
};

@Injectable()
export class FlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string): Promise<boolean> {
    const f = await this.prisma.featureFlag.findUnique({ where: { key } });
    return f?.enabled ?? false;
  }

  async list() {
    const rows = await this.prisma.featureFlag.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return Object.entries(DEFAULT_FLAGS).map(([key, description]) => ({
      key, description, enabled: byKey.get(key)?.enabled ?? false,
    }));
  }

  async set(key: string, enabled: boolean, actorId: string) {
    if (!(key in DEFAULT_FLAGS)) throw new Error('Unknown flag');
    await this.prisma.$transaction([
      this.prisma.featureFlag.upsert({
        where: { key },
        update: { enabled, updatedBy: actorId },
        create: { key, enabled, updatedBy: actorId, description: DEFAULT_FLAGS[key] },
      }),
      this.prisma.adminAuditEvent.create({
        data: { actorId, action: 'FLAG_SET', entityType: 'FeatureFlag', entityId: key, metadata: { enabled } },
      }),
    ]);
    return { key, enabled };
  }
}
