import { NextResponse } from 'next/server';
import { warmCallingStats } from '../../lib/calling-stats-cache';
import { createFrtCallingClient, syncLiveComplaints } from '../../lib/frt-calling';
import {
  createFrtApiScraperSession,
  getSupabaseClient,
  saveToNewDb,
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
//   2. Scrape a small recent window (today back CRON_LOOKBACK_DAYS)
//   3. Upsert with change-detection — new complaints inserted, status changes
//      on recent complaints updated, unchanged rows skipped by content_hash
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

function subtractDaysIST(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// The cron re-scrapes today only (LOOKBACK 0) so it stays fast — it runs every
// ~2 min. saveToNewDb still updates any status change on today's complaints
// (writes only changed rows). Yesterday's across-midnight flips are caught by the
// Sync Latest button, and everything older by the Daily Full Scrape (~3 AM IST).
const CRON_LOOKBACK_DAYS = Math.max(0, Number(process.env.CRON_STATUS_LOOKBACK_DAYS) || 0);

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

    // ── 6. Scrape the recent window (today back CRON_LOOKBACK_DAYS) ─────────────
    const fromIST = subtractDaysIST(todayIST, CRON_LOOKBACK_DAYS);
    let scrapedRows: Record<string, string>[] = [];
    try {
      console.log(`[CRON] Scraping ${fromIST} → ${todayIST}…`);
      const scrapeStart = Date.now();
      const payload = await session.scrapeRange(fromIST, todayIST);
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

    // Precompute the Calling Report stats while the DB is warm (the grid sync
    // above just touched complaints/live_complaints), storing each preset in
    // `reports` so /api/calling/analytics serves the dashboard from one fast row
    // read instead of the cold ~4-8s RPC. Runs AFTER the insert below so it can
    // never eat into the critical scrape→insert path; non-fatal either way.
    const warmCallingStatsCache = async () => {
      try {
        const supabase = getSupabaseClient();
        if (supabase) {
          const warm = await warmCallingStats(supabase);
          console.log('[CRON] Calling stats warmed:', warm);
        }
      } catch (err) {
        console.warn('[CRON] Calling stats warm failed (non-fatal):', getErrorMessage(err));
      }
    };

    // ── 7. Insert only new complaints ──────────────────────────────────────────
    const totalDuration = Math.round((Date.now() - startTime) / 1000);

    if (!scrapedRows.length) {
      console.log('[CRON] No rows in window — nothing to write.');
      await logScrapeSuccess(0, 0, 0, totalDuration);
      await warmCallingStatsCache();
      return NextResponse.json({ success: true, message: 'No data in window', stats: { scraped: 0, new: 0, updated: 0, duration: totalDuration }, calling: callingSync });
    }

    // Upsert with change-detection: new complaints are inserted, and existing
    // ones whose content changed (e.g. status flipped to Closed) are updated.
    // Unchanged rows are skipped by content_hash, so re-scanning the window is cheap.
    const saveResult = await saveToNewDb(scrapedRows, totalDuration, 'cron_status_refresh', { recordMetadata: true });
    await warmCallingStatsCache();
    const finalDuration = Math.round((Date.now() - startTime) / 1000);

    console.log('[CRON] Done!', {
      range: `${fromIST}..${todayIST}`,
      scraped: scrapedRows.length,
      new: saveResult.new_rows,
      updated: saveResult.updated_rows,
      duration: `${finalDuration}s`,
    });

    return NextResponse.json({
      success: true,
      stats: {
        range: `${fromIST}..${todayIST}`,
        scraped: scrapedRows.length,
        new: saveResult.new_rows,
        updated: saveResult.updated_rows,
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
