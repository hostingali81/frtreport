import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { existsSync } from 'fs';

// --- Types ---
export interface ScrapeResult {
    success: boolean;
    data?: any[];
    error?: string;
    scrapeType?: string;
    debug?: any;
    stats?: any;
    cached?: boolean;
    lastScrapedAt?: string;
    source?: string;
    system?: string;
    message?: string;
    dateRange?: { from: string; to: string };
    suggestion?: string;
}

// --- Supabase Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

// --- Helper Functions ---

function describeError(error: unknown) {
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

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientDbError(error: unknown) {
    const description = describeError(error).toLowerCase();
    return (
        description.includes('57014') ||
        description.includes('timeout') ||
        description.includes('temporarily') ||
        description.includes('network') ||
        description.includes('fetch failed') ||
        description.includes('too many connections') ||
        description.includes('rate limit') ||
        description.includes('429') ||
        description.includes('500') ||
        description.includes('502') ||
        description.includes('503') ||
        description.includes('504')
    );
}

function parsePositiveInteger(value: string | undefined, fallback: number, max: number) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
) {
    if (items.length === 0) return;

    let nextIndex = 0;
    let firstError: unknown;
    let hasError = false;
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (!hasError) {
                const currentIndex = nextIndex;
                nextIndex += 1;

                if (currentIndex >= items.length) return;

                try {
                    await worker(items[currentIndex], currentIndex);
                } catch (error) {
                    hasError = true;
                    firstError = error;
                    return;
                }
            }
        })
    );

    if (hasError) throw firstError;
}

// Parse date in IST timezone (India Standard Time)
export function parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Match: DD/MM/YYYY HH:MM AM/PM
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    const [, day, month, year, hour, minute, period] = match;
    let hours = parseInt(hour);
    const mins = parseInt(minute);

    // Convert to 24-hour format
    if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;

    // Create date in IST (UTC+5:30)
    // Store as-is without timezone conversion
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, mins, 0, 0);

    return date;
}

// Convert IST date to ISO string for storage
export function toISTISOString(date: Date | null): string | null {
    if (!date) return null;

    // Format: YYYY-MM-DDTHH:MM:SS+05:30
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}

// Get current time in IST and format for storage
export function getCurrentISTTime(): string {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');
    const hours = String(istTime.getUTCHours()).padStart(2, '0');
    const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}

// --- Database Functions ---

export async function checkNewTablesExist() {
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('complaints').select('id').limit(1);
        return !error;
    } catch {
        return false;
    }
}

export async function loadFromOldDb() {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('reports')
        .select('payload')
        .eq('key', 'frt_supply')
        .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
        ...data.payload,
        source: 'supabase_old',
        system: 'legacy'
    };
}

export async function saveToOldDb(payload: any, timestamp: string) {
    if (!supabase) return;
    const dataToSave = { ...payload, lastScrapedAt: timestamp };
    await supabase
        .from('reports')
        .upsert({ key: 'frt_supply', payload: dataToSave }, { onConflict: 'key' });
}

export async function getLastSuccessfulScrape() {
    if (!supabase) return null;
    const { data } = await supabase
        .from('scrape_metadata')
        .select('last_scrape_at, total_rows')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return data;
}

export async function getLastComplaintDate(): Promise<string | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('complaints')
        .select('complaint_date')
        .order('complaint_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data?.complaint_date) return null;
    return data.complaint_date;
}

export async function loadFromNewDb() {
    if (!supabase) return null;

    // Fetch ALL rows in batches
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('complaints')
            .select('complaint_number, division, sub_division, sub_station, consumer_name, consumer_mobile, consumer_address, complaint_type, complaint_sub_type, status, closed_status, closed_by, complaint_date, closed_date, closing_remarks, area_type, feeder')
            .order('complaint_date', { ascending: false })
            .range(from, from + batchSize - 1);

        if (error || !data || data.length === 0) break;

        allData = allData.concat(data);

        if (data.length < batchSize) break;
        from += batchSize;
    }

    const { count } = await supabase
        .from('complaints')
        .select('id', { count: 'exact', head: true });

    const lastScrape = await getLastSuccessfulScrape();
    
    // Format timestamp for display
    const lastScrapedAt = lastScrape?.last_scrape_at
        ? new Date(lastScrape.last_scrape_at).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        : null;
    
    const formatDT = (dt: string | null) => {
        if (!dt) return null;
        return new Date(dt).toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
            month: '2-digit', day: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).replace(',', '');
    };
    
    return {
        data: allData.map(row => ({
            'Complaint Number': row.complaint_number,
            'Division': row.division,
            'Sub Division': row.sub_division,
            'Sub Station': row.sub_station,
            'Consumer Name': row.consumer_name,
            'Consumer Mobile': row.consumer_mobile,
            'Consumer Address': row.consumer_address,
            'Complaint Type': row.complaint_type,
            'Complaint Sub Type': row.complaint_sub_type,
            'Status': row.status,
            'Closed Status': row.closed_status,
            'Closed By': row.closed_by,
            'Complaint Date and Time': formatDT(row.complaint_date),
            'Closed Date': formatDT(row.closed_date),
            'Closing Remarks': row.closing_remarks,
            'Area Type': row.area_type,
            'Feeder': row.feeder
        })),
        total: count || 0,
        lastScrapedAt,
        source: 'supabase_new',
        system: 'optimized'
    };
}

export async function saveToNewDb(
    rows: any[],
    scrapeDuration: number,
    scrapeType: string,
    options: { recordMetadata?: boolean } = {}
) {
    if (!supabase || !rows.length) return { new_rows: 0, updated_rows: 0 };

    // Deduplicate rows based on Complaint Number
    const validRowsMap = new Map();
    rows.forEach(r => {
        const cn = r['Complaint Number']?.trim();
        if (cn) validRowsMap.set(cn, r);
    });
    const validRows = Array.from(validRowsMap.values());

    if (!validRows.length) return { new_rows: 0, updated_rows: 0 };

    const complaintNumbers = validRows.map(r => r['Complaint Number']);
    const complaintNumberBatches: string[][] = [];

    for (let i = 0; i < complaintNumbers.length; i += 500) {
        complaintNumberBatches.push(complaintNumbers.slice(i, i + 500));
    }

    const lookupConcurrency = parsePositiveInteger(
        process.env.SUPABASE_LOOKUP_CONCURRENCY || process.env.SUPABASE_SAVE_CONCURRENCY,
        4,
        8
    );
    const existingRecordBatches: Array<Array<{ complaint_number: string; content_hash: string | null }>> =
        new Array(complaintNumberBatches.length);

    await runWithConcurrency(complaintNumberBatches, lookupConcurrency, async (batch, batchIndex) => {
        const { data, error } = await supabase
            .from('complaints')
            .select('complaint_number, content_hash')
            .in('complaint_number', batch);

        if (error) {
            const start = batchIndex * 500 + 1;
            throw new Error(`Existing complaint lookup failed (${start}-${start + batch.length - 1}): ${describeError(error)}`);
        }

        existingRecordBatches[batchIndex] = data || [];
    });

    const existingHashes = new Map(
        existingRecordBatches.flat().map(r => [r.complaint_number, r.content_hash])
    );

    const allRecords = validRows.map(row => {
        const complaintDate = parseDate(row['Complaint Date and Time'] || '');
        const closedDate = parseDate(row['Closed Date'] || '');

        const record = {
            complaint_number: row['Complaint Number'],
            complaint_date: toISTISOString(complaintDate),
            division: row['Division'],
            sub_division: row['Sub Division'],
            sub_station: row['Sub Station'],
            consumer_name: row['Consumer Name'],
            consumer_mobile: row['Consumer Mobile'],
            consumer_address: row['Consumer Address'],
            complaint_type: row['Complaint Type'],
            complaint_sub_type: row['Complaint Sub Type'],
            status: row['Status'],
            closed_status: row['Closed Status'],
            closed_by: row['Closed By'],
            closed_date: toISTISOString(closedDate),
            closing_remarks: row['Closing Remarks'],
            area_type: row['Area Type'],
            feeder: row['Feeder'] || null
        };

        return { ...record, content_hash: createHash('md5').update(JSON.stringify(record)).digest('hex') };
    });

    // Skip rows whose content is identical to what is stored.
    const newRecords = allRecords.filter(r => !existingHashes.has(r.complaint_number));
    const changedRecords = allRecords.filter(r =>
        existingHashes.has(r.complaint_number) && existingHashes.get(r.complaint_number) !== r.content_hash
    );
    const upsertData = [...newRecords, ...changedRecords];
    const newRowsCount = newRecords.length;
    const updatedRowsCount = changedRecords.length;
    const skippedCount = allRecords.length - upsertData.length;

    if (skippedCount > 0) {
        console.log(`[DB] Skipping ${skippedCount} unchanged row(s); writing ${upsertData.length}.`);
    }

    // Each written row pays GIN trigram + covering index maintenance
    // (~30ms/row on this instance), so keep batches well inside the 8s
    // statement timeout.
    const upsertBatchSize = parsePositiveInteger(process.env.SUPABASE_UPSERT_BATCH_SIZE, 250, 1000);
    const batches: Array<typeof upsertData> = [];
    for (let i = 0; i < upsertData.length; i += upsertBatchSize) {
        batches.push(upsertData.slice(i, i + upsertBatchSize));
    }

    const upsertConcurrency = parsePositiveInteger(
        process.env.SUPABASE_UPSERT_CONCURRENCY || process.env.SUPABASE_SAVE_CONCURRENCY,
        3,
        6
    );

    await runWithConcurrency(batches, upsertConcurrency, async (batch, batchIndex) => {
        let attempt = 0;

        while (true) {
            attempt += 1;
            const { error } = await supabase
                .from('complaints')
                .upsert(batch, { onConflict: 'complaint_number', ignoreDuplicates: false });

            if (!error) break;

            const description = describeError(error);
            if (attempt >= 3 || !isTransientDbError(error)) {
                throw new Error(`Failed to upsert complaint batch ${batchIndex + 1}/${batches.length}: ${description}`);
            }

            const delay = Math.min(2000 * attempt, 10000);
            console.warn(
                `Complaint batch ${batchIndex + 1}/${batches.length} failed on attempt ${attempt}/3: ${description}. Retrying in ${delay}ms.`
            );
            await sleep(delay);
        }
    });

    if (options.recordMetadata !== false) {
        await logScrapeSuccess(validRows.length, newRowsCount, updatedRowsCount, scrapeDuration);
    }

    return { new_rows: newRowsCount, updated_rows: updatedRowsCount };
}

// Insert-only variant for the fast 5-minute today-scraper.
// Unlike saveToNewDb(), this function:
//   - Does NOT update any existing rows (no upsert on conflicts)
//   - Does NOT check content_hash — if complaint_number exists, skip it entirely
//   - Uses ignoreDuplicates:true as a DB-level safety net
// This keeps the today-scraper lean: only new complaints hit the DB,
// no index churn from re-writing unchanged rows.
//
// One exception: rows whose stored status is NULL are "slim" rows created by
// the calling app's live sync (grid metadata only — no status/consumer data).
// Those are upserted with the full report record so a complaint that reached
// the live feed first doesn't sit status-less on the dashboard until the
// nightly full scrape.
export async function insertOnlyNewDb(
    rows: any[],
    scrapeDuration: number,
    options: { recordMetadata?: boolean } = {}
) {
    if (!supabase || !rows.length) return { new_rows: 0, skipped_rows: 0, enriched_rows: 0 };

    // Deduplicate input rows by Complaint Number (last one wins within the batch)
    const validRowsMap = new Map<string, any>();
    for (const r of rows) {
        const cn = r['Complaint Number']?.trim();
        if (cn) validRowsMap.set(cn, r);
    }
    const validRows = Array.from(validRowsMap.values());
    if (!validRows.length) return { new_rows: 0, skipped_rows: 0, enriched_rows: 0 };

    const complaintNumbers = validRows.map(r => r['Complaint Number'] as string);

    // Batch lookup: which complaint_numbers already exist in DB?
    const lookupBatchSize = 500;
    const lookupBatches: string[][] = [];
    for (let i = 0; i < complaintNumbers.length; i += lookupBatchSize) {
        lookupBatches.push(complaintNumbers.slice(i, i + lookupBatchSize));
    }

    const lookupConcurrency = parsePositiveInteger(
        process.env.SUPABASE_LOOKUP_CONCURRENCY || process.env.SUPABASE_SAVE_CONCURRENCY,
        4,
        8
    );
    const existingRecordBatches: Array<Array<{ complaint_number: string; status: string | null }>> =
        new Array(lookupBatches.length);

    await runWithConcurrency(lookupBatches, lookupConcurrency, async (batch, batchIndex) => {
        const { data, error } = await supabase!
            .from('complaints')
            .select('complaint_number, status')
            .in('complaint_number', batch);

        if (error) {
            const start = batchIndex * lookupBatchSize + 1;
            throw new Error(
                `Complaint existence check failed (${start}-${start + batch.length - 1}): ${describeError(error)}`
            );
        }
        existingRecordBatches[batchIndex] = data || [];
    });

    const existing = existingRecordBatches.flat();
    const existingSet = new Set(existing.map(r => r.complaint_number));
    // Slim rows from the calling app's live sync — status never set yet.
    const needsEnrichSet = new Set(existing.filter(r => r.status == null).map(r => r.complaint_number));

    const newRows = validRows.filter(r => !existingSet.has(r['Complaint Number']));
    const enrichRows = validRows.filter(r => needsEnrichSet.has(r['Complaint Number']));
    const skippedCount = validRows.length - newRows.length - enrichRows.length;

    if (skippedCount > 0) {
        console.log(`[DB] Skipping ${skippedCount} already-existing complaint(s); inserting ${newRows.length} new, enriching ${enrichRows.length} slim.`);
    }

    if (!newRows.length && !enrichRows.length) {
        if (options.recordMetadata !== false) {
            await logScrapeSuccess(0, 0, 0, scrapeDuration);
        }
        return { new_rows: 0, skipped_rows: skippedCount, enriched_rows: 0 };
    }

    // Build a full record for insert/upsert
    const toRecord = (row: any) => {
        const complaintDate = parseDate(row['Complaint Date and Time'] || '');
        const closedDate = parseDate(row['Closed Date'] || '');

        const record = {
            complaint_number: row['Complaint Number'],
            complaint_date: toISTISOString(complaintDate),
            division: row['Division'],
            sub_division: row['Sub Division'],
            sub_station: row['Sub Station'],
            consumer_name: row['Consumer Name'],
            consumer_mobile: row['Consumer Mobile'],
            consumer_address: row['Consumer Address'],
            complaint_type: row['Complaint Type'],
            complaint_sub_type: row['Complaint Sub Type'],
            status: row['Status'],
            closed_status: row['Closed Status'],
            closed_by: row['Closed By'],
            closed_date: toISTISOString(closedDate),
            closing_remarks: row['Closing Remarks'],
            area_type: row['Area Type'],
            feeder: row['Feeder'] || null
        };

        return { ...record, content_hash: createHash('md5').update(JSON.stringify(record)).digest('hex') };
    };

    const records = newRows.map(toRecord);
    const enrichRecords = enrichRows.map(toRecord);

    // Insert in batches; ignoreDuplicates:true is a safety net at DB level
    const insertBatchSize = parsePositiveInteger(process.env.SUPABASE_UPSERT_BATCH_SIZE, 250, 1000);
    const batches: typeof records[] = [];
    for (let i = 0; i < records.length; i += insertBatchSize) {
        batches.push(records.slice(i, i + insertBatchSize));
    }

    const insertConcurrency = parsePositiveInteger(
        process.env.SUPABASE_UPSERT_CONCURRENCY || process.env.SUPABASE_SAVE_CONCURRENCY,
        3,
        6
    );

    await runWithConcurrency(batches, insertConcurrency, async (batch, batchIndex) => {
        let attempt = 0;

        while (true) {
            attempt += 1;
            const { error } = await supabase!
                .from('complaints')
                .upsert(batch, { onConflict: 'complaint_number', ignoreDuplicates: true });

            if (!error) break;

            const description = describeError(error);
            if (attempt >= 3 || !isTransientDbError(error)) {
                throw new Error(
                    `Failed to insert complaint batch ${batchIndex + 1}/${batches.length}: ${description}`
                );
            }

            const delay = Math.min(2000 * attempt, 10000);
            console.warn(
                `Insert batch ${batchIndex + 1}/${batches.length} failed on attempt ${attempt}/3: ${description}. Retrying in ${delay}ms.`
            );
            await sleep(delay);
        }
    });

    // Enrich slim rows with a real upsert (ignoreDuplicates:false so the
    // existing row IS updated). Usually 0-2 rows, so index churn stays minimal.
    if (enrichRecords.length) {
        const enrichBatches: typeof enrichRecords[] = [];
        for (let i = 0; i < enrichRecords.length; i += insertBatchSize) {
            enrichBatches.push(enrichRecords.slice(i, i + insertBatchSize));
        }
        await runWithConcurrency(enrichBatches, insertConcurrency, async (batch, batchIndex) => {
            let attempt = 0;
            while (true) {
                attempt += 1;
                const { error } = await supabase!
                    .from('complaints')
                    .upsert(batch, { onConflict: 'complaint_number', ignoreDuplicates: false });

                if (!error) break;

                const description = describeError(error);
                if (attempt >= 3 || !isTransientDbError(error)) {
                    throw new Error(
                        `Failed to enrich complaint batch ${batchIndex + 1}/${enrichBatches.length}: ${description}`
                    );
                }
                const delay = Math.min(2000 * attempt, 10000);
                console.warn(
                    `Enrich batch ${batchIndex + 1}/${enrichBatches.length} failed on attempt ${attempt}/3: ${description}. Retrying in ${delay}ms.`
                );
                await sleep(delay);
            }
        });
    }

    if (options.recordMetadata !== false) {
        await logScrapeSuccess(newRows.length + enrichRecords.length, newRows.length, enrichRecords.length, scrapeDuration);
    }

    return { new_rows: newRows.length, skipped_rows: skippedCount, enriched_rows: enrichRecords.length };
}

export async function logScrapeSuccess(totalRows: number, newRows: number, updatedRows: number, duration: number) {
    if (supabase) {
        await supabase.from('scrape_metadata').insert({
            last_scrape_at: getCurrentISTTime(),
            total_rows: totalRows,
            new_rows: newRows,
            updated_rows: updatedRows,
            duration_seconds: duration,
            status: 'success'
        });
    }
}

export async function logScrapeError(error: any, duration: number) {
    if (supabase) {
        await supabase.from('scrape_metadata').insert({
            last_scrape_at: getCurrentISTTime(),
            total_rows: 0,
            new_rows: 0,
            updated_rows: 0,
            duration_seconds: duration,
            status: 'failed',
            error_message: describeError(error)
        });
    }
}

export const getSupabaseClient = () => supabase;

function resolveExistingBrowserPath(candidates: Array<string | undefined>) {
    for (const candidate of candidates) {
        if (candidate && existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function getLocalBrowserCandidates() {
    return [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH,
        process.env.BROWSER_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        `${process.env.LOCALAPPDATA || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium'
    ].filter(Boolean);
}

type FrtLoginType = 'L' | 'M';

function resolveFrtLoginType(username: string): FrtLoginType {
    const configuredType = (process.env.FRT_LOGIN_TYPE || '').trim().toUpperCase();

    if (configuredType === 'M' || configuredType === 'MOBILE') return 'M';
    if (configuredType === 'L' || configuredType === 'USERID' || configuredType === 'USER_ID') return 'L';

    // The current FRT login page has separate UserID and Mobile tabs. A 10 digit
    // login must be submitted in Mobile mode, otherwise the server counts it as invalid.
    return /^\d{10}$/.test(username.trim()) ? 'M' : 'L';
}

function getLoginTypeLabel(loginType: FrtLoginType) {
    return loginType === 'M' ? 'mobile' : 'user_id';
}

function getFrtLoginFailureMessage(response: unknown, fallbackText = '', status?: number) {
    const responseRecord = response && typeof response === 'object'
        ? response as Record<string, unknown>
        : null;
    const message = responseRecord?.Message || responseRecord?.message || responseRecord?.Error || responseRecord?.error;
    if (message) return `FRT login failed: ${String(message)}`;

    const statusText = typeof status === 'number' ? ` (HTTP ${status})` : '';
    const trimmedText = fallbackText.replace(/\s+/g, ' ').trim();
    if (trimmedText && trimmedText !== 'null') {
        return `FRT login failed${statusText}: ${trimmedText.slice(0, 250)}`;
    }
    if (trimmedText === 'null') return `FRT login failed: null response${statusText}`;
    if (response == null) return `FRT login failed: empty response${statusText}`;

    try {
        return `FRT login failed: ${JSON.stringify(response)}`;
    } catch {
        return `FRT login failed: empty response${statusText}`;
    }
}

// --- Puppeteer Scraper ---

type FrtScrapePayload = {
    clickedAction: string;
    data: Array<Record<string, string>>;
    pageInfo: { totalPages: number; totalRows: number };
};

type FrtDialogLike = {
    message: () => string;
    accept: () => Promise<void>;
};

type FrtResponseLike = {
    url: () => string;
    request: () => { method: () => string };
    text: () => Promise<string>;
    status?: () => number;
};

type FrtRequestLike = {
    url: () => string;
    method: () => string;
    headers: () => Record<string, string>;
    postData: () => string | undefined;
};

export type FrtPageLike = {
    setUserAgent: (userAgent: string) => Promise<void>;
    on: ((event: 'dialog', handler: (dialog: FrtDialogLike) => Promise<void>) => void)
        & ((event: 'request', handler: (request: FrtRequestLike) => void) => void);
    cookies: () => Promise<Array<{ name: string; value: string }>>;
    evaluateOnNewDocument: (source: string) => Promise<void>;
    goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
    waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
    waitForFunction: (pageFunction: unknown, options?: Record<string, unknown>, ...args: unknown[]) => Promise<unknown>;
    evaluate: {
        <Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
        <Arg, Result>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>;
    };
    click: (selector: string) => Promise<void>;
    waitForResponse: (predicate: (response: FrtResponseLike) => boolean, options?: Record<string, unknown>) => Promise<FrtResponseLike>;
    waitForNavigation: (options?: Record<string, unknown>) => Promise<unknown>;
};

type FrtBrowserLike = {
    newPage: () => Promise<FrtPageLike>;
    close: () => Promise<void>;
};

type PuppeteerModuleLike = {
    launch: (options: Record<string, unknown>) => Promise<FrtBrowserLike>;
    executablePath?: () => string;
};

type FrtRangeEvalResult = {
    data: Array<Record<string, string>>;
    debug?: string | {
        reason?: string;
        url?: string;
        title?: string;
        bodySample?: string;
        headersFound?: number;
        rowsFound?: number;
        totalTrElements?: number;
    };
};

type FrtSessionDialogControls = {
    getSessionDialogError: () => Error | null;
    clearDialogMessage: () => void;
};

export type FrtScraperSession = {
    scrapeRange: (fromDate?: string, toDate?: string) => Promise<FrtScrapePayload>;
    captureApiSession?: () => Promise<FrtApiSession>;
    captureCallingSession?: () => Promise<FrtCallingApiSession>;
    close: () => Promise<void>;
    // Debug/diagnostic hook: exposes the logged-in Puppeteer page so one-off
    // scripts (e.g. Phase 0 form verification) can drive arbitrary forms
    // without re-implementing the login flow. Not used by the scrape paths.
    getPage?: () => FrtPageLike;
};

// Captured authenticated request "recipe" for the report API. With this we can
// pull reports via plain HTTP fetch - no browser needed - until the FRT
// session/token expires.
export type FrtApiSession = {
    savedAt: string;
    baseUrl: string;
    endpoint: string;
    referer: string;
    cookieHeader: string;
    headers: Record<string, string>;
    inputxmlTemplate: string;
    bodyTemplate: Record<string, unknown>;
};

// Captured authenticated recipe for the calling app. Holds the full per-form
// request headers (each already carries the right `formid` + shared token) plus
// the session-wide cookie, so list (13339) and detail (13340) can be fetched over
// plain HTTP. Refreshed via browser login when the session expires.
export type FrtCallingApiSession = {
    savedAt: string;
    baseUrl: string;
    endpoint: string;
    cookieHeader: string;
    listHeaders: Record<string, string>;
    detailHeaders: Record<string, string>;
};

const FRT_BASE_URL = 'https://www.frtbarabanki.com';
const FRT_FORM_URL = `${FRT_BASE_URL}/UI/Form?FormId=13345`;
const FRT_REPORT_ENDPOINT = '/api/AppsavyServices/GetRelationalDataA';
// Calling app forms: 13339 = live complaints grid (list), 13340 = complaint
// detail (consumer name/mobile). Verified Phase 0: each form's `formid` header is
// a stable per-form constant; token/roleid/sourcetype/appsavylogin + cookies are
// session-wide. See PROJECT-PLAN.md.
const FRT_CALLING_LIST_FORM_ID = 13339;
const FRT_CALLING_DETAIL_FORM_ID = 13340;
const FRT_FROM_CONTROL_ID = '143709';
const FRT_TO_CONTROL_ID = '143707';
const FRT_API_SESSION_KEY = 'frt_api_session';
const FRT_DEFAULT_START_DATE = '2025-11-01';
const FRT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

async function scrapeAuthenticatedRange(
    page: FrtPageLike,
    fromDate: string | undefined,
    toDate: string | undefined,
    dialogControls: FrtSessionDialogControls,
    loadTimeout: number
): Promise<FrtScrapePayload> {
    dialogControls.clearDialogMessage();

    console.log('[SCRAPER] Step 5: Direct navigation to report form...');
    await page.goto('https://www.frtbarabanki.com/UI/Form?FormId=13345', {
        timeout: 60000,
        waitUntil: 'domcontentloaded'
    });

    try {
        await page.waitForSelector('#ctrl143708', { timeout: 10000, visible: true });
    } catch (error) {
        const sessionDialogError = dialogControls.getSessionDialogError();
        if (sessionDialogError) throw sessionDialogError;
        throw error;
    }

    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

    const formatDateDisplay = (date: Date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const mon = monthNames[date.getMonth()];
        const yr = date.getFullYear();
        return `${day}-${mon}-${yr}`;
    };

    const parseDateOnly = (value: string) => {
        const parts = value.split('-').map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }
        return new Date(value);
    };

    const toDateDisplay = toDate ? formatDateDisplay(parseDateOnly(toDate)) : formatDateDisplay(now);
    const fromDateDisplay = fromDate ? formatDateDisplay(parseDateOnly(fromDate)) : '01-Nov-2025';

    console.log('[SCRAPER] Step 6: Setting dates...', { fromDateDisplay, toDateDisplay });

    await page.evaluate(function ({ fromStr, toStr }: { fromStr: string; toStr: string }) {
        const fromEl = document.getElementById('ctrl143709') as HTMLInputElement;
        const toEl = document.getElementById('ctrl143707') as HTMLInputElement;

        if (fromEl) {
            fromEl.value = fromStr;
            fromEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (toEl) {
            toEl.value = toStr;
            toEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, { fromStr: fromDateDisplay, toStr: toDateDisplay });

    await page.waitForFunction(
        ({ fromStr, toStr }: { fromStr: string; toStr: string }) => {
            const fromEl = document.getElementById('ctrl143709') as HTMLInputElement | null;
            const toEl = document.getElementById('ctrl143707') as HTMLInputElement | null;
            const button = document.getElementById('ctrl143708') as HTMLButtonElement | HTMLInputElement | null;
            return (
                fromEl?.value === fromStr &&
                toEl?.value === toStr &&
                !!button &&
                !button.disabled
            );
        },
        { timeout: 5000, polling: 100 },
        { fromStr: fromDateDisplay, toStr: toDateDisplay }
    );

    console.log('[SCRAPER] Step 7: Clicking search button...');
    await page.evaluate(function () {
        type SearchWaitState = {
            startedAt: number;
            initialText: string;
            loaderSeen: boolean;
            lastContentChangeAt: number;
            lastObservedText: string;
            loaderFinishedAt: number;
            observer: MutationObserver | null;
        };

        const win = window as Window & { __frtSearchWait?: SearchWaitState };
        const previousState = win.__frtSearchWait;

        if (previousState?.observer && typeof previousState.observer.disconnect === 'function') {
            previousState.observer.disconnect();
        }

        const getTableText = () => {
            const container = document.querySelector('#printablediv143706') as HTMLElement | null;
            const tables = container ? Array.from(container.querySelectorAll('table')) : [];
            const dataTable = tables[1] as HTMLElement | undefined;
            return (dataTable?.innerText || dataTable?.textContent || '').trim();
        };

        const initialText = getTableText();
        const state = {
            startedAt: Date.now(),
            initialText,
            loaderSeen: false,
            lastContentChangeAt: 0,
            lastObservedText: initialText,
            loaderFinishedAt: 0,
            observer: null as MutationObserver | null
        };

        const container = document.querySelector('#printablediv143706');
        if (container && typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver(() => {
                const text = getTableText();
                if (text !== state.lastObservedText) {
                    state.lastObservedText = text;
                    state.lastContentChangeAt = Date.now();
                }
            });
            observer.observe(container, { childList: true, subtree: true, characterData: true });
            state.observer = observer;
        }

        win.__frtSearchWait = state;
    });

    await page.click('#ctrl143708');

    console.log('[SCRAPER] Waiting for search results...');
    const startWait = Date.now();

    await page.waitForFunction(
        function () {
            type SearchWaitState = {
                startedAt: number;
                initialText: string;
                loaderSeen: boolean;
                lastContentChangeAt: number;
                lastObservedText: string;
                loaderFinishedAt: number;
            };

            const win = window as Window & { __frtSearchWait?: SearchWaitState };
            const state = win.__frtSearchWait || {
                startedAt: Date.now(),
                initialText: '',
                loaderSeen: false,
                lastContentChangeAt: 0,
                lastObservedText: '',
                loaderFinishedAt: 0
            };
            win.__frtSearchWait = state;

            const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
            const loader = document.querySelector('.loading-bar') as HTMLElement | null;
            const style = loader ? window.getComputedStyle(loader) : null;
            const loaderActive = !!loader &&
                !!style &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                loader.getClientRects().length > 0;

            if (loaderActive) {
                state.loaderSeen = true;
                state.loaderFinishedAt = 0;
                return false;
            }

            if (state.loaderSeen && !state.loaderFinishedAt) {
                state.loaderFinishedAt = Date.now();
            }

            const container = document.querySelector('#printablediv143706') as HTMLElement | null;
            if (!container) return false;

            const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
            const dataTable = tables[1];
            if (!dataTable) return false;

            const rows = Array.from(dataTable.querySelectorAll('tbody tr, tr')) as HTMLTableRowElement[];
            const dataRows = rows.filter((row) => {
                const cells = Array.from(row.querySelectorAll('td'));
                return cells.some((cell) => normalize(cell.textContent).length > 0);
            });

            const now = Date.now();
            const tableText = normalize(dataTable.textContent);
            const containerText = normalize(container.textContent);
            const hasRows = dataRows.length > 0;
            const hasEmptyMessage = /no\s+(record|records|data|rows)|not\s+found/i.test(containerText);
            const contentChanged = tableText !== normalize(state.initialText);

            if (contentChanged && tableText !== state.lastObservedText) {
                state.lastObservedText = tableText;
                state.lastContentChangeAt = now;
            }

            const contentSettled = state.lastContentChangeAt > 0 && now - state.lastContentChangeAt >= 200;
            const loaderSettled = state.loaderFinishedAt > 0 && now - state.loaderFinishedAt >= 200;

            if (state.loaderSeen) return loaderSettled && (hasRows || hasEmptyMessage);
            if (contentChanged) return contentSettled && (hasRows || hasEmptyMessage);

            return false;
        },
        {
            timeout: Number.isFinite(loadTimeout) ? loadTimeout : 300000,
            polling: 100
        }
    );

    await page.evaluate(function () {
        type SearchWaitState = {
            observer?: MutationObserver | null;
        };

        const win = window as Window & { __frtSearchWait?: SearchWaitState };
        const state = win.__frtSearchWait;
        if (state?.observer && typeof state.observer.disconnect === 'function') {
            state.observer.disconnect();
        }
        delete win.__frtSearchWait;
    });

    const loadTime = Math.round((Date.now() - startWait) / 1000);
    console.log(`[SCRAPER] Data loaded in ${loadTime}s`);

    console.log('[SCRAPER] Step 8: Scraping first page only...');

    const result = await page.evaluate<FrtRangeEvalResult>(function () {
        const normalize = (s: string | null | undefined) => (s || '').trim();
        const url = window.location.href;
        const title = document.title || '';
        const bodyText = normalize(document.body?.innerText || '');
        const loginForm = document.querySelector('#txtUserName, #txtPassword, #btnlogin');
        const sessionText = /session|expired|unauthorized|unauthorised|please\s+log\s*in|login\s+again/i.test(bodyText);
        const looksLikeLoginPage = !!loginForm || /login|session|expired|unauthorized|unauthorised/i.test(`${url} ${title}`) || sessionText;

        if (looksLikeLoginPage) {
            return {
                data: [],
                debug: {
                    reason: 'session_expired',
                    url,
                    title,
                    bodySample: bodyText.slice(0, 250)
                }
            };
        }

        const container = document.querySelector('#printablediv143706');
        if (!container) return { data: [], debug: 'container not found' };
        const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
        if (tables.length < 2) return { data: [], debug: 'tables not found' };
        const headerTable = tables[0];
        const dataTable = tables[1];

        const headerRows = Array.from(headerTable.querySelectorAll('tr'));
        let headers: string[] = [];

        for (let rowIdx = 0; rowIdx < Math.min(3, headerRows.length); rowIdx++) {
            const headerCells = Array.from(headerRows[rowIdx].querySelectorAll('th, td')) as HTMLElement[];
            const tempHeaders = headerCells.map((cell, i) => normalize(cell.textContent) || `Column ${i + 1}`);
            if (tempHeaders.length > 1 && tempHeaders.some(h => h && h !== `Column ${tempHeaders.indexOf(h) + 1}` && !h.includes('Report from'))) {
                headers = tempHeaders;
                break;
            }
        }

        if (headers.length === 0) {
            headers = ['Complaint Number', 'Complaint Date and Time', 'Division', 'Sub Division', 'Sub Station', 'Status', 'Closed Status', 'Closed By', 'Closed Date', 'Closing Remarks', 'Area Type'];
        }

        const dataRows = dataTable.querySelectorAll('tbody tr').length > 0
            ? Array.from(dataTable.querySelectorAll('tbody tr'))
            : Array.from(dataTable.querySelectorAll('tr'));

        const mapped = dataRows.map(row => {
            const cells = Array.from(row.querySelectorAll('td')) as HTMLElement[];
            if (cells.length === 0) return null;
            const rowData: Record<string, string> = {};
            const limit = Math.min(cells.length, headers.length);
            for (let i = 0; i < limit; i++) rowData[headers[i] || `Column ${i + 1}`] = normalize(cells[i].textContent);
            const anyValue = Object.values(rowData).some(v => v && v.length > 0);
            return anyValue ? rowData : null;
        }).filter(Boolean) as Record<string, string>[];

        return { data: mapped, debug: { headersFound: headers.length, rowsFound: mapped.length, totalTrElements: dataRows.length } };
    });

    if (typeof result.debug === 'object' && result.debug?.reason === 'session_expired') {
        throw new Error('FRT session expired or another login replaced this session');
    }

    return { clickedAction: '#ctrl143708', data: result.data, pageInfo: { totalPages: 1, totalRows: result.data.length } };
}

export async function createFrtScraperSession(username: string, password: string): Promise<FrtScraperSession> {
    const isVercel = !!process.env.VERCEL_URL || !!process.env.VERCEL;
    const isHeadfulDebug = process.env.SCRAPER_HEADFUL === '1';
    const loginType = resolveFrtLoginType(username);
    const slowMo = process.env.SCRAPER_DEBUG === '1' ? 50 : 0;
    const protocolTimeout = Number.parseInt(
        process.env.SCRAPER_PROTOCOL_TIMEOUT_MS || process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS || '600000',
        10
    );
    const loadTimeout = Number.parseInt(process.env.SCRAPER_LOAD_TIMEOUT_MS || '300000', 10);

    let puppeteer: PuppeteerModuleLike;
    let launchOptions: Record<string, unknown> = {
        headless: isHeadfulDebug ? false : true,
        slowMo,
        protocolTimeout: Number.isFinite(protocolTimeout) ? protocolTimeout : 600000
    };

    console.log('[SCRAPER] Starting scraper session...', { isVercel, loginType: getLoginTypeLabel(loginType) });

    if (isVercel) {
        const chromium = (await import('@sparticuz/chromium')).default;
        puppeteer = await import('puppeteer-core') as unknown as PuppeteerModuleLike;

        chromium.setHeadlessMode = true;
        chromium.setGraphicsMode = false;

        launchOptions = {
            ...launchOptions,
            headless: true,
            args: [
                ...chromium.args,
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-extensions',
            ],
            executablePath: await chromium.executablePath(),
            ignoreHTTPSErrors: true,
        };
    } else {
        puppeteer = await import('puppeteer') as unknown as PuppeteerModuleLike;
        let executablePath = resolveExistingBrowserPath(getLocalBrowserCandidates());

        if (!executablePath && typeof puppeteer.executablePath === 'function') {
            try {
                const bundledPath = puppeteer.executablePath();
                if (bundledPath && existsSync(bundledPath)) {
                    executablePath = bundledPath;
                }
            } catch {
                // Ignore missing bundled browser and fall back to system Chrome/Edge.
            }
        }

        launchOptions = {
            ...launchOptions,
            executablePath: executablePath || undefined
        };

        if (process.env.CI) {
            launchOptions = {
                ...launchOptions,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            };
        }
    }

    let browser: FrtBrowserLike;

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const missingBrowser = /Could not find Chrome|Could not find expected browser|Browser was not found/i.test(errorMessage);

        if (!isVercel && missingBrowser) {
            const detectedBrowser = resolveExistingBrowserPath(getLocalBrowserCandidates());
            const suggestion = detectedBrowser
                ? `Detected browser at "${detectedBrowser}". Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH to that path if launch still fails.`
                : 'Install Chrome with "npm run install:chrome" or set CHROME_PATH / PUPPETEER_EXECUTABLE_PATH to your Chrome or Edge executable.';

            throw new Error(`Local browser launch failed. ${suggestion}`);
        }

        throw error;
    }

    let closed = false;

    const close = async () => {
        if (closed) return;
        closed = true;
        try { await browser.close(); } catch { }
    };

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

        let lastDialogMessage = '';
        const clearDialogMessage = () => {
            lastDialogMessage = '';
        };
        const getSessionDialogError = () => {
            if (/session|login|logged|already|active|unauthorized|unauthorised|unsuccessful|invalid|blocked|captcha|password/i.test(lastDialogMessage)) {
                return new Error(`FRT login dialog: ${lastDialogMessage}`);
            }
            return null;
        };

        page.on('dialog', async (dialog: FrtDialogLike) => {
            lastDialogMessage = dialog.message();
            console.log('[SCRAPER] Browser dialog:', lastDialogMessage);
            await dialog.accept();
        });

        await page.evaluateOnNewDocument('window.__name = (func) => func');

        console.log('[SCRAPER] Step 1: Opening website...');
        await page.goto('https://www.frtbarabanki.com', {
            timeout: 45000,
            waitUntil: 'domcontentloaded'
        });

        console.log('[SCRAPER] Step 2: Waiting for login form...');
        await page.waitForSelector('#txtUserName', { timeout: 15000 });
        await page.waitForFunction(
            () => typeof (window as Window & { AuthCrypto?: { encryptPayload?: unknown } }).AuthCrypto?.encryptPayload === 'function',
            { timeout: 15000 }
        );

        console.log('[SCRAPER] Step 3: Selecting login mode and filling credentials...');
        await page.evaluate((credentials: { user: string; pass: string; loginType: FrtLoginType }) => {
            const win = window as Window & {
                fnbtncheckrd?: (type: FrtLoginType) => void;
                fnBtnCheckChangeRadio?: (type: FrtLoginType) => void;
            };
            const userIdRadio = document.getElementById('rdbUserID') as HTMLInputElement | null;
            const mobileRadio = document.getElementById('rdbMobile') as HTMLInputElement | null;
            const userEl = document.getElementById('txtUserName') as HTMLInputElement;
            const passEl = document.getElementById('txtPassword') as HTMLInputElement;

            if (typeof win.fnbtncheckrd === 'function') {
                win.fnbtncheckrd(credentials.loginType);
            } else if (typeof win.fnBtnCheckChangeRadio === 'function') {
                win.fnBtnCheckChangeRadio(credentials.loginType);
            }

            if (credentials.loginType === 'M') {
                if (userIdRadio) userIdRadio.checked = false;
                if (mobileRadio) {
                    mobileRadio.checked = true;
                    mobileRadio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                if (mobileRadio) mobileRadio.checked = false;
                if (userIdRadio) {
                    userIdRadio.checked = true;
                    userIdRadio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            const setValue = (element: HTMLInputElement | null, value: string) => {
                if (!element) return;
                element.disabled = false;
                element.focus();
                element.value = value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.blur();
            };

            setValue(userEl, credentials.user);
            setValue(passEl, credentials.pass);
        }, { user: username, pass: password, loginType });

        console.log('[SCRAPER] Step 4: Waiting for successful login...');
        try {
            const loginResponsePromise = page.waitForResponse(
                (response: FrtResponseLike) =>
                    response.url().includes('/UserAccounts/Login') &&
                    response.request().method() === 'POST',
                { timeout: 45000 }
            ).catch(() => null);
            const navigationPromise = page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 45000
            }).catch((error: unknown) => error);

            await page.click('#btnlogin');

            const loginResponse = await loginResponsePromise;
            if (loginResponse) {
                const loginText = await loginResponse.text().catch(() => '');
                const loginStatus = typeof loginResponse.status === 'function' ? loginResponse.status() : undefined;
                let loginJson: Record<string, unknown> | null = null;

                if (loginText.trim()) {
                    try {
                        const parsedLoginJson = JSON.parse(loginText) as unknown;
                        loginJson = parsedLoginJson && typeof parsedLoginJson === 'object'
                            ? parsedLoginJson as Record<string, unknown>
                            : null;
                    } catch {
                        loginJson = null;
                    }
                }

                if (loginJson && String(loginJson.Status) !== '1') {
                    throw new Error(getFrtLoginFailureMessage(loginJson, loginText, loginStatus));
                }

                if (!loginJson) {
                    // The login response body often becomes unreadable when the
                    // post-login navigation starts before CDP can fetch it, so an
                    // empty body is not proof of failure. Confirm via page state.
                    await navigationPromise;
                    const sessionDialogError = getSessionDialogError();
                    if (sessionDialogError) throw sessionDialogError;
                    const stillOnLoginPage = await page.evaluate(
                        () => !!document.querySelector('#txtPassword')
                    );
                    if (stillOnLoginPage) {
                        throw new Error(getFrtLoginFailureMessage(null, loginText, loginStatus));
                    }
                } else {
                    const navigationResult = await navigationPromise;
                    if (navigationResult instanceof Error) {
                        console.warn('[SCRAPER] Login succeeded but redirect wait timed out. Continuing to report form...');
                    }
                }
            } else {
                const navigationResult = await navigationPromise;
                if (navigationResult instanceof Error) {
                    const sessionDialogError = getSessionDialogError();
                    if (sessionDialogError) throw sessionDialogError;
                    throw navigationResult;
                }
            }
        } catch (error) {
            const sessionDialogError = getSessionDialogError();
            if (sessionDialogError) throw sessionDialogError;
            throw error;
        }

        clearDialogMessage();

        const captureApiSession = async (): Promise<FrtApiSession> => {
            if (closed) throw new Error('FRT scraper session is closed');
            clearDialogMessage();

            console.log('[SCRAPER] Capturing report API session...');
            await page.goto(FRT_FORM_URL, {
                timeout: 60000,
                waitUntil: 'domcontentloaded'
            });

            try {
                await page.waitForSelector('#ctrl143708', { timeout: 10000, visible: true });
            } catch (error) {
                const sessionDialogError = getSessionDialogError();
                if (sessionDialogError) throw sessionDialogError;
                throw error;
            }

            // Same-day range keeps the triggered report tiny; we only need the
            // outgoing request (headers + inputxml), not the report itself.
            const today = new Date();
            const todayDisplay = `${String(today.getDate()).padStart(2, '0')}-${FRT_MONTH_NAMES[today.getMonth()]}-${today.getFullYear()}`;

            const requestPromise = new Promise<{ headers: Record<string, string>; postData: string }>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('Timed out waiting for the report API request during capture')),
                    30000
                );
                page.on('request', (request: FrtRequestLike) => {
                    if (!request.url().includes(FRT_REPORT_ENDPOINT) || request.method() !== 'POST') return;
                    const postData = request.postData() || '';
                    try {
                        const parsed = JSON.parse(postData) as { inputxml?: string };
                        const xml = Buffer.from(String(parsed.inputxml || ''), 'base64').toString('utf8');
                        if (!xml.includes(`Control_Id="${FRT_FROM_CONTROL_ID}"`)) return;
                    } catch {
                        return;
                    }
                    clearTimeout(timer);
                    resolve({ headers: request.headers(), postData });
                });
            });

            await page.evaluate(function ({ fromStr, toStr }: { fromStr: string; toStr: string }) {
                const fromEl = document.getElementById('ctrl143709') as HTMLInputElement;
                const toEl = document.getElementById('ctrl143707') as HTMLInputElement;

                if (fromEl) {
                    fromEl.value = fromStr;
                    fromEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (toEl) {
                    toEl.value = toStr;
                    toEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, { fromStr: todayDisplay, toStr: todayDisplay });

            await page.click('#ctrl143708');
            const captured = await requestPromise;

            const parsedBody = JSON.parse(captured.postData) as Record<string, unknown>;
            const inputxmlTemplate = Buffer.from(String(parsedBody.inputxml || ''), 'base64').toString('utf8');
            if (!inputxmlTemplate.includes(`Control_Id="${FRT_FROM_CONTROL_ID}"`) ||
                !inputxmlTemplate.includes(`Control_Id="${FRT_TO_CONTROL_ID}"`)) {
                throw new Error('Captured inputxml template is missing the date controls');
            }

            const bodyTemplate: Record<string, unknown> = { ...parsedBody };
            delete bodyTemplate.inputxml;

            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(captured.headers)) {
                const lower = key.toLowerCase();
                if (lower.startsWith(':') || lower === 'cookie' || lower === 'content-length' || lower === 'host') continue;
                headers[lower] = value;
            }

            const cookies = await page.cookies();
            const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

            console.log('[SCRAPER] Report API session captured.');
            return {
                savedAt: new Date().toISOString(),
                baseUrl: FRT_BASE_URL,
                endpoint: FRT_REPORT_ENDPOINT,
                referer: FRT_FORM_URL,
                cookieHeader,
                headers,
                inputxmlTemplate,
                bodyTemplate
            };
        };

        // Capture the calling-app session: navigate to each form so the browser
        // fires its GetRelationalDataA request, and record that request's headers
        // (which carry the form's `formid` + the shared session token). Cookies
        // are session-wide. No inputxml is needed here — the app builds its own.
        const captureCallingSession = async (): Promise<FrtCallingApiSession> => {
            if (closed) throw new Error('FRT scraper session is closed');
            clearDialogMessage();
            console.log('[SCRAPER] Capturing calling-app session (13339 + 13340)...');

            const captureFormHeaders = async (formId: number): Promise<Record<string, string>> => {
                const requestPromise = new Promise<Record<string, string>>((resolve, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error(`Timed out waiting for FormId ${formId} request during capture`)),
                        30000
                    );
                    page.on('request', (request: FrtRequestLike) => {
                        if (!request.url().includes(FRT_REPORT_ENDPOINT) || request.method() !== 'POST') return;
                        const headers: Record<string, string> = {};
                        for (const [key, value] of Object.entries(request.headers())) {
                            const lower = key.toLowerCase();
                            if (lower.startsWith(':') || lower === 'cookie' || lower === 'content-length' || lower === 'host') continue;
                            headers[lower] = value;
                        }
                        // Ignore any straggler requests from a previously captured form.
                        if (!headers.formid) return;
                        clearTimeout(timer);
                        resolve(headers);
                    });
                });

                await page.goto(`${FRT_BASE_URL}/UI/Form?FormId=${formId}`, {
                    timeout: 60000,
                    waitUntil: 'domcontentloaded'
                });
                return requestPromise;
            };

            const listHeaders = await captureFormHeaders(FRT_CALLING_LIST_FORM_ID);
            const detailHeaders = await captureFormHeaders(FRT_CALLING_DETAIL_FORM_ID);
            const cookies = await page.cookies();
            const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

            console.log('[SCRAPER] Calling-app session captured.');
            return {
                savedAt: new Date().toISOString(),
                baseUrl: FRT_BASE_URL,
                endpoint: FRT_REPORT_ENDPOINT,
                cookieHeader,
                listHeaders,
                detailHeaders
            };
        };

        return {
            scrapeRange: async (fromDate?: string, toDate?: string) => {
                if (closed) throw new Error('FRT scraper session is closed');
                console.log('[SCRAPER] Starting scraper...', {
                    isVercel,
                    fromDate,
                    toDate,
                    loginType: getLoginTypeLabel(loginType),
                    session: 'reused'
                });
                return scrapeAuthenticatedRange(
                    page,
                    fromDate,
                    toDate,
                    { getSessionDialogError, clearDialogMessage },
                    loadTimeout
                );
            },
            captureApiSession,
            captureCallingSession,
            getPage: () => page,
            close
        };
    } catch (error) {
        await close();
        throw error;
    }
}

// --- Fast API-replay scraper (no browser per report pull) ---

export class FrtApiAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FrtApiAuthError';
    }
}

export function isFatalFrtLoginError(message: string) {
    return /unsuccessful attempt|maximum retry attempts|temporarily blocked|blocked till|five invalid attempts|invalid credentials|invalid user|invalid password|invalid captcha|enter captcha/i.test(message);
}

function decodeHtmlEntities(value: string) {
    return value
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

// The report API answers with XML wrapping an HTML-escaped pair of tables:
// table 1 = title row + header row, table 2 = data rows.
export function parseFrtReportResponse(responseText: string): Array<Record<string, string>> {
    const htmlMatch = responseText.match(/<HTML>([\s\S]*?)<\/HTML>/);
    if (!htmlMatch) throw new Error('FRT report response did not contain an <HTML> block');

    const html = decodeHtmlEntities(htmlMatch[1]);
    const cellText = (cellHtml: string) =>
        decodeHtmlEntities(cellHtml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

    let headers: string[] | null = null;
    const rows: Array<Record<string, string>> = [];
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const cells: string[] = [];
        cellRegex.lastIndex = 0;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
            cells.push(cellText(cellMatch[1]));
        }

        if (cells.length === 0) continue;
        if (cells.length === 1 && /report from/i.test(cells[0])) continue;

        const isHeaderRow = cells.some(cell => /^complaint number$/i.test(cell));
        if (!headers) {
            if (isHeaderRow) headers = cells;
            continue;
        }
        if (isHeaderRow) continue;

        const rowData: Record<string, string> = {};
        const limit = Math.min(cells.length, headers.length);
        for (let i = 0; i < limit; i++) {
            rowData[headers[i] || `Column ${i + 1}`] = cells[i];
        }
        if (Object.values(rowData).some(value => value && value.length > 0)) {
            rows.push(rowData);
        }
    }

    if (!headers && rows.length === 0) return [];
    if (!headers) throw new Error('FRT report response had data rows but no recognizable header row');
    return rows;
}

function setFrtControlDate(xml: string, controlId: string, dateDisplay: string) {
    const controlRegex = new RegExp(`<Parent Control_Id="${controlId}"[^>]*/>`);
    const match = xml.match(controlRegex);
    if (!match) throw new Error(`Control ${controlId} not found in captured inputxml template`);

    const updated = match[0]
        .replace(/Value="[^"]*"/, `Value="${dateDisplay}"`)
        .replace(/XValue="[^"]*"/, `XValue="${dateDisplay}"`);
    return xml.replace(match[0], updated);
}

async function fetchFrtReportRange(
    session: FrtApiSession,
    fromDisplay: string,
    toDisplay: string
): Promise<Array<Record<string, string>>> {
    let xml = setFrtControlDate(session.inputxmlTemplate, FRT_FROM_CONTROL_ID, fromDisplay);
    xml = setFrtControlDate(xml, FRT_TO_CONTROL_ID, toDisplay);

    const body = JSON.stringify({
        ...session.bodyTemplate,
        inputxml: Buffer.from(xml, 'utf8').toString('base64')
    });

    const response = await fetch(session.baseUrl + session.endpoint, {
        method: 'POST',
        headers: { ...session.headers, cookie: session.cookieHeader },
        body,
        redirect: 'manual'
    });

    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
        throw new FrtApiAuthError(`FRT API session rejected (HTTP ${response.status})`);
    }

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`FRT report API failed (HTTP ${response.status}): ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }

    if (!text.includes('<RESULT')) {
        const sample = text.replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!sample || sample === 'null' || /login|session|expired|unauthor|token|denied/i.test(sample)) {
            throw new FrtApiAuthError(`FRT API session expired: ${sample || 'empty response'}`);
        }
        throw new Error(`Unexpected FRT report response: ${sample}`);
    }

    return parseFrtReportResponse(text);
}

async function loadCachedFrtApiSession(): Promise<FrtApiSession | null> {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('reports')
            .select('payload')
            .eq('key', FRT_API_SESSION_KEY)
            .maybeSingle();

        if (error || !data?.payload) return null;
        const session = data.payload as FrtApiSession;
        if (!session.inputxmlTemplate || !session.headers || !session.cookieHeader || !session.endpoint) return null;
        return session;
    } catch {
        return null;
    }
}

async function saveCachedFrtApiSession(session: FrtApiSession) {
    if (!supabase) return;
    try {
        await supabase
            .from('reports')
            .upsert({ key: FRT_API_SESSION_KEY, payload: session }, { onConflict: 'key' });
    } catch (error) {
        console.warn('[SCRAPER] Failed to cache FRT API session:', describeError(error));
    }
}

// Must match CALLING_SESSION_KEY in frt-calling.ts (same `reports` row).
const FRT_CALLING_SESSION_KEY = 'frt_calling_session';

async function saveCachedFrtCallingSession(session: FrtCallingApiSession) {
    if (!supabase) return;
    try {
        await supabase
            .from('reports')
            .upsert({ key: FRT_CALLING_SESSION_KEY, payload: session }, { onConflict: 'key' });
    } catch (error) {
        console.warn('[SCRAPER] Failed to cache FRT calling session:', describeError(error));
    }
}

// One FRT login that refreshes BOTH cached sessions (report + calling) at once.
//
// FRT permits a single active session per account. Capturing the report session
// (`frt_api_session`) and the calling session (`frt_calling_session`) from
// SEPARATE browser logins therefore made each new login silently invalidate the
// other — so the two 5-minute crons (today-scrape + calling-sync) ended up doing
// a fresh browser login on almost every run (a login "ping-pong"). Capturing
// both from a SINGLE login means they share the same underlying FRT session and
// stay valid together, so recaptures become rare and replays stay warm. Every
// recapture entry point (createFrtApiScraperSession, createFrtCallingClient)
// routes through here for that reason.
export async function refreshFrtSessions(
    username: string,
    password: string
): Promise<{ api: FrtApiSession; calling: FrtCallingApiSession }> {
    console.log('[SCRAPER] Refreshing BOTH FRT sessions from a single browser login...');
    const browserSession = await createFrtScraperSession(username, password);
    try {
        const api = await browserSession.captureApiSession!();
        await saveCachedFrtApiSession(api);
        const calling = await browserSession.captureCallingSession!();
        await saveCachedFrtCallingSession(calling);
        console.log('[SCRAPER] Both FRT sessions refreshed from one login.');
        return { api, calling };
    } finally {
        await browserSession.close();
    }
}

function getTodayDateOnlyIST() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const partMap = Object.fromEntries(
        parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
    );

    return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function parseFrtDateOnly(value: string): Date {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    }
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
    return new Date(Date.UTC(fallback.getFullYear(), fallback.getMonth(), fallback.getDate()));
}

function formatFrtDisplayDate(date: Date) {
    return `${String(date.getUTCDate()).padStart(2, '0')}-${FRT_MONTH_NAMES[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

// Smaller windows keep individual responses light (a week of complaints is
// roughly 15-20 MB of report HTML) and let us fetch them concurrently.
function buildFrtChunks(fromDate?: string, toDate?: string): Array<{ from: string; to: string }> {
    const from = parseFrtDateOnly(fromDate || FRT_DEFAULT_START_DATE);
    const to = parseFrtDateOnly(toDate || getTodayDateOnlyIST());
    if (from > to) throw new Error(`From date ${fromDate} is after to date ${toDate}`);

    const chunkDays = parsePositiveInteger(process.env.FRT_API_CHUNK_DAYS, 7, 62);
    const chunks: Array<{ from: string; to: string }> = [];
    let cursor = from;

    while (cursor <= to) {
        const windowEnd = new Date(Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth(),
            cursor.getUTCDate() + chunkDays - 1
        ));
        const chunkEnd = windowEnd < to ? windowEnd : to;
        chunks.push({ from: formatFrtDisplayDate(cursor), to: formatFrtDisplayDate(chunkEnd) });
        cursor = new Date(Date.UTC(
            chunkEnd.getUTCFullYear(),
            chunkEnd.getUTCMonth(),
            chunkEnd.getUTCDate() + 1
        ));
    }

    return chunks;
}

// Drop-in replacement for createFrtScraperSession: same scrapeRange/close
// interface, but report pulls go over plain fetch. The browser is only used
// once to capture/refresh the API session, then closed immediately.
export async function createFrtApiScraperSession(username: string, password: string): Promise<FrtScraperSession> {
    let apiSession = await loadCachedFrtApiSession();
    if (apiSession) {
        console.log(`[SCRAPER] Reusing cached FRT API session from ${apiSession.savedAt}`);
    }

    let closed = false;
    let generation = 0;
    let capturePromise: Promise<FrtApiSession> | null = null;

    const captureFreshSession = () => {
        if (!capturePromise) {
            capturePromise = (async () => {
                // Refresh BOTH sessions from one login so this recapture doesn't
                // invalidate the calling session (see refreshFrtSessions).
                const { api } = await refreshFrtSessions(username, password);
                apiSession = api;
                generation += 1;
                return api;
            })().finally(() => {
                capturePromise = null;
            });
        }
        return capturePromise;
    };

    const scrapeRange = async (fromDate?: string, toDate?: string): Promise<FrtScrapePayload> => {
        if (closed) throw new Error('FRT scraper session is closed');

        const chunks = buildFrtChunks(fromDate, toDate);
        const concurrency = parsePositiveInteger(process.env.FRT_API_CONCURRENCY, 2, 6);
        console.log(
            `[SCRAPER] API scrape ${chunks[0].from} -> ${chunks[chunks.length - 1].to} in ${chunks.length} chunk(s), concurrency ${concurrency}`
        );

        if (!apiSession) await captureFreshSession();

        let recaptures = 0;
        const chunkRows: Array<Array<Record<string, string>>> = new Array(chunks.length);

        await runWithConcurrency(chunks, concurrency, async (chunk, index) => {
            let attempt = 0;

            while (true) {
                attempt += 1;
                const generationAtFetch = generation;

                try {
                    const chunkStart = Date.now();
                    const rows = await fetchFrtReportRange(apiSession!, chunk.from, chunk.to);
                    console.log(
                        `[SCRAPER] Chunk ${chunk.from}..${chunk.to}: ${rows.length} rows in ${((Date.now() - chunkStart) / 1000).toFixed(1)}s`
                    );
                    chunkRows[index] = rows;
                    return;
                } catch (error) {
                    if (attempt >= 4) throw error;

                    if (error instanceof FrtApiAuthError) {
                        // Another worker may have refreshed the session already.
                        if (generation === generationAtFetch) {
                            if (recaptures >= 2) throw error;
                            recaptures += 1;
                            await captureFreshSession();
                        }
                        continue;
                    }

                    console.warn(
                        `[SCRAPER] Chunk ${chunk.from}..${chunk.to} attempt ${attempt} failed: ${describeError(error)}. Retrying...`
                    );
                    await sleep(1500 * attempt);
                }
            }
        });

        const data = chunkRows.flat();
        return {
            clickedAction: 'api:GetRelationalDataA',
            data,
            pageInfo: { totalPages: chunks.length, totalRows: data.length }
        };
    };

    return {
        scrapeRange,
        close: async () => {
            closed = true;
        }
    };
}

// One-shot convenience wrapper used by the API routes.
export async function scrapeFrtFast(username: string, password: string, fromDate?: string, toDate?: string) {
    const session = await createFrtApiScraperSession(username, password);
    try {
        return await session.scrapeRange(fromDate, toDate);
    } finally {
        await session.close();
    }
}

export async function scrapeWithPuppeteer(username: string, password: string, fromDate?: string, toDate?: string) {
    const isVercel = !!process.env.VERCEL_URL || !!process.env.VERCEL;
    const isHeadfulDebug = process.env.SCRAPER_HEADFUL === '1';
    const loginType = resolveFrtLoginType(username);
    const slowMo = process.env.SCRAPER_DEBUG === '1' ? 50 : 0;
    const protocolTimeout = Number.parseInt(
        process.env.SCRAPER_PROTOCOL_TIMEOUT_MS || process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS || '600000',
        10
    );
    const loadTimeout = Number.parseInt(process.env.SCRAPER_LOAD_TIMEOUT_MS || '300000', 10);

    let puppeteer: any;
    let launchOptions: any = {
        headless: isHeadfulDebug ? false : true,
        slowMo,
        protocolTimeout: Number.isFinite(protocolTimeout) ? protocolTimeout : 600000
    };

    console.log('[SCRAPER] Starting scraper...', { isVercel, fromDate, toDate, loginType: getLoginTypeLabel(loginType) });

    if (isVercel) {
        // Vercel Environment
        const chromium = (await import('@sparticuz/chromium')).default;
        puppeteer = await import('puppeteer-core');
        
        // Optimize chromium for Vercel
        chromium.setHeadlessMode = true;
        chromium.setGraphicsMode = false;
        
        launchOptions = {
            ...launchOptions,
            headless: true,
            args: [
                ...chromium.args,
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-extensions',
            ],
            executablePath: await chromium.executablePath(),
            ignoreHTTPSErrors: true,
        };
    } else {
        // Local / GitHub Actions Environment
        // We expect 'puppeteer' to be installed
        puppeteer = await import('puppeteer');
        let executablePath = resolveExistingBrowserPath(getLocalBrowserCandidates());

        if (!executablePath && typeof puppeteer.executablePath === 'function') {
            try {
                const bundledPath = puppeteer.executablePath();
                if (bundledPath && existsSync(bundledPath)) {
                    executablePath = bundledPath;
                }
            } catch {
                // Ignore missing bundled browser and fall back to system Chrome/Edge.
            }
        }

        launchOptions = {
            ...launchOptions,
            executablePath: executablePath || undefined
        };

        // For GitHub Actions (CI), we might need specific args if it fails, 
        // but usually default puppeteer works well if installed correctly.
        // Adding --no-sandbox is often safer for CI environments.
        if (process.env.CI) {
            launchOptions = {
                ...launchOptions,
                headless: true, // New Headless mode
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        }
    }
    let browser: any;

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error: any) {
        const missingBrowser = /Could not find Chrome|Could not find expected browser|Browser was not found/i.test(error?.message || '');

        if (!isVercel && missingBrowser) {
            const detectedBrowser = resolveExistingBrowserPath(getLocalBrowserCandidates());
            const suggestion = detectedBrowser
                ? `Detected browser at "${detectedBrowser}". Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH to that path if launch still fails.`
                : 'Install Chrome with "npm run install:chrome" or set CHROME_PATH / PUPPETEER_EXECUTABLE_PATH to your Chrome or Edge executable.';

            throw new Error(`Local browser launch failed. ${suggestion}`);
        }

        throw error;
    }
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    let lastDialogMessage = '';
    page.on('dialog', async (dialog: { message: () => string; accept: () => Promise<void> }) => {
        lastDialogMessage = dialog.message();
        console.log('[SCRAPER] Browser dialog:', lastDialogMessage);
        await dialog.accept();
    });

    const getSessionDialogError = () => {
        if (/session|login|logged|already|active|unauthorized|unauthorised|unsuccessful|invalid|blocked|captcha|password/i.test(lastDialogMessage)) {
            return new Error(`FRT login dialog: ${lastDialogMessage}`);
        }
        return null;
    };

    // Polyfill for esbuild/tsx __name helper - using evaluateOnNewDocument to persist across navigations
    await page.evaluateOnNewDocument('window.__name = (func) => func');

    try {
        console.log('[SCRAPER] Step 1: Opening website...');
        await page.goto('https://www.frtbarabanki.com', { 
            timeout: 45000, 
            waitUntil: 'domcontentloaded' // Faster than networkidle2
        });

        console.log('[SCRAPER] Step 2: Waiting for login form...');
        await page.waitForSelector('#txtUserName', { timeout: 15000 });
        await page.waitForFunction(
            () => typeof (window as Window & { AuthCrypto?: { encryptPayload?: unknown } }).AuthCrypto?.encryptPayload === 'function',
            { timeout: 15000 }
        );

        console.log('[SCRAPER] Step 3: Selecting login mode and filling credentials...');
        await page.evaluate((credentials: { user: string; pass: string; loginType: FrtLoginType }) => {
            const win = window as Window & {
                fnbtncheckrd?: (type: FrtLoginType) => void;
                fnBtnCheckChangeRadio?: (type: FrtLoginType) => void;
            };
            const userIdRadio = document.getElementById('rdbUserID') as HTMLInputElement | null;
            const mobileRadio = document.getElementById('rdbMobile') as HTMLInputElement | null;
            const userEl = document.getElementById('txtUserName') as HTMLInputElement;
            const passEl = document.getElementById('txtPassword') as HTMLInputElement;

            if (typeof win.fnbtncheckrd === 'function') {
                win.fnbtncheckrd(credentials.loginType);
            } else if (typeof win.fnBtnCheckChangeRadio === 'function') {
                win.fnBtnCheckChangeRadio(credentials.loginType);
            }

            if (credentials.loginType === 'M') {
                if (userIdRadio) userIdRadio.checked = false;
                if (mobileRadio) {
                    mobileRadio.checked = true;
                    mobileRadio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                if (mobileRadio) mobileRadio.checked = false;
                if (userIdRadio) {
                    userIdRadio.checked = true;
                    userIdRadio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            const setValue = (element: HTMLInputElement | null, value: string) => {
                if (!element) return;
                element.disabled = false;
                element.focus();
                element.value = value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.blur();
            };

            setValue(userEl, credentials.user);
            setValue(passEl, credentials.pass);
        }, { user: username, pass: password, loginType });
        
        console.log('[SCRAPER] Step 4: Waiting for successful login...');
        try {
            const loginResponsePromise = page.waitForResponse(
                (response: { url: () => string; request: () => { method: () => string } }) =>
                    response.url().includes('/UserAccounts/Login') &&
                    response.request().method() === 'POST',
                { timeout: 45000 }
            ).catch(() => null);
            const navigationPromise = page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 45000
            }).catch((error: unknown) => error);

            await page.click('#btnlogin');

            const loginResponse = await loginResponsePromise;
            if (loginResponse) {
                const loginJson = await loginResponse.json().catch(() => null);
                if (loginJson && String(loginJson.Status) !== '1') {
                    throw new Error(getFrtLoginFailureMessage(loginJson));
                }

                if (!loginJson) {
                    // Empty/unreadable body usually means the post-login navigation
                    // started before CDP could fetch it. Confirm via page state.
                    await navigationPromise;
                    const sessionDialogError = getSessionDialogError();
                    if (sessionDialogError) throw sessionDialogError;
                    const stillOnLoginPage = await page.evaluate(
                        () => !!document.querySelector('#txtPassword')
                    );
                    if (stillOnLoginPage) {
                        throw new Error(getFrtLoginFailureMessage(null));
                    }
                } else {
                    const navigationResult = await navigationPromise;
                    if (navigationResult instanceof Error) {
                        console.warn('[SCRAPER] Login succeeded but redirect wait timed out. Continuing to report form...');
                    }
                }
            } else {
                const navigationResult = await navigationPromise;
                if (navigationResult instanceof Error) {
                    const sessionDialogError = getSessionDialogError();
                    if (sessionDialogError) throw sessionDialogError;
                    throw navigationResult;
                }
            }
        } catch (error) {
            const sessionDialogError = getSessionDialogError();
            if (sessionDialogError) throw sessionDialogError;
            throw error;
        }

        console.log('[SCRAPER] Step 5: Direct navigation to report form...');
        await page.goto('https://www.frtbarabanki.com/UI/Form?FormId=13345', { 
            timeout: 60000,
            waitUntil: 'domcontentloaded'
        });
        
        // SMART: Wait for form to be ready
        try {
            await page.waitForSelector('#ctrl143708', { timeout: 10000, visible: true });
        } catch (error) {
            const sessionDialogError = getSessionDialogError();
            if (sessionDialogError) throw sessionDialogError;
            throw error;
        }

        const now = new Date();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

        // Input fields use DD-Mon-YYYY format (like 20-Jan-2026)
        const formatDateDisplay = (date: Date) => {
            const day = String(date.getDate()).padStart(2, '0');
            const mon = monthNames[date.getMonth()];
            const yr = date.getFullYear();
            return `${day}-${mon}-${yr}`;
        };

        const parseDateOnly = (value: string) => {
            const parts = value.split('-').map(Number);
            if (parts.length === 3 && parts.every(Number.isFinite)) {
                return new Date(parts[0], parts[1] - 1, parts[2]);
            }
            return new Date(value);
        };

        const toDateDisplay = toDate ? formatDateDisplay(parseDateOnly(toDate)) : formatDateDisplay(now);
        const fromDateDisplay = fromDate ? formatDateDisplay(parseDateOnly(fromDate)) : '01-Nov-2025';

        console.log('[SCRAPER] Step 6: Setting dates...', { fromDateDisplay, toDateDisplay });

        // SMART: Set dates and trigger events efficiently
        await page.evaluate(function ({ fromStr, toStr }: { fromStr: string; toStr: string }) {
            const fromEl = document.getElementById('ctrl143709') as HTMLInputElement;
            const toEl = document.getElementById('ctrl143707') as HTMLInputElement;
            
            if (fromEl) {
                fromEl.value = fromStr;
                fromEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (toEl) {
                toEl.value = toStr;
                toEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, { fromStr: fromDateDisplay, toStr: toDateDisplay });

        await page.waitForFunction(
            ({ fromStr, toStr }: { fromStr: string; toStr: string }) => {
                const fromEl = document.getElementById('ctrl143709') as HTMLInputElement | null;
                const toEl = document.getElementById('ctrl143707') as HTMLInputElement | null;
                const button = document.getElementById('ctrl143708') as HTMLButtonElement | HTMLInputElement | null;
                return (
                    fromEl?.value === fromStr &&
                    toEl?.value === toStr &&
                    !!button &&
                    !button.disabled
                );
            },
            { timeout: 5000, polling: 100 },
            { fromStr: fromDateDisplay, toStr: toDateDisplay }
        );

        console.log('[SCRAPER] Step 7: Clicking search button...');
        await page.evaluate(function () {
            type SearchWaitState = {
                startedAt: number;
                initialText: string;
                loaderSeen: boolean;
                lastContentChangeAt: number;
                lastObservedText: string;
                loaderFinishedAt: number;
                observer: MutationObserver | null;
            };

            const win = window as Window & { __frtSearchWait?: SearchWaitState };
            const previousState = win.__frtSearchWait;

            if (previousState?.observer && typeof previousState.observer.disconnect === 'function') {
                previousState.observer.disconnect();
            }

            const getTableText = () => {
                const container = document.querySelector('#printablediv143706') as HTMLElement | null;
                const tables = container ? Array.from(container.querySelectorAll('table')) : [];
                const dataTable = tables[1] as HTMLElement | undefined;
                return (dataTable?.innerText || dataTable?.textContent || '').trim();
            };

            const initialText = getTableText();
            const state = {
                startedAt: Date.now(),
                initialText,
                loaderSeen: false,
                lastContentChangeAt: 0,
                lastObservedText: initialText,
                loaderFinishedAt: 0,
                observer: null as MutationObserver | null
            };

            const container = document.querySelector('#printablediv143706');
            if (container && typeof MutationObserver !== 'undefined') {
                const observer = new MutationObserver(() => {
                    const text = getTableText();
                    if (text !== state.lastObservedText) {
                        state.lastObservedText = text;
                        state.lastContentChangeAt = Date.now();
                    }
                });
                observer.observe(container, { childList: true, subtree: true, characterData: true });
                state.observer = observer;
            }

            win.__frtSearchWait = state;
        });

        await page.click('#ctrl143708');

        console.log('[SCRAPER] Waiting for search results...');
        const startWait = Date.now();
        
        await page.waitForFunction(
            function () {
                type SearchWaitState = {
                    startedAt: number;
                    initialText: string;
                    loaderSeen: boolean;
                    lastContentChangeAt: number;
                    lastObservedText: string;
                    loaderFinishedAt: number;
                };

                const win = window as Window & { __frtSearchWait?: SearchWaitState };
                const state = win.__frtSearchWait || {
                    startedAt: Date.now(),
                    initialText: '',
                    loaderSeen: false,
                    lastContentChangeAt: 0,
                    lastObservedText: '',
                    loaderFinishedAt: 0
                };
                win.__frtSearchWait = state;

                const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
                const loader = document.querySelector('.loading-bar') as HTMLElement | null;
                const style = loader ? window.getComputedStyle(loader) : null;
                const loaderActive = !!loader &&
                    !!style &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    loader.getClientRects().length > 0;

                if (loaderActive) {
                    state.loaderSeen = true;
                    state.loaderFinishedAt = 0;
                    return false;
                }

                if (state.loaderSeen && !state.loaderFinishedAt) {
                    state.loaderFinishedAt = Date.now();
                }

                const container = document.querySelector('#printablediv143706') as HTMLElement | null;
                if (!container) return false;

                const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
                const dataTable = tables[1];
                if (!dataTable) return false;

                const rows = Array.from(dataTable.querySelectorAll('tbody tr, tr')) as HTMLTableRowElement[];
                const dataRows = rows.filter((row) => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    return cells.some((cell) => normalize(cell.textContent).length > 0);
                });

                const now = Date.now();
                const tableText = normalize(dataTable.textContent);
                const containerText = normalize(container.textContent);
                const hasRows = dataRows.length > 0;
                const hasEmptyMessage = /no\s+(record|records|data|rows)|not\s+found/i.test(containerText);
                const contentChanged = tableText !== normalize(state.initialText);

                if (contentChanged && tableText !== state.lastObservedText) {
                    state.lastObservedText = tableText;
                    state.lastContentChangeAt = now;
                }

                const contentSettled = state.lastContentChangeAt > 0 && now - state.lastContentChangeAt >= 200;
                const loaderSettled = state.loaderFinishedAt > 0 && now - state.loaderFinishedAt >= 200;

                if (state.loaderSeen) return loaderSettled && (hasRows || hasEmptyMessage);
                if (contentChanged) return contentSettled && (hasRows || hasEmptyMessage);

                return false;
            },
            {
                timeout: Number.isFinite(loadTimeout) ? loadTimeout : 300000,
                polling: 100
            }
        );

        await page.evaluate(function () {
            type SearchWaitState = {
                observer?: MutationObserver | null;
            };

            const win = window as Window & { __frtSearchWait?: SearchWaitState };
            const state = win.__frtSearchWait;
            if (state?.observer && typeof state.observer.disconnect === 'function') {
                state.observer.disconnect();
            }
            delete win.__frtSearchWait;
        });
        
        const loadTime = Math.round((Date.now() - startWait) / 1000);
        console.log(`[SCRAPER] Data loaded in ${loadTime}s`);
        
        console.log('[SCRAPER] Step 8: Scraping first page only...');

        const result = await page.evaluate(function () {
            const normalize = (s: string | null | undefined) => (s || '').trim();
            const url = window.location.href;
            const title = document.title || '';
            const bodyText = normalize(document.body?.innerText || '');
            const loginForm = document.querySelector('#txtUserName, #txtPassword, #btnlogin');
            const sessionText = /session|expired|unauthorized|unauthorised|please\s+log\s*in|login\s+again/i.test(bodyText);
            const looksLikeLoginPage = !!loginForm || /login|session|expired|unauthorized|unauthorised/i.test(`${url} ${title}`) || sessionText;

            if (looksLikeLoginPage) {
                return {
                    data: [],
                    debug: {
                        reason: 'session_expired',
                        url,
                        title,
                        bodySample: bodyText.slice(0, 250)
                    }
                };
            }

            const container = document.querySelector('#printablediv143706');
            if (!container) return { data: [], debug: 'container not found' };
            const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
            if (tables.length < 2) return { data: [], debug: 'tables not found' };
            const headerTable = tables[0];
            const dataTable = tables[1];

            // Get headers
            const headerRows = Array.from(headerTable.querySelectorAll('tr'));
            let headers: string[] = [];

            for (let rowIdx = 0; rowIdx < Math.min(3, headerRows.length); rowIdx++) {
                const headerCells = Array.from(headerRows[rowIdx].querySelectorAll('th, td')) as HTMLElement[];
                const tempHeaders = headerCells.map((cell, i) => normalize(cell.textContent) || `Column ${i + 1}`);
                if (tempHeaders.length > 1 && tempHeaders.some(h => h && h !== `Column ${tempHeaders.indexOf(h) + 1}` && !h.includes('Report from'))) {
                    headers = tempHeaders;
                    break;
                }
            }

            if (headers.length === 0) {
                headers = ['Complaint Number', 'Complaint Date and Time', 'Division', 'Sub Division', 'Sub Station', 'Status', 'Closed Status', 'Closed By', 'Closed Date', 'Closing Remarks', 'Area Type'];
            }

            // Get ALL data rows - check both tbody and direct tr
            const dataRows = dataTable.querySelectorAll('tbody tr').length > 0
                ? Array.from(dataTable.querySelectorAll('tbody tr'))
                : Array.from(dataTable.querySelectorAll('tr'));

            const mapped = dataRows.map(row => {
                const cells = Array.from(row.querySelectorAll('td')) as HTMLElement[];
                if (cells.length === 0) return null;
                const rowData: Record<string, string> = {};
                const limit = Math.min(cells.length, headers.length);
                for (let i = 0; i < limit; i++) rowData[headers[i] || `Column ${i + 1}`] = normalize(cells[i].textContent);
                const anyValue = Object.values(rowData).some(v => v && v.length > 0);
                return anyValue ? rowData : null;
            }).filter(Boolean) as Record<string, string>[];

            return { data: mapped, debug: { headersFound: headers.length, rowsFound: mapped.length, totalTrElements: dataRows.length } };
        });

        if (result.debug?.reason === 'session_expired') {
            throw new Error('FRT session expired or another login replaced this session');
        }

        await browser.close();
        return { clickedAction: '#ctrl143708', data: result.data, pageInfo: { totalPages: 1, totalRows: result.data.length } };

    } catch (error) {
        // Ensure browser closes even on error
        try { await browser.close(); } catch { }
        throw error;
    }
}
