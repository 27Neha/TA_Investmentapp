# Phase 1 — remaining blockers

Phase 1 is **not complete**. Ordered by what unblocks the most.

| # | Blocker | Owner | How to clear |
|---|---|---|---|
| 1 | Credentials leaked in chat not yet rotated | Owner | Rotate Supabase DB password, Cybrilla client secrets (both sets), Interakt key, ZeptoMail token, admin password. See SECURITY-REVIEW.md |
| 2 | ZeptoMail never tested live | Owner + me | Verify sender domain in ZeptoMail; run `npm run email:smoke`; confirm inbox arrival; then run signup/forgot-password with `EMAIL_PROVIDER=zeptomail` |
| 3 | Staging DB migration not applied | Owner | Provide an empty staging Postgres URL (not production); run the commands in DATABASE-MIGRATIONS.md, including the Prisma drift check |
| 4 | Mobile never run on a device | Owner | Run MOBILE-DEVICE-TEST-CHECKLIST.md on a physical Android phone (gesture AND 3-button nav) and report failures |
| 5 | Cybrilla sandbox unverified/unimplemented | Owner + me | Share API docs/collection + enabled products; I implement and test only those endpoints from an environment that can reach them |
| 6 | Approved language list | Owner | Supply the ~13 languages; then add to `locales.ts` + catalogs. Human-reviewed translations required for consent/risk text |
| 7 | Legal text | Owner / counsel | Approved Terms, Privacy, risk disclosures; ARN wording (Sushil Arvind Raul, ARN-330164, operating through TechArtha — not attributed to the company) |
| 8 | Open security items 9–14 | Me | See SECURITY-REVIEW.md; schedule before production |
| 9 | Expo version alignment | Owner | `cd apps/mobile && npx expo install --fix` (blocked here) |
| 10 | Hand-written migration needs Prisma drift confirmation | Owner | Step 1 in DATABASE-MIGRATIONS.md |

## Known bugs / limitations
- hi/mr catalogs cover 40/59 keys; consent checkboxes, risk disclosure and several flow messages show English in those languages (by design until human-translated).
- Explore, Goals and Portfolio are placeholders ("coming soon"); they are not features.
- Mobile `AppHeader` in the tab shell receives stub navigation props (no back button on tabs — intended; verify on device).
- Admin portal has no staff user-management UI; first admin is created by `npm run seed`.
- No webhook endpoints yet; email status never reaches DELIVERED/BOUNCED.
