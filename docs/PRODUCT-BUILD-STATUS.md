# Product build status

## Verified here
- API: `npx tsc --noEmit` clean; **160/160 Jest tests pass** against a real local PostgreSQL 16 (schema/migration parity, RLS, isolation, new features).
- Mobile: `tsc --noEmit` clean; `expo export --platform android` produces a Hermes bundle (2.4 MB). i18n integrity check passes (0 unknown keys, 0 placeholder mismatches).
- Isolation proven through the NestJS API: user A/B for risk, goals, watchlist, search history, inbox, learning, account requests, transactions; family: unrelated family and non-members get 404, owner gets 403 on a member who has not shared, a member cannot be affected by the owner changing sharing.

## NOT verified / not done (do not treat as complete)
| Item | Why | What is needed |
|---|---|---|
| **APK / AAB** | No Android SDK or EAS access in the build sandbox | Run `eas build -p android --profile preview` (APK) and `--profile production` (AAB) from `apps/mobile`; set the two `EXPO_PUBLIC_API_URL` values in `eas.json`; confirm package id `com.techartha.app` before the first Play upload (permanent) |
| Physical-device / network-failure / keyboard / safe-area / navigation-mode tests | No device | Follow `docs/MOBILE-DEVICE-TEST-CHECKLIST.md` |
| Live MFAPI | Egress blocked; response shapes follow public docs | Run the app against the real API once; the code cleans/sorts/dedupes and fails closed (503) on bad bodies |
| Index data and market news | No licensed/verified provider chosen | Implement `IndexDataProvider` (see `apps/api/src/market/index.provider.ts`) and bind it in `MarketModule`; UI already renders `available:true` |
| Cybrilla (investing, transactions, portfolio, withdrawals, SIP/mandate) | No docs/sandbox | Implement `TransactionProvider`; tables `Transaction` and `PortfolioSnapshot` are provider-write-only |
| ZeptoMail | No credentials | Email interface is ready (`EmailService`); family invitation emails are best-effort and in-app invitations work without it |
| Supabase staging | Unreachable; unknown whether `ghbpasukrwmaxknaadkk` is staging or production | Provide a staging pooled URL; run `npm run db:drift` and apply `20261118000000_product_build` to staging first. **Never apply to production before staging passes** |
| Prisma drift check | Engine download blocked | `npm run db:drift` on your machine with `SHADOW_DATABASE_URL` |
| Hindi / Marathi | Machine-draft only for 40 of 605 keys; the rest fall back to English; none approved | Human translation + review; legal and risk keys are protected |
| Risk questionnaire & scoring | Awaiting approved version | Replace `RISK_QUESTIONS`/`RISK_FRAMEWORK` and set `approved:true`; versioning keeps old assessments comparable |
| Legal text, category education, FAQ, quiz content | Drafts, unreviewed | Counsel/compliance review; flagged "Draft" in the UI |
| GitHub push | GitHub not linked to the session | Link GitHub, then push `feat/phase-1-foundations` and verify the remote |

## Design decisions worth knowing
- Goal contributions, family goal totals and learning progress are **self-reported**; the UI says so. Nothing is shown as verified portfolio data.
- Withdrawals: there is no endpoint that starts one. Success could only be reported after provider confirmation.
- Account deletion is a **request** (password re-auth, idempotent, cancellable); nothing is deleted automatically.
- Email/mobile change is explicitly "not supported yet" (needs verified OTP flows).
- Backups: enable Supabase daily backups/PITR for production and test a restore into a scratch project quarterly (`docs/SUPABASE-AND-DEPLOYMENT.md`). Not verified here.
- Rate limiting: global throttler plus 5/min on password change and account requests; idempotency on account requests and watchlist/invite creation.
