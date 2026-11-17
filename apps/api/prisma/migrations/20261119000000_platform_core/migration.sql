-- Platform core: guardian accounts, support, webhooks/outbox, payments, mandates/SIP.
-- ADDITIVE ONLY: no existing table or column is altered. Reviewed proposal: docs/MIGRATION-PROPOSAL-PLATFORM.md.
-- Partial unique indexes from the proposal are implemented as nullable UNIQUE "...Key" columns guarded by CHECKs
-- (Prisma cannot represent partial indexes, and the CI drift gate must stay valid). Same invariants.

-- CreateTable
CREATE TABLE "GuardianLinkage" (
    "id" TEXT NOT NULL,
    "minorUserId" TEXT NOT NULL,
    "guardianUserId" TEXT,
    "guardianContactHash" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "consentVersionId" TEXT,
    "consentedAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "activeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuardianLinkage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GuardianLinkage_status_chk" CHECK ("status" IN ('INVITED','ACTIVE','REVOKED','REJECTED','EXPIRED')),
    CONSTRAINT "GuardianLinkage_not_self_chk" CHECK ("guardianUserId" IS NULL OR "guardianUserId" <> "minorUserId"),
    CONSTRAINT "GuardianLinkage_active_chk" CHECK ("status" <> 'ACTIVE' OR ("guardianUserId" IS NOT NULL AND "consentedAt" IS NOT NULL)),
    CONSTRAINT "GuardianLinkage_activekey_chk" CHECK (("status" IN ('INVITED','ACTIVE')) = ("activeKey" IS NOT NULL))
);
CREATE TABLE "GuardianPermission" (
    "id" TEXT NOT NULL,
    "linkageId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "liveKey" TEXT,
    CONSTRAINT "GuardianPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GuardianPermission_scope_chk" CHECK ("scope" IN ('VIEW_SUMMARY','VIEW_GOALS','VIEW_PORTFOLIO','VIEW_TRANSACTIONS','MANAGE_PROFILE','TRANSACT')),
    CONSTRAINT "GuardianPermission_livekey_chk" CHECK (("revokedAt" IS NULL) = ("liveKey" IS NOT NULL))
);
CREATE TABLE "GuardianAuditEvent" (
    "id" TEXT NOT NULL,
    "linkageId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuardianAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "onBehalfOfMinorId" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'SYNC_PENDING',
    "subject" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'APP',
    "clientRequestId" TEXT,
    "externalProvider" TEXT,
    "externalId" TEXT,
    "externalNumber" TEXT,
    "assigneeName" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportTicket_status_chk" CHECK ("status" IN ('SYNC_PENDING','OPEN','ON_HOLD','ESCALATED','CLOSED','SYNC_FAILED')),
    CONSTRAINT "SupportTicket_priority_chk" CHECK ("priority" IN ('LOW','MEDIUM','HIGH')),
    CONSTRAINT "SupportTicket_channel_chk" CHECK ("channel" IN ('APP','EMAIL','WHATSAPP'))
);
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "externalThreadId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'APP',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportMessage_direction_chk" CHECK ("direction" IN ('IN','OUT')),
    CONSTRAINT "SupportMessage_author_chk" CHECK ("authorType" IN ('USER','GUARDIAN','AGENT','SYSTEM')),
    CONSTRAINT "SupportMessage_channel_chk" CHECK ("channel" IN ('APP','EMAIL','WHATSAPP'))
);
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_UPLOAD',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportAttachment_size_chk" CHECK ("sizeBytes" BETWEEN 1 AND 5242880),
    CONSTRAINT "SupportAttachment_mime_chk" CHECK ("mime" IN ('application/pdf','image/png','image/jpeg')),
    CONSTRAINT "SupportAttachment_status_chk" CHECK ("status" IN ('PENDING_UPLOAD','STORED','FORWARDED','FORWARD_FAILED','REJECTED'))
);
CREATE TABLE "ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "error" TEXT,
    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderWebhookEvent_provider_chk" CHECK ("provider" IN ('zoho_desk','zeptomail','cybrilla','interakt','sms'))
);
CREATE TABLE "OutboxJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboxJob_status_chk" CHECK ("status" IN ('PENDING','RUNNING','DONE','DEAD'))
);
CREATE TABLE "InvestmentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actingGuardianLinkageId" TEXT,
    "schemeCode" TEXT NOT NULL,
    "schemeName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InvestmentOrder_kind_chk" CHECK ("kind" IN ('LUMPSUM','SIP_INSTALMENT')),
    CONSTRAINT "InvestmentOrder_amount_chk" CHECK ("amount" > 0)
);
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerPaymentRef" TEXT,
    "providerOrderRef" TEXT,
    "providerConfirmedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "openKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_status_chk" CHECK ("status" IN ('CREATED','INITIATED','PROCESSING','PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED')),
    CONSTRAINT "Payment_success_chk" CHECK ("status" <> 'SUCCESS' OR ("providerPaymentRef" IS NOT NULL AND "providerConfirmedAt" IS NOT NULL)),
    CONSTRAINT "Payment_amount_chk" CHECK ("amount" > 0),
    CONSTRAINT "Payment_openkey_chk" CHECK (("status" IN ('CREATED','INITIATED','PROCESSING','PENDING')) = ("openKey" IS NOT NULL))
);
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "webhookEventId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentEvent_source_chk" CHECK ("source" IN ('CLIENT','SYSTEM','PROVIDER_VERIFIED'))
);
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerMandateRef" TEXT,
    "authorizationUrlIssuedAt" TIMESTAMP(3),
    "providerConfirmedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Mandate_status_chk" CHECK ("status" IN ('CREATED','AUTHORIZATION_REQUIRED','PROCESSING','PENDING','ACTIVE','REJECTED','FAILED','CANCELLED','EXPIRED')),
    CONSTRAINT "Mandate_active_chk" CHECK ("status" <> 'ACTIVE' OR ("providerMandateRef" IS NOT NULL AND "providerConfirmedAt" IS NOT NULL)),
    CONSTRAINT "Mandate_max_chk" CHECK ("maxAmount" > 0)
);
CREATE TABLE "MandateEvent" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "webhookEventId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MandateEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MandateEvent_source_chk" CHECK ("source" IN ('CLIENT','SYSTEM','PROVIDER_VERIFIED'))
);
CREATE TABLE "SipPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mandateId" TEXT,
    "schemeCode" TEXT NOT NULL,
    "schemeName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "frequency" TEXT NOT NULL,
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "providerSipRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SipPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SipPlan_status_chk" CHECK ("status" IN ('DRAFT','AWAITING_MANDATE','ACTIVE','PAUSED','CANCELLED','ENDED')),
    CONSTRAINT "SipPlan_freq_chk" CHECK ("frequency" IN ('MONTHLY','QUARTERLY','WEEKLY')),
    CONSTRAINT "SipPlan_day_chk" CHECK ("dayOfMonth" IS NULL OR "dayOfMonth" BETWEEN 1 AND 28),
    CONSTRAINT "SipPlan_amount_chk" CHECK ("amount" > 0),
    CONSTRAINT "SipPlan_active_chk" CHECK ("status" <> 'ACTIVE' OR ("mandateId" IS NOT NULL AND "providerSipRef" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianLinkage_activeKey_key" ON "GuardianLinkage"("activeKey");
CREATE INDEX "GuardianLinkage_minorUserId_status_idx" ON "GuardianLinkage"("minorUserId", "status");
CREATE INDEX "GuardianLinkage_guardianUserId_status_idx" ON "GuardianLinkage"("guardianUserId", "status");
CREATE UNIQUE INDEX "GuardianPermission_liveKey_key" ON "GuardianPermission"("liveKey");
CREATE INDEX "GuardianAuditEvent_linkageId_createdAt_idx" ON "GuardianAuditEvent"("linkageId", "createdAt");
CREATE UNIQUE INDEX "SupportTicket_externalProvider_externalId_key" ON "SupportTicket"("externalProvider", "externalId");
CREATE UNIQUE INDEX "SupportTicket_userId_clientRequestId_key" ON "SupportTicket"("userId", "clientRequestId");
CREATE INDEX "SupportTicket_userId_updatedAt_idx" ON "SupportTicket"("userId", "updatedAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");
CREATE UNIQUE INDEX "SupportMessage_ticketId_externalThreadId_key" ON "SupportMessage"("ticketId", "externalThreadId");
CREATE INDEX "SupportMessage_ticketId_occurredAt_idx" ON "SupportMessage"("ticketId", "occurredAt");
CREATE UNIQUE INDEX "SupportAttachment_storageKey_key" ON "SupportAttachment"("storageKey");
CREATE INDEX "SupportAttachment_messageId_idx" ON "SupportAttachment"("messageId");
CREATE UNIQUE INDEX "ProviderWebhookEvent_provider_eventId_key" ON "ProviderWebhookEvent"("provider", "eventId");
CREATE INDEX "ProviderWebhookEvent_processedAt_receivedAt_idx" ON "ProviderWebhookEvent"("processedAt", "receivedAt");
CREATE UNIQUE INDEX "OutboxJob_kind_idempotencyKey_key" ON "OutboxJob"("kind", "idempotencyKey");
CREATE INDEX "OutboxJob_status_nextRunAt_idx" ON "OutboxJob"("status", "nextRunAt");
CREATE UNIQUE INDEX "InvestmentOrder_userId_idempotencyKey_key" ON "InvestmentOrder"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "Payment_providerPaymentRef_key" ON "Payment"("providerPaymentRef");
CREATE UNIQUE INDEX "Payment_openKey_key" ON "Payment"("openKey");
CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key" ON "Payment"("userId", "idempotencyKey");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_status_updatedAt_idx" ON "Payment"("status", "updatedAt");
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");
CREATE UNIQUE INDEX "Mandate_providerMandateRef_key" ON "Mandate"("providerMandateRef");
CREATE UNIQUE INDEX "Mandate_userId_idempotencyKey_key" ON "Mandate"("userId", "idempotencyKey");
CREATE INDEX "Mandate_userId_createdAt_idx" ON "Mandate"("userId", "createdAt");
CREATE INDEX "MandateEvent_mandateId_createdAt_idx" ON "MandateEvent"("mandateId", "createdAt");
CREATE UNIQUE INDEX "SipPlan_userId_idempotencyKey_key" ON "SipPlan"("userId", "idempotencyKey");
CREATE INDEX "SipPlan_userId_createdAt_idx" ON "SipPlan"("userId", "createdAt");
CREATE INDEX "SipPlan_mandateId_idx" ON "SipPlan"("mandateId");

-- AddForeignKey
ALTER TABLE "GuardianLinkage" ADD CONSTRAINT "GuardianLinkage_minorUserId_fkey" FOREIGN KEY ("minorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardianLinkage" ADD CONSTRAINT "GuardianLinkage_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardianLinkage" ADD CONSTRAINT "GuardianLinkage_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardianPermission" ADD CONSTRAINT "GuardianPermission_linkageId_fkey" FOREIGN KEY ("linkageId") REFERENCES "GuardianLinkage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardianAuditEvent" ADD CONSTRAINT "GuardianAuditEvent_linkageId_fkey" FOREIGN KEY ("linkageId") REFERENCES "GuardianLinkage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardianAuditEvent" ADD CONSTRAINT "GuardianAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_onBehalfOfMinorId_fkey" FOREIGN KEY ("onBehalfOfMinorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentOrder" ADD CONSTRAINT "InvestmentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvestmentOrder" ADD CONSTRAINT "InvestmentOrder_actingGuardianLinkageId_fkey" FOREIGN KEY ("actingGuardianLinkageId") REFERENCES "GuardianLinkage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InvestmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "ProviderWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MandateEvent" ADD CONSTRAINT "MandateEvent_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MandateEvent" ADD CONSTRAINT "MandateEvent_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "ProviderWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SipPlan" ADD CONSTRAINT "SipPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SipPlan" ADD CONSTRAINT "SipPlan_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only history and terminal-status guards (triggers are invisible to Prisma and survive drift checks)
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER "PaymentEvent_ro" BEFORE UPDATE OR DELETE ON "PaymentEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "MandateEvent_ro" BEFORE UPDATE OR DELETE ON "MandateEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "GuardianAuditEvent_ro" BEFORE UPDATE OR DELETE ON "GuardianAuditEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION terminal_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = ANY (TG_ARGV) AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION '% % is in terminal status % and cannot change', TG_TABLE_NAME, OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Payment_terminal" BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION terminal_status_guard('SUCCESS','FAILED','CANCELLED','EXPIRED');
CREATE TRIGGER "Mandate_terminal" BEFORE UPDATE ON "Mandate" FOR EACH ROW EXECUTE FUNCTION terminal_status_guard('REJECTED','FAILED','CANCELLED','EXPIRED');
CREATE TRIGGER "SipPlan_terminal" BEFORE UPDATE ON "SipPlan" FOR EACH ROW EXECUTE FUNCTION terminal_status_guard('CANCELLED','ENDED');
CREATE TRIGGER "GuardianLinkage_terminal" BEFORE UPDATE ON "GuardianLinkage" FOR EACH ROW EXECUTE FUNCTION terminal_status_guard('REVOKED','REJECTED','EXPIRED');

-- Row level security: same posture as every existing table (enabled, no policies; the API role bypasses RLS, isolation is enforced and tested in code)
ALTER TABLE "GuardianLinkage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvestmentOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Mandate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MandateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SipPlan" ENABLE ROW LEVEL SECURITY;
