import { createClient } from '@supabase/supabase-js';

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
            .select('raw_data')
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
    return {
        data: allData.map(row => row.raw_data),
        total: count || 0,
        lastScrapedAt: lastScrape?.last_scrape_at,
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

    // Single query for all existing records - much faster
    const { data: existingRecords, error: existingRecordsError } = await supabase
        .from('complaints')
        .select('complaint_number')
        .in('complaint_number', complaintNumbers);

    if (existingRecordsError) {
        throw existingRecordsError;
    }

    const existingSet = new Set(existingRecords?.map(r => r.complaint_number) || []);
    const newRowsCount = validRows.filter(r => !existingSet.has(r['Complaint Number'])).length;
    const updatedRowsCount = validRows.length - newRowsCount;

    const upsertData = validRows.map(row => {
        const complaintDate = parseDate(row['Complaint Date and Time'] || '');
        const closedDate = parseDate(row['Closed Date'] || '');

        return {
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
            raw_data: row
        };
    });

    // Parallel upserts - much faster
    const batches = [];
    for (let i = 0; i < upsertData.length; i += 1000) {
        batches.push(upsertData.slice(i, i + 1000));
    }

    const results = await Promise.allSettled(batches.map(batch =>
        supabase
            .from('complaints')
            .upsert(batch, { onConflict: 'complaint_number', ignoreDuplicates: false })
    ));

    const batchErrors: string[] = [];

    results.forEach((result, i) => {
        if (result.status === 'rejected' || (result.status === 'fulfilled' && result.value.error)) {
            const error = result.status === 'rejected' ? result.reason : result.value.error;
            console.error(`Batch ${i + 1} error:`, error);
            batchErrors.push(`Batch ${i + 1}: ${error?.message || error}`);
        }
    });

    if (batchErrors.length > 0) {
        throw new Error(`Failed to upsert complaint batches. ${batchErrors.slice(0, 3).join(' | ')}`);
    }

    if (options.recordMetadata !== false) {
        await logScrapeSuccess(validRows.length, newRowsCount, updatedRowsCount, scrapeDuration);
    }

    return { new_rows: newRowsCount, updated_rows: updatedRowsCount };
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
            error_message: error.message
        });
    }
}

export const getSupabaseClient = () => supabase;

// --- Puppeteer Scraper ---

export async function scrapeWithPuppeteer(username: string, password: string, fromDate?: string, toDate?: string) {
    const isVercel = !!process.env.VERCEL_URL || !!process.env.VERCEL;
    const isHeadfulDebug = process.env.SCRAPER_HEADFUL === '1';
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

    console.log('[SCRAPER] Starting scraper...', { isVercel, fromDate, toDate });

    if (isVercel) {
        // Vercel Environment
        const chromium = (await import('@sparticuz/chromium')).default;
        puppeteer = await import('puppeteer-core');
        launchOptions = {
            ...launchOptions,
            headless: true,
            args: chromium.args,
            executablePath: await chromium.executablePath(),
        };
    } else {
        // Local / GitHub Actions Environment
        // We expect 'puppeteer' to be installed
        puppeteer = await import('puppeteer');

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

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    let lastDialogMessage = '';
    page.on('dialog', async (dialog: { message: () => string; accept: () => Promise<void> }) => {
        lastDialogMessage = dialog.message();
        console.log('[SCRAPER] Browser dialog:', lastDialogMessage);
        await dialog.accept();
    });

    const getSessionDialogError = () => {
        if (/session|login|logged|already|active|unauthorized|unauthorised/i.test(lastDialogMessage)) {
            return new Error(`FRT session/login dialog: ${lastDialogMessage}`);
        }
        return null;
    };

    // Polyfill for esbuild/tsx __name helper - using evaluateOnNewDocument to persist across navigations
    await page.evaluateOnNewDocument('window.__name = (func) => func');

    try {
        console.log('[SCRAPER] Step 1: Opening website...');
        await page.goto('https://www.frtbarabanki.com', { timeout: 30000, waitUntil: 'domcontentloaded' }); // Increased timeout for safety

        console.log('[SCRAPER] Step 2: Waiting for login form...');
        await page.waitForSelector('#txtUserName', { timeout: 10000 });

        console.log('[SCRAPER] Step 3: Filling credentials...');
        await page.type('#txtUserName', username);
        await page.type('#txtPassword', password);
        await page.click('#btnlogin');

        console.log('[SCRAPER] Step 4: Waiting for successful login...');
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 45000 });
        } catch (error) {
            const sessionDialogError = getSessionDialogError();
            if (sessionDialogError) throw sessionDialogError;
            throw error;
        }

        console.log('[SCRAPER] Step 5: Direct navigation to report form...');
        // Direct goto with networkidle for Vercel stability
        await page.goto('https://www.frtbarabanki.com/UI/Form?FormId=13345', {
            timeout: 60000,
            waitUntil: 'networkidle0' // More stable on Vercel
        });

        // SMART: Wait for form to be ready
        try {
            await page.waitForSelector('#ctrl143708', { timeout: 10000 });
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

        const formatDateIso = (date: Date) => {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${date.getFullYear()}-${month}-${day}`;
        };

        const toDateValue = toDate ? parseDateOnly(toDate) : now;
        const fromDateValue = fromDate ? parseDateOnly(fromDate) : parseDateOnly('2025-11-01');
        const toDateDisplay = formatDateDisplay(toDateValue);
        const fromDateDisplay = formatDateDisplay(fromDateValue);
        const toDateIso = formatDateIso(toDateValue);
        const fromDateIso = formatDateIso(fromDateValue);

        console.log('[SCRAPER] Step 6: Setting dates...', { fromDateDisplay, toDateDisplay });

        await page.evaluate(function ({ fromStr, toStr, fromIsoEval, toIsoEval }: { fromStr: string; toStr: string; fromIsoEval: string; toIsoEval: string }) {
            const fireEvents = (el: HTMLElement) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); };
            const fromEl = document.getElementById('ctrl143709') as HTMLInputElement | null;
            const toEl = document.getElementById('ctrl143707') as HTMLInputElement | null;
            console.log('[SCRAPER] Date fields found:', { fromEl: !!fromEl, toEl: !!toEl });
            if (fromEl) { fromEl.value = fromStr; fireEvents(fromEl); try { (window as any).$ && (window as any)('#ctrl143709').val(fromStr).trigger('change'); } catch { } }
            if (toEl) { toEl.value = toStr; fireEvents(toEl); try { (window as any).$ && (window as any)('#ctrl143707').val(toStr).trigger('change'); } catch { } }
            const dateInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
            if (dateInputs.length === 1) { dateInputs[0].value = toIsoEval; fireEvents(dateInputs[0]); }
            else if (dateInputs.length >= 2) { dateInputs[0].value = fromIsoEval; fireEvents(dateInputs[0]); dateInputs[1].value = toIsoEval; fireEvents(dateInputs[1]); }
        }, { fromStr: fromDateDisplay, toStr: toDateDisplay, fromIsoEval: fromDateIso, toIsoEval: toDateIso });

        // Small delay to let form process dates
        await new Promise(r => setTimeout(r, 500));

        console.log('[SCRAPER] Step 7: Clicking search button...');
        await page.click('#ctrl143708').catch(() => { console.log('[SCRAPER] Search button click failed!'); });

        console.log('[SCRAPER] Waiting for data table...');
        await page.waitForFunction(() => {
            const container = document.querySelector('#printablediv143706');
            if (!container) return false;
            const tables = Array.from(container.querySelectorAll('table'));
            if (tables.length < 2) return false;
            const dataTable = tables[1];
            const rows = dataTable.querySelectorAll('tbody tr, tr');
            return rows.length > 0;
        }, {
            timeout: Number.isFinite(loadTimeout) ? loadTimeout : 300000,
            polling: 1000
        }).catch(async () => {
            const errorMsg = await page.evaluate(function () {
                return document.body.innerText.substring(0, 500);
            });
            throw new Error(`Table did not load within 5 minutes. Page content snippet: ${errorMsg}`);
        });

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
