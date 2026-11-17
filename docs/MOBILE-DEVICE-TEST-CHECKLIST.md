# Mobile device test checklist (NOT yet performed)

No emulator or physical device was available to the build environment, so **none of this has been run**. The Android bundle compiles (`expo export --platform android` succeeded) and TypeScript passes; that is all that is verified.

Setup: `cd apps/mobile && npx expo install --fix && npx expo start` — use your computer's LAN IP in `EXPO_PUBLIC_API_URL` on a physical phone. API running with `EMAIL_PROVIDER=console` (OTP in API log) or real ZeptoMail.

| # | Check | Pass/Fail | Notes |
|---|---|---|---|
| 1 | Welcome shows logo, language buttons, Log in / Create account | | |
| 2 | Logo is the supplied lockup, not stretched, same size on every screen | | |
| 3 | Header identical height on Welcome/Signup/Verify/Login/Forgot; no page title under logo | | |
| 4 | Back button returns to previous screen on each auth screen; none on Welcome | | |
| 5 | Signup: consent boxes start UNCHECKED; Continue disabled until both checked | | |
| 6 | Signup → email arrives → code verifies → Login | | |
| 7 | Signup with email delivery failing → message + Resend works immediately | | |
| 8 | Login unverified account → taken to Verify screen, new code sent | | |
| 9 | Forgot password: email → code → new password → Login; resend countdown shows | | |
| 10 | Forgot password: wrong code ×5 → locked message; weak password rejected without losing session | | |
| 11 | After login: 5 tabs, labels not clipped, header identical to auth screens | | |
| 12 | Explore/Goals/Portfolio show "coming soon" only (they are placeholders) | | |
| 13 | **Android gesture navigation**: tab bar not under the gesture bar; no overlap | | |
| 14 | **Android three-button navigation**: tab bar above buttons; no overlap | | |
| 15 | Keyboard open on Signup (long form): focused field visible, can scroll, Continue reachable | | |
| 16 | Small phone (≈5") and large phone/tablet: no clipping | | |
| 17 | System font size at largest: labels wrap, buttons grow, nothing cut off | | |
| 18 | Switch to Hindi / Marathi: layout holds; untranslated strings fall back to English (expected, see i18n report) | | |
| 19 | Kill app while logged in → reopen → still logged in; Log out → returns to Welcome | | |
| 20 | Airplane mode → friendly network error on login/signup | | |
