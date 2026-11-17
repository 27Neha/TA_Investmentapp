# Release readiness (Android) and deployment notes

**Status: NOT production-ready.** No provider integration is live, no migration is applied to Supabase, and nothing was tested on a physical device or emulator.

## What was actually run (at the commit named in the completion report)
API unit + integration tests (disposable local PostgreSQL), API typecheck and `nest build`, root ESLint (0 errors; warnings are mostly `any`), mobile `tsc --noEmit`, `i18n:check`, `expo export --platform android` (Hermes bundle produced), admin `next build`. **Not run:** GitHub Actions (cannot be read from here), Prisma `db:drift` (needs the CI database), Docker (daemon unavailable), APK/AAB build, any device test.

## APK / AAB
- `apps/mobile/app.json`: Android package `com.techartha.app`, `versionCode` 1. **The package ID is not confirmed by you; do not publish until it is** (it cannot change after the first Play upload).
- `eas.json` exists. Building needs your Expo/EAS account and an upload keystore (not available here). No APK/AAB was produced and none is claimed.
- `EXPO_PUBLIC_API_URL` must point to the deployed API (public value only). Never put secrets in `EXPO_PUBLIC_*`.

## Before any release
1. Review and approve the migration SQL (`docs/MIGRATION-PROPOSAL-PLATFORM.md`, `…-KYC.md`) and apply to Supabase **only** after backup/PITR is confirmed and you give separate approval. CI runs `prisma migrate deploy` on a disposable DB.
2. Fix the 8 production-dependency audit findings via approved major upgrades (NestJS 11, Prisma 7); see `DEPENDENCY-AUDIT.md`.
3. Provider work (all BLOCKED-PROVIDER): Cybrilla, KYC partner, Zoho Desk, ZeptoMail delivery webhooks, Supabase Storage live test.
4. Compliance sign-off: consent and legal wording, risk-methodology approval, guardian activation, and the `investing.*` flags (all default OFF).
5. Human translation review (see `LOCALIZATION.md`).
6. Device test using `MOBILE-DEVICE-TEST-CHECKLIST.md`, plus Riskometer animation and reduce-motion, Indic script rendering, screen-reader pass.
