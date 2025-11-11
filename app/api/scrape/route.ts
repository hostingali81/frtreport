import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Ensure this route runs on the Node.js runtime (Playwright is not supported on the Edge runtime)
export const runtime = 'nodejs';
// Always compute fresh data from the remote site
export const dynamic = 'force-dynamic';
// Allow longer execution on serverless
export const maxDuration = 60;

// Supabase client (writes require service role key)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

async function loadFromDb() {
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
    source: 'supabase' 
  };
}

async function saveToDb(payload: any, timestamp: string) {
  if (!supabase) return;
  const dataToSave = { ...payload, lastScrapedAt: timestamp };
  await supabase
    .from('reports')
    .upsert({ key: 'frt_supply', payload: dataToSave }, { onConflict: 'key' });
}

async function scrapeWithPuppeteer(username: string, password: string) {
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
  const toDay = String(now.getDate()).padStart(2, '0');
  const toMon = monthNames[now.getMonth()];
  const toYr = now.getFullYear();
  const toDateDisplay = `${toDay}-${toMon}-${toYr}`;
  const fromDateDisplay = `01-Jan-2010`;
  const todayIso = `${toYr}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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
  let browser;
  
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';

    // Load from Supabase when not refreshing
    if (!refresh) {
      const fromDb = await loadFromDb();
      if (fromDb) {
        return NextResponse.json({ success: true, cached: true, ...fromDb });
      }
    }

    // Ensure Playwright resolves browsers properly
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS || '1';

    // Validate required credentials
    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Missing credentials: set FRT_USERNAME and FRT_PASSWORD in env' },
        { status: 400 }
      );
    }
    
    // Always use Puppeteer on Vercel
    const payload = await scrapeWithPuppeteer(username, password);
    const scrapedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    try { await saveToDb(payload, scrapedAt); } catch {}
    return NextResponse.json({ success: true, cached: false, lastScrapedAt: scrapedAt, source: 'live', ...payload });
  } catch (error: any) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
/*
// Old Playwright code - not used anymore
export async function GET_OLD(request: Request) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    // Set a User-Agent to reduce chances of being blocked by the target site
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    
    await page.goto('https://www.frtbarabanki.com', { timeout: 60000 });
    await page.waitForSelector('#txtUserName', { timeout: 10000 });
    await page.fill('#txtUserName', username);
    await page.fill('#txtPassword', password);
    await page.click('#btnlogin');
    await page.waitForLoadState('networkidle', { timeout: 60000 });

    // Basic login success heuristic: login controls should disappear
    const loginStillVisible = await page.$('#txtUserName');
    if (loginStillVisible) {
      return NextResponse.json(
        { success: false, error: 'Login failed: verify FRT_USERNAME/FRT_PASSWORD or site availability' },
        { status: 401 }
      );
    }
    
    await page.goto('https://www.frtbarabanki.com/UI/Form?FormId=13345', { timeout: 60000 });

    // Explicitly set the known text-date fields and click the known Search button
    const now = new Date();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
    const toDay = String(now.getDate()).padStart(2, '0');
    const toMon = monthNames[now.getMonth()];
    const toYr = now.getFullYear();
    const toDateDisplay = `${toDay}-${toMon}-${toYr}`; // dd-Mon-yyyy
    const fromDateDisplay = `01-Jan-2010`;

    // Also keep a ISO style (yyyy-mm-dd) for generic inputs if needed
    const todayIso = `${toYr}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    await page.evaluate(({ fromStr, toStr, todayIsoEval }) => {
      const fireEvents = (el: HTMLElement) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      // Fill specific masked text inputs (dd-Mon-yyyy)
      const fromEl = document.getElementById('ctrl143709') as HTMLInputElement | null; // From Date
      const toEl = document.getElementById('ctrl143707') as HTMLInputElement | null;   // To Date
      if (fromEl) {
        fromEl.focus();
        fromEl.value = fromStr;
        fireEvents(fromEl);
        // If jQuery present, trigger as well
        try { (window as any).$ && (window as any)('#ctrl143709').val(fromStr).trigger('change'); } catch {}
      }
      if (toEl) {
        toEl.focus();
        toEl.value = toStr;
        fireEvents(toEl);
        try { (window as any).$ && (window as any)('#ctrl143707').val(toStr).trigger('change'); } catch {}
      }

      // Fallback: if native date inputs exist, fill them as yyyy-mm-dd
      const dateInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
      if (dateInputs.length === 1) {
        dateInputs[0].value = todayIsoEval;
        fireEvents(dateInputs[0]);
      } else if (dateInputs.length >= 2) {
        dateInputs[0].value = '2010-01-01';
        fireEvents(dateInputs[0]);
        dateInputs[1].value = todayIsoEval;
        fireEvents(dateInputs[1]);
      }

      // Select options: prefer "All", else first non-placeholder
      const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
      for (const sel of selects) {
        const opts = Array.from(sel.options);
        const allOption = opts.find(o => (o.textContent || '').trim().toLowerCase() === 'all' || (o.value || '').toLowerCase() === 'all');
        if (allOption) {
          sel.value = allOption.value;
          fireEvents(sel);
          continue;
        }
        const firstReal = opts.find(o => {
          const t = (o.textContent || '').trim().toLowerCase();
          const v = (o.value || '').trim().toLowerCase();
          if (v === '' || v === '0' || v === '-1') return false;
          if (t === '' || t.includes('select') || t === '--' || t.includes('choose')) return false;
          return true;
        });
        if (firstReal) {
          sel.value = firstReal.value;
          fireEvents(sel);
        }
      }
    }, { fromStr: fromDateDisplay, toStr: toDateDisplay, todayIsoEval: todayIso });

    // Click the known Search button by id first
    let clickedAction = '';
    const knownSearch = await page.$('#ctrl143708');
    if (knownSearch) {
      await knownSearch.click({ timeout: 5000 });
      clickedAction = '#ctrl143708';
    }

    // If not found, try to click a likely submit/search/view button to populate the grid
    const actionButtonsSelectors = [
      'input[value="Submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'input[value="Search"]',
      'button:has-text("Search")',
      'input[value="View"]',
      'button:has-text("View")',
      'input[value="Get"]',
      'button:has-text("Get")',
      'button:has-text("View Report")'
    ];

    if (!clickedAction) for (const sel of actionButtonsSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        try {
          await btn.click({ timeout: 3000 });
          clickedAction = sel;
          break;
        } catch {}
      }
    }

    // Prefer waiting for the container's second table (data table)
    const dataTableAppeared = await page.waitForFunction(() => {
      const container = document.querySelector('#printablediv143706');
      if (!container) return false;
      const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
      if (tables.length < 2) return false;
      const dataTable = tables[1];
      const rows = dataTable.querySelectorAll('tbody tr').length > 0
        ? Array.from(dataTable.querySelectorAll('tbody tr'))
        : Array.from(dataTable.querySelectorAll('tr'));
      return rows.length >= 1;
    }, { timeout: 20000 }).catch(() => false);

    // Fallback: wait for any table with expected header tokens
    if (!dataTableAppeared) {
      await page.waitForFunction(() => {
        const normalize = (s: string | null | undefined) => (s || '').trim().toLowerCase();
        const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[];
        const target = tables.find(t => {
          const headerCells = Array.from(t.querySelectorAll('thead th, tr th, tr td')) as HTMLElement[];
          const headers = headerCells.map(c => normalize(c.textContent));
          return headers.some(h => h.includes('complaint number'));
        });
        if (!target) return false;
        const bodyRows = target.querySelectorAll('tbody tr').length > 0
          ? Array.from(target.querySelectorAll('tbody tr'))
          : Array.from(target.querySelectorAll('tr'));
        return bodyRows.length >= 2;
      }, { timeout: 15000 }).catch(() => {});
    }
    
    const pageInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"], select'));
      const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
      return {
        buttons: buttons.map(b => ({ text: b.textContent?.trim(), id: b.id, name: (b as HTMLInputElement).name })),
        inputs: inputs.map(i => ({ id: i.id, name: (i as HTMLInputElement).name, type: (i as HTMLInputElement).type })),
        selectOptions: selects.map(s => ({
          id: s.id,
          name: s.name,
          options: Array.from(s.options).map(o => ({ value: o.value, text: (o.textContent || '').trim(), selected: o.selected }))
        }))
      };
    });
    
    const submitBtn = await page.$('input[value="Submit"], button:has-text("Submit"), input[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }
    
    const data = await page.evaluate(() => {
      const normalize = (s: string | null | undefined) => (s || '').trim();
      const lower = (s: string) => s.toLowerCase();
      const container = document.querySelector('#printablediv143706');
      if (container) {
        const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
        if (tables.length >= 2) {
          const headerTable = tables[0];
          const dataTable = tables[1];

          // Try to derive headers from the second row of the header table
          const headerRows = Array.from(headerTable.querySelectorAll('tr'));
          const headerCells = headerRows[1]
            ? Array.from(headerRows[1].querySelectorAll('th, td')) as HTMLElement[]
            : [];

          let headers = headerCells.map((cell, i) => normalize(cell.textContent) || `Column ${i + 1}`);
          if (headers.length === 0) {
            headers = [
              'Complaint Number',
              'Complaint Date and Time',
              'Division',
              'Sub Division',
              'Sub Station',
              'Status',
              'Closed By',
              'Closed Date',
              'Closing Remarks'
            ];
          }

          const dataRows = dataTable.querySelectorAll('tbody tr').length > 0
            ? Array.from(dataTable.querySelectorAll('tbody tr'))
            : Array.from(dataTable.querySelectorAll('tr'));

          const result = dataRows.map(row => {
            const cells = Array.from(row.querySelectorAll('td')) as HTMLElement[];
            if (cells.length === 0) return null;
            const rowData: Record<string, string> = {};
            const limit = Math.min(cells.length, headers.length);
            for (let i = 0; i < limit; i++) {
              rowData[headers[i] || `Column ${i + 1}`] = normalize(cells[i].textContent);
            }
            const anyValue = Object.values(rowData).some(v => v && v.length > 0);
            return anyValue ? rowData : null;
          }).filter(Boolean) as Record<string, string>[];

          return {
            data: result,
            debug: {
              mode: 'container-second-table',
              rows: dataRows.length,
              headers,
            }
          };
        }
      }

      // Fallback: original header-token based detection
      const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[];
      const table = tables.find(t => {
        const headerCells = Array.from(t.querySelectorAll('thead th, tr th, tr td')) as HTMLElement[];
        const headers = headerCells.map(c => lower(normalize(c.textContent)));
        return headers.some(h => h.includes('complaint number'));
      });
      if (!table) return { data: [], debug: 'Target table not found' };

      const allRows = table.querySelectorAll('tbody tr').length > 0
        ? Array.from(table.querySelectorAll('tbody tr'))
        : Array.from(table.querySelectorAll('tr'));

      const headerTokens = ['complaint number', 'complaint date'];
      let headerRowIndex = allRows.findIndex(r => {
        const cells = Array.from(r.querySelectorAll('th, td')) as HTMLElement[];
        const texts = cells.map(c => lower(normalize(c.textContent)));
        return texts.some(t => headerTokens.some(tok => t.includes(tok)));
      });
      if (headerRowIndex === -1) headerRowIndex = 0;

      const headerCells2 = Array.from(allRows[headerRowIndex].querySelectorAll('th, td')) as HTMLElement[];
      const headers2 = headerCells2.map((cell, i) => normalize(cell.textContent) || `Column ${i + 1}`);

      const result2 = allRows.slice(headerRowIndex + 1)
        .map(row => {
          const cells = Array.from(row.querySelectorAll('td')) as HTMLElement[];
          if (cells.length === 0) return null;
          const rowData: Record<string, string> = {};
          cells.forEach((cell, i) => {
            rowData[headers2[i] || `Column ${i + 1}`] = normalize(cell.textContent);
          });
          const anyValue = Object.values(rowData).some(v => v && v.length > 0);
          return anyValue ? rowData : null;
        })
        .filter(Boolean) as Record<string, string>[];

      return {
        data: result2,
        debug: {
          mode: 'fallback-header-token',
          totalRows: allRows.length,
          headerRowIndex,
          headers: headers2,
          tableFound: true,
        }
      };
    });
    
    const payload = { clickedAction, ...data, pageInfo };
    return NextResponse.json({ success: true, ...payload });
  } finally {
    if (browser) await browser.close();
  }
}
*/
