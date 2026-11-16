/**
 * Integration boundary for the transaction/KYC provider (Cybrilla / Fintech Primitives).
 * NO Cybrilla endpoint, request shape or auth flow is implemented here because the API documentation and sandbox
 * credentials have not been supplied/verified. Every operation therefore fails closed with PROVIDER_NOT_CONFIGURED.
 * When docs arrive: implement this interface in a CybrillaProvider, verify each call against the sandbox, and only then bind it.
 * Rules the implementation MUST keep: sandbox/production strictly separated; never report success before the provider confirms;
 * verify webhook signatures; never log secrets or raw customer documents.
 */
export interface TransactionProvider {
  readonly name: string;
  readonly environment: 'sandbox' | 'production' | 'none';
  isConnected(): boolean;
  submitKyc(userId: string): Promise<never>;
  verifyBank(userId: string): Promise<never>;
  placeOrder(userId: string, order: unknown): Promise<never>;
  getHoldings(userId: string): Promise<never>;
}

export const TRANSACTION_PROVIDER = Symbol('TRANSACTION_PROVIDER');

export class ProviderNotConfiguredError extends Error {
  readonly code = 'PROVIDER_NOT_CONFIGURED';
  constructor(op: string) { super(`${op} is unavailable: the investment provider is not configured.`); }
}

/** Default binding: explicitly "not connected". Exists so callers have one honest code path instead of ad-hoc stubs. */
export class UnconfiguredProvider implements TransactionProvider {
  readonly name = 'none';
  readonly environment = 'none' as const;
  isConnected() { return false; }
  async submitKyc(): Promise<never> { throw new ProviderNotConfiguredError('KYC submission'); }
  async verifyBank(): Promise<never> { throw new ProviderNotConfiguredError('Bank verification'); }
  async placeOrder(): Promise<never> { throw new ProviderNotConfiguredError('Order placement'); }
  async getHoldings(): Promise<never> { throw new ProviderNotConfiguredError('Holdings'); }
}
