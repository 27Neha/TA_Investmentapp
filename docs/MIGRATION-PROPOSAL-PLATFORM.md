# Migration proposal — guardian, support, webhooks/outbox, payments, mandates/SIP, audit (PROPOSAL ONLY)

**Status: nothing created, nothing applied.** No file under `apps/api/prisma/migrations/` was added or changed; no database (Supabase or disposable) was touched for this document. Approval of this proposal is required before (1) the migration is written as a Prisma migration, (2) it is applied to a **disposable** PostgreSQL and tested, and only later (3) considered for Supabase, which needs a separate explicit approval with a backup/PITR point confirmed. It complements `MIGRATION-PROPOSAL-D1-D4.md` (changes to *existing* tables), which is independent of this one.

## 0. Design principles

1. **Additive only.** Every change is a new table, index or constraint on a new table. No existing column or table is altered or dropped, so existing data, endpoints and the current `GuardianLink` data stay valid (backward compatible; the old table is kept until a later approved clean-up).
2. **Money is never guessed.** Amounts are `numeric(14,2)`; every provider-sourced fact (reference ids, statuses, timestamps) is stored as received, in nullable columns that stay NULL until a verified provider event supplies them. No default can represent success.
3. **Append-only history.** State changes are recorded in event tables that the API only inserts into; a database trigger (included below) blocks UPDATE/DELETE on them.
4. **Financial and consent records outlive users.** Foreign keys from financial/guardian/audit tables to `User` are `ON DELETE RESTRICT` (deletion is by anonymisation, see §8). Support tables use `SET NULL` + anonymisation.
5. **Same RLS posture as today.** `ENABLE ROW LEVEL SECURITY` with no policies on every new table (the API connects as the table owner; isolation stays in API code and tests). Item S2 (live RLS audit) remains open and is not changed here.
6. **Status values are CHECK-constrained** from day one (the D2 lesson), so they can't drift.
7. All SQL runs in one transaction per migration; Prisma cannot express CHECKs, partial indexes or triggers, so they ship as hand-written SQL in the migration, and CI's drift check needs to be told about them (to be settled at implementation).

## 1. Guardian accounts and permissions

A guardian is a **normal verified `User`** (own email/mobile OTP, password, S1 session). A guardian never shares credentials with the minor.

```sql
CREATE TABLE "GuardianLinkage" (
  "id"              text PRIMARY KEY,
  "minorUserId"     text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "guardianUserId"  text REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,   -- NULL until the invited guardian registers and verifies
  "guardianContactHash" text NOT NULL,           -- HMAC of the invited email/mobile (never store raw invite target twice)
  "relationship"    text NOT NULL,
  "status"          text NOT NULL DEFAULT 'INVITED',
  "consentVersionId" text,                        -- DisclosureVersion accepted by the guardian
  "consentedAt"     timestamp(3),
  "invitedAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt"     timestamp(3),
  "revokedAt"       timestamp(3),
  "revokedByUserId" text REFERENCES "User"("id") ON DELETE RESTRICT,
  "revokeReason"    text,
  "createdAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuardianLinkage_status_chk" CHECK ("status" IN ('INVITED','ACTIVE','REVOKED','REJECTED','EXPIRED')),
  CONSTRAINT "GuardianLinkage_not_self_chk" CHECK ("guardianUserId" IS NULL OR "guardianUserId" <> "minorUserId"),
  CONSTRAINT "GuardianLinkage_active_chk" CHECK ("status" <> 'ACTIVE' OR ("guardianUserId" IS NOT NULL AND "consentedAt" IS NOT NULL))
);
CREATE INDEX "GuardianLinkage_minor_idx" ON "GuardianLinkage"("minorUserId", "status");
CREATE INDEX "GuardianLinkage_guardian_idx" ON "GuardianLinkage"("guardianUserId", "status");
CREATE UNIQUE INDEX "GuardianLinkage_one_active_pair" ON "GuardianLinkage"("minorUserId", "guardianUserId") WHERE "status" IN ('INVITED','ACTIVE');

CREATE TABLE "GuardianPermission" (
  "id"         text PRIMARY KEY,
  "linkageId"  text NOT NULL REFERENCES "GuardianLinkage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "scope"      text NOT NULL,
  "grantedAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"  timestamp(3),
  CONSTRAINT "GuardianPermission_scope_chk" CHECK ("scope" IN ('VIEW_SUMMARY','VIEW_GOALS','VIEW_PORTFOLIO','VIEW_TRANSACTIONS','MANAGE_PROFILE','TRANSACT'))
);
CREATE UNIQUE INDEX "GuardianPermission_live" ON "GuardianPermission"("linkageId","scope") WHERE "revokedAt" IS NULL;

CREATE TABLE "GuardianAuditEvent" (   -- append-only
  "id" text PRIMARY KEY, "linkageId" text NOT NULL REFERENCES "GuardianLinkage"("id") ON DELETE RESTRICT,
  "actorUserId" text REFERENCES "User"("id") ON DELETE RESTRICT, "action" text NOT NULL,
  "detail" jsonb, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GuardianAuditEvent_linkage_idx" ON "GuardianAuditEvent"("linkageId","createdAt");
```
- **Rules enforced in code (and tested):** no permission is implied by being linked (zero rows = no access); minor data is exposed only for scopes granted and unrevoked; revocation is immediate (the S1 guard-style check reads the linkage on each guardian request); `TRANSACT` is **never enabled in code** until the compliance review below is complete, even though the scope exists in the table.
- **Legacy `GuardianLink`** (name + mobile) is kept untouched; migration of old rows is a later, approved data step (each guardian must register and consent; names are not proof of identity).
- **Compliance review required before any minor-related financial function:** minor/guardian KYC rules for the investor type, who may transact, nominee/guardian roles, age-of-majority transition, DPDP verifiable parental consent, and AMFI/SEBI constraints. Awaiting your adviser; the app keeps minor investing disabled.
- **Data impact:** none on existing rows. **Rollback:** `DROP TABLE "GuardianAuditEvent","GuardianPermission","GuardianLinkage" CASCADE;` (only safe before real linkages exist; afterwards, keep for audit).

## 2. Support tickets and messages

```sql
CREATE TABLE "SupportTicket" (
  "id" text PRIMARY KEY,
  "userId" text REFERENCES "User"("id") ON DELETE SET NULL,
  "onBehalfOfMinorId" text REFERENCES "User"("id") ON DELETE SET NULL,   -- guardian raising a ticket about a linked minor
  "category" text NOT NULL, "priority" text NOT NULL DEFAULT 'MEDIUM',
  "status" text NOT NULL DEFAULT 'SYNC_PENDING',
  "subject" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'APP',
  "externalProvider" text, "externalId" text, "externalNumber" text,      -- Zoho Desk ids, NULL until Desk confirms
  "assigneeName" text, "lastSyncedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "SupportTicket_status_chk" CHECK ("status" IN ('SYNC_PENDING','OPEN','ON_HOLD','ESCALATED','CLOSED','SYNC_FAILED')),
  CONSTRAINT "SupportTicket_priority_chk" CHECK ("priority" IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT "SupportTicket_channel_chk" CHECK ("channel" IN ('APP','EMAIL','WHATSAPP'))
);
CREATE UNIQUE INDEX "SupportTicket_external_uq" ON "SupportTicket"("externalProvider","externalId") WHERE "externalId" IS NOT NULL;
CREATE INDEX "SupportTicket_user_idx" ON "SupportTicket"("userId","updatedAt" DESC);
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status","updatedAt" DESC);

CREATE TABLE "SupportMessage" (
  "id" text PRIMARY KEY, "ticketId" text NOT NULL REFERENCES "SupportTicket"("id") ON DELETE CASCADE,
  "direction" text NOT NULL, "authorType" text NOT NULL, "authorName" text,
  "body" text NOT NULL, "externalThreadId" text, "channel" text NOT NULL DEFAULT 'APP',
  "occurredAt" timestamp(3) NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_direction_chk" CHECK ("direction" IN ('IN','OUT')),
  CONSTRAINT "SupportMessage_author_chk" CHECK ("authorType" IN ('USER','GUARDIAN','AGENT','SYSTEM'))
);
CREATE UNIQUE INDEX "SupportMessage_thread_uq" ON "SupportMessage"("ticketId","externalThreadId") WHERE "externalThreadId" IS NOT NULL;  -- dedupes webhook replays
CREATE INDEX "SupportMessage_ticket_idx" ON "SupportMessage"("ticketId","occurredAt");

CREATE TABLE "SupportAttachment" (
  "id" text PRIMARY KEY, "messageId" text NOT NULL REFERENCES "SupportMessage"("id") ON DELETE CASCADE,
  "fileName" text NOT NULL, "mime" text NOT NULL, "sizeBytes" integer NOT NULL, "sha256" text NOT NULL,
  "storageKey" text, "externalId" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportAttachment_size_chk" CHECK ("sizeBytes" BETWEEN 1 AND 5242880),
  CONSTRAINT "SupportAttachment_mime_chk" CHECK ("mime" IN ('application/pdf','image/png','image/jpeg'))
);
```
- **Privacy:** content never contains PAN/bank/OTP (rejected server-side before storage or sending, see `security/sensitive.ts`). Attachment bytes are not stored in Postgres: only metadata; storage location (Supabase Storage vs Desk only) is a decision for you (open item).
- **Retention:** `userId` is `SET NULL` on user deletion and the anonymisation job blanks `subject/body`; retention period to be set with compliance (support records for disputes vs DPDP erasure).
- **Rollback:** drop the three tables (data loss limited to the mirror; Desk remains the record).

## 3. Provider webhook events and outbox jobs

```sql
CREATE TABLE "ProviderWebhookEvent" (
  "id" text PRIMARY KEY, "provider" text NOT NULL, "eventId" text NOT NULL, "eventType" text NOT NULL,
  "signatureValid" boolean NOT NULL, "payloadHash" text NOT NULL, "payload" jsonb,      -- payload redacted of sensitive fields before storing
  "receivedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" timestamp(3), "outcome" text, "error" text,
  CONSTRAINT "ProviderWebhookEvent_provider_chk" CHECK ("provider" IN ('zoho_desk','zeptomail','cybrilla','interakt','sms'))
);
CREATE UNIQUE INDEX "ProviderWebhookEvent_dedupe" ON "ProviderWebhookEvent"("provider","eventId");   -- duplicate callbacks cannot double-process
CREATE INDEX "ProviderWebhookEvent_pending_idx" ON "ProviderWebhookEvent"("receivedAt") WHERE "processedAt" IS NULL;

CREATE TABLE "OutboxJob" (
  "id" text PRIMARY KEY, "kind" text NOT NULL, "payload" jsonb NOT NULL,
  "idempotencyKey" text NOT NULL, "status" text NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0, "nextRunAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "doneAt" timestamp(3),
  CONSTRAINT "OutboxJob_status_chk" CHECK ("status" IN ('PENDING','RUNNING','DONE','DEAD'))
);
CREATE UNIQUE INDEX "OutboxJob_idem_uq" ON "OutboxJob"("kind","idempotencyKey");
CREATE INDEX "OutboxJob_due_idx" ON "OutboxJob"("nextRunAt") WHERE "status" = 'PENDING';
```
- Workers claim jobs with `SELECT … FOR UPDATE SKIP LOCKED`. Webhook payloads are stored for investigation but sensitive fields are stripped first; retention: purge raw payloads after a set period (proposed 90 days; event id/outcome kept).
- **Rollback:** drop both (outbox must be empty/`DONE`; otherwise queued messages are lost).

## 4. Payments and orders

```sql
CREATE TABLE "InvestmentOrder" (
  "id" text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "actingGuardianLinkageId" text REFERENCES "GuardianLinkage"("id") ON DELETE RESTRICT,
  "schemeCode" text NOT NULL, "schemeName" text NOT NULL,
  "kind" text NOT NULL, "amount" numeric(14,2) NOT NULL,
  "idempotencyKey" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentOrder_kind_chk" CHECK ("kind" IN ('LUMPSUM','SIP_INSTALMENT')),
  CONSTRAINT "InvestmentOrder_amount_chk" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "InvestmentOrder_idem_uq" ON "InvestmentOrder"("userId","idempotencyKey");

CREATE TABLE "Payment" (
  "id" text PRIMARY KEY, "orderId" text NOT NULL REFERENCES "InvestmentOrder"("id") ON DELETE RESTRICT,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "attempt" integer NOT NULL DEFAULT 1,           -- a retry is a NEW row (new idempotency key); terminal rows are never reopened
  "status" text NOT NULL DEFAULT 'CREATED', "method" text,
  "amount" numeric(14,2) NOT NULL, "idempotencyKey" text NOT NULL,
  "providerPaymentRef" text, "providerOrderRef" text,   -- NULL until the provider returns them; never invented
  "providerConfirmedAt" timestamp(3),                    -- set ONLY by a verified provider event
  "failureCode" text, "failureReason" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "Payment_status_chk" CHECK ("status" IN ('CREATED','INITIATED','PROCESSING','PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED')),
  CONSTRAINT "Payment_success_chk" CHECK ("status" <> 'SUCCESS' OR ("providerPaymentRef" IS NOT NULL AND "providerConfirmedAt" IS NOT NULL)),
  CONSTRAINT "Payment_amount_chk" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "Payment_idem_uq" ON "Payment"("userId","idempotencyKey");
CREATE UNIQUE INDEX "Payment_provider_ref_uq" ON "Payment"("providerPaymentRef") WHERE "providerPaymentRef" IS NOT NULL;
CREATE UNIQUE INDEX "Payment_one_open_per_order" ON "Payment"("orderId") WHERE "status" IN ('CREATED','INITIATED','PROCESSING','PENDING');
CREATE INDEX "Payment_user_idx" ON "Payment"("userId","createdAt" DESC);
CREATE INDEX "Payment_reconcile_idx" ON "Payment"("updatedAt") WHERE "status" IN ('INITIATED','PROCESSING','PENDING');

CREATE TABLE "PaymentEvent" (   -- append-only history; includes the webhook event that caused the change
  "id" text PRIMARY KEY, "paymentId" text NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT,
  "fromStatus" text, "toStatus" text NOT NULL, "eventType" text NOT NULL, "source" text NOT NULL,
  "webhookEventId" text REFERENCES "ProviderWebhookEvent"("id"), "reason" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_source_chk" CHECK ("source" IN ('CLIENT','SYSTEM','PROVIDER_VERIFIED'))
);
CREATE INDEX "PaymentEvent_payment_idx" ON "PaymentEvent"("paymentId","createdAt");
```
- `Payment_success_chk` makes a "success" row **impossible to store without** a provider reference and confirmation time. The state machine (`integrations/lifecycle`) is the code-side guard; this is the database-side one.
- Existing `Transaction` (provider-written history) stays as is and is written **only** from a verified payment/provider event.
- **Rollback:** drop in reverse order. Unsafe once real payments exist (financial records must be retained): after go-live these tables are never dropped.

## 5. Mandates and SIP plans

```sql
CREATE TABLE "Mandate" (
  "id" text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "bankAccountId" text, "status" text NOT NULL DEFAULT 'CREATED',
  "maxAmount" numeric(14,2) NOT NULL, "idempotencyKey" text NOT NULL,
  "providerMandateRef" text, "authorizationUrlIssuedAt" timestamp(3),
  "providerConfirmedAt" timestamp(3), "failureCode" text, "failureReason" text,
  "cancelRequestedAt" timestamp(3), "cancelledAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "Mandate_status_chk" CHECK ("status" IN ('CREATED','AUTHORIZATION_REQUIRED','PROCESSING','PENDING','ACTIVE','REJECTED','FAILED','CANCELLED','EXPIRED')),
  CONSTRAINT "Mandate_active_chk" CHECK ("status" <> 'ACTIVE' OR ("providerMandateRef" IS NOT NULL AND "providerConfirmedAt" IS NOT NULL)),
  CONSTRAINT "Mandate_max_chk" CHECK ("maxAmount" > 0)
);
CREATE UNIQUE INDEX "Mandate_idem_uq" ON "Mandate"("userId","idempotencyKey");
CREATE UNIQUE INDEX "Mandate_provider_ref_uq" ON "Mandate"("providerMandateRef") WHERE "providerMandateRef" IS NOT NULL;
CREATE INDEX "Mandate_user_idx" ON "Mandate"("userId","createdAt" DESC);

CREATE TABLE "MandateEvent" (
  "id" text PRIMARY KEY, "mandateId" text NOT NULL REFERENCES "Mandate"("id") ON DELETE RESTRICT,
  "fromStatus" text, "toStatus" text NOT NULL, "eventType" text NOT NULL, "source" text NOT NULL,
  "webhookEventId" text REFERENCES "ProviderWebhookEvent"("id"), "reason" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MandateEvent_source_chk" CHECK ("source" IN ('CLIENT','SYSTEM','PROVIDER_VERIFIED'))
);

CREATE TABLE "SipPlan" (
  "id" text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "mandateId" text REFERENCES "Mandate"("id") ON DELETE RESTRICT,
  "schemeCode" text NOT NULL, "schemeName" text NOT NULL, "amount" numeric(14,2) NOT NULL,
  "frequency" text NOT NULL, "dayOfMonth" integer, "startDate" date NOT NULL, "endDate" date,
  "status" text NOT NULL DEFAULT 'DRAFT', "providerSipRef" text, "idempotencyKey" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "SipPlan_status_chk" CHECK ("status" IN ('DRAFT','AWAITING_MANDATE','ACTIVE','PAUSED','CANCELLED','ENDED')),
  CONSTRAINT "SipPlan_freq_chk" CHECK ("frequency" IN ('MONTHLY','QUARTERLY','WEEKLY')),
  CONSTRAINT "SipPlan_day_chk" CHECK ("dayOfMonth" IS NULL OR "dayOfMonth" BETWEEN 1 AND 28),
  CONSTRAINT "SipPlan_amount_chk" CHECK ("amount" > 0),
  CONSTRAINT "SipPlan_active_chk" CHECK ("status" <> 'ACTIVE' OR ("mandateId" IS NOT NULL AND "providerSipRef" IS NOT NULL))
);
CREATE UNIQUE INDEX "SipPlan_idem_uq" ON "SipPlan"("userId","idempotencyKey");
CREATE INDEX "SipPlan_user_idx" ON "SipPlan"("userId","createdAt" DESC);
CREATE INDEX "SipPlan_mandate_idx" ON "SipPlan"("mandateId");
```
- Payment status and mandate status are **separate tables and types**; a SIP instalment that must be collected creates an `InvestmentOrder(kind='SIP_INSTALMENT')` + `Payment`, never a status on the mandate.
- A DB check cannot verify that the linked mandate is ACTIVE; that cross-row rule is enforced in the service (inside a transaction that locks the mandate) and covered by tests.

## 6. Append-only enforcement and audit history

```sql
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER "PaymentEvent_ro" BEFORE UPDATE OR DELETE ON "PaymentEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- same trigger on MandateEvent, GuardianAuditEvent
```
Financial and guardian actions additionally write to the existing `AuditLog`/`AdminAuditEvent` (actions added in code, no schema change). Tests must truncate through a privileged test helper only on the **disposable** DB.

## 7. RLS considerations
`ALTER TABLE … ENABLE ROW LEVEL SECURITY` (no policies) on all new tables, matching the 33 existing tables. As noted in `DB-SECURITY-AUDIT.md` (S3), the API role bypasses RLS, so user/family/guardian isolation is code-enforced and tested (including new guardian and ticket isolation tests). Adding real RLS policies remains deferred to the S2 outcome.

## 8. Retention, privacy and deletion
| Data | On user deletion | Proposed retention (needs compliance sign-off) |
|---|---|---|
| Payments, orders, mandates, SIP, events | Kept (RESTRICT); personal fields on `User` anonymised | Statutory minimum for financial records (to be set by your adviser) |
| Guardian linkage/permission/audit | Kept | Same as consent evidence |
| Support tickets/messages | `userId` → NULL, text blanked | Short, defined period; Desk retention aligned |
| Webhook payloads | n/a | ~90 days raw payload; event id/outcome kept |
| Outbox | n/a | Purge `DONE` jobs after ~30 days |
DPDP: erasure requests are served by anonymisation while retaining records required by law; Zoho Desk (and ZeptoMail/Cybrilla) act as processors and need data-processing terms. An anonymisation procedure is a separate task.

## 9. Backward compatibility and rollout
No existing table is touched; old app versions are unaffected. New endpoints are added behind flags (`investing.*`, support enabled only when `SUPPORT_PROVIDER` is configured). Rollout order: (1) approve proposal → (2) generate Prisma migration + hand-written SQL → (3) apply to disposable Postgres and run the whole suite plus new tests, EXPLAIN checks on the hot paths (webhook dedupe, reconcile scan, ticket list) → (4) your review of the generated SQL → (5) **separate** approval to apply to Supabase after a backup/PITR point is confirmed (my S2/backup items remain open until your read-only audit results arrive).

## 10. Rollback summary
All objects are new, so the down-migration is `DROP TRIGGER/FUNCTION`, then `DROP TABLE` in reverse dependency order (events → payments/mandates/SIP → orders → guardian → support → outbox/webhooks). Safe only while the tables hold no real records; after real use, rollback means *stop writing and keep the data*, never drop financial or consent history.

## 11. Decisions I need from you
1. Approve this proposal (or mark changes), so I can generate the migration and test it on disposable PostgreSQL.
2. Support attachments: store bytes in Supabase Storage, or keep them only in Zoho Desk (metadata only here)?
3. Retention periods per §8 (with your adviser).
4. Compliance sign-off needed before any guardian/minor `TRANSACT` capability or minor investing is enabled.

## Implementation note (added after approval)
Generated as `apps/api/prisma/migrations/20261119000000_platform_core/migration.sql` with a manual rollback in `apps/api/prisma/rollback/`. **Applied only to disposable local PostgreSQL** (fresh DB with all 6 migrations: 33 → 47 tables; rollback returns exactly to 33; re-apply works). **Not applied to Supabase; that needs your separate approval after you review this SQL and confirm backup/PITR.**
Deviations from the proposal text, made to keep the CI Prisma drift gate valid: (1) partial unique indexes became nullable UNIQUE key columns (`activeKey`, `liveKey`, `openKey`) kept consistent by CHECK constraints, same invariants; (2) partial/DESC non-unique indexes became plain composite indexes; (3) added `SupportTicket.clientRequestId` (unique per user) so retried ticket creation cannot duplicate; (4) added `SupportAttachment.status`; (5) terminal-status guard triggers on Payment, Mandate, SipPlan and GuardianLinkage. The Prisma schema engine (`db:drift`) cannot run in this sandbox; the existing engine-less schema/migration test (now 47 models, 52 foreign keys) passes, and the CI drift job remains the final check.
