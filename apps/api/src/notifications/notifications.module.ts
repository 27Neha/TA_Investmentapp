import { Inject, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmailService } from './email.provider';
import { InteraktWhatsApp } from './interakt.adapter';
import { loadApprovals, SMS_PORT, UnconfiguredMessaging, WHATSAPP_PORT } from './messaging';
import { MessagingWebhookController } from './messaging-webhook.controller';
import { NOTIFY_APPROVALS, NotificationService } from './notification.service';
import { ZeptoMailWebhookController } from './zeptomail-webhook.controller';

const isProd = () => process.env.NODE_ENV === 'production';

@Module({
  controllers: [ZeptoMailWebhookController, MessagingWebhookController],
  providers: [
    EmailService, NotificationService,
    { provide: NOTIFY_APPROVALS, useFactory: () => loadApprovals(process.env, isProd()) },
    // No SMS provider has been chosen: the SMS channel stays "not configured" (and DLT-gated) until an adapter is added.
    { provide: SMS_PORT, useFactory: () => new UnconfiguredMessaging('SMS') },
    { provide: WHATSAPP_PORT, useFactory: () => process.env.INTERAKT_API_KEY ? new InteraktWhatsApp({ apiKey: process.env.INTERAKT_API_KEY, baseUrl: process.env.INTERAKT_API_BASE || undefined, webhookSecret: process.env.INTERAKT_WEBHOOK_SECRET || undefined }) : new UnconfiguredMessaging('WHATSAPP') },
  ],
  exports: [EmailService, NotificationService],
})
export class NotificationsModule implements OnModuleInit, OnModuleDestroy {
  private t?: NodeJS.Timeout;
  constructor(@Inject(NotificationService) private readonly n: NotificationService) {}
  /** Delivery worker: off under test and when NOTIFY_WORKER=off. A no-op while no channel is configured. */
  onModuleInit() { if (process.env.NODE_ENV === 'test' || process.env.NOTIFY_WORKER === 'off') return; this.t = setInterval(() => this.n.process().catch(() => undefined), 30_000); this.t.unref?.(); }
  onModuleDestroy() { if (this.t) clearInterval(this.t); }
}
