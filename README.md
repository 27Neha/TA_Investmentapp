# TechArtha Investment App

Mutual-fund investing app for Indian users, built by TechArtha Financial Services Pvt Ltd.
This repository is a monorepo (npm workspaces):

| Path | What it is | Stack |
|---|---|---|
| `apps/api` | Backend REST API (`/v1/...`) | NestJS 10, Prisma 6, PostgreSQL |
| `apps/mobile` | Android/iOS app | Expo SDK 58, React Native 0.88, React Navigation 7 |
| `apps/admin` | Staff portal (Phase 1 scope only: login, feature flags, provider checklist) | Next.js 15 |
| `packages/shared` | Reserved for shared code; currently empty | — |
| `docs/` | Status reports, runbooks, reviews (start at [`docs/INDEX.md`](docs/INDEX.md)) | — |

## Current status (read this first)
- **Working and tested against a local PostgreSQL:** authentication, onboarding/profile, risk assessment, goals, fund exploration, family groups, learning, notifications, legal/consent records. See [`docs/PRODUCT-BUILD-STATUS.md`](docs/PRODUCT-BUILD-STATUS.md).
- **Not available (clearly marked in the app):** investing, KYC/bank verification, holdings and transactions (need the Cybrilla integration), live index data and news.
- **Never run on a real device, never built as an APK/AAB, never run against a real Supabase project.**
- No investment, NAV, or provider data is ever invented: unavailable features show an "unavailable" state.

## Prerequisites
- Node.js 22 (the Docker image uses Node 22)
- npm 10+
- PostgreSQL 16 for local work and tests (a throwaway database, **never** production or staging data)
- For the mobile app: Expo Go or an Android emulator/device

## Setup
```bash
git clone https://github.com/27Neha/TA_Investmentapp.git
cd TA_Investmentapp
npm install
```

### 1. Environment
Copy `.env.example` to `apps/api/.env` and fill it in. **Never commit it** (`.env*` is git-ignored).

> **Important:** the API does not load `.env` by itself. Only the Prisma CLI reads `apps/api/.env`. Export the variables into your shell before running the API, the seed script or tests (commands in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)).

In development, missing secrets fall back to insecure dev values. In production the API refuses to start without strong secrets (see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#environment-variables)).

### 2. Database
Apply the **existing** migrations. Do not run `prisma migrate dev --name init`: the migrations already exist and creating another would diverge them.
```bash
cd apps/api
npx prisma migrate deploy      # local/throwaway or staging database only
npm run seed                   # draft legal documents, feature flags (all OFF), first admin from ADMIN_EMAIL/ADMIN_PASSWORD
```
Details and safety rules: [`docs/DATABASE-MIGRATIONS.md`](docs/DATABASE-MIGRATIONS.md).

### 3. Run
```bash
cd apps/api    && npm run start:dev      # API on :3000 (health: /health)
cd apps/mobile && npx expo start         # set EXPO_PUBLIC_API_URL to the API address first
cd apps/admin  && npm run dev            # admin portal on :3001
```
On a phone or emulator, `localhost` is the device itself. Use your computer's LAN IP, or `10.0.2.2` on the Android emulator, for `EXPO_PUBLIC_API_URL`.

## Tests and checks
```bash
npm run api:test                                       # API unit tests (integration tests skip without a DB)
cd apps/api && TEST_DATABASE_URL=postgresql://... npm run test:int   # full suite; TRUNCATES tables: throwaway DB only
cd apps/mobile && npm run typecheck && npm run i18n:check
cd apps/mobile && npm run export:android               # verifies the Android JS bundle builds (this is not an APK)
```
There is no CI, no linting and no mobile unit-test setup yet; these are planned for later milestones.

## Principles
- No fake financial success. Live investing is feature-flagged OFF.
- Secrets are server-side only. Nothing secret goes into `EXPO_PUBLIC_*` variables.
- Legal text, translations and risk wording are drafts until counsel/human review.
- Never run migrations or tests against production data.

## More
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Development guide: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Change history: [`CHANGELOG.md`](CHANGELOG.md)
- Repository hygiene review (pending decisions): [`docs/REPO-HYGIENE.md`](docs/REPO-HYGIENE.md)
