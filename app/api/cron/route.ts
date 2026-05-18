import { NextResponse } from 'next/server';
import { scrapeWithPuppeteer, saveToNewDb, checkNewTablesExist, getLastSuccessfulScrape } from '../../lib/shared-scraper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Extend to max allowed on Hobby (was 10, but cron might allow up to 60)

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
    const useNewSystem = await checkNewTablesExist();

    const lastSuccessfulScrape = await getLastSuccessfulScrape();
    const toDate = formatDateOnly(new Date());
    const fromDate = lastSuccessfulScrape?.last_scrape_at
      ? subtractDaysFromDateOnly(formatDateOnly(new Date(lastSuccessfulScrape.last_scrape_at)), 1)
      : subtractDaysFromDateOnly(toDate, 1);

    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;

    if (!username || !password) {
      throw new Error('Missing credentials');
    }

    console.log('[CRON] Starting Direct Scrape...', { fromDate, toDate });

    // Direct call - no fetch overhead
    const payload = await scrapeWithPuppeteer(username, password, fromDate, toDate);
    const scrapeDuration = Math.round((Date.now() - startTime) / 1000);

    if (useNewSystem && payload.data && payload.data.length > 0) {
      const saveResult = await saveToNewDb(payload.data, scrapeDuration, 'cron_last_update_minus_1_day');
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
