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
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedShift, setSelectedShift] = useState<string>(''); // e.g. "Today - Morning (07:00–15:00)"

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
          setLastUpdated(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
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
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        let aVal: any, bVal: any;
        
        if (sortColumn === 'Resolution Time') {
          const aTime = computeResolutionTime(a);
          const bTime = computeResolutionTime(b);
          const aMs = aTime ? (parseInt(aTime) || 0) * (aTime.includes('d') ? 1440 : aTime.includes('h') ? 60 : 1) : 0;
          const bMs = bTime ? (parseInt(bTime) || 0) * (bTime.includes('d') ? 1440 : bTime.includes('h') ? 60 : 1) : 0;
          return sortDirection === 'asc' ? aMs - bMs : bMs - aMs;
        }
        
        aVal = String(a[sortColumn] ?? '');
        bVal = String(b[sortColumn] ?? '');
        
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }
        
        const aDate = parsePossibleDate(aVal);
        const bDate = parsePossibleDate(bVal);
        if (aDate && bDate) {
          return sortDirection === 'asc' ? aDate.getTime() - bDate.getTime() : bDate.getTime() - aDate.getTime();
        }
        
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
    }
    return rows;
  }, [original, search, fromDT, toDT, statusFilter, sortColumn, sortDirection]);

  const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };

  const applyShiftPreset = (shift: 'today_morning' | 'today_day' | 'today_night' | 'yesterday_morning' | 'yesterday_day' | 'yesterday_night') => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const labelMap: Record<string, string> = {
      today_morning: 'Today - Morning (07:00–15:00)',
      today_day: 'Today - Day (15:00–23:00)',
      today_night: 'Today - Night (23:00–07:00)',
      yesterday_morning: 'Yesterday - Morning (07:00–15:00)',
      yesterday_day: 'Yesterday - Day (15:00–23:00)',
      yesterday_night: 'Yesterday - Night (23:00–07:00)',
    };
    const setRange = (start: Date, end: Date) => {
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(end));
    };
    switch (shift) {
      case 'today_morning': {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0, 0);
        setRange(start, end);
        break;
      }
      case 'today_day': {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 0, 0);
        setRange(start, end);
        break;
      }
      case 'today_night': {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 0, 0);
        const end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        end.setHours(7, 0, 0, 0);
        setRange(start, end);
        break;
      }
      case 'yesterday_morning': {
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 7, 0, 0);
        const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 15, 0, 0);
        setRange(start, end);
        break;
      }
      case 'yesterday_day': {
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 15, 0, 0);
        const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 0, 0);
        setRange(start, end);
        break;
      }
      case 'yesterday_night': {
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 0, 0);
        setRange(start, end);
        break;
      }
    }
    setSelectedShift(labelMap[shift]);
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
      setSelectedShift('');
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

  useEffect(() => {
    fetchData(false);
  }, []);

  const SkeletonBlock = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
  );

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
    if (selectedShift) {
      doc.text(`Shift: ${selectedShift}`, 40, 68);
    }

    autoTable(doc, {
      head: [headers],
      body,
      startY: selectedShift ? 84 : 70,
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
    if (selectedShift) {
      doc.text(`Shift: ${selectedShift}`, 40, 90);
    }
    if (periodParts.length) {
      const periodText = periodParts.join('   ');
      // Draw a subtle highlighted ribbon behind the period range
      const x = 40;
      const y = selectedShift ? 122 : 104; // place below previous lines to avoid overlap
      doc.setFontSize(12);
      const textWidth = (doc.getTextWidth(periodText) || 0);
      const padX = 8; const padY = 6;
      // Professional subtle blue-gray background
      doc.setFillColor(235, 242, 250); // #EBF2FA
      doc.setDrawColor(209, 223, 235); // light border
      doc.roundedRect(x - padX, y - 14 - padY / 2, textWidth + padX * 2, 22 + padY, 3, 3, 'FD');
      doc.setTextColor(34, 62, 99); // dark slate text
      doc.text(periodText, x, y);
      doc.setTextColor(0, 0, 0); // reset for next content
    }

    // Division summary with Total/Closed/Pending + Grand Total row
    const { rows: divRows, grand } = divisionTotals(rows);
    const tableBody = divRows.map(r => [r.division, String(r.total), String(r.closed), String(r.pending)]);
    tableBody.push([ 'Grand Total', String(grand.total), String(grand.closed), String(grand.pending) ]);
    autoTable(doc, {
      startY: 130,
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
    if (selectedShift) doc.text(`Shift: ${selectedShift}`, 40, 70);
    if (periodParts.length) doc.text(periodParts.join('   '), 40, selectedShift ? 86 : 72);

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
      startY: selectedShift ? 114 : 100,
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

  const exportExcel = async () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const [excelModule, { saveAs }] = await Promise.all([
      import('exceljs/dist/exceljs.min.js'),
      import('file-saver'),
    ]);
    const ExcelJS: any = (excelModule as any).default || excelModule;
    const wb = new ExcelJS.Workbook();
    // Basic document properties
    wb.creator = 'FRT Report Dashboard';
    wb.created = new Date();
    wb.modified = new Date();
    wb.properties = {
      title: 'Supply Complaint Report',
      subject: 'Complaint data export with summaries',
      keywords: ['FRT', 'Barabanki', 'Supply', 'Complaints', 'Report', 'Excel'],
      category: 'Report',
      description: 'Filtered export with division and date-wise summaries',
      lastModifiedBy: 'FRT Report Dashboard',
    } as any;

    // Theme and helpers (declare before first use)
    const theme = {
      headerFill: 'FF2563EB',       // Tailwind blue-600
      headerFont: 'FFFFFFFF',
      altFill: 'FFF8FAFC',          // slate-50
      border: { style: 'thin', color: { argb: 'FFCBD5E1' } }, // slate-300
      titleColor: 'FF111827',       // gray-900
      metaColor: 'FF374151',        // gray-700
      success: 'FF059669',          // emerald-600
      info: 'FF2563EB',             // blue-600
      warning: 'FFF59E0B',          // amber-500
    } as const;

    const addTitle = (ws: any, title: string, subtitle?: string) => {
      ws.mergeCells('A1', 'H1');
      const t = ws.getCell('A1');
      t.value = title;
      t.font = { size: 18, bold: true, color: { argb: theme.titleColor } };
      t.alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getRow(1).height = 26;
      ws.mergeCells('A2', 'H2');
      const s = ws.getCell('A2');
      s.value = subtitle || '';
      s.font = { size: 11, color: { argb: theme.metaColor } };
      s.alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getRow(2).height = 20;
    };

    const styleHeaderRow = (ws: any, rowNumber: number) => {
      const row = ws.getRow(rowNumber);
      row.eachCell((cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.headerFill } };
        cell.font = { bold: true, color: { argb: theme.headerFont } };
        cell.border = {
          top: theme.border,
          left: theme.border,
          bottom: theme.border,
          right: theme.border,
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
    };

    const setAlternatingRows = (ws: any, startRow: number, endRow: number) => {
      for (let r = startRow; r <= endRow; r++) {
        if ((r - startRow) % 2 === 1) {
          ws.getRow(r).eachCell((cell: any) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.altFill } };
          });
        }
      }
    };

    // Cover / Summary sheet
    const wsCover = wb.addWorksheet('Cover', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
    const periodText = fromDT || toDT ? `Period: ${fromDT ? fromDT.replace('T',' ') : ''} ${toDT ? '→ ' + toDT.replace('T',' ') : ''}` : 'Period: All';
    const statusApplied = statusFilter ? statusFilter : 'All';
    const uniqueDivisions = Array.from(new Set(rows.map(r => String((r as any)['Division'] || '').trim()).filter(Boolean))).sort();
    const uniqueStatuses = Array.from(new Set(rows.map(r => String((r as any)['Status'] || '').trim()).filter(Boolean))).sort();
    const shiftSuffix = selectedShift ? ` | Shift: ${selectedShift}` : '';
    addTitle(wsCover, 'FRT Barabanki - Supply Complaint Report', `Generated: ${new Date().toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})${shiftSuffix}`);
    wsCover.addRow([]);
    wsCover.addRow(['Overview']);
    wsCover.getRow(4).font = { bold: true, size: 12 };
    wsCover.addRow(['Total Complaints (filtered)', rows.length]);
    wsCover.addRow([periodText]);
    wsCover.addRow([`Filters: Search="${search || '—'}", Status="${statusApplied}"`]);
    wsCover.addRow([]);
    wsCover.addRow(['Distinct Divisions', uniqueDivisions.length]);
    wsCover.addRow([uniqueDivisions.join(', ') || '—']);
    wsCover.addRow([]);
    wsCover.addRow(['Distinct Statuses', uniqueStatuses.length]);
    wsCover.addRow([uniqueStatuses.join(', ') || '—']);
    wsCover.getColumn(1).width = 42;
    wsCover.getColumn(2).width = 80;


    // Sheet 1: Bulk Data
    const wsData = wb.addWorksheet('Bulk Data', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsData, 'Supply Complaint Report (Bulk)', `Generated: ${new Date().toLocaleString()}${fromDT || toDT ? `   Period: ${fromDT ? fromDT.replace('T',' ') : ''} ${toDT ? '→ ' + toDT.replace('T',' ') : ''}` : ''}`);

    const baseHeaders = Object.keys(rows[0]);
    const headers = (() => {
      const arr = [...baseHeaders];
      const idx = arr.indexOf('Closed Date');
      if (idx >= 0) arr.splice(idx + 1, 0, 'Resolution Time'); else arr.push('Resolution Time');
      return arr;
    })();

    const headerRowIndex = 3;
    wsData.addRow(headers);
    styleHeaderRow(wsData, headerRowIndex);

    const bodyStart = headerRowIndex + 1;
    const statusColIndex = headers.indexOf('Status') + 1; // 1-based
    for (const r of rows) {
      const rowVals = headers.map(h => {
        if (h === 'Resolution Time') return computeResolutionTime(r);
        return String((r as any)[h] ?? '');
      });
      const excelRow = wsData.addRow(rowVals);
      // Color-code Status cell
      if (statusColIndex > 0) {
        const statusCell = excelRow.getCell(statusColIndex);
        const statusStr = String((r as any)['Status'] ?? '').trim().toLowerCase();
        const isClosed = isClosedRow(r);
        let fillColor = '';
        if (isClosed) fillColor = theme.success;            // green for closed
        else if (statusStr.includes('pending')) fillColor = 'FFDC2626'; // red-600 for pending
        else fillColor = 'FFF59E0B';                         // amber-500 otherwise
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        statusCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      }
    }

    // Column widths and formatting
    const widthMap: Record<string, number> = {
      'Complaint Number': 20,
      'Complaint Date and Time': 24,
      'Division': 18,
      'Sub Division': 18,
      'Sub Station': 18,
      'Status': 18,
      'Closed By': 18,
      'Closed Date': 18,
      'Closing Remarks': 40,
      'Resolution Time': 14,
    };
    headers.forEach((h, i) => {
      wsData.getColumn(i + 1).width = widthMap[h] || 18;
      // wrap remarks
      if (h === 'Closing Remarks') {
        wsData.getColumn(i + 1).alignment = { wrapText: true, vertical: 'top' };
      }
    });
    // borders + alt rows
    const bodyEnd = wsData.lastRow.number;
    for (let r = headerRowIndex; r <= bodyEnd; r++) {
      wsData.getRow(r).eachCell((cell: any) => {
        cell.border = {
          top: theme.border,
          left: theme.border,
          bottom: theme.border,
          right: theme.border,
        };
        if (r === headerRowIndex) return;
        cell.alignment = cell.alignment || { vertical: 'middle' };
      });
    }
    setAlternatingRows(wsData, bodyStart, bodyEnd);
    wsData.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: headers.length },
    };

    // Sheet 2: Summary by Division
    const wsSummary = wb.addWorksheet('Summary by Division', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsSummary, 'Supply Complaint Summary', `Total Complaints: ${rows.length}`);
    const { rows: divRows, grand } = divisionTotals(rows);
    const sumHeaders = ['Division', 'Total', 'Closed', 'Pending'];
    wsSummary.addRow(sumHeaders);
    styleHeaderRow(wsSummary, 3);
    divRows.forEach(r => wsSummary.addRow([r.division, r.total, r.closed, r.pending]));
    wsSummary.addRow(['Grand Total', grand.total, grand.closed, grand.pending]);
    // Style columns, widths
    wsSummary.getColumn(1).width = 36;
    wsSummary.getColumn(2).width = 16;
    wsSummary.getColumn(3).width = 16;
    wsSummary.getColumn(4).width = 16;
    // Borders and alternating fill
    const sumEnd = wsSummary.lastRow.number;
    for (let r = 3; r <= sumEnd; r++) {
      wsSummary.getRow(r).eachCell((cell: any) => {
        cell.border = {
          top: theme.border,
          left: theme.border,
          bottom: theme.border,
          right: theme.border,
        };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsSummary, 4, sumEnd);
    // Make Grand Total bold and colored
    const gtRow = wsSummary.getRow(sumEnd);
    gtRow.eachCell((cell: any, idx: number) => {
      cell.font = { bold: true, color: { argb: idx === 4 ? theme.warning : theme.titleColor } };
    });

    // Sheet 3: Date-wise Counts
    const wsDate = wb.addWorksheet('Date-wise', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsDate, 'Date-wise Complaint Count', fromDT || toDT ? `Period: ${fromDT ? fromDT.replace('T',' ') : ''} ${toDT ? '→ ' + toDT.replace('T',' ') : ''}` : '');
    wsDate.addRow(['Date', 'Total Complaints']);
    styleHeaderRow(wsDate, 3);
    const dateMap = new Map<string, number>();
    for (const r of rows) {
      const s = String((r as any)['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      dateMap.set(key, (dateMap.get(key) || 0) + 1);
    }
    const byDate = Array.from(dateMap.entries()).sort((a, b) => {
      const pa = a[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });
    byDate.forEach(([d, c]) => wsDate.addRow([d, c]));
    const dateTotal = byDate.reduce((acc, [, c]) => acc + (c as number), 0);
    wsDate.addRow(['Grand Total', dateTotal]);
    wsDate.getColumn(1).width = 20;
    wsDate.getColumn(2).width = 22;
    const dateEnd = wsDate.lastRow.number;
    for (let r = 3; r <= dateEnd; r++) {
      wsDate.getRow(r).eachCell((cell: any) => {
        cell.border = {
          top: theme.border,
          left: theme.border,
          bottom: theme.border,
          right: theme.border,
        };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsDate, 4, dateEnd);
    const dateGt = wsDate.getRow(dateEnd);
    dateGt.eachCell((cell: any, idx: number) => {
      cell.font = { bold: true, color: { argb: idx === 2 ? theme.info : theme.titleColor } };
    });
    wsDate.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 2 } };

    // Sheet 4: Status Breakdown
    const wsStatus = wb.addWorksheet('Status Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsStatus, 'Status Breakdown', `Total Complaints: ${rows.length}`);
    const statusMap = new Map<string, number>();
    for (const r of rows) {
      const s = String((r as any)['Status'] || '').trim() || 'Unknown';
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    const statusArr = Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1]);
    wsStatus.addRow(['Status', 'Count', 'Share %']);
    styleHeaderRow(wsStatus, 3);
    statusArr.forEach(([name, count]) => {
      const share = rows.length ? Math.round((count / rows.length) * 1000) / 10 : 0;
      wsStatus.addRow([name, count, share]);
    });
    wsStatus.addRow(['Grand Total', rows.length, 100]);
    wsStatus.getColumn(1).width = 40;
    wsStatus.getColumn(2).width = 16;
    wsStatus.getColumn(3).width = 12;
    const stEnd = wsStatus.lastRow.number;
    for (let r = 3; r <= stEnd; r++) {
      wsStatus.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
        if (cell.col === 3 && r > 3) {
          cell.numFmt = '0.0%';
          // share was in percent already (0-100); convert to fraction for display
          const v = typeof cell.value === 'number' ? cell.value / 100 : cell.value;
          cell.value = v;
        }
      });
    }
    setAlternatingRows(wsStatus, 4, stEnd);
    const stGt = wsStatus.getRow(stEnd);
    stGt.eachCell((cell: any, idx: number) => {
      cell.font = { bold: true, color: { argb: idx === 2 ? theme.info : theme.titleColor } };
    });

    // Sheet 5: Top Sub Stations
    const wsTopSS = wb.addWorksheet('Top Sub Stations', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsTopSS, 'Top Sub Stations by Complaints', `Top 20 (of ${rows.length} complaints)`);
    const ssMap = new Map<string, number>();
    for (const r of rows) {
      const s = String((r as any)['Sub Station'] || '').trim() || 'Unknown';
      ssMap.set(s, (ssMap.get(s) || 0) + 1);
    }
    const topSS = Array.from(ssMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    wsTopSS.addRow(['Sub Station', 'Complaints']);
    styleHeaderRow(wsTopSS, 3);
    topSS.forEach(([name, count]) => wsTopSS.addRow([name, count]));
    wsTopSS.getColumn(1).width = 40;
    wsTopSS.getColumn(2).width = 16;
    const ssEnd = wsTopSS.lastRow.number;
    for (let r = 3; r <= ssEnd; r++) {
      wsTopSS.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsTopSS, 4, ssEnd);

    // File name
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const safeShift = selectedShift ? selectedShift.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
    const fileName = `frt-report-${yyyy}${mm}${dd}-${hh}${mi}${safeShift ? '-' + safeShift : ''}.xlsx`;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, fileName);
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
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition"
          >
            {loading ? (<><FiClock /> लोड हो रहा है…</>) : (<><FiRefreshCw /> Refresh</>)}
          </button>
        </header>

        {lastUpdated && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ Data last updated on: {lastUpdated}</p>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-md p-4 md:p-5 border border-gray-100">
              <div className="flex items-center gap-2 mb-3 text-gray-700"><FiFilter /> <span className="font-semibold">Filters</span></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <SkeletonBlock className="h-9 lg:col-span-2" />
                <SkeletonBlock className="h-9 lg:col-span-1" />
                <SkeletonBlock className="h-9 lg:col-span-1" />
                <SkeletonBlock className="h-9 lg:col-span-1" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <SkeletonBlock className="h-6 w-24" />
                <SkeletonBlock className="h-6 w-20" />
                <SkeletonBlock className="h-6 w-24" />
                <SkeletonBlock className="h-6 w-28" />
                <SkeletonBlock className="h-6 w-24" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 justify-end">
                <SkeletonBlock className="h-9 w-28" />
                <SkeletonBlock className="h-9 w-32" />
                <SkeletonBlock className="h-9 w-32" />
                <SkeletonBlock className="h-9 w-32" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-md border border-gray-100">
              <div className="p-4">
                <div className="flex gap-2 mb-3">
                  <SkeletonBlock className="h-6 w-40" />
                  <SkeletonBlock className="h-6 w-20" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="grid grid-cols-6 gap-2 items-center">
                      <SkeletonBlock className="h-5 col-span-1" />
                      <SkeletonBlock className="h-5 col-span-1" />
                      <SkeletonBlock className="h-5 col-span-1" />
                      <SkeletonBlock className="h-5 col-span-1" />
                      <SkeletonBlock className="h-5 col-span-1" />
                      <SkeletonBlock className="h-5 col-span-1" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {original.length > 0 && !loading && (
          <div className="bg-white rounded-xl shadow-md p-4 md:p-5 mb-6 border border-gray-100">
            <div className="flex items-center gap-2 mb-3 text-gray-700"><FiFilter /> <span className="font-semibold">Filters</span></div>
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-600">Basic Filters</div>
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
              </div>
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs font-semibold text-gray-600 mb-2">Date Range</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
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
                </div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs font-semibold text-gray-600 mb-2">Presets</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => applyPreset('from2010ToNow')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">2010 → Now</button>
                  <button onClick={() => applyPreset('today')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Today</button>
                  <button onClick={() => applyPreset('last24h')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Last 24h</button>
                  <button onClick={() => applyPreset('thisMonth')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">This Month</button>
                  <button onClick={() => applyPreset('toNow')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Set To = Now</button>
                  <button onClick={() => applyPreset('clear')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Clear</button>
                </div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs font-semibold text-gray-600 mb-2">Shift Presets</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-600 mr-1">Yesterday:</span>
                  <button onClick={() => applyShiftPreset('yesterday_morning')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Morning (07–15)</button>
                  <button onClick={() => applyShiftPreset('yesterday_day')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Day (15–23)</button>
                  <button onClick={() => applyShiftPreset('yesterday_night')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Night (23–07)</button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-xs text-gray-600 mr-1">Today:</span>
                  <button onClick={() => applyShiftPreset('today_morning')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Morning (07–15)</button>
                  <button onClick={() => applyShiftPreset('today_day')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Day (15–23)</button>
                  <button onClick={() => applyShiftPreset('today_night')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Night (23–07)</button>
                </div>
                {selectedShift && (
                  <div className="text-xs text-gray-600 mt-2">Selected Shift: <span className="font-semibold text-gray-800">{selectedShift}</span></div>
                )}
              </div>
              {/* Export buttons moved to separate action row below */}
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
              <button
                onClick={exportExcel}
                className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg"
              >
                <FiDownload /> Excel (.xlsx)
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
          <div className="bg-white rounded-xl shadow-md border border-gray-100">
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="min-w-full divide-y divide-gray-200 text-xs md:text-sm">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  {(() => {
                    const base = Object.keys(filtered[0]);
                    const idx = base.indexOf('Closed Date');
                    if (idx >= 0) base.splice(idx + 1, 0, 'Resolution Time'); else base.push('Resolution Time');
                    return base;
                  })().map((header) => (
                    <th 
                      key={header} 
                      onClick={() => handleSort(header)}
                      className="px-4 md:px-6 py-3 text-left font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 select-none"
                    >
                      <div className="flex items-center gap-1">
                        {header}
                        {sortColumn === header && (
                          <span className="text-blue-600">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
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
          </div>
        )}
      </div>
    </div>
  );
}
