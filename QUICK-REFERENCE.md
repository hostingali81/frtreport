# 🚀 Quick Reference Guide

## 🔄 Daily Operations

### 1. Refresh Data (Manual)
```
Click "Refresh" button in UI
→ Triggers incremental scrape
→ Fetches last 2 days + new data
→ Takes 30-45 seconds
```

### 2. Force Full Scrape
```
URL: /api/scrape?refresh=1&full=1
→ Scrapes all data from 2010
→ Takes 60-90 seconds
→ Use only if data seems incomplete
```

### 3. Check Last Scrape
```
Look at "Data last updated on:" banner
→ Shows last successful scrape time
→ In IST timezone
```

---

## 🔍 Filters Usage

### Quick Filters:
```
Today: Shows today's complaints
Yesterday: Shows yesterday's complaints
Last 24h: Shows last 24 hours
This Month: Shows current month
```

### Shift Filters:
```
Control Room:
- Morning: 07:00 AM - 03:00 PM
- Day: 03:00 PM - 11:00 PM
- Night: 11:00 PM - 07:00 AM

Field:
- Shift A: 08:00 AM - 04:00 PM
- Shift B: 04:00 PM - 12:00 AM
- Shift C: 12:00 AM - 08:00 AM
```

### Custom Date:
```
1. Select date from calendar
2. Click shift button
3. Data filtered automatically
```

---

## 📥 Downloads

### PDF Reports:
```
Summary PDF: Quick overview
Detailed Report: 7-page comprehensive report
Charts PDF: Trend analysis with graphs
Individual Reports: 15+ specialized reports
```

### Excel Export:
```
18 Sheets including:
- Cover Page (navigation)
- All Complaints Data
- Division/Sub Division/Sub Station Summaries
- FRT vs Control Room Analysis
- Status Breakdowns
- Date-wise Analysis
```

---

## 🐛 Troubleshooting

### Data Not Loading:
```
1. Check internet connection
2. Click Refresh button
3. Check browser console for errors
4. Try force full scrape: /api/scrape?refresh=1&full=1
```

### Slow Performance:
```
1. Clear browser cache
2. Close other tabs
3. Check if 15K+ rows (expected slowdown)
4. Consider using filters to reduce data
```

### Export Not Working:
```
1. Check if data is loaded
2. Apply filters if needed
3. Try different browser
4. Check browser console for errors
```

### Scraping Failed:
```
1. Check scrape_metadata table in Supabase
2. Look for error_message
3. Check FRT website availability
4. Verify credentials in .env.local
```

---

## 📊 Performance Expectations

### Current (11K rows):
```
Load: 2-3 seconds ✅
Filter: Instant ✅
Export: 5-8 seconds ✅
```

### Future (15K rows):
```
Load: 3-4 seconds ✅
Filter: Instant ✅
Export: 8-10 seconds ✅
```

### Future (20K rows):
```
Load: 4-5 seconds ⚠️
Filter: Instant ✅
Export: 10-12 seconds ⚠️
Consider virtual scrolling
```

---

## 🔧 Maintenance

### Weekly:
```
✅ Check scrape_metadata for errors
✅ Verify data accuracy
✅ Monitor performance
```

### Monthly:
```
✅ Review database size
✅ Check index performance
✅ Verify backup strategy
```

### Quarterly:
```
✅ Performance audit
✅ Consider optimizations
✅ Plan for scaling
```

---

## 🆘 Emergency Contacts

### Database Issues:
```
Check: Supabase Dashboard
Table: complaints, scrape_metadata
Logs: scrape_metadata.error_message
```

### Scraping Issues:
```
Check: /api/scrape response
Logs: Browser console
Fallback: Force full scrape
```

### Performance Issues:
```
Check: Browser DevTools (Performance tab)
Monitor: Memory usage
Action: Clear filters, reduce data
```

---

## 📞 Support

### Documentation:
```
SYSTEM-VERIFICATION.md - Complete system check
PERFORMANCE-OPTIMIZATIONS.md - Performance details
COMPLETE-CHECK-HINDI.md - Hindi summary
```

### Quick Commands:
```
npm run dev - Start development server
npm run build - Build for production
npm start - Start production server
```

---

## ✅ All Systems Operational!
