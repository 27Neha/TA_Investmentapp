# Android release (APK / AAB)

**Status: NOT built. Not verifiable from the sandbox.** The sandbox has Java but no Android SDK, no EAS CLI session and no Expo account, so no APK/AAB has been produced and nothing was run on a device or emulator. The JS bundle does export (`npm run export:android` in `apps/mobile`).

## Configuration found
- `apps/mobile/app.json`: name `TechArtha`, version `1.0.0`, `android.package` = `com.techartha.app` (**unconfirmed: it is permanent once published; confirm before the first upload**), `versionCode` 1, no permissions requested, adaptive icons present.
- `apps/mobile/eas.json`: `preview` -> internal APK, `production` -> app-bundle (AAB, `autoIncrement`, remote version source). Both set `EXPO_PUBLIC_API_URL` to a **placeholder** (`https://REPLACE-WITH-...`).

## Steps (run on your machine, with your Expo account)
1. Decide and confirm the package id; put the real HTTPS API URL in `eas.json` (`EXPO_PUBLIC_*` values are public: never a secret).
2. `npm i -g eas-cli`, `eas login`, then in `apps/mobile`: `eas init` (links the project) .
3. Internal test build: `eas build --platform android --profile preview` (APK; EAS generates and stores the upload keystore on first run: back it up with `eas credentials`).
4. Install the APK on a real device and run `docs/MOBILE-DEVICE-TEST-CHECKLIST.md`.
5. Store build: `eas build --platform android --profile production` (AAB). Google Play needs a developer account, app signing enrolment, privacy policy URL, Data Safety form (declare account, contact, identity-verification and support-file data) and financial-services declarations.
6. The API must be deployed over HTTPS with `CORS_ORIGIN` limited to the admin origin(s); native mobile calls are not subject to CORS.

## Before a production release
API deployed with all production guards passing (`loadConfig`); migrations approved and applied by you; Supabase storage verified (`npm run verify:storage`); real provider credentials where features are to be enabled; legal text approved; device testing done; dependency findings reviewed (`DEPENDENCY-AUDIT.md`).
