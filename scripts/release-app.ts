/**
 * Publish a new FRT Calling app release for the in-app self-updater.
 *
 * Uploads the built APK to the public Supabase Storage bucket `app-updates`
 * and rewrites `latest.json` — every installed app checks that manifest on
 * launch and offers the update (mobile/lib/updater.dart).
 *
 * Release flow:
 *   1. Bump version in mobile/pubspec.yaml (e.g. 1.0.1+2 -> 1.0.2+3).
 *      The number after `+` is the build number the updater compares.
 *   2. cd mobile && flutter build apk --release --split-per-abi
 *      (per-ABI APKs: a fat APK exceeds Supabase's 50MB upload limit)
 *   3. npx tsx scripts/release-app.ts --notes "What changed"
 *
 * Options:
 *   --notes "text"   Shown in the update dialog (optional).
 *   --min-build N    Force-update floor: installs older than build N cannot
 *                    dismiss the update dialog (optional, sticky per release).
 */

import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const BUCKET = 'app-updates';
const APK_DIR = path.resolve('mobile/build/app/outputs/flutter-apk');
const PUBSPEC_PATH = path.resolve('mobile/pubspec.yaml');
// arm64 first: it's also the manifest's fallback `url` for devices whose ABI
// list matches nothing (x86 emulators aside, that shouldn't happen).
const ABIS = ['arm64-v8a', 'armeabi-v7a'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function upload(objectPath: string, body: Buffer, contentType: string, cacheSeconds: number) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'cache-control': String(cacheSeconds),
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Upload of ${objectPath} failed: HTTP ${res.status} ${await res.text()}`);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE missing in .env.local');

  const m = readFileSync(PUBSPEC_PATH, 'utf8').match(/^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$/m);
  if (!m) throw new Error('Could not parse `version: X.Y.Z+N` from mobile/pubspec.yaml');
  const [, version, buildStr] = m;
  const build = Number(buildStr);
  // Hard limit from `flutter build --split-per-abi` (versionCode = abiOffset*1000
  // + build) AND the app's Updater.currentBuild() (`raw % 1000`). A build >= 1000
  // would collide across ABIs and break update detection on installed devices.
  if (build >= 1000) {
    throw new Error(`Build number ${build} >= 1000 breaks the split-per-abi versionCode scheme — reset the build counter (bump the version instead).`);
  }

  const urls: Record<string, string> = {};
  for (const abi of ABIS) {
    const apkPath = path.join(APK_DIR, `app-${abi}-release.apk`);
    if (!existsSync(apkPath)) {
      throw new Error(`APK not found — run \`flutter build apk --release --split-per-abi\` in mobile/ first.\n  ${apkPath}`);
    }
    const ageMin = Math.round((Date.now() - statSync(apkPath).mtimeMs) / 60000);
    if (ageMin > 30) console.warn(`⚠ ${abi} APK was built ${ageMin} minutes ago — is it the right one?`);

    const apkName = `frt-calling-v${build}-${abi}.apk`;
    const apk = readFileSync(apkPath);
    console.log(`Uploading ${apkName} (${(apk.length / 1024 / 1024).toFixed(1)} MB, version ${version}+${build})...`);
    // Versioned filename => effectively immutable, long CDN cache is safe.
    await upload(apkName, apk, 'application/vnd.android.package-archive', 31536000);
    urls[abi] = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${apkName}`;
  }

  const manifest = {
    // Legacy bridge — DO NOT change the formula. App versions 1.0.1/1.0.2
    // compared this against their RAW versionCode, which `--split-per-abi`
    // offsets per ABI (arm64 = 2000+N, v7a = 1000+N). Publishing 2000+N keeps
    // it above every legacy install's raw code so they still see updates.
    build: 2000 + build,
    // Plain pubspec build number — what 1.0.3+ installs compare (they strip
    // the ABI offset with % 1000 on their side).
    buildNumber: build,
    version,
    url: urls['arm64-v8a'],
    urls,
    notes: arg('notes') ?? '',
    minBuild: Number(arg('min-build') ?? 0),
    publishedAt: new Date().toISOString(),
  };
  await upload('latest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json', 60);

  console.log('✅ Published. Installed apps will see the update on next launch.');
  console.log(`   APK:      ${manifest.url}`);
  console.log(`   Manifest: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/latest.json`);
}

main().catch((e) => {
  console.error(`❌ ${e.message ?? e}`);
  process.exit(1);
});
