# Investment journey: suitability and scheme Riskometer

**Status: implemented and tested locally. Real transactions remain OFF.** Nothing here places, simulates or confirms a financial transaction.

## What exists
- `GET /v1/me/suitability/:schemeCode` compares the user's server-scored `ta-risk-v1` profile with the scheme's published Riskometer level. Result: `CONSISTENT | ABOVE_PROFILE | ABOVE_CAPACITY | UNKNOWN` plus the reasons. It is a comparison, never advice (`note: NOT_A_RECOMMENDATION`).
- `UNKNOWN` (never a guess) when there is no assessment, the assessment is over 365 days old, or the scheme level is missing or stale (> 62 days).
- Order gating (`POST /v1/me/payments`, `POST /v1/me/sips`): `UNKNOWN` is refused (403 with reasons); a mismatch needs `acknowledgeRisk: true` (otherwise 409 `RISK_ACK_REQUIRED`) and an audit event `INVEST_RISK_MISMATCH_ACK` is written. This happens after the existing investing gate (provider, KYC, flags), which is still closed without Cybrilla.
- Mobile: fund detail and the invest screen show the scheme level, the user's band, the status text and a required acknowledgement checkbox for mismatches. English text only until human review.

## Scheme Riskometer data (you must supply it)
The app holds no verified scheme riskometer data and will not invent any. Set `SCHEME_RISKOMETER_FILE` to a JSON file:
```json
{ "source": "AMC monthly portfolio disclosure, <month year>", "asOf": "2026-10-31", "schemes": { "119551": "MODERATELY_HIGH", "120503": "VERY_HIGH" } }
```
Levels: `LOW, LOW_TO_MODERATE, MODERATE, MODERATELY_HIGH, HIGH, VERY_HIGH` (SEBI six-level riskometer). Keys are AMFI scheme codes. Source it from the AMC/AMFI monthly disclosures. In production a malformed file stops startup; unset means every scheme is `UNKNOWN` and investing is blocked.

## Policy table (draft, NOT approved)
Band -> maximum scheme level and the capacity cut-off are policy `ta-suit-v1` in `apps/api/src/risk/engine/ta-risk-v1.ts`. `policyReviewed` is always `false` until compliance signs it off; the UI says so.

## Still blocked
Payment, mandate, SIP and order execution need Cybrilla sandbox access, credentials, documentation and compliance approval. The API, state machines and UI are built and tested against fakes only.
