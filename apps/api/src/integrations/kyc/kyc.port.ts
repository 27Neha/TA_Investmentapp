export type KycKind = 'PAN' | 'AADHAAR' | 'DIGILOCKER' | 'CKYC';
export const KYC_KINDS: KycKind[] = ['PAN', 'AADHAAR', 'DIGILOCKER', 'CKYC'];

export interface KycSubject { fullName: string; dateOfBirth: string /* YYYY-MM-DD */; pan?: string }
export interface KycProviderResult {
  provider: string; eventId: string; providerRef: string; kind: KycKind;
  outcome: 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  /** Details as the PROVIDER returned them, used only for the name/DOB comparison. Never stored in full. */
  verifiedName?: string; verifiedDob?: string; maskedIdentifier?: string; failureCode?: string; reason?: string; occurredAt: Date;
}
export class KycNotConfiguredError extends Error { readonly code = 'KYC_PROVIDER_NOT_CONFIGURED'; constructor(op: string) { super(`${op} is unavailable: no KYC provider is configured.`); } }
export class KycWebhookRejectedError extends Error { readonly code = 'WEBHOOK_REJECTED'; constructor(why: string) { super(`KYC webhook rejected: ${why}`); } }

/**
 * Provider-independent KYC boundary. No real adapter exists: authorized PAN/Aadhaar/DigiLocker/CKYC access needs onboarding,
 * credentials and documentation that have not been supplied. The default binding fails closed and reports "not connected".
 * Rules every adapter must follow: never return or store Aadhaar numbers/OTPs; never mark success without an authenticated provider response.
 */
export interface KycProvider {
  readonly name: string;
  readonly environment: 'sandbox' | 'production' | 'none';
  isConnected(): boolean;
  /** Which verification kinds this provider is authorised and onboarded for. */
  capabilities(): Record<KycKind, boolean>;
  start(i: { kind: KycKind; attemptId: string; consentRef: string; subject: KycSubject }): Promise<{ providerRef: string; redirectUrl?: string }>;
  getResult(providerRef: string): Promise<KycProviderResult | null>;
  verifyAndNormalizeWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): KycProviderResult[];
}
export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

export class UnconfiguredKycProvider implements KycProvider {
  readonly name = 'none'; readonly environment = 'none' as const;
  isConnected() { return false; }
  capabilities() { return { PAN: false, AADHAAR: false, DIGILOCKER: false, CKYC: false }; }
  async start(): Promise<never> { throw new KycNotConfiguredError('Identity verification'); }
  async getResult(): Promise<never> { throw new KycNotConfiguredError('Verification status'); }
  verifyAndNormalizeWebhook(): never { throw new KycNotConfiguredError('KYC webhook verification'); }
}
