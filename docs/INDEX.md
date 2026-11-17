# Documentation index

**Current (maintained):** `ARCHITECTURE.md`, `DEVELOPMENT.md`, `DATABASE-MIGRATIONS.md`, `SECURITY-REVIEW.md`, `INTEGRATION-STATUS.md`, `PRODUCT-BUILD-STATUS.md`, `MOBILE-DEVICE-TEST-CHECKLIST.md`, `REPO-HYGIENE.md`, `DEPENDENCY-AUDIT.md`, `DB-SECURITY-AUDIT.md`, `FULL-PRODUCTION-GAP-ANALYSIS.md`, `ZOHO-INTEGRATION-ARCHITECTURE.md` (planning only), `MIGRATION-PROPOSAL-PLATFORM.md` (proposal only), `ZOHO-SETUP-REQUIRED.md`, `IMPLEMENTATION-STATUS.md`, `MIGRATION-PROPOSAL-D1-D4.md` (proposal only, nothing applied), `MIGRATION-PROPOSAL-KYC.md` (proposal only), `RISK-SCORING-METHODOLOGY.md`, `LOCALIZATION.md`, `RETENTION-CONFIGURATION.md`, `RELEASE-READINESS.md`, and `../CHANGELOG.md`.

**Historical (point-in-time snapshots, kept for the audit trail; may be out of date):**
| File | Snapshot of |
|---|---|
| `PHASE-1-STATUS.md`, `PHASE-1-TEST-REPORT.md`, `PHASE-1-REMAINING-BLOCKERS.md` | End of Phase 1 stabilisation |
| `M2-STATUS.md`, `M3-STATUS.md`, `M4-STATUS.md` | Milestones 2–4 |
| `PRODUCT-GAP-ANALYSIS.md` | What existed before the product build |
| `SUPABASE-AND-DEPLOYMENT.md` | Milestone 1 deployment foundation |

Known staleness: `PHASE-1-STATUS.md` says "do not start Phase 2" and mentions one migration; there are now five. Phase 2 work is tracked in the Phase 2 branch, not in those files. Where a historical document disagrees with the code or `ARCHITECTURE.md`, trust the code.
- [SUPPORT-ATTACHMENTS.md](SUPPORT-ATTACHMENTS.md): attachment upload/download design, limits, security model, what is unverified.
- [INVESTMENT-JOURNEY.md](INVESTMENT-JOURNEY.md): suitability and scheme Riskometer linking, data file format, gating.
- [NOTIFICATIONS.md](NOTIFICATIONS.md): SMS/WhatsApp architecture, templates, DLT, Interakt, ZeptoMail webhooks.
- [INTEGRATION-VERIFICATION-RUNBOOK.md](INTEGRATION-VERIFICATION-RUNBOOK.md): operator steps to verify Supabase, Zoho Desk, ZeptoMail; KYC provider onboarding.
- [ANDROID-RELEASE.md](ANDROID-RELEASE.md): APK/AAB readiness and EAS steps.
- [RELEASE-CANDIDATE-V4.md](RELEASE-CANDIDATE-V4.md): status matrix for this release candidate.
- [SIGNUP-CONSENT-FIX-V4.md](SIGNUP-CONSENT-FIX-V4.md): signup / Terms root causes, fixes, legal content awaiting approval.
