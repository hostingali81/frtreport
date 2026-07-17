import { NextResponse } from 'next/server';
import {
  checkNewTablesExist,
  getLastSuccessfulScrape,
  loadFromNewDb,
  loadFromOldDb,
  scrapeFrtFast,
  scrapeWithPuppeteer,
  isFatalFrtLoginError,
  saveToNewDb,
  saveToOldDb,
  getCurrentISTTime,
  getSupabaseClient
} from '../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Incremental sync only; keep the date range small.

// The "Sync Latest" button re-scrapes today + yesterday (LOOKBACK 1) and upserts
// via saveToNewDb, so a status flip (Pending -> Complaint Closed) on a very recent
// complaint updates immediately — not just brand-new rows. Kept small so the
// button stays fast; older complaints are handled by the Daily Full Scrape.
const SYNC_LOOKBACK_DAYS = Math.max(1, Number(process.env.SYNC_LOOKBACK_DAYS) || 1);

function getISTDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const partMap = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day)
  };
}

function formatDateOnly(date: Date) {
  const { year, month, day } = getISTDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function subtractDaysFromDateOnly(dateOnly: string, days: number) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateOnly;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  date.setUTCDate(date.getUTCDate() - days);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';
    const cronSecret = searchParams.get('secret');
    const isCronJob = cronSecret === process.env.CRON_SECRET;

    // Note: 'full' param is ignored on Vercel unless manually triggered and lucky with timeout, 
    // but useful for local debugging
    const forceFullScrape = searchParams.get('full') === '1';

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

    // Website sync stays small: last successful update day - 1 through today.
    if (useNewSystem && !isCronJob && !forceFullScrape) {
      const lastSuccessfulScrape = await getLastSuccessfulScrape();
      toDate = formatDateOnly(new Date());

      if (lastSuccessfulScrape?.last_scrape_at) {
        const lastUpdateDay = formatDateOnly(new Date(lastSuccessfulScrape.last_scrape_at));
        fromDate = subtractDaysFromDateOnly(lastUpdateDay, 1);
        scrapeType = 'manual_sync_last_update_minus_1_day';
      } else {
        fromDate = subtractDaysFromDateOnly(toDate, 1);
        scrapeType = 'manual_sync_last_2_days_initial';
      }
    } else if (isCronJob) {
      scrapeType = 'cron_last_update_minus_1_day';
      const lastSuccessfulScrape = await getLastSuccessfulScrape();
      toDate = formatDateOnly(new Date());
      if (lastSuccessfulScrape?.last_scrape_at) {
        const lastUpdateDay = formatDateOnly(new Date(lastSuccessfulScrape.last_scrape_at));
        fromDate = subtractDaysFromDateOnly(lastUpdateDay, 1);
      } else {
        fromDate = subtractDaysFromDateOnly(toDate, 1);
      }
    } else if (forceFullScrape) {
      scrapeType = 'manual_full_attempt';
      // Manual override - will likely timeout on Vercel if range is large
      // But useful if running locally
    }

    // Widen the incremental window back to at least SYNC_LOOKBACK_DAYS so status
    // changes on recently-filed complaints are re-fetched, not just new rows.
    if (fromDate && toDate && !forceFullScrape) {
      const lookbackFloor = subtractDaysFromDateOnly(toDate, SYNC_LOOKBACK_DAYS);
      if (lookbackFloor < fromDate) fromDate = lookbackFloor;
    }

    // Fast path: replay the captured report API session (no browser unless the
    // session needs refreshing). Falls back to the DOM scraper on failure.
    let payload;
    try {
      payload = await scrapeFrtFast(username, password, fromDate, toDate);
    } catch (fastError: any) {
      const message = fastError?.message || String(fastError);
      if (isFatalFrtLoginError(message)) throw fastError;
      console.warn('[SCRAPE] Fast API scrape failed, falling back to browser scraper:', message);
      payload = await scrapeWithPuppeteer(username, password, fromDate, toDate);
    }
    const scrapeDuration = Math.round((Date.now() - startTime) / 1000);
    const scrapedAt = new Date().toLocaleString('en-IN', { 
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

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
      const saveResult = await saveToNewDb(validData, scrapeDuration, scrapeType);

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
          duration: scrapeDuration
        }
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
    const supabase = getSupabaseClient();
    const isBrowserError = /Local browser launch failed|Could not find Chrome|Could not find expected browser|Browser was not found/i.test(error?.message || '');

    if (supabase) {
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
      suggestion: isBrowserError
        ? 'Local browser not available. Install Chrome with "npm run install:chrome" or set CHROME_PATH / PUPPETEER_EXECUTABLE_PATH.'
        : 'Try force full scrape: /api/scrape?refresh=1&full=1'
    }, { status: 500 });
  }
}
