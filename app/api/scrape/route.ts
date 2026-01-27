import { NextResponse } from 'next/server';
import {
  checkNewTablesExist,
  loadFromNewDb,
  loadFromOldDb,
  scrapeWithPuppeteer,
  saveToNewDb,
  saveToOldDb,
  getLastComplaintDate,
  getCurrentISTTime,
  getSupabaseClient
} from '../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Attempt to extend Vercel timeout to 60s

export async function GET(request: Request) {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

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

    // Vercel Logic: Strict limits to avoid timeout
    if (useNewSystem && !isCronJob && !forceFullScrape) {
      // Normal user refresh - scrape last 2 days or 7 days if empty
      const lastComplaintDate = await getLastComplaintDate();

      if (lastComplaintDate) {
        const lastDate = new Date(lastComplaintDate);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Cap lookback to 7 days max to prevent timeouts on Vercel
        // If DB is very old (e.g. months ago), we only backfill last 7 days here.
        // GitHub Actions handles the deep historical backfill.
        if (lastDate < sevenDaysAgo) {
          fromDate = sevenDaysAgo.toISOString().split('T')[0];
        } else {
          const safeDate = new Date(lastDate);
          safeDate.setDate(safeDate.getDate() - 2); // Overlap 2 days for safety
          fromDate = safeDate.toISOString().split('T')[0];
        }
        toDate = new Date().toISOString().split('T')[0];
      } else {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        fromDate = sevenDaysAgo.toISOString().split('T')[0];
        toDate = new Date().toISOString().split('T')[0];
      }
    } else if (isCronJob) {
      scrapeType = 'cron_last_7_days';
      // Robust incremental scrape for cron checks last 7 days to catch updates/delays
      // This ensures speed (<10s) and reliability
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      fromDate = sevenDaysAgo.toISOString().split('T')[0];
      toDate = new Date().toISOString().split('T')[0];
    } else if (forceFullScrape) {
      scrapeType = 'manual_full_attempt';
      // Manual override - will likely timeout on Vercel if range is large
      // But useful if running locally
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
      const { count } = supabase ? await supabase.from('complaints').select('id', { count: 'exact', head: true }) : { count: 0 };

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
    const supabase = getSupabaseClient();

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
