/**
 * Pure lifecycle (state machine) engine for payments, mandates and SIP plans. No I/O, no provider calls.
 *
 * Core safety rules enforced here and covered by tests:
 *  - A client-originated signal (redirect return, "I paid", authorization URL opened) can NEVER move an item to a
 *    success state. Success states are reachable only through events whose source is PROVIDER_VERIFIED
 *    (an authenticated provider response or a signature-verified webhook).
 *  - Terminal states never change. A repeated identical event is an idempotent no-op; a conflicting terminal event is
 *    reported as a conflict (for reconciliation) and is NOT applied.
 */
export type EventSource = 'CLIENT' | 'SYSTEM' | 'PROVIDER_VERIFIED' | 'ADMIN';

export interface LifecycleEvent<E extends string> {
  type: E;
  source: EventSource;
  /** Provider's own event/transaction reference, when relevant. Never fabricated by us. */
  providerRef?: string;
  reason?: string;
  at: Date;
}

export interface Rule<S extends string, E extends string> { from: S[]; event: E; to: S; sources: EventSource[] }

export type TransitionResult<S extends string> =
  | { outcome: 'APPLIED'; from: S; to: S }
  | { outcome: 'NOOP_DUPLICATE'; state: S }
  | { outcome: 'REJECTED'; state: S; code: 'ILLEGAL_TRANSITION' | 'SOURCE_NOT_ALLOWED' }
  | { outcome: 'CONFLICT'; state: S; attempted: S };

export class Lifecycle<S extends string, E extends string> {
  constructor(private readonly rules: Rule<S, E>[], private readonly terminal: S[]) {}

  isTerminal(s: S) { return this.terminal.includes(s); }

  next(current: S, ev: LifecycleEvent<E>): TransitionResult<S> {
    const candidates = this.rules.filter((r) => r.event === ev.type);
    if (candidates.length === 0) return { outcome: 'REJECTED', state: current, code: 'ILLEGAL_TRANSITION' };
    const target = candidates[0].to;
    // Same terminal outcome again (duplicate callback) -> idempotent no-op, regardless of who sends it.
    if (this.isTerminal(current) && current === target) return { outcome: 'NOOP_DUPLICATE', state: current };
    const rule = candidates.find((r) => r.from.includes(current));
    if (!rule) {
      // A different terminal outcome arriving after we are already terminal is a conflict to reconcile, never applied.
      if (this.isTerminal(current) && this.isTerminal(target)) return { outcome: 'CONFLICT', state: current, attempted: target };
      return { outcome: 'REJECTED', state: current, code: 'ILLEGAL_TRANSITION' };
    }
    if (!rule.sources.includes(ev.source)) return { outcome: 'REJECTED', state: current, code: 'SOURCE_NOT_ALLOWED' };
    if (current === rule.to) return { outcome: 'NOOP_DUPLICATE', state: current };
    return { outcome: 'APPLIED', from: current, to: rule.to };
  }
}
