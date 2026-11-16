# Localisation (13-language requirement)

**Registry:** `apps/mobile/src/i18n/locales.ts` is the single configurable list. The API mirrors it in `SUPPORTED_LOCALES` (`apps/api/src/auth/dto.ts`); `test/locale-registry-parity.spec.ts` fails if they differ.

| Status | Languages |
|---|---|
| Owner-confirmed (11) | English, Hindi, Marathi, Gujarati, Punjabi, Bengali, Tamil, Telugu, Assamese, Kannada, Malayalam |
| **Proposed, awaiting owner confirmation (2)** | Odia (`or`), Urdu (`ur`, right-to-left). The list stays configurable; edit both registries together to change them. |

## What is translated
- English is complete (1,035 keys). The other 12 languages carry **40 draft UI labels** (navigation, login/signup/verify/reset, common buttons). Everything else falls back to English. These are machine-assisted drafts and **need native-speaker review**; none is marked reviewed (`legalReviewed: false`).
- **Legal, consent, financial and risk text stays English** for every non-English language until a human reviewer signs it off. Enforced three ways: (1) `LEGAL_KEY_PREFIXES` (`disclosure. consent. risk. legal. signup.accept signup.legalUnavailable kyc. invest. pay. sip. mandate. guardian.`); (2) a runtime guard in `translate()` that ignores any translation for these keys unless the locale's `legalReviewed` is true; (3) `npm run i18n:check` fails if such a key is translated early. It also fails on unknown keys and mismatched `{placeholders}`.
- Coverage today: `npm run i18n:check` (run in `apps/mobile`).

## Behaviour
- Choice is stored on the device and on the profile (`PATCH /v1/me/locale`); after sign-in the profile language is applied (`LocaleSync`).
- Financial figures keep Indian digit grouping and Latin digits (`format.ts`) in every language to avoid ambiguity; dates in financial screens are ISO.
- Fonts: Android system fonts render the Indic and Arabic scripts; no custom font is bundled. **Not verified on a device.**
- Urdu sets the RTL flag, which Android applies on the next app launch. Layout mirroring of every screen is **untested**.
- Notifications/email templates are English only.

## To finish
Native-speaker review of the 12 draft catalogues; human-reviewed legal/consent/risk translations (then set `legalReviewed: true` per language); translation of the remaining ~995 UI keys; owner confirmation of the final 13th/12th language; on-device script and RTL checks.
