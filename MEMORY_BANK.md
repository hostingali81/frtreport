# Memory Bank - FRT Barabanki Scraping Project

## Project Overview
Next.js web scraping application that extracts complaint data from frtbarabanki.com and displays it in a dashboard with PDF export capabilities.

## Tech Stack
- **Framework**: Next.js 16.0.1 (App Router)
- **Runtime**: Node.js (serverless)
- **Scraping**: Playwright (local) + Puppeteer + @sparticuz/chromium (Vercel)
- **Database**: Supabase (caching layer)
- **PDF**: jsPDF + jspdf-autotable
- **Styling**: Tailwind CSS 4

## Architecture

### API Route: `/app/api/scrape/route.ts`
- **Runtime**: `nodejs` (maxDuration: 60s)
- **Caching**: 3-tier (in-memory → Supabase → live scrape)
- **Dual Engine**: Playwright (dev) / Puppeteer (production/Vercel)

### Scraping Flow
1. Login to frtbarabanki.com with credentials
2. Navigate to Form 13345
3. Set date range (01-Jan-2010 to today)
4. Click search button (#ctrl143708)
5. Extract data from #printablediv143706 (2-table structure)

### Data Structure
Extracts 9 columns:
- Complaint Number
- Complaint Date and Time
- Division
- Sub Division
- Sub Station
- Status
- Closed By
- Closed Date
- Closing Remarks

## Environment Variables
```
FRT_USERNAME=<login username>
FRT_PASSWORD=<login password>
SUPABASE_URL=<supabase project url>
SUPABASE_SERVICE_ROLE=<service role key>
VERCEL=1 (auto-set on Vercel)
PLAYWRIGHT_FORCE_PUPPETEER=1 (force Puppeteer mode)
```

## Known Issues

### Chromium Dependency Error (Current)
**Error**: `libnss3.so: cannot open shared object file`
**Cause**: @sparticuz/chromium missing system libraries in serverless environment
**Solutions**:
1. Use chromium-min layer or custom Lambda layer with dependencies
2. Switch to chrome-aws-lambda (deprecated but stable)
3. Add system dependencies to deployment config
4. Use Playwright with bundled browser (local only)

### Date Input Handling
Form uses masked text inputs (dd-Mon-yyyy) not native date pickers. Code handles both formats.

### Table Detection
Primary: #printablediv143706 → tables[1]
Fallback: Search for table with "complaint number" header

## Deployment Notes
- **Local**: Uses Playwright with `npx playwright install chromium`
- **Vercel**: Switches to Puppeteer + @sparticuz/chromium via VERCEL env check
- **Postinstall**: Skips Playwright install on Vercel to reduce bundle size

## Database Schema (Supabase)
```sql
Table: reports
- key: text (primary key) = 'frt_supply'
- payload: jsonb (scraped data)
- updated_at: timestamp (auto)
```

## Frontend Features
- Real-time data display
- PDF export with jsPDF
- Refresh button (bypasses cache)
- Loading states
- Error handling

## File Structure
```
app/
├── api/scrape/route.ts    # Scraping API
├── page.tsx               # Dashboard UI
├── layout.tsx             # Root layout
└── globals.css            # Tailwind styles
```

## Quick Commands
```bash
npm run dev          # Local development
npm run build        # Production build
npm start            # Start production server
```

## Troubleshooting Checklist
- [ ] Verify FRT_USERNAME/FRT_PASSWORD in .env.local
- [ ] Check Supabase credentials
- [ ] Ensure Node.js >= 18
- [ ] For Vercel: Add chromium dependencies or use alternative
- [ ] Test with ?refresh=1 to bypass cache
- [ ] Check browser console for client errors
- [ ] Verify target site structure hasn't changed

## Performance
- Cache TTL: Indefinite (manual refresh required)
- Scrape time: ~15-30s
- Max execution: 60s (serverless limit)
