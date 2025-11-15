'use client';

import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FiDownload, FiRefreshCw, FiFilter, FiSearch, FiFileText, FiClock, FiBarChart2, FiTrendingUp, FiLayers } from 'react-icons/fi';
import Image from 'next/image';

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
  const [showReportModal, setShowReportModal] = useState(false);

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
          // Set timestamp from API response (last scrape time)
          if (result.lastScrapedAt) {
            setLastUpdated(result.lastScrapedAt);
          }
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

  const exportDivisionSummary = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Division-wise Summary');
    const { rows: divRows, grand } = divisionTotals(rows);
    const divBody = divRows.map(r => [r.division, String(r.total), String(r.closed), String(r.pending)]);
    divBody.push(['Grand Total', String(grand.total), String(grand.closed), String(grand.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total', 'Closed', 'Pending']],
      body: divBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Division-wise Summary');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === divBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('division-summary.pdf');
  };

  const exportSubStationCount = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Sub Station-wise Total Complaint Count');
    const ssMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Sub Station'] || '').trim() || 'Unknown';
      ssMap.set(s, (ssMap.get(s) || 0) + 1);
    }
    const topSS = Array.from(ssMap.entries()).sort((a, b) => b[1] - a[1]);
    const ssBody = topSS.map(([name, count]) => [name, String(count)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Sub Station', 'Total Complaints']],
      body: ssBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Sub Station-wise Total Count');
        }
      },
    });

    doc.save('substation-count.pdf');
  };

  const exportDetailedClosedBreakdown = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Detailed Closed Breakdown');
    const detailedMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = detailedMap.get(key) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      detailedMap.set(key, entry);
    }
    for (const [k, v] of detailedMap) {
      v.pending = Math.max(0, v.total - v.closed);
      detailedMap.set(k, v);
    }
    const detailedRows = Array.from(detailedMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { division, subDivision, subStation, ...stats };
      })
      .sort((a, b) => {
        if (a.division !== b.division) return a.division.localeCompare(b.division);
        if (a.subDivision !== b.subDivision) return a.subDivision.localeCompare(b.subDivision);
        return a.subStation.localeCompare(b.subStation);
      });
    const grandDetailed = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) acc.controlRoom += 1;
        else acc.frt += 1;
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandDetailed.pending = Math.max(0, grandDetailed.total - grandDetailed.closed);
    const detailedBody = detailedRows.map(r => [r.division, r.subDivision, r.subStation, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    detailedBody.push(['Grand Total', '', '', String(grandDetailed.total), String(grandDetailed.closed), String(grandDetailed.controlRoom), String(grandDetailed.frt), String(grandDetailed.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: detailedBody,
      theme: 'grid',
      styles: { fontSize: 13, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 14, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'left' },
        2: { halign: 'left' }
      } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Detailed Closed Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === detailedBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('detailed-closed-breakdown.pdf');
  };

  const exportDatewiseTotalCount = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Date-wise Total Complaint Count');
    const dateTotalMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const date = m ? m[1] : 'Unknown';
      dateTotalMap.set(date, (dateTotalMap.get(date) || 0) + 1);
    }
    const dateTotalRows = Array.from(dateTotalMap.entries()).sort((a, b) => {
      const pa = a[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });
    const dateTotalBody = dateTotalRows.map(([date, count]) => [date, String(count)]);
    const dateTotalSum = dateTotalRows.reduce((acc, [, c]) => acc + (c as number), 0);
    dateTotalBody.push(['Grand Total', String(dateTotalSum)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Date', 'Total Complaints']],
      body: dateTotalBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Date-wise Total Complaint Count');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === dateTotalBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('datewise-total-count.pdf');
  };

  const exportStatusBreakdown = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Complaint Status Breakdown');
    const statusMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Status'] || '').trim() || 'Unknown';
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    const statusArr = Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1]);
    const statusBody = statusArr.map(([name, count]) => [name, String(count)]);
    statusBody.push(['Grand Total', String(rows.length)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Status', 'Count']],
      body: statusBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Complaint Status Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === statusBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('status-breakdown.pdf');
  };

  const exportDatewiseClosedBreakdown = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Date-wise Closed Breakdown');
    const dateBreakMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const date = m ? m[1] : 'Unknown';
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = dateBreakMap.get(date) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      dateBreakMap.set(date, entry);
    }
    for (const [k, v] of dateBreakMap) {
      v.pending = Math.max(0, v.total - v.closed);
      dateBreakMap.set(k, v);
    }
    const dateBreakRows = Array.from(dateBreakMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => {
        const pa = a.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const pb = b.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
        const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
        return da.getTime() - db.getTime();
      });
    const grandDateBreak = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) acc.controlRoom += 1;
        else acc.frt += 1;
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandDateBreak.pending = Math.max(0, grandDateBreak.total - grandDateBreak.closed);
    const dateBreakBody = dateBreakRows.map(r => [r.date, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    dateBreakBody.push(['Grand Total', String(grandDateBreak.total), String(grandDateBreak.closed), String(grandDateBreak.controlRoom), String(grandDateBreak.frt), String(grandDateBreak.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Date', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: dateBreakBody,
      theme: 'grid',
      styles: { fontSize: 15, cellPadding: 11, halign: 'center', minCellHeight: 26 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 16, fontStyle: 'bold', halign: 'center', minCellHeight: 30 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Date-wise Closed Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === dateBreakBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('datewise-closed-breakdown.pdf');
  };

  const exportDivisionClosedBreakdown = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Division Closed Breakdown');
    const divBreakdownMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = divBreakdownMap.get(division) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      divBreakdownMap.set(division, entry);
    }
    for (const [k, v] of divBreakdownMap) {
      v.pending = Math.max(0, v.total - v.closed);
      divBreakdownMap.set(k, v);
    }
    const divBreakRows = Array.from(divBreakdownMap.entries())
      .map(([div, stats]) => ({ division: div, ...stats }))
      .sort((a, b) => b.total - a.total);
    const grandBreak = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) acc.controlRoom += 1;
        else acc.frt += 1;
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandBreak.pending = Math.max(0, grandBreak.total - grandBreak.closed);
    const divBreakBody = divBreakRows.map(r => [r.division, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    divBreakBody.push(['Grand Total', String(grandBreak.total), String(grandBreak.closed), String(grandBreak.controlRoom), String(grandBreak.frt), String(grandBreak.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: divBreakBody,
      theme: 'grid',
      styles: { fontSize: 15, cellPadding: 11, halign: 'center', minCellHeight: 26 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 16, fontStyle: 'bold', halign: 'center', minCellHeight: 30 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Division Closed Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === divBreakBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('division-closed-breakdown.pdf');
  };

  const exportDetailedReportPDF = () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    // Common header function
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    // Page 1: Division Summary
    addHeader('Division-wise Summary');
    const { rows: divRows, grand } = divisionTotals(rows);
    const divBody = divRows.map(r => [r.division, String(r.total), String(r.closed), String(r.pending)]);
    divBody.push(['Grand Total', String(grand.total), String(grand.closed), String(grand.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total', 'Closed', 'Pending']],
      body: divBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Division-wise Summary');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === divBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    // Page 3: Division Closed Breakdown (Control Room vs FRT)
    doc.addPage();
    addHeader('Division Closed Breakdown');
    const divBreakdownMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = divBreakdownMap.get(division) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      divBreakdownMap.set(division, entry);
    }
    for (const [k, v] of divBreakdownMap) {
      v.pending = Math.max(0, v.total - v.closed);
      divBreakdownMap.set(k, v);
    }
    const divBreakRows = Array.from(divBreakdownMap.entries())
      .map(([div, stats]) => ({ division: div, ...stats }))
      .sort((a, b) => b.total - a.total);
    const grandBreak = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) acc.controlRoom += 1;
        else acc.frt += 1;
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandBreak.pending = Math.max(0, grandBreak.total - grandBreak.closed);
    const divBreakBody = divBreakRows.map(r => [r.division, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    divBreakBody.push(['Grand Total', String(grandBreak.total), String(grandBreak.closed), String(grandBreak.controlRoom), String(grandBreak.frt), String(grandBreak.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: divBreakBody,
      theme: 'grid',
      styles: { fontSize: 15, cellPadding: 11, halign: 'center', minCellHeight: 26 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 16, fontStyle: 'bold', halign: 'center', minCellHeight: 30 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Division Closed Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === divBreakBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    // Page 4: Date-wise Closed Breakdown
    doc.addPage();
    addHeader('Date-wise Closed Breakdown');
    const dateBreakMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const date = m ? m[1] : 'Unknown';
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = dateBreakMap.get(date) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      dateBreakMap.set(date, entry);
    }
    for (const [k, v] of dateBreakMap) {
      v.pending = Math.max(0, v.total - v.closed);
      dateBreakMap.set(k, v);
    }
    const dateBreakRows = Array.from(dateBreakMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => {
        const pa = a.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const pb = b.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
        const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
        return da.getTime() - db.getTime();
      });
    const grandDateBreak = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) acc.controlRoom += 1;
        else acc.frt += 1;
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandDateBreak.pending = Math.max(0, grandDateBreak.total - grandDateBreak.closed);
    const dateBreakBody = dateBreakRows.map(r => [r.date, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    dateBreakBody.push(['Grand Total', String(grandDateBreak.total), String(grandDateBreak.closed), String(grandDateBreak.controlRoom), String(grandDateBreak.frt), String(grandDateBreak.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Date', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: dateBreakBody,
      theme: 'grid',
      styles: { fontSize: 15, cellPadding: 11, halign: 'center', minCellHeight: 26 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 16, fontStyle: 'bold', halign: 'center', minCellHeight: 30 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Date-wise Closed Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === dateBreakBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    // Page 5: Status Breakdown
    doc.addPage();
    addHeader('Complaint Status Breakdown');
    const statusMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Status'] || '').trim() || 'Unknown';
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    const statusArr = Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1]);
    const statusBody = statusArr.map(([name, count]) => [name, String(count)]);
    statusBody.push(['Grand Total', String(rows.length)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Status', 'Count']],
      body: statusBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Complaint Status Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === statusBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    // Page 6: Date-wise Total Count
    doc.addPage();
    addHeader('Date-wise Total Complaint Count');
    const dateTotalMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const date = m ? m[1] : 'Unknown';
      dateTotalMap.set(date, (dateTotalMap.get(date) || 0) + 1);
    }
    const dateTotalRows = Array.from(dateTotalMap.entries()).sort((a, b) => {
      const pa = a[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });
    const dateTotalBody = dateTotalRows.map(([date, count]) => [date, String(count)]);
    const dateTotalSum = dateTotalRows.reduce((acc, [, c]) => acc + (c as number), 0);
    dateTotalBody.push(['Grand Total', String(dateTotalSum)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Date', 'Total Complaints']],
      body: dateTotalBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Date-wise Total Complaint Count');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === dateTotalBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    // Page 7: Detailed Closed Breakdown (Division → Sub Division → Sub Station)
    doc.addPage();
    addHeader('Detailed Closed Breakdown');
    const detailedMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = detailedMap.get(key) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      detailedMap.set(key, entry);
    }
    for (const [k, v] of detailedMap) {
      v.pending = Math.max(0, v.total - v.closed);
      detailedMap.set(k, v);
    }
    const detailedRows = Array.from(detailedMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { division, subDivision, subStation, ...stats };
      })
      .sort((a, b) => {
        if (a.division !== b.division) return a.division.localeCompare(b.division);
        if (a.subDivision !== b.subDivision) return a.subDivision.localeCompare(b.subDivision);
        return a.subStation.localeCompare(b.subStation);
      });
    const grandDetailed = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) acc.controlRoom += 1;
        else acc.frt += 1;
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandDetailed.pending = Math.max(0, grandDetailed.total - grandDetailed.closed);
    const detailedBody = detailedRows.map(r => [r.division, r.subDivision, r.subStation, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    detailedBody.push(['Grand Total', '', '', String(grandDetailed.total), String(grandDetailed.closed), String(grandDetailed.controlRoom), String(grandDetailed.frt), String(grandDetailed.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: detailedBody,
      theme: 'grid',
      styles: { fontSize: 13, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 14, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'left' },
        2: { halign: 'left' }
      } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Detailed Closed Breakdown');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === detailedBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    // Page 8: Sub Station Wise Count
    doc.addPage();
    addHeader('Sub Station-wise Total Complaint Count');
    const ssMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Sub Station'] || '').trim() || 'Unknown';
      ssMap.set(s, (ssMap.get(s) || 0) + 1);
    }
    const topSS = Array.from(ssMap.entries()).sort((a, b) => b[1] - a[1]);
    const ssBody = topSS.map(([name, count]) => [name, String(count)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Sub Station', 'Total Complaints']],
      body: ssBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Sub Station-wise Total Count');
        }
      },
    });

    doc.save('detailed-report.pdf');
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
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';
    
    const addHeader = (title: string) => {
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      let yPos = 58;
      doc.text(`Generated: ${nowStr}`, 40, yPos);
      yPos += 15;
      doc.text(`Period: ${periodText}`, 40, yPos);
      yPos += 15;
      doc.text(`Total Complaints: ${rows.length}`, 40, yPos);
      if (selectedShift) {
        yPos += 15;
        doc.text(`Shift: ${selectedShift}`, 40, yPos);
      }
    };

    addHeader('Division-wise Summary');
    const { rows: divRows, grand } = divisionTotals(rows);
    const tableBody = divRows.map(r => [r.division, String(r.total), String(r.closed), String(r.pending)]);
    tableBody.push(['Grand Total', String(grand.total), String(grand.closed), String(grand.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total', 'Closed', 'Pending']],
      body: tableBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Division-wise Summary');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === tableBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('report-summary.pdf');
  };

  const exportTrendChartsPDF = async () => {
    const rows = filtered;
    if (rows.length === 0) return;

    // Separate Control Room and FRT closed complaints
    const controlRoomClosed = rows.filter(r => {
      const isClosed = isClosedRow(r);
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      return isClosed && isControlRoom;
    });

    const frtClosed = rows.filter(r => {
      const isClosed = isClosedRow(r);
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      return isClosed && !isControlRoom;
    });

    // Group Control Room by date
    const controlRoomMap = new Map<string, number>();
    for (const r of controlRoomClosed) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      controlRoomMap.set(key, (controlRoomMap.get(key) || 0) + 1);
    }

    // Group FRT by date
    const frtMap = new Map<string, number>();
    for (const r of frtClosed) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      frtMap.set(key, (frtMap.get(key) || 0) + 1);
    }

    // Get all unique dates
    const allDates = new Set([...controlRoomMap.keys(), ...frtMap.keys()]);
    const sortedDates = Array.from(allDates).sort((a, b) => {
      const pa = a.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });

    if (sortedDates.length === 0) {
      alert('No closed complaints found in the selected period');
      return;
    }

    // Create chart using Chart.js
    const { Chart } = await import('chart.js/auto');
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sortedDates,
        datasets: [
          {
            label: 'Control Room Closed',
            data: sortedDates.map(date => controlRoomMap.get(date) || 0),
            borderColor: 'rgb(239, 68, 68)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.3,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'FRT Closed',
            data: sortedDates.map(date => frtMap.get(date) || 0),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.3,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          }
        ]
      },
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: 'Control Room vs FRT Closed Complaints Comparison',
            font: { size: 16, weight: 'bold' }
          },
          legend: {
            display: true,
            position: 'top'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 },
            title: { display: true, text: 'Number of Complaints' }
          },
          x: {
            title: { display: true, text: 'Date' }
          }
        }
      }
    });

    // Wait for chart to render
    await new Promise(resolve => setTimeout(resolve, 500));

    // Convert comparison chart to image
    const comparisonChartImage = canvas.toDataURL('image/png');
    chart.destroy();
    canvas.remove();

    // Create PDF
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
    const periodParts: string[] = [];
    if (fromDT) {
      const d = new Date(fromDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`From: ${formatted}`);
    }
    if (toDT) {
      const d = new Date(toDT);
      const formatted = d.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am/gi, 'AM').replace(/pm/gi, 'PM');
      periodParts.push(`To: ${formatted}`);
    }
    const periodText = periodParts.length ? periodParts.join(' | ') : 'All Data';

    // Page 1: FRT Only Chart
    
    if (frtClosed.length > 0) {
      const canvas2 = document.createElement('canvas');
      canvas2.width = 800;
      canvas2.height = 400;
      const ctx2 = canvas2.getContext('2d');
      if (ctx2) {
        const chart2 = new Chart(ctx2, {
          type: 'line',
          data: {
            labels: sortedDates,
            datasets: [{
              label: 'FRT Closed',
              data: sortedDates.map(date => frtMap.get(date) || 0),
              borderColor: 'rgb(59, 130, 246)',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.3,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
            }]
          },
          options: {
            responsive: false,
            plugins: {
              title: { display: true, text: 'FRT Closed Complaints Trend', font: { size: 16, weight: 'bold' } },
              legend: { display: true, position: 'top' }
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Number of Complaints' } },
              x: { title: { display: true, text: 'Date' } }
            }
          }
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        const chartImage2 = canvas2.toDataURL('image/png');
        
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('FRT Closed Complaints Trend', 40, 40);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        let yPos = 58;
        doc.text(`Generated: ${nowStr}`, 40, yPos);
        yPos += 15;
        doc.text(`Period: ${periodText}`, 40, yPos);
        yPos += 15;
        doc.text(`Total FRT Closed: ${frtClosed.length}`, 40, yPos);
        if (selectedShift) {
          yPos += 15;
          doc.text(`Shift: ${selectedShift}`, 40, yPos);
        }
        const startY1 = selectedShift ? 130 : 115;
        doc.addImage(chartImage2, 'PNG', 40, startY1, 760, 380);
        
        chart2.destroy();
        canvas2.remove();
      }
    }

    // Page 2: Control Room Only Chart
    doc.addPage();
    
    if (controlRoomClosed.length > 0) {

      const canvas3 = document.createElement('canvas');
      canvas3.width = 800;
      canvas3.height = 400;
      const ctx3 = canvas3.getContext('2d');
      if (ctx3) {
        const chart3 = new Chart(ctx3, {
          type: 'line',
          data: {
            labels: sortedDates,
            datasets: [{
              label: 'Control Room Closed',
              data: sortedDates.map(date => controlRoomMap.get(date) || 0),
              borderColor: 'rgb(239, 68, 68)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              tension: 0.3,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
            }]
          },
          options: {
            responsive: false,
            plugins: {
              title: { display: true, text: 'Control Room Closed Complaints Trend', font: { size: 16, weight: 'bold' } },
              legend: { display: true, position: 'top' }
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Number of Complaints' } },
              x: { title: { display: true, text: 'Date' } }
            }
          }
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        const chartImage3 = canvas3.toDataURL('image/png');
        
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Control Room Closed Complaints Trend', 40, 40);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        let yPos = 58;
        doc.text(`Generated: ${nowStr}`, 40, yPos);
        yPos += 15;
        doc.text(`Period: ${periodText}`, 40, yPos);
        yPos += 15;
        doc.text(`Total Control Room Closed: ${controlRoomClosed.length}`, 40, yPos);
        if (selectedShift) {
          yPos += 15;
          doc.text(`Shift: ${selectedShift}`, 40, yPos);
        }
        const startY2 = selectedShift ? 130 : 115;
        doc.addImage(chartImage3, 'PNG', 40, startY2, 760, 380);
        
        chart3.destroy();
        canvas3.remove();
      }
    }

    // Page 3: Comparison Chart
    doc.addPage();
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Control Room vs FRT Comparison', 40, 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    let yPos3 = 58;
    doc.text(`Generated: ${nowStr}`, 40, yPos3);
    yPos3 += 15;
    doc.text(`Period: ${periodText}`, 40, yPos3);
    yPos3 += 15;
    doc.text(`Control Room: ${controlRoomClosed.length} | FRT: ${frtClosed.length}`, 40, yPos3);
    if (selectedShift) {
      yPos3 += 15;
      doc.text(`Shift: ${selectedShift}`, 40, yPos3);
    }
    const startY3 = selectedShift ? 130 : 115;
    doc.addImage(comparisonChartImage, 'PNG', 40, startY3, 760, 380);

    // Page 4: Data Table
    doc.addPage();
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Detailed Data', 40, 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    let yPos4 = 58;
    doc.text(`Generated: ${nowStr}`, 40, yPos4);
    yPos4 += 15;
    doc.text(`Period: ${periodText}`, 40, yPos4);
    yPos4 += 15;
    doc.text(`Total Complaints: ${rows.length}`, 40, yPos4);
    if (selectedShift) {
      yPos4 += 15;
      doc.text(`Shift: ${selectedShift}`, 40, yPos4);
    }
    
    const tableBody = sortedDates.map(date => [
      date,
      String(controlRoomMap.get(date) || 0),
      String(frtMap.get(date) || 0),
      String((controlRoomMap.get(date) || 0) + (frtMap.get(date) || 0))
    ]);
    const totalControlRoom = controlRoomClosed.length;
    const totalFRT = frtClosed.length;
    tableBody.push(['Total', String(totalControlRoom), String(totalFRT), String(totalControlRoom + totalFRT)]);

    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Date', 'Control Room', 'FRT', 'Total']],
      body: tableBody,
      theme: 'grid',
      styles: { fontSize: 15, cellPadding: 11, halign: 'center', minCellHeight: 26 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 16, fontStyle: 'bold', halign: 'center', minCellHeight: 30 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      columnStyles: {
        0: { halign: 'left' }
      } as any,
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === tableBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('trend-charts-report.pdf');
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

    // Helper to convert datetime-local to 12-hour format
    const convertTo12Hour = (dateTimeStr: string) => {
      if (!dateTimeStr) return '';
      const match = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hour24, minute] = match;
        let hours = parseInt(hour24);
        const period = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${day}/${month}/${year} ${hours}:${minute} ${period}`;
      }
      return dateTimeStr.replace('T', ' ');
    };

    // Period subtitle for all sheets
    const periodSubtitle = fromDT || toDT ? `Period: ${fromDT ? convertTo12Hour(fromDT) : 'Start'} → ${toDT ? convertTo12Hour(toDT) : 'Now'}` : 'Period: All Data';

    // Helper function to format date with time in 12-hour AM/PM format
    const formatDateTime = (dateStr: string) => {
      if (!dateStr) return '';
      
      // Try multiple formats
      // Format 1: DD/MM/YYYY HH:MM (24-hour)
      let match = dateStr.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}):(\d{2})/i);
      if (match) {
        const date = match[1];
        let hours = parseInt(match[2]);
        const minutes = match[3];
        
        // Convert to 12-hour format
        const period = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        
        return `${date} ${hours}:${minutes} ${period}`;
      }
      
      // Format 2: DD/MM/YYYY HH:MM AM/PM (already in 12-hour)
      match = dateStr.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2})\s*(AM|PM)/i);
      if (match) {
        return `${match[1]} ${match[2]} ${match[3]}`;
      }
      
      return dateStr;
    };

    // Cover / Summary sheet
    const wsCover = wb.addWorksheet('1. Cover Page', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
    const periodText = periodSubtitle;
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
    const wsData = wb.addWorksheet('2. All Complaints Data', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsData, 'All Complaints - Complete Data', `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}   |   ${periodSubtitle}`);

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
        if (h === 'Complaint Date and Time') return formatDateTime(String((r as any)[h] ?? ''));
        if (h === 'Closed Date') return formatDateTime(String((r as any)[h] ?? ''));
        return String((r as any)[h] ?? '');
      });
      const excelRow = wsData.addRow(rowVals);
      
      // Make time bold in date columns
      const dateTimeColIndex = headers.indexOf('Complaint Date and Time') + 1;
      const closedDateColIndex = headers.indexOf('Closed Date') + 1;
      
      if (dateTimeColIndex > 0) {
        const cell = excelRow.getCell(dateTimeColIndex);
        const val = String(cell.value || '');
        const timeMatch = val.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
        if (timeMatch) {
          const datepart = val.substring(0, val.indexOf(timeMatch[1]));
          const timepart = timeMatch[1];
          cell.value = {
            richText: [
              { text: datepart },
              { font: { bold: true, size: 11 }, text: timepart }
            ]
          };
        }
      }
      
      if (closedDateColIndex > 0) {
        const cell = excelRow.getCell(closedDateColIndex);
        const val = String(cell.value || '');
        const timeMatch = val.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
        if (timeMatch) {
          const datepart = val.substring(0, val.indexOf(timeMatch[1]));
          const timepart = timeMatch[1];
          cell.value = {
            richText: [
              { text: datepart },
              { font: { bold: true, size: 11 }, text: timepart }
            ]
          };
        }
      }
      
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
    const wsSummary = wb.addWorksheet('3. Division Summary', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsSummary, 'Division-wise Complaint Summary', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
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
    const wsDate = wb.addWorksheet('4. Date-wise Total Count', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsDate, 'Date-wise Total Complaint Count', periodSubtitle);
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
    const wsStatus = wb.addWorksheet('5. Status Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsStatus, 'Complaint Status Breakdown', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
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

    // Sheet 5: Division Breakdown (Control Room vs FRT)
    const wsDivBreakdown = wb.addWorksheet('6. Division Closed Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsDivBreakdown, 'Division-wise Closed Complaints (Control Room vs FRT)', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    
    // Calculate division-wise breakdown
    const divBreakdownMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      
      const entry = divBreakdownMap.get(division) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) {
          entry.controlRoom += 1;
        } else {
          entry.frt += 1;
        }
      }
      divBreakdownMap.set(division, entry);
    }
    
    // Calculate pending
    for (const [k, v] of divBreakdownMap) {
      v.pending = Math.max(0, v.total - v.closed);
      divBreakdownMap.set(k, v);
    }
    
    const divBreakdownRows = Array.from(divBreakdownMap.entries())
      .map(([div, stats]) => ({ division: div, ...stats }))
      .sort((a, b) => b.total - a.total);
    
    // Calculate grand totals
    const grandBreakdown = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) {
          acc.controlRoom += 1;
        } else {
          acc.frt += 1;
        }
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandBreakdown.pending = Math.max(0, grandBreakdown.total - grandBreakdown.closed);
    
    wsDivBreakdown.addRow(['Division', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']);
    styleHeaderRow(wsDivBreakdown, 3);
    divBreakdownRows.forEach(r => wsDivBreakdown.addRow([r.division, r.total, r.closed, r.controlRoom, r.frt, r.pending]));
    wsDivBreakdown.addRow(['Grand Total', grandBreakdown.total, grandBreakdown.closed, grandBreakdown.controlRoom, grandBreakdown.frt, grandBreakdown.pending]);
    
    wsDivBreakdown.getColumn(1).width = 36;
    wsDivBreakdown.getColumn(2).width = 14;
    wsDivBreakdown.getColumn(3).width = 14;
    wsDivBreakdown.getColumn(4).width = 18;
    wsDivBreakdown.getColumn(5).width = 14;
    wsDivBreakdown.getColumn(6).width = 14;
    
    const divBreakEnd = wsDivBreakdown.lastRow.number;
    for (let r = 3; r <= divBreakEnd; r++) {
      wsDivBreakdown.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsDivBreakdown, 4, divBreakEnd);
    const divBreakGt = wsDivBreakdown.getRow(divBreakEnd);
    divBreakGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 6: Detailed Breakdown (Division + Sub Division + Sub Station)
    const wsDetailedBreakdown = wb.addWorksheet('7. Detailed Closed Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsDetailedBreakdown, 'Detailed Closed Breakdown (Division → Sub Division → Sub Station)', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    
    // Calculate detailed breakdown
    const detailedMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      
      const entry = detailedMap.get(key) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) {
          entry.controlRoom += 1;
        } else {
          entry.frt += 1;
        }
      }
      detailedMap.set(key, entry);
    }
    
    // Calculate pending
    for (const [k, v] of detailedMap) {
      v.pending = Math.max(0, v.total - v.closed);
      detailedMap.set(k, v);
    }
    
    const detailedRows = Array.from(detailedMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { division, subDivision, subStation, ...stats };
      })
      .sort((a, b) => {
        if (a.division !== b.division) return a.division.localeCompare(b.division);
        if (a.subDivision !== b.subDivision) return a.subDivision.localeCompare(b.subDivision);
        return a.subStation.localeCompare(b.subStation);
      });
    
    // Calculate grand totals
    const grandDetailed = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) {
          acc.controlRoom += 1;
        } else {
          acc.frt += 1;
        }
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandDetailed.pending = Math.max(0, grandDetailed.total - grandDetailed.closed);
    
    wsDetailedBreakdown.addRow(['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']);
    styleHeaderRow(wsDetailedBreakdown, 3);
    detailedRows.forEach(r => wsDetailedBreakdown.addRow([r.division, r.subDivision, r.subStation, r.total, r.closed, r.controlRoom, r.frt, r.pending]));
    wsDetailedBreakdown.addRow(['Grand Total', '', '', grandDetailed.total, grandDetailed.closed, grandDetailed.controlRoom, grandDetailed.frt, grandDetailed.pending]);
    
    wsDetailedBreakdown.getColumn(1).width = 24;
    wsDetailedBreakdown.getColumn(2).width = 24;
    wsDetailedBreakdown.getColumn(3).width = 28;
    wsDetailedBreakdown.getColumn(4).width = 12;
    wsDetailedBreakdown.getColumn(5).width = 12;
    wsDetailedBreakdown.getColumn(6).width = 16;
    wsDetailedBreakdown.getColumn(7).width = 12;
    wsDetailedBreakdown.getColumn(8).width = 12;
    
    const detailedEnd = wsDetailedBreakdown.lastRow.number;
    for (let r = 3; r <= detailedEnd; r++) {
      wsDetailedBreakdown.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 3 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsDetailedBreakdown, 4, detailedEnd);
    const detailedGt = wsDetailedBreakdown.getRow(detailedEnd);
    detailedGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 7: Date-wise Breakdown (Control Room vs FRT)
    const wsDateBreakdown = wb.addWorksheet('8. Date-wise Closed Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsDateBreakdown, 'Date-wise Closed Complaints (Control Room vs FRT)', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    
    // Calculate date-wise breakdown
    const dateBreakdownMap = new Map<string, { total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const date = m ? m[1] : 'Unknown';
      
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      
      const entry = dateBreakdownMap.get(date) || { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) {
          entry.controlRoom += 1;
        } else {
          entry.frt += 1;
        }
      }
      dateBreakdownMap.set(date, entry);
    }
    
    // Calculate pending
    for (const [k, v] of dateBreakdownMap) {
      v.pending = Math.max(0, v.total - v.closed);
      dateBreakdownMap.set(k, v);
    }
    
    const dateBreakdownRows = Array.from(dateBreakdownMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => {
        const pa = a.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const pb = b.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
        const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
        return da.getTime() - db.getTime();
      });
    
    // Calculate grand totals
    const grandDateBreakdown = rows.reduce((acc, r) => {
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      
      acc.total += 1;
      if (isClosed) {
        acc.closed += 1;
        if (isControlRoom) {
          acc.controlRoom += 1;
        } else {
          acc.frt += 1;
        }
      }
      return acc;
    }, { total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 });
    grandDateBreakdown.pending = Math.max(0, grandDateBreakdown.total - grandDateBreakdown.closed);
    
    wsDateBreakdown.addRow(['Date', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']);
    styleHeaderRow(wsDateBreakdown, 3);
    dateBreakdownRows.forEach(r => wsDateBreakdown.addRow([r.date, r.total, r.closed, r.controlRoom, r.frt, r.pending]));
    wsDateBreakdown.addRow(['Grand Total', grandDateBreakdown.total, grandDateBreakdown.closed, grandDateBreakdown.controlRoom, grandDateBreakdown.frt, grandDateBreakdown.pending]);
    
    wsDateBreakdown.getColumn(1).width = 20;
    wsDateBreakdown.getColumn(2).width = 14;
    wsDateBreakdown.getColumn(3).width = 14;
    wsDateBreakdown.getColumn(4).width = 18;
    wsDateBreakdown.getColumn(5).width = 14;
    wsDateBreakdown.getColumn(6).width = 14;
    
    const dateBreakEnd = wsDateBreakdown.lastRow.number;
    for (let r = 3; r <= dateBreakEnd; r++) {
      wsDateBreakdown.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsDateBreakdown, 4, dateBreakEnd);
    const dateBreakGt = wsDateBreakdown.getRow(dateBreakEnd);
    dateBreakGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 8: Top Sub Stations
    const wsTopSS = wb.addWorksheet('9. Sub Station Wise Count', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsTopSS, 'Sub Station-wise Total Complaint Count', `Total: ${rows.length} complaints   |   ${periodSubtitle}`);
    const ssMap = new Map<string, number>();
    for (const r of rows) {
      const s = String((r as any)['Sub Station'] || '').trim() || 'Unknown';
      ssMap.set(s, (ssMap.get(s) || 0) + 1);
    }
    const topSS = Array.from(ssMap.entries()).sort((a, b) => b[1] - a[1]);
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
            <Image src="/logo.png" alt="FRT Logo" width={56} height={56} className="rounded-lg" priority />
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
          <div className="bg-amber-50 border-l-4 border-amber-500 text-amber-800 px-4 py-3 rounded">
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
            <div className="flex flex-wrap items-center justify-end gap-3 mt-4">
              <button
                onClick={exportSummaryPDF}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-semibold py-2.5 px-5 rounded-lg shadow-md hover:shadow-lg transition-all transform hover:scale-105"
              >
                <FiBarChart2 className="text-lg" /> Summary PDF
              </button>
              <button
                onClick={exportTrendChartsPDF}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-semibold py-2.5 px-5 rounded-lg shadow-md hover:shadow-lg transition-all transform hover:scale-105"
              >
                <FiTrendingUp className="text-lg" /> Trend Charts
              </button>
              <button
                onClick={() => setShowReportModal(true)}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold py-2.5 px-5 rounded-lg shadow-md hover:shadow-lg transition-all transform hover:scale-105"
              >
                <FiLayers className="text-lg" /> Detailed Reports
              </button>
              <button
                onClick={exportExcel}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-semibold py-2.5 px-5 rounded-lg shadow-md hover:shadow-lg transition-all transform hover:scale-105"
              >
                <FiDownload className="text-lg" /> Excel (.xlsx)
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

        {/* Report Selection Modal */}
        {showReportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-800">Select Report to Download</h2>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                >
                  ×
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">📊</span> Summary Reports
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => { exportDivisionSummary(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 hover:border-indigo-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-indigo-500 p-3 rounded-lg group-hover:bg-indigo-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-indigo-700 transition">Division-wise Summary</div>
                        <div className="text-xs text-gray-600">Total, Closed, Pending by Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportStatusBreakdown(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 hover:border-indigo-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-indigo-500 p-3 rounded-lg group-hover:bg-indigo-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-indigo-700 transition">Status Breakdown</div>
                        <div className="text-xs text-gray-600">Complaint Status wise Count</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">🔍</span> Closed Breakdown Reports
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => { exportDivisionClosedBreakdown(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-200 hover:border-emerald-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-emerald-500 p-3 rounded-lg group-hover:bg-emerald-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Division Closed Breakdown</div>
                        <div className="text-xs text-gray-600">Control Room vs FRT by Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportDatewiseClosedBreakdown(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-200 hover:border-emerald-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-emerald-500 p-3 rounded-lg group-hover:bg-emerald-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Date-wise Closed Breakdown</div>
                        <div className="text-xs text-gray-600">Control Room vs FRT by Date</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportDetailedClosedBreakdown(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-200 hover:border-emerald-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-emerald-500 p-3 rounded-lg group-hover:bg-emerald-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Detailed Closed Breakdown</div>
                        <div className="text-xs text-gray-600">Division → Sub Division → Sub Station</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">📅</span> Count Reports
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => { exportDatewiseTotalCount(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 hover:border-purple-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-purple-500 p-3 rounded-lg group-hover:bg-purple-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-purple-700 transition">Date-wise Total Count</div>
                        <div className="text-xs text-gray-600">Total Complaints by Date</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportSubStationCount(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 hover:border-purple-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-purple-500 p-3 rounded-lg group-hover:bg-purple-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-purple-700 transition">Sub Station-wise Count</div>
                        <div className="text-xs text-gray-600">Total Complaints by Sub Station</div>
                      </div>
                    </button>
                  </div>
                </div>
                <div className="border-t-2 border-gray-300 pt-4 mt-2"></div>
                <button
                  onClick={() => { exportDetailedReportPDF(); setShowReportModal(false); }}
                  className="w-full flex items-center gap-4 p-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02] group"
                >
                  <div className="bg-white/20 p-3 rounded-lg group-hover:bg-white/30 transition">
                    <FiDownload className="text-white text-2xl" />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-lg">Download All Reports</div>
                    <div className="text-sm text-blue-100">Combined PDF with all 7 reports</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
