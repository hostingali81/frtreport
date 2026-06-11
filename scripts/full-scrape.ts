import {
    checkNewTablesExist,
    createFrtApiScraperSession,
    createFrtScraperSession,
    saveToNewDb,
    saveToOldDb,
    logScrapeError,
    logScrapeSuccess
} from '../app/lib/shared-scraper';

// Fast path: pull reports over the captured API session (no browser per pull).
// Set FRT_USE_BROWSER=1 to fall back to the old DOM-based scraper.
const createScraperSession = process.env.FRT_USE_BROWSER === '1'
    ? createFrtScraperSession
    : createFrtApiScraperSession;

type MonthRange = {
    label: string;
    from: string;
    to: string;
};

type ScrapedRow = Record<string, string | undefined>;

type MonthResult = {
    range: MonthRange;
    scraped: number;
    valid: number;
    newRows: number;
    updatedRows: number;
    duration: number;
    rows: ScrapedRow[];
};

type ScraperSession = Awaited<ReturnType<typeof createFrtScraperSession>>;

const DEFAULT_START_DATE = '2025-11-01';
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 30000;
const DEFAULT_SESSION_RETRY_DELAY_MS = 120000;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIntegerEnv(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getTodayInIST() {
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

function parseDateOnly(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
    }

    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
    ) {
        throw new Error(`Invalid date "${value}".`);
    }

    return date;
}

function formatDateOnly(date: Date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function buildMonthlyRanges(startDate: string, endDate: string): MonthRange[] {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);

    if (start > end) {
        throw new Error(`Start date ${startDate} is after end date ${endDate}.`);
    }

    const ranges: MonthRange[] = [];
    let cursor = start;

    while (cursor <= end) {
        const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
        const rangeEnd = monthEnd < end ? monthEnd : end;
        const label = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;

        ranges.push({
            label,
            from: formatDateOnly(cursor),
            to: formatDateOnly(rangeEnd)
        });

        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }

    return ranges;
}

function formatAttempt(attempt: number, maxRetries: number) {
    return maxRetries === 0 ? `${attempt}/unlimited` : `${attempt}/${maxRetries}`;
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    if (error && typeof error === 'object') {
        const maybeError = error as Record<string, unknown>;
        const parts = ['message', 'details', 'hint', 'code']
            .map(key => maybeError[key] ? `${key}: ${String(maybeError[key])}` : '')
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

async function createScraperSessionWithRetries(
    username: string,
    password: string,
    maxRetries: number,
    retryDelayMs: number,
    sessionRetryDelayMs: number
): Promise<ScraperSession> {
    let attempt = 0;
    let lastError: unknown;

    while (maxRetries === 0 || attempt < maxRetries) {
        attempt += 1;

        try {
            console.log(`[SCRIPT] Opening FRT session - attempt ${formatAttempt(attempt, maxRetries)}`);
            return await createScraperSession(username, password);
        } catch (error: unknown) {
            lastError = error;
            const message = getErrorMessage(error);
            console.error(`[SCRIPT] FRT session open failed on attempt ${formatAttempt(attempt, maxRetries)}: ${message}`);

            if (isFatalLoginError(message)) {
                console.error('[SCRIPT] Login/auth failure detected. Stopping retries to avoid locking the FRT account.');
                break;
            }

            if (maxRetries !== 0 && attempt >= maxRetries) {
                break;
            }

            const baseDelay = isSessionConflictError(message) ? sessionRetryDelayMs : retryDelayMs;
            const delay = Math.min(baseDelay * attempt, 10 * 60 * 1000);
            const reason = isSessionConflictError(message) ? 'session/login conflict' : 'transient failure';
            console.log(`[SCRIPT] Retrying FRT session open in ${Math.round(delay / 1000)}s after ${reason}...`);
            await sleep(delay);
        }
    }

    throw new Error(`[session] ${lastError ? getErrorMessage(lastError) : 'Failed to open FRT session'}`);
}

async function scrapeAndSaveMonth(
    range: MonthRange,
    scraperSession: ScraperSession,
    useNewSystem: boolean,
    maxRetries: number,
    retryDelayMs: number,
    sessionRetryDelayMs: number
): Promise<MonthResult> {
    let attempt = 0;
    let lastError: unknown;

    while (maxRetries === 0 || attempt < maxRetries) {
        attempt += 1;
        const monthStart = Date.now();

        try {
            console.log(
                `[SCRIPT] Scraping ${range.label} (${range.from} to ${range.to}) - attempt ${formatAttempt(attempt, maxRetries)}`
            );

            const payload = await scraperSession.scrapeRange(range.from, range.to);
            const duration = Math.round((Date.now() - monthStart) / 1000);
            const rows = (payload.data || []) as ScrapedRow[];
            const validRows = rows.filter(row => row['Complaint Number']?.trim());

            if (!validRows.length) {
                throw new Error(`No valid complaint rows scraped for ${range.label}`);
            }

            console.log(`[SCRIPT] ${range.label} scraped ${rows.length} rows, ${validRows.length} valid. Saving...`);

            let newRows = 0;
            let updatedRows = 0;

            if (useNewSystem) {
                const saveResult = await saveToNewDb(
                    rows,
                    duration,
                    `github_action_full_monthly:${range.label}`,
                    { recordMetadata: false }
                );
                newRows = saveResult.new_rows;
                updatedRows = saveResult.updated_rows;
            }

            console.log(
                `[SCRIPT] ${range.label} done: scraped=${rows.length}, valid=${validRows.length}, new=${newRows}, updated=${updatedRows}, duration=${duration}s`
            );

            return {
                range,
                scraped: rows.length,
                valid: validRows.length,
                newRows,
                updatedRows,
                duration,
                rows
            };
        } catch (error: unknown) {
            lastError = error;
            const message = getErrorMessage(error);
            const duration = Math.round((Date.now() - monthStart) / 1000);
            console.error(
                `[SCRIPT] ${range.label} failed on attempt ${formatAttempt(attempt, maxRetries)} after ${duration}s: ${message}`
            );

            if (isFatalLoginError(message)) {
                console.error('[SCRIPT] Login/auth failure detected. Stopping retries to avoid locking the FRT account.');
                break;
            }

            if (maxRetries !== 0 && attempt >= maxRetries) {
                break;
            }

            const baseDelay = isSessionConflictError(message) ? sessionRetryDelayMs : retryDelayMs;
            const delay = Math.min(baseDelay * attempt, 10 * 60 * 1000);
            const reason = isSessionConflictError(message) ? 'session/login conflict' : 'transient failure';
            console.log(`[SCRIPT] Retrying ${range.label} in ${Math.round(delay / 1000)}s after ${reason}...`);
            await sleep(delay);
        }
    }

    throw new Error(`[${range.label}] ${lastError ? getErrorMessage(lastError) : 'Failed to scrape month'}`);
}

async function main() {
    console.log('[SCRIPT] Starting Monthly Full Daily Scrape...');
    const startTime = Date.now();

    try {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
            throw new Error('Missing Supabase credentials');
        }
        if (!process.env.FRT_USERNAME || !process.env.FRT_PASSWORD) {
            throw new Error('Missing FRT credentials');
        }

        const useNewSystem = await checkNewTablesExist();
        console.log(`[SCRIPT] System detected: ${useNewSystem ? 'Optimized (Supabase Complaint Table)' : 'Legacy (JSON Blob)'}`);

        const fromDate = process.env.FULL_SCRAPE_START_DATE || DEFAULT_START_DATE;
        const toDate = process.env.FULL_SCRAPE_END_DATE || getTodayInIST();
        const maxRetries = parseIntegerEnv(process.env.FULL_SCRAPE_MAX_RETRIES, DEFAULT_MAX_RETRIES);
        const retryDelayMs = parseIntegerEnv(process.env.FULL_SCRAPE_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
        const sessionRetryDelayMs = parseIntegerEnv(
            process.env.FULL_SCRAPE_SESSION_RETRY_DELAY_MS,
            DEFAULT_SESSION_RETRY_DELAY_MS
        );
        const ranges = buildMonthlyRanges(fromDate, toDate);

        console.log(`[SCRIPT] Date Range: ${fromDate} to ${toDate}`);
        console.log(
            `[SCRIPT] Monthly chunks: ${ranges.map(range => `${range.label}(${range.from}..${range.to})`).join(', ')}`
        );
        console.log(`[SCRIPT] Retry policy: ${maxRetries === 0 ? 'unlimited attempts' : `${maxRetries} attempts`} per month`);

        const results: MonthResult[] = [];
        const legacyRows: ScrapedRow[] = [];
        const scraperSession = await createScraperSessionWithRetries(
            process.env.FRT_USERNAME,
            process.env.FRT_PASSWORD,
            maxRetries,
            retryDelayMs,
            sessionRetryDelayMs
        );

        try {
            for (const range of ranges) {
                const result = await scrapeAndSaveMonth(
                    range,
                    scraperSession,
                    useNewSystem,
                    maxRetries,
                    retryDelayMs,
                    sessionRetryDelayMs
                );

                results.push(result);

                if (!useNewSystem) {
                    legacyRows.push(...result.rows);
                }
            }
        } finally {
            await scraperSession.close();
        }

        const totalDuration = Math.round((Date.now() - startTime) / 1000);
        const totals = results.reduce(
            (acc, result) => ({
                scraped: acc.scraped + result.scraped,
                valid: acc.valid + result.valid,
                newRows: acc.newRows + result.newRows,
                updatedRows: acc.updatedRows + result.updatedRows
            }),
            { scraped: 0, valid: 0, newRows: 0, updatedRows: 0 }
        );

        if (useNewSystem) {
            await logScrapeSuccess(totals.valid, totals.newRows, totals.updatedRows, totalDuration);
        } else {
            const scrapedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            await saveToOldDb(
                {
                    clickedAction: 'monthly-full-scrape',
                    data: legacyRows,
                    pageInfo: { totalPages: results.length, totalRows: legacyRows.length }
                },
                scrapedAt
            );
        }

        console.log('[SCRIPT] Monthly full scrape success!', {
            months: results.length,
            scraped: totals.scraped,
            valid: totals.valid,
            new: totals.newRows,
            updated: totals.updatedRows,
            duration: totalDuration
        });

        process.exit(0);
    } catch (error: unknown) {
        console.error('[SCRIPT] Fatal Error:', error);
        const errorDuration = Math.round((Date.now() - startTime) / 1000);
        await logScrapeError(error instanceof Error ? error : new Error(getErrorMessage(error)), errorDuration);
        process.exit(1);
    }
}

main();
