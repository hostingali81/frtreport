import { NextResponse } from 'next/server';
import { createFrtCallingClient, syncLiveComplaints } from '../../lib/frt-calling';
import {
  createFrtApiScraperSession,
  insertOnlyNewDb,
  logScrapeError,
  logScrapeSuccess,
  checkNewTablesExist,
} from '../../lib/shared-scraper';

// ---------------------------------------------------------------------------
// Vercel Cron Route — /api/cron
// ---------------------------------------------------------------------------
// Triggered every 5 minutes by Vercel Cron (vercel.json).
// Uses the same fast API-replay strategy as scripts/today-scrape.ts:
//   1. Reuse cached FRT session (no browser unless session expired)
//   2. Scrape today's date only
//   3. Insert only NEW complaints (skip duplicates)
//   4. Target runtime: < 60s per run, well within the 5-min window
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
// Vercel Hobby cron functions can run up to 60s, Pro up to 300s.
// Set to 60s (safe for Hobby). Upgrade to 300 on Pro if needed.
export const maxDuration = 60;

// Simple in-memory lock — prevents overlapping concurrent invocations
// (Vercel can occasionally double-invoke a cron if the previous one is slow).
let isRunning = false;

function getTodayInIST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const partMap = Object.fromEntries(
    parts
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export async function GET(request: Request) {
  const startTime = Date.now();

  // ── 1. Auth: only Vercel Cron or requests with the correct secret ──────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';

    if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ── 2. Concurrency guard ───────────────────────────────────────────────────
  if (isRunning) {
    console.log('[CRON] Previous run still in progress — skipping.');
    return NextResponse.json({ skipped: true, reason: 'previous run in progress' });
  }

  // ── 3. Validate DB schema ──────────────────────────────────────────────────
  const useNewSystem = await checkNewTablesExist();
  if (!useNewSystem) {
    return NextResponse.json(
      { success: false, error: 'Optimized complaints table not found — new DB schema required.' },
      { status: 500 }
    );
  }

  // ── 4. Validate credentials ────────────────────────────────────────────────
  const username = process.env.FRT_USERNAME;
  const password = process.env.FRT_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ success: false, error: 'Missing FRT credentials' }, { status: 500 });
  }

  isRunning = true;
  const todayIST = getTodayInIST();
  console.log(`[CRON] Starting 5-min scrape for ${todayIST}…`);

  try {
    // ── 5. Open FRT session (cached — no browser unless token expired) ─────────
    let session: Awaited<ReturnType<typeof createFrtApiScraperSession>>;
    try {
      session = await createFrtApiScraperSession(username, password);
    } catch (err) {
      const msg = getErrorMessage(err);
      console.error('[CRON] Session open failed:', msg);
      await logScrapeError(err instanceof Error ? err : new Error(msg), Math.round((Date.now() - startTime) / 1000));
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }

    // ── 6. Scrape today ────────────────────────────────────────────────────────
    let scrapedRows: Record<string, string>[] = [];
    try {
      console.log(`[CRON] Scraping ${todayIST} → ${todayIST}…`);
      const scrapeStart = Date.now();
      const payload = await session.scrapeRange(todayIST, todayIST);
      scrapedRows = (payload.data ?? []) as Record<string, string>[];
      console.log(`[CRON] Scraped ${scrapedRows.length} rows in ${((Date.now() - scrapeStart) / 1000).toFixed(1)}s`);
    } finally {
      // Always release the FRT login immediately after scraping
      await session.close();
      console.log('[CRON] FRT session closed — login released.');
    }

    // ── 6b. Refresh the calling app's live grid too (best-effort) ──────────────
    // One external ping to /api/cron then refreshes BOTH the report data and the
    // calling grid (FormId 13339) — a warm session replay each, no browser. This
    // is what lets an external pinger (cron-job.org / pg_cron) keep the calling
    // app fresh like its manual Refresh button, without a GitHub runner cold
    // start. A failure here must never fail the report scrape.
    let callingSync: unknown = null;
    try {
      process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';
      const client = await createFrtCallingClient(username, password);
      const rows = await client.fetchList();
      callingSync = await syncLiveComplaints(rows);
      console.log('[CRON] Calling grid synced:', callingSync);
    } catch (err) {
      const msg = getErrorMessage(err);
      console.warn('[CRON] Calling grid sync failed (non-fatal):', msg);
      callingSync = { error: msg };
    }

    // ── 7. Insert only new complaints ──────────────────────────────────────────
    const totalDuration = Math.round((Date.now() - startTime) / 1000);

    if (!scrapedRows.length) {
      console.log('[CRON] No rows for today — nothing to insert.');
      await logScrapeSuccess(0, 0, 0, totalDuration);
      return NextResponse.json({ success: true, message: 'No data for today', stats: { scraped: 0, new: 0, duration: totalDuration }, calling: callingSync });
    }

    const saveResult = await insertOnlyNewDb(scrapedRows, totalDuration, { recordMetadata: true });
    const finalDuration = Math.round((Date.now() - startTime) / 1000);

    console.log('[CRON] Done!', {
      date: todayIST,
      scraped: scrapedRows.length,
      new_inserted: saveResult.new_rows,
      already_existed: saveResult.skipped_rows,
      enriched: saveResult.enriched_rows,
      duration: `${finalDuration}s`,
    });

    return NextResponse.json({
      success: true,
      stats: {
        date: todayIST,
        scraped: scrapedRows.length,
        new: saveResult.new_rows,
        skipped: saveResult.skipped_rows,
        enriched: saveResult.enriched_rows,
        duration: finalDuration,
      },
      calling: callingSync,
    });

  } catch (error: unknown) {
    const errorDuration = Math.round((Date.now() - startTime) / 1000);
    const msg = getErrorMessage(error);
    console.error('[CRON] Fatal error:', msg);
    await logScrapeError(error instanceof Error ? error : new Error(msg), errorDuration);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });

  } finally {
    isRunning = false;
  }
}
