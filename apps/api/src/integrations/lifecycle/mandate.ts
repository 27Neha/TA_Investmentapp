import { Lifecycle, Rule } from './lifecycle';

export const MANDATE_STATES = ['CREATED', 'AUTHORIZATION_REQUIRED', 'PROCESSING', 'PENDING', 'ACTIVE', 'REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;
export type MandateState = (typeof MANDATE_STATES)[number];
export type MandateEvent =
  | 'PROVIDER_CREATED'
  | 'AUTH_URL_OPENED' // client opened the authorization page: NOT activation
  | 'CLIENT_RETURNED' // client came back: a hint to re-check only
  | 'PROVIDER_PROCESSING'
  | 'PROVIDER_PENDING'
  | 'PROVIDER_CONFIRMED_ACTIVE'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_FAILED'
  | 'USER_CANCEL_REQUESTED'
  | 'PROVIDER_CANCELLED'
  | 'EXPIRED';

const P = 'PROVIDER_VERIFIED' as const, C = 'CLIENT' as const, S = 'SYSTEM' as const;
const open: MandateState[] = ['CREATED', 'AUTHORIZATION_REQUIRED', 'PROCESSING', 'PENDING'];

const rules: Rule<MandateState, MandateEvent>[] = [
  { from: ['CREATED'], event: 'PROVIDER_CREATED', to: 'AUTHORIZATION_REQUIRED', sources: [P] },
  { from: ['AUTHORIZATION_REQUIRED'], event: 'AUTH_URL_OPENED', to: 'PROCESSING', sources: [C] },
  { from: ['AUTHORIZATION_REQUIRED', 'PROCESSING', 'PENDING'], event: 'CLIENT_RETURNED', to: 'PENDING', sources: [C] },
  { from: ['AUTHORIZATION_REQUIRED', 'PENDING'], event: 'PROVIDER_PROCESSING', to: 'PROCESSING', sources: [P] },
  { from: ['AUTHORIZATION_REQUIRED', 'PROCESSING'], event: 'PROVIDER_PENDING', to: 'PENDING', sources: [P] },
  { from: ['AUTHORIZATION_REQUIRED', 'PROCESSING', 'PENDING'], event: 'PROVIDER_CONFIRMED_ACTIVE', to: 'ACTIVE', sources: [P] },
  { from: open, event: 'PROVIDER_REJECTED', to: 'REJECTED', sources: [P] },
  { from: open, event: 'PROVIDER_FAILED', to: 'FAILED', sources: [P] },
  // Cancellation is requested by the user but only final once the provider confirms (an ACTIVE mandate needs provider cancellation).
  { from: ['CREATED', 'AUTHORIZATION_REQUIRED', 'PENDING', 'ACTIVE'], event: 'PROVIDER_CANCELLED', to: 'CANCELLED', sources: [P] },
  { from: ['CREATED', 'AUTHORIZATION_REQUIRED'], event: 'USER_CANCEL_REQUESTED', to: 'CANCELLED', sources: [C, S] }, // nothing registered with the provider yet
  { from: open, event: 'EXPIRED', to: 'EXPIRED', sources: [S, P] },
];

// ACTIVE is not terminal: a live mandate can later be cancelled or expire at the provider.
export const mandateLifecycle = new Lifecycle<MandateState, MandateEvent>(rules, ['REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED']);

export const SIP_STATES = ['DRAFT', 'AWAITING_MANDATE', 'ACTIVE', 'PAUSED', 'CANCELLED', 'ENDED'] as const;
export type SipState = (typeof SIP_STATES)[number];
export type SipEvent = 'SUBMIT' | 'MANDATE_ACTIVE_VERIFIED' | 'MANDATE_ENDED_VERIFIED' | 'PROVIDER_PAUSED' | 'PROVIDER_RESUMED' | 'USER_CANCEL' | 'COMPLETED';

const sipRules: Rule<SipState, SipEvent>[] = [
  { from: ['DRAFT'], event: 'SUBMIT', to: 'AWAITING_MANDATE', sources: [C, S] },
  // A SIP becomes ACTIVE only from a PROVIDER-VERIFIED active mandate; never from a redirect or user action.
  { from: ['AWAITING_MANDATE'], event: 'MANDATE_ACTIVE_VERIFIED', to: 'ACTIVE', sources: [P] },
  { from: ['ACTIVE'], event: 'PROVIDER_PAUSED', to: 'PAUSED', sources: [P] },
  { from: ['PAUSED'], event: 'PROVIDER_RESUMED', to: 'ACTIVE', sources: [P] },
  { from: ['DRAFT', 'AWAITING_MANDATE', 'ACTIVE', 'PAUSED'], event: 'USER_CANCEL', to: 'CANCELLED', sources: [C, S, P] },
  { from: ['ACTIVE', 'PAUSED', 'AWAITING_MANDATE'], event: 'MANDATE_ENDED_VERIFIED', to: 'ENDED', sources: [P] },
  { from: ['ACTIVE'], event: 'COMPLETED', to: 'ENDED', sources: [P, S] },
];
export const sipLifecycle = new Lifecycle<SipState, SipEvent>(sipRules, ['CANCELLED', 'ENDED']);
