
import {
    checkNewTablesExist,
    scrapeWithPuppeteer,
    saveToNewDb,
    saveToOldDb,
    logScrapeError
} from '../app/lib/shared-scraper';

async function main() {
    console.log('[SCRIPT] Starting Full Daily Scrape...');
    const startTime = Date.now();

    try {
        // 1. Verify Environment
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
            throw new Error('Missing Supabase credentials');
        }
        if (!process.env.FRT_USERNAME || !process.env.FRT_PASSWORD) {
            throw new Error('Missing FRT credentials');
        }

        // 2. Determine System (New vs Old)
        const useNewSystem = await checkNewTablesExist();
        console.log(`[SCRIPT] System detected: ${useNewSystem ? 'Optimized (Supabase Complaint Table)' : 'Legacy (JSON Blob)'}`);

        // 3. Define Date Range (Full Scrape Strategy)
        // For GitHub Actions, we want to scrape from Nov 1, 2025 to Present every day
        // This ensures we catch any back-dated updates and heal missing data
        const fromDate = '2025-11-01';
        const toDate = new Date().toISOString().split('T')[0];

        console.log(`[SCRIPT] Date Range: ${fromDate} to ${toDate}`);

        // 4. Run Scraper
        const scrapeType = 'github_action_full_daily';
        const payload = await scrapeWithPuppeteer(
            process.env.FRT_USERNAME,
            process.env.FRT_PASSWORD,
            fromDate,
            toDate
        );

        const scrapeDuration = Math.round((Date.now() - startTime) / 1000);
        const scrapedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        // 5. Save Data
        if (!payload.data || payload.data.length === 0) {
            console.error('[SCRIPT] No data scraped.');
            await logScrapeError(new Error('No data scraped'), scrapeDuration);
            process.exit(1);
        }

        const validData = payload.data?.filter((r: any) => r['Complaint Number'] && r['Complaint Number'].trim()) || [];
        console.log(`[SCRIPT] Scraped ${payload.data.length} rows, ${validData.length} valid.`);

        if (useNewSystem) {
            const saveResult = await saveToNewDb(payload.data, scrapeDuration, scrapeType);
            console.log('[SCRIPT] Success!', {
                scraped: validData.length,
                new: saveResult.new_rows,
                updated: saveResult.updated_rows,
                duration: scrapeDuration
            });
        } else {
            await saveToOldDb(payload, scrapedAt);
            console.log('[SCRIPT] Success (Legacy)!');
        }

        process.exit(0);

    } catch (error: any) {
        console.error('[SCRIPT] Fatal Error:', error);
        const errorDuration = Math.round((Date.now() - startTime) / 1000);
        await logScrapeError(error, errorDuration);
        process.exit(1);
    }
}

main();
