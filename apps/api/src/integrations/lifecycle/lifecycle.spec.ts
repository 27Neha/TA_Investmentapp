import { canRetry, countsAsPaid, PAYMENT_STATES, paymentLifecycle, PaymentEvent, PaymentState } from './payment';
import { MANDATE_STATES, mandateLifecycle, MandateEvent, MandateState, sipLifecycle } from './mandate';
import { EventSource } from './lifecycle';

const at = new Date('2026-11-16T00:00:00Z');
const pay = (s: PaymentState, type: PaymentEvent, source: EventSource) => paymentLifecycle.next(s, { type, source, at });
const man = (s: MandateState, type: MandateEvent, source: EventSource) => mandateLifecycle.next(s, { type, source, at });

describe('payment lifecycle', () => {
  it('happy path only advances through provider-verified events', () => {
    expect(pay('CREATED', 'PROVIDER_ACCEPTED', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'APPLIED', to: 'INITIATED' });
    expect(pay('INITIATED', 'PROVIDER_PROCESSING', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'PROCESSING' });
    expect(pay('PROCESSING', 'PROVIDER_CONFIRMED_SUCCESS', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'APPLIED', to: 'SUCCESS' });
  });
  it('a client redirect/return can never produce SUCCESS, from any state', () => {
    for (const s of PAYMENT_STATES) {
      expect(pay(s, 'PROVIDER_CONFIRMED_SUCCESS', 'CLIENT').outcome).not.toBe('APPLIED');
      expect(pay(s, 'PROVIDER_CONFIRMED_SUCCESS', 'SYSTEM').outcome).not.toBe('APPLIED');
    }
    expect(pay('INITIATED', 'CLIENT_RETURNED', 'CLIENT')).toMatchObject({ outcome: 'APPLIED', to: 'PENDING' });
    expect(countsAsPaid('PENDING')).toBe(false);
  });
  it('duplicate provider callbacks are idempotent no-ops', () => {
    expect(pay('SUCCESS', 'PROVIDER_CONFIRMED_SUCCESS', 'PROVIDER_VERIFIED')).toEqual({ outcome: 'NOOP_DUPLICATE', state: 'SUCCESS' });
    expect(pay('FAILED', 'PROVIDER_CONFIRMED_FAILURE', 'PROVIDER_VERIFIED')).toEqual({ outcome: 'NOOP_DUPLICATE', state: 'FAILED' });
    expect(pay('PENDING', 'PROVIDER_PENDING', 'PROVIDER_VERIFIED').outcome).toBe('REJECTED'); // PENDING is not a terminal state: re-sending is not special-cased
  });
  it('terminal states never change; conflicting terminal events are flagged, not applied', () => {
    expect(pay('FAILED', 'PROVIDER_CONFIRMED_SUCCESS', 'PROVIDER_VERIFIED')).toEqual({ outcome: 'CONFLICT', state: 'FAILED', attempted: 'SUCCESS' });
    expect(pay('SUCCESS', 'PROVIDER_CONFIRMED_FAILURE', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'CONFLICT' });
    expect(pay('SUCCESS', 'USER_CANCELLED', 'CLIENT')).toMatchObject({ outcome: 'CONFLICT' });
    expect(pay('CANCELLED', 'PROVIDER_PROCESSING', 'PROVIDER_VERIFIED').outcome).toBe('REJECTED');
  });
  it('pending, failure, cancellation, expiry and retry rules', () => {
    expect(pay('PROCESSING', 'PROVIDER_PENDING', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'PENDING' });
    expect(pay('PENDING', 'PROVIDER_CONFIRMED_FAILURE', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'FAILED' });
    expect(pay('PENDING', 'USER_CANCELLED', 'CLIENT')).toMatchObject({ to: 'CANCELLED' });
    expect(pay('PROCESSING', 'USER_CANCELLED', 'CLIENT')).toMatchObject({ outcome: 'REJECTED' }); // cannot cancel once the provider is processing
    expect(pay('PENDING', 'EXPIRED', 'SYSTEM')).toMatchObject({ to: 'EXPIRED' });
    expect(['FAILED', 'EXPIRED', 'CANCELLED'].every((s) => canRetry(s as PaymentState))).toBe(true);
    expect(canRetry('SUCCESS')).toBe(false);
  });
  it('unknown/illegal events are rejected', () => {
    expect(pay('CREATED', 'PROVIDER_CONFIRMED_SUCCESS', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'REJECTED', code: 'ILLEGAL_TRANSITION' });
    expect(pay('CREATED', 'PROVIDER_ACCEPTED', 'CLIENT')).toMatchObject({ outcome: 'REJECTED', code: 'SOURCE_NOT_ALLOWED' });
  });
});

describe('mandate lifecycle (separate from payments)', () => {
  it('opening the authorization URL or returning from it never activates a mandate', () => {
    expect(man('AUTHORIZATION_REQUIRED', 'AUTH_URL_OPENED', 'CLIENT')).toMatchObject({ to: 'PROCESSING' });
    expect(man('PROCESSING', 'CLIENT_RETURNED', 'CLIENT')).toMatchObject({ to: 'PENDING' });
    for (const s of MANDATE_STATES) {
      expect(man(s, 'PROVIDER_CONFIRMED_ACTIVE', 'CLIENT').outcome).not.toBe('APPLIED');
      expect(man(s, 'PROVIDER_CONFIRMED_ACTIVE', 'SYSTEM').outcome).not.toBe('APPLIED');
    }
  });
  it('provider-verified path: created -> authorization -> pending -> active', () => {
    expect(man('CREATED', 'PROVIDER_CREATED', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'AUTHORIZATION_REQUIRED' });
    expect(man('PROCESSING', 'PROVIDER_PENDING', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'PENDING' });
    expect(man('PENDING', 'PROVIDER_CONFIRMED_ACTIVE', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'APPLIED', to: 'ACTIVE' });
  });
  it('rejected / failed / cancelled / expired are terminal; duplicates are no-ops; conflicts flagged', () => {
    expect(man('PENDING', 'PROVIDER_REJECTED', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'REJECTED' });
    expect(man('REJECTED', 'PROVIDER_REJECTED', 'PROVIDER_VERIFIED').outcome).toBe('NOOP_DUPLICATE');
    expect(man('REJECTED', 'PROVIDER_CONFIRMED_ACTIVE', 'PROVIDER_VERIFIED').outcome).toBe('REJECTED'); // ACTIVE is not terminal so not a conflict; still not allowed
    expect(man('CANCELLED', 'PROVIDER_FAILED', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'CONFLICT' });
    expect(man('PENDING', 'EXPIRED', 'SYSTEM')).toMatchObject({ to: 'EXPIRED' });
  });
  it('cancellation: local only before provider registration; an active mandate needs provider confirmation', () => {
    expect(man('AUTHORIZATION_REQUIRED', 'USER_CANCEL_REQUESTED', 'CLIENT')).toMatchObject({ to: 'CANCELLED' });
    expect(man('ACTIVE', 'USER_CANCEL_REQUESTED', 'CLIENT').outcome).toBe('REJECTED');
    expect(man('ACTIVE', 'PROVIDER_CANCELLED', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'CANCELLED' });
  });
});

describe('SIP lifecycle is driven by verified mandate status', () => {
  const sip = (s: any, type: any, source: EventSource) => sipLifecycle.next(s, { type, source, at });
  it('activates only from a provider-verified active mandate', () => {
    expect(sip('DRAFT', 'SUBMIT', 'CLIENT')).toMatchObject({ to: 'AWAITING_MANDATE' });
    expect(sip('AWAITING_MANDATE', 'MANDATE_ACTIVE_VERIFIED', 'CLIENT').outcome).toBe('REJECTED');
    expect(sip('AWAITING_MANDATE', 'MANDATE_ACTIVE_VERIFIED', 'SYSTEM').outcome).toBe('REJECTED');
    expect(sip('AWAITING_MANDATE', 'MANDATE_ACTIVE_VERIFIED', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'ACTIVE' });
    expect(sip('DRAFT', 'MANDATE_ACTIVE_VERIFIED', 'PROVIDER_VERIFIED').outcome).toBe('REJECTED');
  });
  it('cancel and end are terminal', () => {
    expect(sip('ACTIVE', 'USER_CANCEL', 'CLIENT')).toMatchObject({ to: 'CANCELLED' });
    expect(sip('CANCELLED', 'USER_CANCEL', 'CLIENT').outcome).toBe('NOOP_DUPLICATE');
  });
});
