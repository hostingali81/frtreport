'use client';

import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FiDownload, FiRefreshCw, FiFilter, FiSearch, FiFileText, FiClock, FiDatabase } from 'react-icons/fi';

export default function Home() {
  const [original, setOriginal] = useState<any[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [fromDT, setFromDT] = useState(''); // yyyy-mm-ddTHH:mm (datetime-local)
  const [toDT, setToDT] = useState('');   // yyyy-mm-ddTHH:mm (datetime-local)
  const [statusFilter, setStatusFilter] = useState(''); // empty = all

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of original) {
      const s = String((r as any)['Status'] ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [original]);

  const fetchData = async (refresh = false) => {
    setLoading(true);
    setError('');
    if (refresh) {
      setOriginal([]);
      setData([]);
    }
    
    try {
      const response = await fetch(`/api/scrape${refresh ? '?refresh=1' : ''}`);
      const result = await response.json();
      
      console.log('API Response:', result);
      
      if (result.success) {
        if (result.data && result.data.length > 0) {
          setOriginal(result.data);
          setData(result.data);
        } else {
          setError('कोई डेटा नहीं मिला। Debug info: ' + JSON.stringify(result.debug));
        }
      } else {
        setError(result.error || 'डेटा प्राप्त करने में त्रुटि');
      }
    } catch (err: any) {
      setError('डेटा प्राप्त करने में त्रुटि: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const normalizedIncludes = (value: string, query: string) =>
    value.toLowerCase().includes(query.toLowerCase());

  const parsePossibleDate = (value: string) => {
    // Handles formats like: 01/11/2025 03:45 PM
    // Returns Date or null
    const d = new Date(value.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$2/$1/$3'));
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDuration = (ms: number) => {
    if (!isFinite(ms) || ms <= 0) return '';
    const minutes = Math.floor(ms / 60000);
    const days = Math.floor(minutes / (60 * 24));
    const hours = Math.floor((minutes % (60 * 24)) / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (mins) parts.push(`${mins}m`);
    return parts.join(' ');
  };

  const computeResolutionTime = (row: any) => {
    const openStr = String(row['Complaint Date and Time'] || row['Complaint Date'] || '');
    const closeStr = String(row['Closed Date'] || '');
    const open = parsePossibleDate(openStr);
    const close = parsePossibleDate(closeStr);
    if (!open || !close) return '';
    return formatDuration(close.getTime() - open.getTime());
  };

  const filtered = useMemo(() => {
    let rows = original;
    if (search.trim()) {
      rows = rows.filter(row =>
        Object.values(row).some(v => normalizedIncludes(String(v || ''), search.trim()))
      );
    }
    if (fromDT || toDT) {
      const fromDate = fromDT ? new Date(fromDT) : null;
      const toDate = toDT ? new Date(toDT) : null;
      rows = rows.filter(row => {
        const val = String(row['Complaint Date and Time'] || row['Complaint Date'] || '');
        const dt = parsePossibleDate(val);
        if (!dt) return false;
        if (fromDate && dt < fromDate) return false;
        if (toDate && dt > toDate) return false;
        return true;
      });
    }
    if (statusFilter) {
      rows = rows.filter(row => String(row['Status'] ?? '').trim() === statusFilter);
    }
    return rows;
  }, [original, search, fromDT, toDT, statusFilter]);

  const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };

  const applyPreset = (type: 'from2010ToNow' | 'today' | 'last24h' | 'thisMonth' | 'clear' | 'toNow') => {
    const now = new Date();
    if (type === 'from2010ToNow') {
      setFromDT('2010-01-01T00:00');
      setToDT(formatDateTimeLocal(now));
    } else if (type === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(now));
    } else if (type === 'last24h') {
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(now));
    } else if (type === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(now));
    } else if (type === 'toNow') {
      setToDT(formatDateTimeLocal(now));
    } else if (type === 'clear') {
      setFromDT('');
      setToDT('');
    }
  };

  // Auto-fill From/To with oldest and latest dates from loaded data
  useEffect(() => {
    if (!original.length) return;
    // only auto-set if user hasn't chosen anything yet
    if (fromDT || toDT) return;
    const dateList = original
      .map(r => parsePossibleDate(String((r as any)['Complaint Date and Time'] || (r as any)['Complaint Date'] || '')))
      .filter((d): d is Date => !!d);
    if (dateList.length === 0) return;
    const min = new Date(Math.min.apply(null, dateList.map(d => d.getTime())));
    const max = new Date(Math.max.apply(null, dateList.map(d => d.getTime())));
    setFromDT(formatDateTimeLocal(min));
    setToDT(formatDateTimeLocal(max));
  }, [original]);

  const exportBulkPDF = () => {
    if (filtered.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const baseHeaders = Object.keys(filtered[0]);
    const headers = (() => {
      const arr = [...baseHeaders];
      const idx = arr.indexOf('Closed Date');
      if (idx >= 0) arr.splice(idx + 1, 0, 'Resolution Time'); else arr.push('Resolution Time');
      return arr;
    })();
    const body = filtered.map(row => headers.map(h => {
      if (h === 'Resolution Time') return computeResolutionTime(row);
      return String((row as any)[h] ?? '');
    }));

    // Title/Header
    doc.setFontSize(16);
    doc.text('Supply Complaint Report (Bulk)', 40, 36);
    doc.setFontSize(10);
    const nowStr = new Date().toLocaleString();
    doc.text(`Generated: ${nowStr}`, 40, 54);

    autoTable(doc, {
      head: [headers],
      body,
      startY: 70,
      theme: 'grid',
      styles: {
        fontSize: 10,
        cellPadding: 6,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: [52, 152, 219],
        fontSize: 12,
      },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      bodyStyles: { textColor: [20, 20, 20] },
      columnStyles: {
        0: { cellWidth: 110 }, // Complaint Number
        1: { cellWidth: 150 }, // Complaint Date and Time
      } as any,
      margin: { top: 50, left: 40, right: 40, bottom: 40 },
      rowPageBreak: 'auto',
      tableWidth: 'auto',
    });
    doc.save('report-bulk.pdf');
  };

  const groupCounts = (rows: any[], field: string) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r[field] ?? '').trim() || 'Unknown';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  };

  const isClosedRow = (row: any) => {
    const statusRaw = String(row['Status'] ?? '').trim();
    const statusLower = statusRaw.toLowerCase();
    const closedDate = String(row['Closed Date'] ?? '').trim();

    // Explicit known labels
    if (statusLower === 'complaint closed') return true;
    if (statusLower === 'pending') return false;

    // Heuristics/fallbacks
    if (closedDate.length > 0) return true;
    if (statusLower.includes('closed') || statusLower.includes('resolve')) return true;
    if (statusLower.includes('attend') && statusLower.includes('confirm')) return true;
    return false;
  };

  const divisionTotals = (rows: any[]) => {
    const map = new Map<string, { total: number; closed: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const entry = map.get(division) || { total: 0, closed: 0, pending: 0 };
      entry.total += 1;
      if (isClosedRow(r)) entry.closed += 1;
      map.set(division, entry);
    }
    // compute pending as total - closed
    for (const [k, v] of map) {
      v.pending = Math.max(0, v.total - v.closed);
      map.set(k, v);
    }
    const rowsOut = Array.from(map.entries())
      .map(([k, v]) => ({ division: k, ...v }))
      .sort((a, b) => b.total - a.total);
    const grand = rows.reduce((acc, r) => {
      acc.total += 1;
      if (isClosedRow(r)) acc.closed += 1;
      return acc;
    }, { total: 0, closed: 0 });
    const grandPending = Math.max(0, grand.total - grand.closed);
    return { rows: rowsOut, grand: { total: grand.total, closed: grand.closed, pending: grandPending } };
  };

  const exportSummaryPDF = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    // Title and meta
    doc.setFontSize(22);
    doc.text('Supply Complaint Summary', 40, 36);
    doc.setFontSize(13);
    const nowStr = new Date().toLocaleString();
    const periodParts: string[] = [];
    if (fromDT) periodParts.push(`From: ${fromDT.replace('T', ' ')}`);
    if (toDT) periodParts.push(`To: ${toDT.replace('T', ' ')}`);
    doc.text(`Generated: ${nowStr}`, 40, 54);
    doc.text(`Total Complaints: ${rows.length}`, 40, 72);
    if (periodParts.length) doc.text(periodParts.join('   '), 40, 90);

    // Division summary with Total/Closed/Pending + Grand Total row
    const { rows: divRows, grand } = divisionTotals(rows);
    const tableBody = divRows.map(r => [r.division, String(r.total), String(r.closed), String(r.pending)]);
    tableBody.push([ 'Grand Total', String(grand.total), String(grand.closed), String(grand.pending) ]);
    autoTable(doc, {
      startY: 110,
      head: [[ 'Division', 'Total Complaints', 'Closed', 'Pending' ]],
      body: tableBody,
      theme: 'grid',
      styles: { fontSize: 14, cellPadding: 7 },
      headStyles: { fillColor: [39, 174, 96], fontSize: 15 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
      columnStyles: { 0: { cellWidth: 360 } } as any,
      didParseCell: (data: any) => {
        // Make Grand Total row bold
        if (data.section === 'body' && data.row.index === tableBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    doc.save('report-summary.pdf');
  };

  const exportDateWisePDF = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    // Title and meta
    doc.setFontSize(18);
    doc.text('Date-wise Complaint Count', 40, 36);
    doc.setFontSize(11);
    const nowStr = new Date().toLocaleString();
    const periodParts: string[] = [];
    if (fromDT) periodParts.push(`From: ${fromDT.replace('T', ' ')}`);
    if (toDT) periodParts.push(`To: ${toDT.replace('T', ' ')}`);
    doc.text(`Generated: ${nowStr}`, 40, 54);
    if (periodParts.length) doc.text(periodParts.join('   '), 40, 72);

    // Group by date (DD/MM/YYYY from 'Complaint Date and Time')
    const map = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      map.set(key, (map.get(key) || 0) + 1);
    }
    const byDate = Array.from(map.entries()).sort((a, b) => {
      // sort by parsed date
      const pa = a[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });

    const body = byDate.map(([date, count]) => [date, String(count)]);
    const total = byDate.reduce((acc, [, c]) => acc + (c as number), 0);
    body.push(['Grand Total', String(total)]);

    autoTable(doc, {
      startY: 100,
      head: [[ 'Date', 'Total Complaints' ]],
      body,
      theme: 'grid',
      styles: { fontSize: 12, cellPadding: 6 },
      headStyles: { fillColor: [52, 152, 219], fontSize: 13 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    doc.save('report-datewise.pdf');
  };

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-600 text-white"><FiDatabase size={22} /></div>
            <div>
              <h1 className="text-xl md:text-3xl font-bold">FRT बाराबंकी - सप्लाई कंप्लेंट रिपोर्ट</h1>
              <p className="text-gray-500 text-sm md:text-base">Analyze, filter and export complaints with ease</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(false)}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition"
            >
              {loading ? (<><FiClock /> लोड हो रहा है…</>) : (<><FiDownload /> डेटा (Cache)</>)}
            </button>
            <button
              onClick={() => fetchData(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition"
            >
              <FiRefreshCw /> Refresh
            </button>
          </div>
        </header>

        {original.length > 0 && (
          <div className="bg-white rounded-xl shadow-md p-4 md:p-5 mb-6 border border-gray-100">
            <div className="flex items-center gap-2 mb-3 text-gray-700"><FiFilter /> <span className="font-semibold">Filters</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="flex flex-col lg:col-span-2 min-w-0">
                <label className="text-xs text-gray-500 mb-1">Search</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search keywords"
                  className="border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none w-full"
                />
              </div>
              <div className="flex flex-col lg:col-span-1 min-w-0">
                <label className="text-xs text-gray-500 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">All</option>
                  {statusOptions.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col lg:col-span-1 min-w-0">
                <label className="text-xs text-gray-500 mb-1">From (Date & Time)</label>
                <input
                  type="datetime-local"
                  value={fromDT}
                  onChange={(e) => setFromDT(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-col lg:col-span-1 min-w-0">
                <label className="text-xs text-gray-500 mb-1">To (Date & Time)</label>
                <input
                  type="datetime-local"
                  value={toDT}
                  onChange={(e) => setToDT(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              {/* Export buttons moved to separate action row below */}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs text-gray-600 mr-1 inline-flex items-center gap-1"><FiSearch /> Presets:</span>
              <button onClick={() => applyPreset('from2010ToNow')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">2010 → Now</button>
              <button onClick={() => applyPreset('today')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Today</button>
              <button onClick={() => applyPreset('last24h')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Last 24h</button>
              <button onClick={() => applyPreset('thisMonth')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">This Month</button>
              <button onClick={() => applyPreset('toNow')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Set To = Now</button>
              <button onClick={() => applyPreset('clear')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Clear</button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
              <button
                onClick={exportBulkPDF}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg"
              >
                <FiFileText /> Bulk PDF
              </button>
              <button
                onClick={exportSummaryPDF}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg"
              >
                <FiFileText /> Summary PDF
              </button>
              <button
                onClick={exportDateWisePDF}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg"
              >
                <FiFileText /> Date-wise PDF
              </button>
            </div>
            <div className="text-sm text-gray-500 mt-2">Showing {filtered.length} of {original.length} rows</div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="bg-white rounded-xl shadow-md overflow-x-auto border border-gray-100">
            <table className="min-w-full divide-y divide-gray-200 text-xs md:text-sm">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  {(() => {
                    const base = Object.keys(filtered[0]);
                    const idx = base.indexOf('Closed Date');
                    if (idx >= 0) base.splice(idx + 1, 0, 'Resolution Time'); else base.push('Resolution Time');
                    return base;
                  })().map((header) => (
                    <th key={header} className="px-4 md:px-6 py-3 text-left font-medium text-gray-700 uppercase tracking-wider">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filtered.map((row, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    {(() => {
                      const baseHeaders = Object.keys(row);
                      const idx = baseHeaders.indexOf('Closed Date');
                      const headers = idx >= 0 ? [
                        ...baseHeaders.slice(0, idx + 1),
                        'Resolution Time',
                        ...baseHeaders.slice(idx + 1)
                      ] : [...baseHeaders, 'Resolution Time'];
                      return headers.map((h, i) => {
                        let display: any = (row as any)[h];
                        if (h === 'Resolution Time') display = computeResolutionTime(row);
                        const isRemarks = h === 'Closing Remarks';
                        return (
                          <td key={i} className="px-4 md:px-6 py-3 whitespace-nowrap text-gray-900 max-w-[14rem] md:max-w-xs">
                            {isRemarks ? (
                              <span title={String(display || '')} className="block truncate">{String(display || '')}</span>
                            ) : (
                              String(display ?? '')
                            )}
                          </td>
                        );
                      });
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
