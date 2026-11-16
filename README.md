# TechArtha Investment App

Monorepo: `apps/api` (NestJS + Prisma + PostgreSQL), `apps/mobile` (Expo / React Native), `apps/admin` (Next.js).
Built phase by phase from the *Claude Code Master Build Prompt* (16 Nov 2026). See `CHANGELOG.md` and `docs/`.

## Quick start
```bash
npm install
cp .env.example apps/api/.env      # fill in real values locally; NEVER commit .env
cd apps/api
npx prisma migrate dev --name init # first time: creates the initial migration against your DB
npm run seed                       # draft disclosures, feature flags (all OFF), admin user from ADMIN_EMAIL/ADMIN_PASSWORD
npm run start:dev                  # API on :3000
cd ../mobile && npx expo install --fix && npx expo start   # align package versions to your Expo SDK, then run
cd ../admin && npm run dev         # admin on :3001
```
Tests: `npm run api:test` (unit; integration tests skip without a DB). Full suite needs a THROWAWAY Postgres: `TEST_DATABASE_URL=... npm run test:int -w apps/api`.
Status and blockers: `docs/PHASE-1-STATUS.md`. Migration steps: `docs/DATABASE-MIGRATIONS.md`.

## Principles (from the master prompt)
No fake financial success. Live investing is feature-flagged OFF. Secrets are server-side only.
Legal text, translations and risk wording need human/counsel review before release.
