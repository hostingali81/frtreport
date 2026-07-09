// ---------------------------------------------------------------------------
// Calling-Sync — keeps the live_complaints grid (FormId 13339) fresh.
// ---------------------------------------------------------------------------
// Why this exists: the calling app's live grid is only pulled from FRT when
// /api/calling/sync runs, and its FRT session (`frt_calling_session`) is
// separate from the report scraper's (`frt_api_session`). Left to the app's
// manual "Refresh" button, that session goes stale between syncs, and the next
// sync on Vercel needs a browser recapture that overruns Vercel's 60s limit
// ("Timed out waiting for FormId 13339 request during capture").
//
// Running this on a GitHub Actions schedule (real Chrome, generous timeout):
//   1. keeps `live_complaints` fresh automatically (new complaints appear in
//      the app without anyone tapping Refresh), and
//   2. refreshes the cached calling session every run, so the Vercel /sync
//      path almost always replays a warm session instead of recapturing.
//
// Mirrors today-scrape.ts: reads FRT + Supabase creds from env (CI secrets),
// falling back to .env.local for local runs.
import { existsSync, readFileSync } from 'fs';
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
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}
loadEnvLocal();

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIntegerEnv(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

// Don't hammer FRT (risking an account lockout) on a hard auth failure.
function isFatalLoginError(message: string) {
    return /unsuccessful attempt|maximum retry attempts|temporarily blocked|blocked till|five invalid attempts|invalid credentials|invalid user|invalid password|invalid captcha|enter captcha/i.test(message);
}

async function main() {
    const startTime = Date.now();
    console.log('[CALLING-SYNC] Starting live-grid sync...');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
        throw new Error('Missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE)');
    }
    if (!process.env.FRT_USERNAME || !process.env.FRT_PASSWORD) {
        throw new Error('Missing FRT credentials (FRT_USERNAME / FRT_PASSWORD)');
    }

    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

    const { createFrtCallingClient, syncLiveComplaints } = await import('../app/lib/frt-calling');

    const maxRetries = parseIntegerEnv(process.env.CALLING_SYNC_MAX_RETRIES, 3);
    const retryDelayMs = parseIntegerEnv(process.env.CALLING_SYNC_RETRY_DELAY_MS, 15_000);

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[CALLING-SYNC] Attempt ${attempt}/${maxRetries}: fetching FormId 13339 grid...`);
            const client = await createFrtCallingClient(process.env.FRT_USERNAME, process.env.FRT_PASSWORD);
            const rows = await client.fetchList();
            const result = await syncLiveComplaints(rows);

            const duration = Math.round((Date.now() - startTime) / 1000);
            console.log('[CALLING-SYNC] Done!', { ...result, duration: `${duration}s` });
            process.exit(0);
        } catch (error) {
            lastError = error;
            const message = getErrorMessage(error);
            console.error(`[CALLING-SYNC] Attempt ${attempt}/${maxRetries} failed: ${message}`);

            if (isFatalLoginError(message)) {
                console.error('[CALLING-SYNC] Fatal auth error — stopping to protect the FRT account.');
                break;
            }
            if (attempt >= maxRetries) break;

            const delay = Math.min(retryDelayMs * attempt, 60_000);
            console.log(`[CALLING-SYNC] Retrying in ${Math.round(delay / 1000)}s...`);
            await sleep(delay);
        }
    }

    throw new Error(`Calling sync failed after ${maxRetries} attempts: ${lastError ? getErrorMessage(lastError) : 'unknown error'}`);
}

main().catch(error => {
    console.error('[CALLING-SYNC] FAILED:', getErrorMessage(error));
    process.exit(1);
});
