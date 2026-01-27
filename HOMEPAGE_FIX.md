# Homepage Performance Fix

## Problem
Homepage slow hai kyunki fetchAll=true use kar raha hai jo 50k records fetch karta hai.

## Solution
Homepage pe sirf 5000 records load karo for fast performance.

## Implementation

In `app/page.tsx`, line ~150-200 (fetchData function):

Replace:
```typescript
const fullEndpoint = '/api/complaints?fetchAll=true';
```

With:
```typescript
const fullEndpoint = '/api/complaints?limit=5000';
```

And remove the two-step loading (partial + full). Just do single load:

```typescript
const fetchData = async (refresh = false) => {
    setLoading(true);
    setError('');
    
    try {
        if (refresh) {
            const scrapeResponse = await fetch('/api/scrape?refresh=1');
            const scrapeResult = await scrapeResponse.json();
            if (!scrapeResult.success) {
                setError(scrapeResult.error || 'Scraping failed');
                setLoading(false);
                return;
            }
        }

        // Single fast load - 5000 records
        const response = await fetch('/api/complaints?limit=5000');
        const result = await response.json();

        if (result.success) {
            setOriginal(result.data || []);
            setData(result.data || []);
            if (result.lastScrapedAt) {
                setLastUpdated(result.lastScrapedAt);
            }
        } else {
            setError(result.error || 'Error');
        }
    } catch (err: any) {
        setError('Error: ' + err.message);
    } finally {
        setLoading(false);
    }
};
```

## Expected Result
- Homepage load: 2-3s (instead of 10-15s)
- 5000 records enough for homepage
- Deep analysis page still has full data
