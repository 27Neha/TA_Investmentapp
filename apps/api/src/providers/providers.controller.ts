import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard, Roles } from '../auth/jwt-auth.guard';
import { APP_CONFIG, AppConfig } from '../common/config';

/** Read-only provider configuration checklist: reports what is configured, never secret values. */
@Controller('v1/admin/providers')
@UseGuards(JwtAuthGuard)
export class ProvidersController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Roles(Role.ADMIN, Role.OPERATIONS, Role.COMPLIANCE) @Get()
  status() {
    const has = (k: string) => Boolean(process.env[k]);
    return {
      environment: this.cfg.nodeEnv,
      providers: [
        { key: 'email', provider: this.cfg.emailProvider, configured: this.cfg.emailProvider !== 'console', note: 'Verify sender domain + delivery webhooks' },
        { key: 'cybrilla', env: process.env.CYBRILLA_ENV ?? 'sandbox', configured: has('CYBRILLA_CLIENT_ID') && has('CYBRILLA_CLIENT_SECRET') && has('CYBRILLA_TENANT_ID'), webhookSecretSet: has('CYBRILLA_WEBHOOK_SECRET'), note: 'Live investing remains flagged off' },
        { key: 'interakt', configured: has('INTERAKT_API_KEY') && has('INTERAKT_OTP_TEMPLATE_NAME'), note: 'Needs approved template + webhook' },
        { key: 'mtalkz', configured: has('MTALKZ_API_KEY') },
      ],
    };
  }
}
