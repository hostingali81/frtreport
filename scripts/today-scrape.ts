import {
    checkNewTablesExist,
    createFrtApiScraperSession,
    saveToNewDb,
    logScrapeError,
    logScrapeSuccess
} from '../app/lib/shared-scraper';

// ---------------------------------------------------------------------------
// Today-Scraper — Fast 5-minute cron job
// ---------------------------------------------------------------------------
// Strategy:
//   1. Login to FRT via API session (cached session reused when valid — no browser needed)
//   2. Scrape a rolling recent window (today back TODAY_SCRAPE_LOOKBACK_DAYS, IST)
//      so complaints whose STATUS changed after they were filed are re-fetched,
//      not just brand-new ones.
//   3. Release login (session.close()) as fast as possible
//   4. Upsert with change-detection (saveToNewDb) — new complaints inserted,
//      changed ones (e.g. status flipped to Closed) updated, unchanged skipped.
//   5. Exit. Total target: well within the 8-min GitHub runner budget.
// ---------------------------------------------------------------------------

// Shorter delays than full-scrape because we must fit inside a 5-min window.
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10_000;       // 10s between transient failures
const SESSION_RETRY_DELAY_MS = 30_000; // 30s if there's a login conflict

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIntegerEnv(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getTodayInIST(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const partMap = Object.fromEntries(
        parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );

    return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function subtractDaysIST(dateOnly: string, days: number): string {
    const [y, m, d] = dateOnly.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - days);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    if (error && typeof error === 'object') {
        const maybeError = error as Record<string, unknown>;
        const parts = ['message', 'details', 'hint', 'code']
            .map(key => (maybeError[key] ? `${key}: ${String(maybeError[key])}` : ''))
            .filter(Boolean);

        if (parts.length > 0) return parts.join(' | ');

        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    return String(error);
}

function isSessionConflictError(message: string) {
    return /session expired|another login|login replaced|logged in|unauthorized|unauthorised|FRT login failed: (empty|null) response/i.test(message);
}

function isFatalLoginError(message: string) {
    return /unsuccessful attempt|maximum retry attempts|temporarily blocked|blocked till|five invalid attempts|invalid credentials|invalid user|invalid password|invalid captcha|enter captcha/i.test(message);
}

async function main() {
    const startTime = Date.now();
    const todayIST = getTodayInIST();

    console.log(`[TODAY-SCRAPE] Starting fast today-scraper for ${todayIST}...`);

    try {
        // --- Validate env ---
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
            throw new Error('Missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE)');
        }
        if (!process.env.FRT_USERNAME || !process.env.FRT_PASSWORD) {
            throw new Error('Missing FRT credentials (FRT_USERNAME / FRT_PASSWORD)');
        }

        const useNewSystem = await checkNewTablesExist();
        if (!useNewSystem) {
            throw new Error('Optimized complaints table not found — today-scraper requires the new DB schema.');
        }

        const maxRetries = parseIntegerEnv(process.env.TODAY_SCRAPE_MAX_RETRIES, MAX_RETRIES);
        const retryDelayMs = parseIntegerEnv(process.env.TODAY_SCRAPE_RETRY_DELAY_MS, RETRY_DELAY_MS);
        const sessionRetryDelayMs = parseIntegerEnv(
            process.env.TODAY_SCRAPE_SESSION_RETRY_DELAY_MS,
            SESSION_RETRY_DELAY_MS
        );

        // Re-scrape this many days back so a status flip on a complaint filed a
        // few days ago (but only closed now) is captured. Bounded so the pull
        // stays cheap; long-open stragglers are handled by the periodic full scrape.
        const lookbackDays = parseIntegerEnv(process.env.TODAY_SCRAPE_LOOKBACK_DAYS, 30);
        const fromIST = subtractDaysIST(todayIST, lookbackDays);

        console.log(`[TODAY-SCRAPE] Date: ${fromIST} → ${todayIST} (last ${lookbackDays}d, for status refresh)`);
        console.log(`[TODAY-SCRAPE] Retry policy: max ${maxRetries} attempts`);

        // --- Login + Scrape ---
        // createFrtApiScraperSession will:
        //   a) Try to reuse cached session from Supabase (no browser, instant)
        //   b) If expired/missing: open browser, login, capture API token, close browser
        // After this call, FRT login is "free" again (browser closed).

        let scraperSession: Awaited<ReturnType<typeof createFrtApiScraperSession>> | null = null;
        let lastError: unknown;
        let attempt = 0;

        while (attempt < maxRetries) {
            attempt += 1;
            try {
                console.log(`[TODAY-SCRAPE] Opening FRT session - attempt ${attempt}/${maxRetries}...`);
                scraperSession = await createFrtApiScraperSession(
                    process.env.FRT_USERNAME,
                    process.env.FRT_PASSWORD
                );
                break;
            } catch (error) {
                lastError = error;
                const message = getErrorMessage(error);
                console.error(`[TODAY-SCRAPE] Session open failed (attempt ${attempt}/${maxRetries}): ${message}`);

                if (isFatalLoginError(message)) {
                    console.error('[TODAY-SCRAPE] Fatal auth error — stopping to protect FRT account.');
                    throw error;
                }

                if (attempt >= maxRetries) break;

                const baseDelay = isSessionConflictError(message) ? sessionRetryDelayMs : retryDelayMs;
                const delay = Math.min(baseDelay * attempt, 60_000); // cap at 60s
                const reason = isSessionConflictError(message) ? 'login conflict' : 'transient failure';
                console.log(`[TODAY-SCRAPE] Retrying session in ${Math.round(delay / 1000)}s (${reason})...`);
                await sleep(delay);
            }
        }

        if (!scraperSession) {
            throw new Error(
                `[session] Failed to open FRT session after ${maxRetries} attempts: ${lastError ? getErrorMessage(lastError) : 'unknown error'}`
            );
        }

        // --- Scrape the recent window ---
        let scrapedRows: Record<string, string>[] = [];
        let scrapeError: unknown;

        try {
            console.log(`[TODAY-SCRAPE] Scraping ${fromIST} → ${todayIST}...`);
            const scrapeStart = Date.now();
            const payload = await scraperSession.scrapeRange(fromIST, todayIST);
            const scrapeMs = Date.now() - scrapeStart;

            scrapedRows = (payload.data || []) as Record<string, string>[];
            const validCount = scrapedRows.filter(r => r['Complaint Number']?.trim()).length;

            console.log(
                `[TODAY-SCRAPE] Scraped ${scrapedRows.length} rows (${validCount} valid) in ${(scrapeMs / 1000).toFixed(1)}s`
            );
        } catch (error) {
            scrapeError = error;
            console.error(`[TODAY-SCRAPE] Scrape failed: ${getErrorMessage(error)}`);
        } finally {
            // *** Release login as fast as possible ***
            await scraperSession.close();
            console.log('[TODAY-SCRAPE] FRT session closed — login released.');
        }

        if (scrapeError) {
            throw scrapeError;
        }

        // --- Upsert into Supabase (new + changed rows) ---
        const totalDuration = Math.round((Date.now() - startTime) / 1000);

        if (!scrapedRows.length) {
            console.log('[TODAY-SCRAPE] No rows scraped in window — nothing to write.');
            await logScrapeSuccess(0, 0, 0, totalDuration);
            console.log(`[TODAY-SCRAPE] Done in ${totalDuration}s. (0 rows)`);
            process.exit(0);
        }

        console.log(`[TODAY-SCRAPE] Upserting new + changed complaints (content_hash skips unchanged)...`);
        const saveResult = await saveToNewDb(scrapedRows, totalDuration, 'today_scrape_status_refresh', { recordMetadata: true });

        const finalDuration = Math.round((Date.now() - startTime) / 1000);
        console.log('[TODAY-SCRAPE] Done!', {
            range: `${fromIST}..${todayIST}`,
            scraped: scrapedRows.length,
            new: saveResult.new_rows,
            updated: saveResult.updated_rows,
            duration: `${finalDuration}s`
        });

        process.exit(0);
    } catch (error: unknown) {
        const errorDuration = Math.round((Date.now() - startTime) / 1000);
        console.error('[TODAY-SCRAPE] Fatal Error:', getErrorMessage(error));
        await logScrapeError(
            error instanceof Error ? error : new Error(getErrorMessage(error)),
            errorDuration
        );
        process.exit(1);
    }
}

main();
