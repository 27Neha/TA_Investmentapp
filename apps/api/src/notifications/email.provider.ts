import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../common/config';
import { maskEmail } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface EmailMessage { to: string; subject: string; text: string }
export interface EmailMeta { userId?: string | null; purpose: string }
export interface EmailResult {
  /** Provider ACCEPTED the request. This is NOT proof of inbox delivery — that only comes from provider callbacks. */
  accepted: boolean;
  providerMessageId?: string;
  attempts: number;
  errorCode?: string;
}

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly prisma: PrismaService) {}

  async send(msg: EmailMessage, meta: EmailMeta): Promise<EmailResult> {
    const result = this.cfg.emailProvider === 'console' ? this.sendConsole(msg) : await this.sendZeptoMail(msg);
    await this.prisma.emailLog
      .create({
        data: {
          userId: meta.userId ?? null,
          purpose: meta.purpose,
          toMasked: maskEmail(msg.to),
          provider: this.cfg.emailProvider,
          providerMessageId: result.providerMessageId,
          status: result.accepted ? 'ACCEPTED' : 'FAILED',
          errorCode: result.errorCode,
          attempts: result.attempts,
        },
      })
      .catch(() => this.log.error('Could not write EmailLog row')); // logging must never break the flow
    return result;
  }

  /** Development only (config forbids this provider in production). Bodies contain OTPs, so they are never logged in any other mode. */
  private sendConsole(msg: EmailMessage): EmailResult {
    if (!this.cfg.isProd) this.log.warn(`[DEV EMAIL] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return { accepted: true, attempts: 1 };
  }

  /** Retries timeouts, network errors, 429 and 5xx with backoff. Never retries other 4xx (bad request/auth). Never logs bodies or tokens. */
  private async sendZeptoMail(msg: EmailMessage): Promise<EmailResult> {
    const token = this.cfg.zeptoToken!.startsWith('Zoho-enczapikey') ? this.cfg.zeptoToken! : `Zoho-enczapikey ${this.cfg.zeptoToken}`;
    let attempt = 0;
    let lastCode = 'UNKNOWN';
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      try {
        const res = await fetch(`${this.cfg.zeptoBase}/v1.1/email`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: token },
          body: JSON.stringify({
            from: { address: this.cfg.emailFromAddress, name: this.cfg.emailFromName },
            to: [{ email_address: { address: msg.to } }],
            subject: msg.subject,
            textbody: msg.text,
          }),
          signal: AbortSignal.timeout(this.cfg.emailTimeoutMs),
        });
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { request_id?: string };
          return { accepted: true, providerMessageId: body.request_id, attempts: attempt };
        }
        lastCode = `HTTP_${res.status}`;
        if (res.status !== 429 && res.status < 500) break; // permanent rejection
      } catch (e) {
        lastCode = (e as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';
      }
      if (attempt < MAX_ATTEMPTS) await sleep(this.cfg.emailRetryBaseMs * 2 ** (attempt - 1));
    }
    this.log.error(`Email provider failure code=${lastCode} attempts=${attempt}`);
    return { accepted: false, attempts: attempt, errorCode: lastCode };
  }
}
