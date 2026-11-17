# Migration `20261120000000_kyc_verification` — proposal (NOT applied to Supabase)

Status: generated and applied **only to disposable local PostgreSQL** (fresh apply of all 7 migrations = 50 tables; rollback → 47; re-apply OK). Supabase/production application needs your separate approval after reviewing the SQL and confirming backup/PITR. SQL: `apps/api/prisma/migrations/20261120000000_kyc_verification/migration.sql`; rollback: `apps/api/prisma/rollback/20261120000000_kyc_verification.down.sql`.

## What it adds (additive only)
- `KycConsent` — purpose-specific consent (PAN, Aadhaar, DigiLocker, CKYC) with version and revoke time. Rows are never deleted by revoke.
- `KycVerificationAttempt` — one attempt per verification: status TEXT + CHECK, provider reference, **masked identifier only**, mismatch flags, timestamps. CHECK: `VERIFIED` requires `providerRef` and `providerConfirmedAt`. One open attempt per user and kind (unique key column). Terminal-status trigger.
- `KycAttemptEvent` — append-only audit history (trigger-enforced).
- `KycStatus` enum gains `MANUAL_REVIEW` and `EXPIRED` (appended; PostgreSQL cannot drop enum values, so rollback leaves them, harmless).
- `ProviderWebhookEvent.provider` CHECK gains `'kyc'`.
- RLS enabled with no policies (same posture as all tables). User FKs are `RESTRICT` so evidence cannot be erased by deleting a user.

## Deliberately absent
No column can hold an Aadhaar number, Aadhaar OTP, password or token (a test asserts this). Raw provider payloads are not stored.

## Behaviour that needs your / compliance decisions
- Per-user status follows the **PAN** attempt: VERIFIED only after a provider-verified PAN match (or a reviewer approval of a flagged mismatch). Whether Aadhaar/DigiLocker/CKYC are also required is a compliance decision.
- Reviewer approval of a name/DOB mismatch is behind flag `kyc.admin_approval` (default OFF) and requires provider evidence.
- Consent wording is a draft (`kyc-consent-draft-1`); legal text approval is pending, English only.
- Retention periods are not decided and no deletion/anonymisation job exists.

## Not verified
No KYC provider is connected. Nothing here is live; tests use a test-only fake. Real PAN/Aadhaar/DigiLocker/CKYC behaviour is unverified until a provider is onboarded.
