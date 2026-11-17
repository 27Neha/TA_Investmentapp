# Milestone 2 — Mobile onboarding and profile

## Built (API + app)
All routes are under `/v1/me/*`, JWT-protected, user id taken only from the token.
| Area | API | Mobile screen |
|---|---|---|
| Personal details, DOB, minor detection | `GET/PUT profile` (PAN AES-256-GCM encrypted, masked on read) | PersonalScreen |
| Guardian workflow | `GET/PUT guardian` (minors only; status PENDING_VERIFICATION) | GuardianScreen |
| KYC status | `GET kyc`, `POST onboarding/confirm` | KycScreen, ReviewScreen |
| Risk assessment | `GET risk/questions`, `GET/POST risk` | RiskScreen (DRAFT questionnaire) |
| Bank | `GET/PUT bank` (account number encrypted; status stays UNVERIFIED) | BankScreen |
| Address | `GET/PUT address` | AddressScreen |
| Nominees | `GET/PUT nominees`, `POST nominees/opt-out` (max 3, shares = 100) | NomineeScreen |
| Consents | `GET/POST consents` (versioned DisclosureVersion) | ConsentScreen |
| Hub / review | `GET onboarding` | OnboardingScreen, ReviewScreen |
| Settings | `PATCH locale`, `GET/PUT notifications` | LanguageScreen, NotificationsScreen |
| Security | `POST password/change` (revokes all sessions), `GET sessions`, `POST sessions/revoke-all` | ChangePasswordScreen, SecurityScreen |
Every screen has loading / error / retry states, client validation mirrored to the server (parity test), and navigation through the signed-in stack (Home banner and Profile tab open the hub).

## Honesty rules enforced (and tested)
- Nothing marks KYC, bank or guardian VERIFIED; no endpoint allows it. Confirmation sets KYC to `PENDING_PROVIDER` ("submitted — awaiting verification") and the app says identity verification has not been performed.
- Submitted details are locked (409 `KYC_LOCKED`) so they cannot be silently changed.
- Minors cannot complete onboarding until a guardian is VERIFIED; no verification path exists yet (operations workflow is future work).
- Production investing remains disabled (all investing feature flags OFF); M2 adds no investing function.
- The risk questionnaire, scoring and band names are a DRAFT pending your approved questions/scoring and compliance review; the app shows a draft banner and makes no advice claim.
- Legal documents are draft placeholders (`reviewedBy` unset) and flagged as such in the app.

## Known limitations
- Hindi/Marathi cover only the original 40 strings; the new M2 strings fall back to English (no unreviewed translations were invented).
- Dates are typed as YYYY-MM-DD (no native date picker yet).
- Not run on a device/emulator; verified by TypeScript typecheck and an Android bundle export only.
- Staff roles have no access to investor PII endpoints in this milestone (admin investor views arrive in M5 with audit logging).
