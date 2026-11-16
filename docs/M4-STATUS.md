# Milestone 4 — Cybrilla sandbox and transaction workflows: BLOCKED (boundary built)

## Why blocked
No Cybrilla/Fintech Primitives API documentation, sandbox credentials or enabled-product list has been provided, and the build sandbox cannot reach `api.sandbox.cybrilla.com` / `s.finprim.com`. Endpoints, request structures, auth flow, webhook signing and product availability would be guesses, which the assignment forbids. **No KYC, bank verification, order, SIP, mandate or holdings call exists.**

## What exists
- `src/investing/transaction.provider.ts`: the `TransactionProvider` interface (submitKyc, verifyBank, placeOrder, getHoldings) and the default `UnconfiguredProvider`, which fails closed with `PROVIDER_NOT_CONFIGURED` for every operation.
- `GET /v1/me/investing/status`: reports `available:false`, provider/environment, flag states, KYC status and exact `blockers` (`PROVIDER_NOT_CONNECTED`, `KYC_NOT_VERIFIED`, `INVESTING_FLAG_OFF`). Tested, including that no order/SIP/purchase routes exist.
- Feature flags `investing.live|sip|onetime` remain OFF. Portfolio/Home already say investing is unavailable.
- Tests: `test/investing.int.spec.ts` (fail-closed provider, status API).

## Needed from you to unblock
1. Cybrilla API documentation (or portal access) for the products you are enabled for; sandbox base URL and credentials (provided through a secret store, rotated — the values pasted earlier must be treated as exposed).
2. Which flows are in scope first (KYC, bank/penny-drop, mandate, lump sum, SIP, holdings) and the webhook signing method.
3. Network egress from wherever integration tests run.

## Implementation rules once unblocked
Implement `CybrillaProvider`, verify each call against the sandbox, bind it in `InvestingModule` by config (sandbox/production never mixed), add webhook signature verification + idempotency, and report an order or KYC as successful only after provider confirmation. Production remains behind `investing.live` and explicit approval.
