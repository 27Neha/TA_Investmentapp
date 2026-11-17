# Data retention (configuration and documentation only)

**No automatic deletion or anonymisation job exists, and none was added.** Nothing in the code purges data on a schedule. Retention periods below are *proposals to be set by you / your compliance adviser*; they are documentation, not behaviour.

| Data | Where | Proposed period (to be decided) | Notes |
|---|---|---|---|
| Support tickets and messages | `SupportTicket`, `SupportMessage` | set by you | Local mirror; the helpdesk remains the system of record once connected |
| Support attachments | private Supabase bucket + `SupportAttachment` metadata | set by you | PDF/PNG/JPEG, 5 MB, signed URL 300 s |
| KYC attempts/events/consents | `KycVerificationAttempt`, `KycAttemptEvent`, `KycConsent` | regulatory minimum applies | Masked identifiers only; never full Aadhaar or OTPs |
| Payments, mandates, SIPs, order events | `Payment*`, `Mandate*`, `SipPlan` | regulatory minimum applies | Append-only event tables |
| Guardian links and audit | `GuardianLinkage`, `GuardianAuditEvent` | set by you | Append-only audit |
| Risk assessments | `RiskAssessment` | keep all (reassessment never overwrites) | Answers + server-computed score |
| Webhook events, outbox | `ProviderWebhookEvent`, `OutboxJob` | set by you | Payload hashes only for webhooks |
| Audit events | `AuditEvent`, `AdminAuditEvent` | regulatory minimum applies | |

The existing account-deletion/anonymisation *request* flow (`AccountRequest`) is unchanged and remains manual/admin-reviewed. If you later want scheduled jobs, that needs your explicit approval of the periods and a dry-run report first.
