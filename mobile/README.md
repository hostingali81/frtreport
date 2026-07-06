# FRT Calling (Android)

Native Android app for the FRT calling workflow — a thin client over the
Next.js `/api` endpoints (Supabase auth, Bearer token). See `../PROJECT-PLAN.md`.

## Releasing an update (in-app self-update, no Play Store)

Installed apps check `latest.json` in the public Supabase Storage bucket
`app-updates` on every launch and offer to download + install the new APK
themselves (`lib/updater.dart` + `installApk` in `MainActivity.kt`).

To ship an update:

1. Bump `version:` in `pubspec.yaml` — e.g. `1.0.1+2` → `1.0.2+3`.
   **The number after `+` (build number) must go up**; that's what the
   updater compares.
2. Build: `flutter build apk --release --split-per-abi`
   (per-ABI APKs — a fat APK is over Supabase's 50MB upload limit)
3. Publish (from the repo root, one level up):
   `npx tsx scripts/release-app.ts --notes "What changed"`

Optional: `--min-build N` makes the update mandatory for installs older than
build N (their update dialog can't be dismissed).

Note: `--split-per-abi` offsets each APK's real versionCode per ABI
(v7a = 1000+N, arm64 = 2000+N). The updater strips that with `% 1000`, and the
manifest publishes both `buildNumber` (plain N) and a legacy `build` (2000+N)
for 1.0.1/1.0.2 installs that compared raw codes. Don't change either formula.

## Signing — do not lose `android/app/frt-upload.keystore`

Release builds are signed with `android/app/frt-upload.keystore`
(via `android/key.properties`). An update only installs over an existing app
if it's signed with the **same key**, so this keystore must never change.
It's deliberately committed to the repo as the durable copy. (Historically it
is the promoted debug keystore — passwords are the well-known debug defaults,
acceptable because the app is distributed privately, not on the Play Store.)

## Local development

`lib/config.dart` defaults `API_BASE_URL` to the deployed Vercel app. Override
for local dev:

- Android emulator: `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000`
- Physical device: `flutter run --dart-define=API_BASE_URL=http://<PC-LAN-IP>:3000`
