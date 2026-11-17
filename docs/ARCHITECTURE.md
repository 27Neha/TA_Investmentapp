# Architecture

Describes the code as it is on `feat/phase-2-hardening` (baseline `ab890fc`). Verified against the source; if code and this file disagree, the code wins — please fix the doc.

## Overview
```
 Expo mobile app ──HTTPS/JSON──▶ NestJS API (/v1/...) ──Prisma + pg adapter──▶ PostgreSQL (Supabase)
 Next.js admin  ──server-side BFF (httpOnly cookie)──▶ same API                    ▲
                                                                          providers (all fail closed):
                                                              MFAPI (fund NAVs) · ZeptoMail (email) · Cybrilla (not connected)
                                                              index/news provider (not connected)
```
The API is the only component that talks to the database and to providers. Mobile and admin never hold provider secrets.

## Backend (`apps/api/src`)
One NestJS module per feature, wired in `app.module.ts`:

| Module | Responsibility |
|---|---|
| `auth` | Signup (versioned consent), email OTP, login with lockout, rotating refresh tokens with reuse detection, password reset, sessions, change password |
| `me` | Profile, address, bank (encrypted), nominees, guardian, KYC record, risk (onboarding), consents, locale, notification preferences, onboarding status |
| `goals` | Goals, contributions, pause/resume/archive, compare, progress; pure illustrative maths in `goal-math.ts` |
| `risk` | Risk framework (draft), draft answers, append-only assessments, history, compare |
| `market` | MFAPI provider (`market.provider.ts`), NAV cleaning/returns (`nav-series.ts`), explore/compare/categories/watchlist, index-data boundary (unconfigured) |
| `family` | Groups, invitations, roles, member-controlled sharing, aggregate overview |
| `learn` | Server-graded quizzes, challenges, streak, badges |
| `inbox` | In-app notifications and the `AuditService` (global module) |
| `consent`, `content` | Public legal-document index/latest, educational articles |
| `account` | Deactivate/delete **requests** (password re-auth; nothing is deleted automatically) |
| `investing` | `TransactionProvider` boundary (unconfigured), read-only transactions, withdrawal availability |
| `home` | Aggregated `/v1/me/home` and `/v1/me/portfolio` |
| `flags`, `providers` | Admin-only feature flags and provider checklist |
| `health` | `/health` liveness |
| `prisma`, `common` | DB service (`pg-config.ts` handles TLS), crypto, field encryption, config |

### Cross-cutting rules
- **Identity:** the user id always comes from the verified JWT (`req.user.sub`). No endpoint accepts a user id; resources owned by someone else return 404.
- **Public routes:** only `health`, `content` and `consent` (legal documents) skip the JWT guard.
- **Validation:** global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`); helmet; CORS from `CORS_ORIGIN`.
- **Rate limiting:** global 120 requests/minute per client plus stricter limits on auth routes, password change and account requests. The store is in memory, so limits are per API instance.
- **Encryption:** PAN and bank account numbers are stored with AES-256-GCM (`FIELD_ENCRYPTION_KEY`); only the last 4 digits are kept in clear.
- **Fail closed:** provider calls that are unconfigured or return unexpected data produce `PROVIDER_NOT_CONFIGURED` / `UPSTREAM_UNAVAILABLE`, never invented data.

## Database (`apps/api/prisma`)
- 33 models, 5 hand-written migrations (the Prisma engine download was blocked when they were produced; `npm run db:drift` has not yet been run against them).
- Row-level security is **enabled with no policies** on every table (deny-by-default for anon/authenticated Supabase roles). The API connects as the table owner, which bypasses RLS, so per-user isolation is enforced in API code and verified by integration tests, not by RLS.
- `Transaction` and `PortfolioSnapshot` are written only by a verified provider; the app cannot create them.

## Mobile (`apps/mobile`)
Expo SDK 58, React Navigation 7 (not Expo Router). Entry: `App.tsx` → `I18nProvider` → `AuthProvider` → `NavigationContainer` → `src/navigation/RootNavigator.tsx` (auth stack, or tabs + app stack when signed in).

```
src/api/client.ts        fetch wrapper: SecureStore tokens, refresh-once on 401
src/auth/                AuthContext
src/components/          ui, kit (useLoad/LoadGate), cards, charts (react-native-svg)
src/screens/<feature>/   auth, home, explore, learn, goals, risk, portfolio, family, legal, inbox, profile, onboarding, main
src/i18n/                en (source of truth), hi, mr, locales registry
src/validation.ts        mirrors server validation (guarded by test/validation-parity.spec.ts)
```
The mobile client has no generated API types yet; screens consume untyped responses.

## Admin (`apps/admin`)
Next.js 15 app router. Browser never calls the API directly: route handlers under `app/api` form a backend-for-frontend using an httpOnly cookie and CSRF checks. Pages: login, dashboard (feature flags, provider checklist). Out of scope for current phases beyond that.

## Not connected (by design, shown as unavailable)
Cybrilla (investing/KYC/bank verification/transactions/portfolio), index and news data, ZeptoMail delivery until credentials exist, SMS/WhatsApp OTP. See `PRODUCT-BUILD-STATUS.md`.
