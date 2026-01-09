# 🚀 Optimization Plan - FRT Barabanki Report

## Current Issues
- 11,000+ rows in single JSON blob (slow, size limit risk)
- Full scrape every refresh (45-60 seconds)
- No incremental updates for daily 300 new rows
- Frontend filtering (slow with large data)

---

## Solution Architecture

### 1. Database Schema (Supabase)

```sql
-- Main complaints table
CREATE TABLE complaints (
  id BIGSERIAL PRIMARY KEY,
  complaint_number TEXT UNIQUE NOT NULL,
  complaint_date TIMESTAMPTZ NOT NULL,
  division TEXT,
  sub_division TEXT,
  sub_station TEXT,
  status TEXT,
  closed_status TEXT,
  closed_by TEXT,
  closed_date TIMESTAMPTZ,
  closing_remarks TEXT,
  area_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_complaint_date ON complaints(complaint_date DESC);
CREATE INDEX idx_division ON complaints(division);
CREATE INDEX idx_sub_division ON complaints(sub_division);
CREATE INDEX idx_status ON complaints(status);
CREATE INDEX idx_closed_status ON complaints(closed_status);
CREATE INDEX idx_complaint_number ON complaints(complaint_number);

-- Metadata table for tracking scrapes
CREATE TABLE scrape_metadata (
  id SERIAL PRIMARY KEY,
  last_scrape_at TIMESTAMPTZ NOT NULL,
  total_rows INTEGER,
  new_rows INTEGER,
  duration_seconds INTEGER,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Incremental Scraping Logic

**Key Changes:**
- Track last successful scrape date
- Scrape only data from last scrape date to now
- Upsert (insert or update) based on complaint_number
- Fallback to full scrape if delta fails

**Flow:**
```
1. Get last_scrape_date from scrape_metadata
2. If last_scrape_date exists:
   → Scrape from last_scrape_date to now (delta)
3. Else:
   → Full scrape from 2010-01-01 to now
4. Upsert rows into complaints table
5. Update scrape_metadata
```

### 3. API Optimization

**Endpoints:**
- `GET /api/complaints` - Paginated data (1000 rows/page)
- `GET /api/complaints/stats` - Pre-computed aggregations
- `POST /api/scrape` - Trigger incremental scrape
- `GET /api/scrape/status` - Check scrape progress

**Query Optimization:**
```sql
-- Frontend filters run on DB, not client
SELECT * FROM complaints
WHERE complaint_date >= $1 
  AND complaint_date <= $2
  AND division = $3
  AND status = $4
ORDER BY complaint_date DESC
LIMIT 1000 OFFSET 0;
```

### 4. Frontend Changes

**Virtual Scrolling:**
- Use `react-window` for table rendering
- Load 50-100 rows at a time
- Infinite scroll for pagination

**State Management:**
- Fetch data in chunks (1000 rows)
- Cache in React Query/SWR
- Debounce filters (300ms)

---

## Performance Gains

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial Load | 45-60s | 2-3s | **20x faster** |
| Refresh (300 new) | 45-60s | 5-8s | **8x faster** |
| Filter/Sort | 2-3s | 0.1-0.2s | **15x faster** |
| Table Render | Laggy | Smooth | **10x better** |
| Data Size | 1MB JSON | Indexed DB | **Scalable** |

---

## Implementation Steps

### Step 1: Database Migration (1-2 hours)
1. Create new schema in Supabase
2. Write migration script to move existing data
3. Test queries with indexes

### Step 2: Backend API (3-4 hours)
1. Update scrape route for incremental logic
2. Add pagination endpoint
3. Add stats/aggregation endpoint
4. Add error handling & retries

### Step 3: Frontend Updates (4-5 hours)
1. Implement pagination
2. Add virtual scrolling
3. Move filters to API calls
4. Add loading states

### Step 4: Testing & Deployment (2-3 hours)
1. Test with production data
2. Monitor performance
3. Deploy incrementally

**Total Time: 10-14 hours**

---

## Quick Wins (Can Do Now - 1-2 hours)

### 1. Add Debouncing to Search
```typescript
const debouncedSearch = useMemo(
  () => debounce((value: string) => setSearch(value), 300),
  []
);
```

### 2. Limit Initial Render
```typescript
const [visibleRows, setVisibleRows] = useState(100);
// Show only first 100, load more on scroll
```

### 3. Optimize useMemo Dependencies
```typescript
// Only recompute when needed
const filtered = useMemo(() => {
  // ... filtering logic
}, [original, search, statusFilter, divisionFilter]); // Remove unnecessary deps
```

### 4. Add Loading Skeleton
```typescript
// Show skeleton while data loads
{loading && <TableSkeleton rows={10} />}
```

---

## Monitoring & Maintenance

1. **Track Scrape Performance:**
   - Log scrape duration
   - Alert if > 30 seconds
   - Monitor failure rate

2. **Database Health:**
   - Check index usage
   - Monitor query performance
   - Set up auto-vacuum

3. **User Experience:**
   - Track page load time
   - Monitor filter response time
   - Collect user feedback

---

## Future Enhancements

1. **Real-time Updates:** WebSocket for live data
2. **Background Jobs:** Cron job for auto-scrape every hour
3. **Data Export:** Pre-generate PDFs/Excel in background
4. **Analytics Dashboard:** Pre-computed charts
5. **Mobile App:** React Native with same backend
