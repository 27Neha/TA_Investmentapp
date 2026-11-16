import { Lifecycle, Rule } from './lifecycle';

/** Payment status only. Mandate/SIP status lives in mandate.ts and is deliberately a different type. */
export const PAYMENT_STATES = ['CREATED', 'INITIATED', 'PROCESSING', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];
export type PaymentEvent =
  | 'PROVIDER_ACCEPTED' // provider created the payment/order and returned a reference
  | 'CLIENT_RETURNED' // user came back from the provider page: a hint to re-check, never proof of payment
  | 'PROVIDER_PROCESSING'
  | 'PROVIDER_PENDING'
  | 'PROVIDER_CONFIRMED_SUCCESS'
  | 'PROVIDER_CONFIRMED_FAILURE'
  | 'USER_CANCELLED'
  | 'EXPIRED';

const P = 'PROVIDER_VERIFIED' as const, C = 'CLIENT' as const, S = 'SYSTEM' as const;
const open: PaymentState[] = ['CREATED', 'INITIATED', 'PROCESSING', 'PENDING'];

const rules: Rule<PaymentState, PaymentEvent>[] = [
  { from: ['CREATED'], event: 'PROVIDER_ACCEPTED', to: 'INITIATED', sources: [P] },
  { from: ['INITIATED', 'PROCESSING', 'PENDING'], event: 'CLIENT_RETURNED', to: 'PENDING', sources: [C] }, // never SUCCESS
  { from: ['INITIATED', 'PENDING'], event: 'PROVIDER_PROCESSING', to: 'PROCESSING', sources: [P] },
  { from: ['INITIATED', 'PROCESSING'], event: 'PROVIDER_PENDING', to: 'PENDING', sources: [P] },
  { from: ['INITIATED', 'PROCESSING', 'PENDING'], event: 'PROVIDER_CONFIRMED_SUCCESS', to: 'SUCCESS', sources: [P] },
  { from: open, event: 'PROVIDER_CONFIRMED_FAILURE', to: 'FAILED', sources: [P] },
  { from: ['CREATED', 'INITIATED', 'PENDING'], event: 'USER_CANCELLED', to: 'CANCELLED', sources: [C, S] },
  { from: open, event: 'EXPIRED', to: 'EXPIRED', sources: [S, P] },
];

export const paymentLifecycle = new Lifecycle<PaymentState, PaymentEvent>(rules, ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED']);
/** Retry creates a NEW payment attempt (new idempotency key); a terminal payment is never reopened. */
export const canRetry = (s: PaymentState) => s === 'FAILED' || s === 'EXPIRED' || s === 'CANCELLED';
/** Holdings, portfolio and receipts may only be produced from this state. */
export const countsAsPaid = (s: PaymentState) => s === 'SUCCESS';
