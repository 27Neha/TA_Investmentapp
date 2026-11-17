# Localisation (11 owner-confirmed languages; more to follow)

**Registry:** `apps/mobile/src/i18n/locales.ts` is the single configurable list. The API mirrors it in `SUPPORTED_LOCALES` (`apps/api/src/auth/dto.ts`); `test/locale-registry-parity.spec.ts` fails if they differ.

| Status | Languages |
|---|---|
| Owner-confirmed (11) | English, Hindi, Marathi, Gujarati, Punjabi, Bengali, Tamil, Telugu, Assamese, Kannada, Malayalam |
| Still to be supplied by the owner | The remaining languages of the original ~13. **None is assumed or pre-added** (an earlier draft that included Odia and Urdu was removed on the owner's instruction). |

## What is translated
- English is complete (1,035 keys). The other 10 languages carry **40 draft UI labels** (navigation, login/signup/verify/reset, common buttons). Everything else falls back to English. These are machine-assisted drafts and **need native-speaker review**; none is marked reviewed (`legalReviewed: false`).
- **Legal, consent, financial and risk text stays English** for every non-English language until a human reviewer signs it off. Enforced three ways: (1) `LEGAL_KEY_PREFIXES` (`disclosure. consent. risk. legal. signup.accept signup.legalUnavailable kyc. invest. pay. sip. mandate. guardian.`); (2) a runtime guard in `translate()` that ignores any translation for these keys unless the locale's `legalReviewed` is true; (3) `npm run i18n:check` fails if such a key is translated early. It also fails on unknown keys and mismatched `{placeholders}`.
- Coverage today: `npm run i18n:check` (run in `apps/mobile`).

## Behaviour
- Choice is stored on the device and on the profile (`PATCH /v1/me/locale`); after sign-in the profile language is applied (`LocaleSync`).
- Financial figures keep Indian digit grouping and Latin digits (`format.ts`) in every language to avoid ambiguity; dates in financial screens are ISO.
- Fonts: Android system fonts render the Indic and Arabic scripts; no custom font is bundled. **Not verified on a device.**
- Right-to-left layout is **not supported** (no confirmed language needs it). If a future language does, RTL handling must be designed and tested then.
- Notifications/email templates are English only.

## To finish
Native-speaker review of the 10 draft catalogues (hi and mr included); human-reviewed legal/consent/risk translations (then set `legalReviewed: true` per language); translation of the remaining ~995 UI keys; the owner supplying the remaining languages (add one `<code>.ts` catalogue, one registry entry here and one entry in the API's `SUPPORTED_LOCALES`; the parity test and `i18n:check` then cover it); on-device script and font checks.
