# Milestone 3 — Home, Explore (ArthaVerse), Goals, Portfolio

## Built
| Area | API | Mobile |
|---|---|---|
| Goals | `GET/POST /v1/me/goals`, `GET/PUT/DELETE /v1/me/goals/:id` (user-scoped; foreign ids return 404; max 20; soft delete) | Goals list, create/edit form, detail with illustrative plan |
| Goal calculator | `goal-math.ts` (pure): required monthly amount, projected value, shortfall for a return THE USER assumes | shown on detail; always labelled illustrative, not a forecast |
| Explore – Funds | `GET /v1/explore/schemes?q=`, `/schemes/:code` via `MarketDataProvider` (MFAPI), 10-min cache, 6 s timeout | search + scheme screen (fund house, category, latest NAV, NAV date, risk disclosure) |
| Explore – Learn (ArthaVerse) | `GET /v1/content`, `/v1/content/:slug` (published only; `reviewed` flag) | list + article screens, DRAFT label while `reviewedBy` is empty |
| Home | `GET /v1/me/home` (name, onboarding next step, KYC status, goals summary, latest articles) | Home with onboarding card, goals card, portfolio empty state, Learn cards |
| Portfolio | `GET /v1/me/portfolio` → `{connected:false, reason, holdings:[], totalValue:null}` | honest empty state with the reason; no figures |
Migration `20261117000000_m3_goals_content` (Goal, ContentItem; RLS enabled). Seed adds 4 general-education articles, unreviewed (shown as DRAFT).

## Honesty rules (tested)
- Upstream fund-data failure or malformed response → HTTP 503 `UPSTREAM_UNAVAILABLE` with no NAV data; nothing is fabricated or cached from errors.
- Portfolio never returns holdings or totals without a transaction provider; investing stays disabled (flags OFF, `investingEnabled:false`).
- No returns, ratings or "best fund" claims. Scheme screen shows only NAV facts + the mandatory disclosure.
- Goal projections require the user's own assumed return (0–20%), echo it back, and carry a not-a-forecast note.

## NOT VERIFIED / blocked
- MFAPI is unreachable from the build sandbox. The client follows MFAPI's public documented shapes (`/mf/search?q=`, `/mf/{code}` → `meta` + `data[{date,nav}]`) from memory and is tested only against a local stub server. Run a live smoke check from your network before relying on it, and confirm MFAPI's terms of use for production traffic.
- Portfolio/holdings, SIP/order flows: blocked on Cybrilla docs and sandbox access (M4).
- Article text is general education and needs compliance review before `reviewedBy` is set.
- Hindi/Marathi still 40 of 274 strings translated; the rest falls back to English.
- Not run on a device/emulator; verified by typecheck and Android bundle export.
