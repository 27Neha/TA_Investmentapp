import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../common/config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailResult {
  accepted: boolean; // provider accepted the request — NOT proof of inbox delivery
  providerMessageId?: string;
}

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async send(msg: EmailMessage): Promise<EmailResult> {
    if (this.cfg.emailProvider === 'console') {
      // Development only (blocked in production by config). Never log OTP contents elsewhere.
      this.log.warn(`[DEV EMAIL] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      return { accepted: true };
    }
    const res = await fetch('https://api.zeptomail.in/v1.1/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.cfg.zeptoToken!,
      },
      body: JSON.stringify({
        from: { address: this.cfg.emailFromAddress, name: this.cfg.emailFromName },
        to: [{ email_address: { address: msg.to } }],
        subject: msg.subject,
        textbody: msg.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      this.log.error(`ZeptoMail rejected request: HTTP ${res.status}`);
      return { accepted: false };
    }
    const body = (await res.json().catch(() => ({}))) as { request_id?: string };
    return { accepted: true, providerMessageId: body.request_id };
  }
}
