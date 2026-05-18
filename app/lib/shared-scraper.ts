import { createClient } from '@supabase/supabase-js';
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
    
    return {
        data: allData.map(row => row.raw_data),
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
    const existingRecords: Array<{ complaint_number: string }> = [];

    for (let i = 0; i < complaintNumbers.length; i += 500) {
        const batch = complaintNumbers.slice(i, i + 500);
        const { data, error } = await supabase
            .from('complaints')
            .select('complaint_number')
            .in('complaint_number', batch);

        if (error) {
            throw new Error(`Existing complaint lookup failed (${i + 1}-${i + batch.length}): ${describeError(error)}`);
        }

        existingRecords.push(...(data || []));
    }

    const existingSet = new Set(existingRecords.map(r => r.complaint_number));
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

    const batches = [];
    for (let i = 0; i < upsertData.length; i += 250) {
        batches.push(upsertData.slice(i, i + 250));
    }

    for (let i = 0; i < batches.length; i++) {
        let attempt = 0;

        while (true) {
            attempt += 1;
            const { error } = await supabase
                .from('complaints')
                .upsert(batches[i], { onConflict: 'complaint_number', ignoreDuplicates: false });

            if (!error) break;

            const description = describeError(error);
            if (attempt >= 3 || !isTransientDbError(error)) {
                throw new Error(`Failed to upsert complaint batch ${i + 1}/${batches.length}: ${description}`);
            }

            const delay = Math.min(2000 * attempt, 10000);
            console.warn(
                `Complaint batch ${i + 1}/${batches.length} failed on attempt ${attempt}/3: ${description}. Retrying in ${delay}ms.`
            );
            await sleep(delay);
        }
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
        if (/session|login|logged|already|active|unauthorized|unauthorised/i.test(lastDialogMessage)) {
            return new Error(`FRT session/login dialog: ${lastDialogMessage}`);
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

        console.log('[SCRAPER] Step 3: Filling credentials...');
        // Direct value set - instant!
        await page.evaluate((credentials: { user: string; pass: string }) => {
            const userEl = document.getElementById('txtUserName') as HTMLInputElement;
            const passEl = document.getElementById('txtPassword') as HTMLInputElement;
            if (userEl) userEl.value = credentials.user;
            if (passEl) passEl.value = credentials.pass;
        }, { user: username, pass: password });
        
        await page.click('#btnlogin');

        console.log('[SCRAPER] Step 4: Waiting for successful login...');
        // Wait for navigation to complete
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

        // Quick wait for form to process
        await new Promise(r => setTimeout(r, 300));

        console.log('[SCRAPER] Step 7: Clicking search button...');
        await page.click('#ctrl143708');

        // PERFECT FIX: Wait for loader to disappear!
        console.log('[SCRAPER] Waiting for loader to disappear...');
        const startWait = Date.now();
        
        await page.waitForFunction(() => {
            const loader = document.querySelector('.loading-bar');
            if (!loader) return true; // No loader = already loaded
            const style = window.getComputedStyle(loader);
            return style.display === 'none'; // Loader hidden = data ready!
        }, { 
            timeout: Number.isFinite(loadTimeout) ? loadTimeout : 300000,
            polling: 1000
        });
        
        const loadTime = Math.round((Date.now() - startWait) / 1000);
        console.log(`[SCRAPER] ✅ Data loaded in ${loadTime}s (loader disappeared)`);
        
        // Small safety wait for DOM to settle
        await new Promise(r => setTimeout(r, 1000));

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
