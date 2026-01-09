import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

async function getLastScrapeDate() {
  if (!supabase) return null;
  const { data } = await supabase
    .from('scrape_metadata')
    .select('last_scrape_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.last_scrape_at || null;
}

async function loadFromDb(limit = 10000, offset = 0) {
  if (!supabase) return null;
  const { data, error, count } = await supabase
    .from('complaints')
    .select('raw_data', { count: 'exact' })
    .order('complaint_date', { ascending: false })
    .range(offset, offset + limit - 1);
  
  if (error || !data) return null;
  
  const lastScrape = await getLastScrapeDate();
  return {
    data: data.map(row => row.raw_data),
    total: count || 0,
    lastScrapedAt: lastScrape,
    source: 'supabase'
  };
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  const [, day, month, year, hour, minute, period] = match;
  let hours = parseInt(hour);
  if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, parseInt(minute));
}

async function saveToDb(rows: any[], scrapeDuration: number) {
  if (!supabase || !rows.length) return { new_rows: 0, updated_rows: 0 };
  
  const upsertData = rows.map(row => {
    const complaintDate = parseDate(row['Complaint Date and Time'] || '');
    const closedDate = parseDate(row['Closed Date'] || '');
    
    return {
      complaint_number: row['Complaint Number'],
      complaint_date: complaintDate?.toISOString(),
      division: row['Division'],
      sub_division: row['Sub Division'],
      sub_station: row['Sub Station'],
      status: row['Status'],
      closed_status: row['Closed Status'],
      closed_by: row['Closed By'],
      closed_date: closedDate?.toISOString(),
      closing_remarks: row['Closing Remarks'],
      area_type: row['Area Type'],
      raw_data: row
    };
  });

  const { error, count } = await supabase
    .from('complaints')
    .upsert(upsertData, { 
      onConflict: 'complaint_number',
      ignoreDuplicates: false 
    })
    .select('id');
  
  await supabase.from('scrape_metadata').insert({
    last_scrape_at: new Date().toISOString(),
    total_rows: rows.length,
    new_rows: count || 0,
    updated_rows: rows.length - (count || 0),
    duration_seconds: scrapeDuration,
    status: 'success'
  });
  
  return { new_rows: count || 0, updated_rows: rows.length - (count || 0) };
}

async function scrapeWithPuppeteer(username: string, password: string, fromDate?: string, toDate?: string) {
  const isVercel = !!process.env.VERCEL_ENV;
  let puppeteer: any;
  let launchOptions: any = { headless: true };

  if (isVercel) {
    const chromium = (await import('@sparticuz/chromium')).default;
    puppeteer = await import('puppeteer-core');
    launchOptions = {
      ...launchOptions,
      args: chromium.args,
      executablePath: await chromium.executablePath(),
    };
  } else {
    puppeteer = await import('puppeteer');
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  await page.goto('https://www.frtbarabanki.com', { timeout: 60000, waitUntil: 'networkidle0' });
  await page.waitForSelector('#txtUserName', { timeout: 10000 });
  await page.type('#txtUserName', username);
  await page.type('#txtPassword', password);
  await page.click('#btnlogin');
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
  await page.goto('https://www.frtbarabanki.com/UI/Form?FormId=13345', { timeout: 60000, waitUntil: 'networkidle0' });

  const now = new Date();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
  
  const formatDateDisplay = (date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const mon = monthNames[date.getMonth()];
    const yr = date.getFullYear();
    return `${day}-${mon}-${yr}`;
  };
  
  const toDateDisplay = toDate ? formatDateDisplay(new Date(toDate)) : formatDateDisplay(now);
  const fromDateDisplay = fromDate ? formatDateDisplay(new Date(fromDate)) : '01-Jan-2010';
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  await page.evaluate(({ fromStr, toStr, todayIsoEval }: { fromStr: string; toStr: string; todayIsoEval: string }) => {
    const fireEvents = (el: HTMLElement) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); };
    const fromEl = document.getElementById('ctrl143709') as HTMLInputElement | null;
    const toEl = document.getElementById('ctrl143707') as HTMLInputElement | null;
    if (fromEl) { fromEl.value = fromStr; fireEvents(fromEl); try { (window as any).$ && (window as any)('#ctrl143709').val(fromStr).trigger('change'); } catch {} }
    if (toEl) { toEl.value = toStr; fireEvents(toEl); try { (window as any).$ && (window as any)('#ctrl143707').val(toStr).trigger('change'); } catch {} }
    const dateInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    if (dateInputs.length === 1) { dateInputs[0].value = todayIsoEval; fireEvents(dateInputs[0]); }
    else if (dateInputs.length >= 2) { dateInputs[0].value = '2010-01-01'; fireEvents(dateInputs[0]); dateInputs[1].value = todayIsoEval; fireEvents(dateInputs[1]); }
  }, { fromStr: fromDateDisplay, toStr: toDateDisplay, todayIsoEval: todayIso });

  await page.click('#ctrl143708').catch(() => {});

  await page.waitForFunction(() => {
    const container = document.querySelector('#printablediv143706');
    if (!container) return false;
    const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
    if (tables.length < 2) return false;
    const dataTable = tables[1];
    const rows = dataTable.querySelectorAll('tbody tr').length > 0 ? Array.from(dataTable.querySelectorAll('tbody tr')) : Array.from(dataTable.querySelectorAll('tr'));
    return rows.length >= 1;
  }, { timeout: 20000 }).catch(() => {});

  const result = await page.evaluate(() => {
    const normalize = (s: string | null | undefined) => (s || '').trim();
    const container = document.querySelector('#printablediv143706');
    if (!container) return { data: [], debug: 'container not found' };
    const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
    if (tables.length < 2) return { data: [], debug: 'tables not found' };
    const headerTable = tables[0];
    const dataTable = tables[1];
    const headerRows = Array.from(headerTable.querySelectorAll('tr'));
    const headerCells = headerRows[1] ? Array.from(headerRows[1].querySelectorAll('th, td')) as HTMLElement[] : [];
    let headers = headerCells.map((cell, i) => normalize(cell.textContent) || `Column ${i + 1}`);
    if (headers.length === 0) {
      headers = ['Complaint Number','Complaint Date and Time','Division','Sub Division','Sub Station','Status','Closed By','Closed Date','Closing Remarks'];
    }
    const dataRows = dataTable.querySelectorAll('tbody tr').length > 0 ? Array.from(dataTable.querySelectorAll('tbody tr')) : Array.from(dataTable.querySelectorAll('tr'));
    const mapped = dataRows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')) as HTMLElement[];
      if (cells.length === 0) return null;
      const rowData: Record<string, string> = {};
      const limit = Math.min(cells.length, headers.length);
      for (let i = 0; i < limit; i++) rowData[headers[i] || `Column ${i + 1}`] = normalize(cells[i].textContent);
      const anyValue = Object.values(rowData).some(v => v && v.length > 0);
      return anyValue ? rowData : null;
    }).filter(Boolean) as Record<string, string>[];
    return { data: mapped, debug: { mode: 'puppeteer' } };
  });

  await browser.close();
  return { clickedAction: '#ctrl143708', ...result, pageInfo: {} };
}

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';
    const fullScrape = searchParams.get('full') === '1';

    if (!refresh) {
      const fromDb = await loadFromDb();
      if (fromDb) {
        return NextResponse.json({ success: true, cached: true, ...fromDb });
      }
    }

    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS || '1';

    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Missing credentials: set FRT_USERNAME and FRT_PASSWORD in env' },
        { status: 400 }
      );
    }
    
    let fromDate: string | undefined;
    let toDate: string | undefined;
    
    if (!fullScrape) {
      const lastScrape = await getLastScrapeDate();
      if (lastScrape) {
        fromDate = new Date(lastScrape).toISOString().split('T')[0];
        toDate = new Date().toISOString().split('T')[0];
      }
    }
    
    const payload = await scrapeWithPuppeteer(username, password, fromDate, toDate);
    const scrapeDuration = Math.round((Date.now() - startTime) / 1000);
    
    const saveResult = await saveToDb(payload.data || [], scrapeDuration);
    
    const scrapedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    return NextResponse.json({ 
      success: true, 
      cached: false, 
      lastScrapedAt: scrapedAt, 
      source: 'live',
      scrapeType: fullScrape ? 'full' : (fromDate ? 'incremental' : 'full'),
      dateRange: fromDate ? { from: fromDate, to: toDate } : null,
      stats: {
        total: payload.data?.length || 0,
        new: saveResult.new_rows,
        updated: saveResult.updated_rows,
        duration: scrapeDuration
      },
      data: payload.data
    });
  } catch (error: any) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
