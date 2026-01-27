import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10; // Vercel free tier - only incremental scraping

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

async function checkNewTablesExist() {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('complaints').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function loadFromOldDb() {
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

async function saveToOldDb(payload: any, timestamp: string) {
  if (!supabase) return;
  const dataToSave = { ...payload, lastScrapedAt: timestamp };
  await supabase
    .from('reports')
    .upsert({ key: 'frt_supply', payload: dataToSave }, { onConflict: 'key' });
}

async function getLastSuccessfulScrape() {
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

// Get the latest complaint date from the database
async function getLastComplaintDate(): Promise<string | null> {
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

async function loadFromNewDb() {
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

// Parse date in IST timezone (India Standard Time)
function parseDate(dateStr: string): Date | null {
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
function toISTISOString(date: Date | null): string | null {
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
function getCurrentISTTime(): string {
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

async function saveToNewDb(rows: any[], scrapeDuration: number, scrapeType: string) {
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
  const { data: existingRecords } = await supabase
    .from('complaints')
    .select('complaint_number')
    .in('complaint_number', complaintNumbers);

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

  results.forEach((result, i) => {
    if (result.status === 'rejected' || (result.status === 'fulfilled' && result.value.error)) {
      console.error(`Batch ${i + 1} error:`, result.status === 'rejected' ? result.reason : result.value.error);
    }
  });

  const now = new Date();
  await supabase.from('scrape_metadata').insert({
    last_scrape_at: getCurrentISTTime(),
    total_rows: validRows.length,
    new_rows: newRowsCount,
    updated_rows: updatedRowsCount,
    duration_seconds: scrapeDuration,
    status: 'success'
  });

  return { new_rows: newRowsCount, updated_rows: updatedRowsCount };
}

async function scrapeWithPuppeteer(username: string, password: string, fromDate?: string, toDate?: string) {
  const isVercel = !!process.env.VERCEL_ENV;
  let puppeteer: any;
  // Use visible browser for local debugging, headless for Vercel
  let launchOptions: any = { headless: isVercel ? true : false, slowMo: isVercel ? 0 : 50 };

  console.log('[SCRAPER] Starting scraper...', { isVercel, fromDate, toDate });

  if (isVercel) {
    const chromium = (await import('@sparticuz/chromium')).default;
    puppeteer = await import('puppeteer-core');
    launchOptions = {
      ...launchOptions,
      headless: true,
      args: chromium.args,
      executablePath: await chromium.executablePath(),
    };
  } else {
    puppeteer = await import('puppeteer');
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

  console.log('[SCRAPER] Step 1: Opening website...');
  await page.goto('https://www.frtbarabanki.com', { timeout: 8000, waitUntil: 'domcontentloaded' });

  console.log('[SCRAPER] Step 2: Waiting for login form...');
  await page.waitForSelector('#txtUserName', { timeout: 3000 });

  console.log('[SCRAPER] Step 3: Filling credentials...');
  await page.type('#txtUserName', username);
  await page.type('#txtPassword', password);
  await page.click('#btnlogin');

  console.log('[SCRAPER] Step 4: Waiting for navigation after login...');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 });

  console.log('[SCRAPER] Step 5: Navigating to form page...');
  await page.goto('https://www.frtbarabanki.com/UI/Form?FormId=13345', { timeout: 8000, waitUntil: 'domcontentloaded' });

  const now = new Date();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

  // Input fields use DD-Mon-YYYY format (like 20-Jan-2026)
  const formatDateDisplay = (date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const mon = monthNames[date.getMonth()];
    const yr = date.getFullYear();
    return `${day}-${mon}-${yr}`;
  };

  const toDateDisplay = toDate ? formatDateDisplay(new Date(toDate)) : formatDateDisplay(now);
  const fromDateDisplay = fromDate ? formatDateDisplay(new Date(fromDate)) : '01-Nov-2025';
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  console.log('[SCRAPER] Step 6: Setting dates...', { fromDateDisplay, toDateDisplay });

  await page.evaluate(({ fromStr, toStr, todayIsoEval }: { fromStr: string; toStr: string; todayIsoEval: string }) => {
    const fireEvents = (el: HTMLElement) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); };
    const fromEl = document.getElementById('ctrl143709') as HTMLInputElement | null;
    const toEl = document.getElementById('ctrl143707') as HTMLInputElement | null;
    console.log('[SCRAPER] Date fields found:', { fromEl: !!fromEl, toEl: !!toEl });
    if (fromEl) { fromEl.value = fromStr; fireEvents(fromEl); try { (window as any).$ && (window as any)('#ctrl143709').val(fromStr).trigger('change'); } catch { } }
    if (toEl) { toEl.value = toStr; fireEvents(toEl); try { (window as any).$ && (window as any)('#ctrl143707').val(toStr).trigger('change'); } catch { } }
    const dateInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    if (dateInputs.length === 1) { dateInputs[0].value = todayIsoEval; fireEvents(dateInputs[0]); }
    else if (dateInputs.length >= 2) { dateInputs[0].value = '2025-11-01'; fireEvents(dateInputs[0]); dateInputs[1].value = todayIsoEval; fireEvents(dateInputs[1]); }
  }, { fromStr: fromDateDisplay, toStr: toDateDisplay, todayIsoEval: todayIso });

  // Small delay to let form process dates
  await new Promise(r => setTimeout(r, 200));

  console.log('[SCRAPER] Step 7: Clicking search button...');
  await page.click('#ctrl143708').catch(() => { console.log('[SCRAPER] Search button click failed!'); });

  // Quick wait for table
  await page.waitForFunction(() => {
    const container = document.querySelector('#printablediv143706');
    if (!container) return false;
    const tables = Array.from(container.querySelectorAll('table'));
    if (tables.length < 2) return false;
    const dataTable = tables[1];
    const rows = dataTable.querySelectorAll('tbody tr, tr');
    return rows.length > 0;
  }, { timeout: 5000 }).catch(() => {
    throw new Error('Table did not load');
  });

  // Skip "Show All" - scrape only first page for speed
  console.log('[SCRAPER] Step 8: Scraping first page only...');

  const result = await page.evaluate(() => {
    const normalize = (s: string | null | undefined) => (s || '').trim();
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

  await browser.close();
  return { clickedAction: '#ctrl143708', data: result.data, pageInfo: { totalPages: 1, totalRows: result.data.length } };
}

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';
    const cronSecret = searchParams.get('secret');
    const isCronJob = cronSecret === process.env.CRON_SECRET;
    const forceFullScrape = isCronJob; // Only cron can do full scrape

    const useNewSystem = await checkNewTablesExist();

    if (!refresh) {
      const fromDb = useNewSystem ? await loadFromNewDb() : await loadFromOldDb();
      if (fromDb) {
        return NextResponse.json({ success: true, cached: true, ...fromDb });
      }
    }

    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Missing credentials' },
        { status: 400 }
      );
    }

    let fromDate: string | undefined;
    let toDate: string | undefined;
    let scrapeType = 'incremental';

    // Always incremental unless cron job
    if (useNewSystem && !isCronJob) {
      const lastComplaintDate = await getLastComplaintDate();

      if (lastComplaintDate) {
        const lastDate = new Date(lastComplaintDate);
        const safeDate = new Date(lastDate);
        safeDate.setDate(safeDate.getDate() - 2);
        fromDate = safeDate.toISOString().split('T')[0];
        toDate = new Date().toISOString().split('T')[0];
      } else {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        fromDate = sevenDaysAgo.toISOString().split('T')[0];
        toDate = new Date().toISOString().split('T')[0];
      }
    } else if (isCronJob) {
      scrapeType = 'full_cron';
      // Full scrape - no date filters
    }

    const payload = await scrapeWithPuppeteer(username, password, fromDate, toDate);
    const scrapeDuration = Math.round((Date.now() - startTime) / 1000);
    const scrapedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    if (!payload.data || payload.data.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No data scraped. Please check website or try again.',
        scrapeType,
        debug: payload
      }, { status: 500 });
    }

    // Filter valid rows (with complaint numbers)
    const validData = payload.data?.filter((r: any) => r['Complaint Number'] && r['Complaint Number'].trim()) || [];

    if (!validData.length) {
      return NextResponse.json({
        success: false,
        error: `Scraped ${payload.data?.length || 0} rows but none had valid complaint numbers`,
        scrapeType,
        debug: {
          firstRowKeys: Object.keys(payload.data[0] || {}),
          firstRowSample: payload.data[0]
        }
      }, { status: 500 });
    }

    if (useNewSystem) {
      const saveResult = await saveToNewDb(payload.data, scrapeDuration, scrapeType);
      const { count } = await supabase!.from('complaints').select('id', { count: 'exact', head: true });

      return NextResponse.json({
        success: true,
        cached: false,
        lastScrapedAt: scrapedAt,
        source: 'live',
        system: 'optimized',
        scrapeType,
        dateRange: fromDate ? { from: fromDate, to: toDate } : { from: '2025-11-01', to: new Date().toISOString().split('T')[0] },
        stats: {
          scraped: validData.length,
          new: saveResult.new_rows,
          updated: saveResult.updated_rows,
          total_in_db: count || 0,
          duration: scrapeDuration
        },
        data: validData.slice(0, 10000) // Limit response data to 10k for performance
      });
    } else {
      await saveToOldDb(payload, scrapedAt);
      return NextResponse.json({
        success: true,
        cached: false,
        lastScrapedAt: scrapedAt,
        source: 'live',
        system: 'legacy',
        message: 'Using old system. Run migration to enable optimized features.',
        ...payload
      });
    }
  } catch (error: any) {
    console.error('Scraping error:', error);
    const errorDuration = Math.round((Date.now() - startTime) / 1000);

    if (supabase) {
      const now = new Date();
      supabase.from('scrape_metadata').insert({
        last_scrape_at: getCurrentISTTime(),
        total_rows: 0,
        new_rows: 0,
        updated_rows: 0,
        duration_seconds: errorDuration,
        status: 'failed',
        error_message: error.message
      });
    }

    return NextResponse.json({
      success: false,
      error: error.message,
      suggestion: 'Try force full scrape: /api/scrape?refresh=1&full=1'
    }, { status: 500 });
  }
}

// Forced deployment trigger: 2026-01-27
