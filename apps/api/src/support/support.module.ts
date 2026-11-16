import { Module, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { APP_CONFIG, AppConfig } from '../common/config';
import { ATTACHMENT_STORE, createAttachmentStore } from '../integrations/storage/attachment-store';
import { createSupportPort } from '../integrations/support/support.factory';
import { SUPPORT_PORT } from '../integrations/support/support.port';
import { SupportController, SupportWebhookController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AuthModule],
  controllers: [SupportController, SupportWebhookController],
  providers: [
    SupportService,
    { provide: SUPPORT_PORT, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => createSupportPort(process.env, cfg.isProd) }, // default "none": fails closed
    { provide: ATTACHMENT_STORE, useFactory: () => createAttachmentStore(process.env) },
  ],
  exports: [SupportService],
})
export class SupportModule implements OnModuleInit, OnModuleDestroy {
  private t?: NodeJS.Timeout;
  constructor(private readonly s: SupportService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}
  /** Delivery worker: off under test and when SUPPORT_WORKER=off. A no-op until a desk is configured. */
  onModuleInit() { if (process.env.NODE_ENV === 'test' || process.env.SUPPORT_WORKER === 'off') return; this.t = setInterval(() => this.s.processOutbox().catch(() => undefined), 30_000); this.t.unref?.(); }
  onModuleDestroy() { if (this.t) clearInterval(this.t); }
}
