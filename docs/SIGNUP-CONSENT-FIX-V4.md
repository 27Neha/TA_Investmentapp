# Signup and consent flow fix (V4)

Branch `feat/phase-2-hardening`. Not tested on a physical device or emulator: the checks below are unit, integration, an HTTP walk-through against a local API on a disposable PostgreSQL, a TypeScript check and an Android bundle export.

## Root causes
1. **Continue stayed disabled.** The button required both Terms and Privacy documents to have loaded from `GET /v1/disclosures/latest`. Any failure to load them (API unreachable from the phone, an unseeded database, a server error) set the state to "unavailable", with no retry and no explanation, so Continue stayed off even with every field filled in. A phone or emulator cannot reach `http://localhost:3000` on the PC; `EXPO_PUBLIC_API_URL` must be the PC's LAN address (emulator: `http://10.0.2.2:3000`).
2. **Terms page was blank.** With no `DisclosureVersion` rows the API answered 200 with an empty body, which the app's request helper turned into `{}`. That is truthy, so the page rendered "loaded" with no title, version or text. The seed script also only inserted a one-line placeholder.
3. **Keyboard overlap (Android).** `KeyboardAvoidingView` had no behaviour on Android, and the scroll area had no bottom space for the button.

## Fixes
- API: `latest` returns an honest `404 LEGAL_NOT_AVAILABLE`; the seed inserts a structured, clearly labelled **DRAFT** Terms and Privacy Policy (`0.2-draft`, `reviewedBy` = null); a development warning is logged at API start when they are missing; **in production, signup is refused (`403 LEGAL_NOT_APPROVED`) until both documents are marked reviewed**.
- Mobile: pure rules (`src/lib/signup-rules.ts`) mirror the server; inline per-field errors; Continue is enabled only when every field is valid, both documents loaded as real documents (version + body), and both consents were ticked by the user; a visible "To continue" list shows what is missing; the document load has retry and distinct network / not-published / error messages (the API address is shown in development builds); the Terms screen renders headings, bullets and paragraphs, shows a draft banner, and, when opened from signup, has an explicit "I have read and accept" box and "Accept and return" button which ticks the signup checkbox only for the exact version shown. Nothing is ever accepted automatically.

## Legal content still requiring approval
No approved Terms or Privacy text exists in this repository. The draft describes what the app does today and leaves every contractual clause as `[LEGAL TO SUPPLY …]`. It makes no ARN or registration claims. To go live, counsel supplies the text, then a reviewed row is inserted (`reviewedBy` set) as a new version; production signup stays blocked until then. Translations of these documents stay English until human review.

## "Cannot POST /v1/auth/login" (stale backend)
The mobile app calls `POST {EXPO_PUBLIC_API_URL}/v1/auth/login`. This branch registers exactly that route (`@Controller('v1/auth')` + `@Post('login')`, no global prefix); `main` contains no auth code at all. "Cannot POST /path" is Nest's answer for an unregistered route, so the process listening on port 3000 was not running this branch's code (for example an older checkout or `main`, or `npm start` on an old `apps/api/dist` that was never rebuilt). The same stale backend also explains the empty legal documents and the disabled Continue button, because the documents endpoint was missing too.

Added: the app now recognises this case (HTTP 404 "Cannot …" with no error code) on login, signup and document loading and shows the address it is calling with the restart instruction; `npm run check:backend [url]` (repo root) checks health, login, signup and documents routes without sending credentials; `apps/api/test/routes.int.spec.ts` guards the routes; login shows inline validation instead of a silently disabled button.
