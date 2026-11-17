import { Lifecycle, Rule } from './lifecycle';

/** State of ONE verification attempt. "NOT_STARTED" is the absence of any attempt. A user is never VERIFIED because of anything the client did. */
export const KYC_STATES = ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED', 'EXPIRED', 'MANUAL_REVIEW'] as const;
export type KycState = (typeof KYC_STATES)[number];
export type KycEvent =
  | 'PROVIDER_ACCEPTED' // provider created the session and returned its reference
  | 'PROVIDER_VERIFIED_MATCH' // provider verified the identity and it matches what the user submitted
  | 'PROVIDER_VERIFIED_MISMATCH' // provider verified a document but name/DOB differ -> human review
  | 'PROVIDER_REJECTED'
  | 'EXPIRED'
  | 'USER_CANCELLED'
  | 'ADMIN_APPROVE' // reviewer accepts a flagged mismatch (service additionally requires provider evidence + a feature flag)
  | 'ADMIN_REJECT';

const P = 'PROVIDER_VERIFIED' as const, C = 'CLIENT' as const, S = 'SYSTEM' as const, A = 'ADMIN' as const;
const open: KycState[] = ['PENDING', 'IN_PROGRESS'];
const rules: Rule<KycState, KycEvent>[] = [
  { from: ['PENDING'], event: 'PROVIDER_ACCEPTED', to: 'IN_PROGRESS', sources: [P] },
  { from: open, event: 'PROVIDER_VERIFIED_MATCH', to: 'VERIFIED', sources: [P] },
  { from: open, event: 'PROVIDER_VERIFIED_MISMATCH', to: 'MANUAL_REVIEW', sources: [P] },
  { from: open, event: 'PROVIDER_REJECTED', to: 'REJECTED', sources: [P] },
  { from: open, event: 'EXPIRED', to: 'EXPIRED', sources: [S, P] },
  { from: open, event: 'USER_CANCELLED', to: 'EXPIRED', sources: [C] },
  { from: ['MANUAL_REVIEW'], event: 'ADMIN_APPROVE', to: 'VERIFIED', sources: [A] },
  { from: ['MANUAL_REVIEW'], event: 'ADMIN_REJECT', to: 'REJECTED', sources: [A] },
];
export const kycLifecycle = new Lifecycle<KycState, KycEvent>(rules, ['VERIFIED', 'REJECTED', 'EXPIRED']);
