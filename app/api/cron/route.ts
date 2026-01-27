import { NextResponse } from 'next/server';
import { scrapeWithPuppeteer, saveToNewDb, checkNewTablesExist, getCurrentISTTime } from '../../lib/shared-scraper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Extend to max allowed on Hobby (was 10, but cron might allow up to 60)

export async function GET(request: Request) {
  const startTime = Date.now();
  try {
    const useNewSystem = await checkNewTablesExist();

    // Explicitly define 7 days range for Cron
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fromDate = sevenDaysAgo.toISOString().split('T')[0];
    const toDate = new Date().toISOString().split('T')[0];

    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;

    if (!username || !password) {
      throw new Error('Missing credentials');
    }

    console.log('[CRON] Starting Direct Scrape (Last 7 Days)...');

    // Direct call - no fetch overhead
    const payload = await scrapeWithPuppeteer(username, password, fromDate, toDate);
    const scrapeDuration = Math.round((Date.now() - startTime) / 1000);

    if (useNewSystem && payload.data && payload.data.length > 0) {
      const saveResult = await saveToNewDb(payload.data, scrapeDuration, 'cron_direct');
      return NextResponse.json({
        success: true,
        source: 'cron_direct',
        stats: {
          scraped: payload.data.length,
          new: saveResult.new_rows,
          updated: saveResult.updated_rows,
          duration: scrapeDuration
        }
      });
    }

    return NextResponse.json({ success: true, message: 'Cron run (no data or old system)', payload });

  } catch (error: any) {
    console.error('[CRON] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
