# Product build — gap analysis (what existed vs what was added)

Method: inspected the stabilised repo (HEAD `2ad4e1d`, M1–M4) feature by feature against the Complete Product Build spec, reused what existed, and added what was missing. Admin Portal untouched (out of scope).

| Area | Existed before | Added / changed in this build |
|---|---|---|
| Home | Greeting, onboarding card, nearest goal, empty portfolio card, 3 draft articles | Avatar + notification bell (unread badge), portfolio-pending card, top-3 goals with progress, risk card with reassess, market snapshot (unavailable state), 7 quick actions, data-derived insights, re-consent banner |
| Explore / ArthaVerse | 2 tabs (articles, fund search), scheme detail (name/NAV/date) | Market brief, fund search with plan/option/AMC filters, search history, NAV history chart with ranges, period returns (CAGR ≥1y, never extrapolated), compare (2–4), watchlist, 12 categories (draft), source/as-of/stale labels |
| Games | — | 5 server-graded quizzes (answers never sent to client), 3 calculator challenges, streak, badges; no money/rewards |
| Goals | Create/edit/delete, illustrative plan | 10 categories, inflation assumption, effective target, contributions log, progress chart, pause/resume/archive, delete needs confirmation, compare 2–4 |
| Portfolio | Honest "not connected" | Summary/allocation/growth/holdings sections driven only by provider data; "Portfolio connection pending"; links to transactions, withdrawal info, goal-linked, family |
| Family | — | Groups, invitations (verified-email match), roles OWNER/ADULT/GUARDIAN, per-member sharing controlled by that member, overview aggregates only shared goals, remove/leave/disband, minor and DEPENDENT blocked |
| Risk | One-shot onboarding questionnaire | Draft/resume, submit (append-only history with version/date), compare + explanation + review prompt, reassess from Home/Profile/hub, "not a Riskometer" |
| Profile | Flat button list | Avatar + 6 groups; Legal & Disclosures with versions/dates/consent history; FAQ; account deactivate/delete **requests** (password re-auth) |
| Consent | Signup checkboxes (no links) | Links to documents before signup, boxes directly above the button, unticked; re-consent only when a document version changes; SCHEME disclosure kind |
| Transactions / withdrawals | Provider boundary only | Read-only transaction list with filters (empty until a provider writes rows); withdrawal availability screen, disabled, no create endpoint |
| Notifications | Preference toggles | Notification centre (read/unread, 10 categories) fed by real events (password change, KYC submit, risk, family) |
| Charts | — | react-native-svg line/donut/bars/column/progress, range selector, tooltip, legend, empty/loading states |
| Backend | 19 models | 33 models (+14), user-scoped everywhere, audit log, idempotent account requests, RLS on all new tables |
| Tests | 145 | 160 (15 new integration tests incl. family isolation, user A/B isolation) |

Not built (blocked, see PRODUCT-BUILD-STATUS.md): live indices/news, Cybrilla investing, portfolio data, ZeptoMail delivery, Hindi/Marathi full translation, approved risk framework and legal text.
