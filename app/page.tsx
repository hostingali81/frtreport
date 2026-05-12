'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { FiDownload, FiRefreshCw, FiFileText, FiClock, FiBarChart2, FiTrendingUp, FiLayers, FiInfo, FiActivity } from 'react-icons/fi';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { getDefaultTodayFilters, useData } from './context/DataContext';
import { loadExcelJS } from './utils/lazyImports';

// Dynamic imports for heavy components
const FilterBar = dynamic(() => import('./components/FilterBar'), { ssr: false });

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function Home() {
  const {
    data: contextData,
    loading: contextLoading,
    lastUpdated: contextLastUpdated,
    refreshData,
    applyFilters,
    filterOptions,
    currentFilters
  } = useData();

  const router = useRouter();
  const [original, setOriginal] = useState<any[]>([]);

  useEffect(() => {
    router.prefetch('/charts');
    router.prefetch('/deep-analysis');
  }, [router]);

  useEffect(() => {
    setOriginal(contextData);
  }, [contextData]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const loading = contextLoading || isRefreshing;

  const [error, setError] = useState('');
  const defaultFilters = currentFilters ?? getDefaultTodayFilters();
  const [search, setSearch] = useState(defaultFilters.search);
  const [fromDT, setFromDT] = useState(defaultFilters.fromDT); // yyyy-mm-ddTHH:mm (datetime-local)
  const [toDT, setToDT] = useState(defaultFilters.toDT);   // yyyy-mm-ddTHH:mm (datetime-local)
  const [statusFilter, setStatusFilter] = useState(defaultFilters.status); // empty = all
  const [closedStatusFilter, setClosedStatusFilter] = useState(defaultFilters.closedStatus);
  const [divisionFilter, setDivisionFilter] = useState(defaultFilters.division);
  const [subDivisionFilter, setSubDivisionFilter] = useState(defaultFilters.subDivision);
  const [subStationFilter, setSubStationFilter] = useState(defaultFilters.subStation);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    if (contextLastUpdated) setLastUpdated(contextLastUpdated);
  }, [contextLastUpdated]);

  useEffect(() => {
    setSearch(currentFilters.search);
    setFromDT(currentFilters.fromDT);
    setToDT(currentFilters.toDT);
    setStatusFilter(currentFilters.status);
    setClosedStatusFilter(currentFilters.closedStatus);
    setDivisionFilter(currentFilters.division);
    setSubDivisionFilter(currentFilters.subDivision);
    setSubStationFilter(currentFilters.subStation);
    setMonthFilter(currentFilters.monthFilter);
  }, [currentFilters]);
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedShift, setSelectedShift] = useState<string>(''); // e.g. "Today - Morning (07:00–15:00)"
  const [showReportModal, setShowReportModal] = useState(false);
  const [showExcelMenu, setShowExcelMenu] = useState(false);
  const [customDate, setCustomDate] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>(''); // Track active preset
  const [monthFilter, setMonthFilter] = useState<string>(defaultFilters.monthFilter);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCellData, setSelectedCellData] = useState<{ title: string, content: string } | null>(null);
  const rowsPerPage = 100;

  const parsePossibleDate = (value: string) => {
    // Handles formats like: 01/11/2025 03:45 PM, 1-1-2025, etc.
    // Returns Date or null
    // Clean string first
    const clean = value.trim();
    if (!clean) return null;

    // Attempt detecting dd/mm/yyyy or dd-mm-yyyy or similar
    const match = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      // Note: we're discarding time here for simple date check, 
      // but if time is needed we could parse it. 
      // The original code passed standard date string to new Date() which might fail for dd/mm
      // Let's return a proper Date object from yyyy-mm-dd

      // If original string has time 'HH:MM AM/PM'
      const timeMatch = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      let hours = 0;
      let minutes = 0;
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        if (timeMatch[3]) {
          const ampm = timeMatch[3].toUpperCase();
          if (ampm === 'PM' && hours < 12) hours += 12;
          if (ampm === 'AM' && hours === 12) hours = 0;
        }
      }

      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, minutes);
    }
    return null;
  };

  const statusOptions = filterOptions.statuses;
  const closedStatusOptions = filterOptions.closedStatuses;
  const divisionOptions = filterOptions.divisions;
  const subDivisionOptions = filterOptions.subDivisions;
  const subStationOptions = filterOptions.subStations;
  const monthOptions = filterOptions.months;

  const applyCurrentFilters = async () => {
    setError('');

    try {
      await applyFilters({
        search,
        division: divisionFilter,
        subDivision: subDivisionFilter,
        subStation: subStationFilter,
        status: statusFilter,
        closedStatus: closedStatusFilter,
        fromDT,
        toDT,
        monthFilter
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load filtered complaints');
    }
  };

  /*
    setError('');
    if (refresh) {
      setOriginal([]);
      setData([]);
    }

    try {
      let scrapeTimestamp: string | null = null;
      
      if (refresh) {
        const scrapeResponse = await fetch('/api/scrape?refresh=1');
        const scrapeResult = await scrapeResponse.json();

        if (!scrapeResult.success) {
          setError(scrapeResult.error || 'Scraping failed');
          setLoading(false);
          return;
        }
        
        scrapeTimestamp = scrapeResult.lastScrapedAt;
      }

      if (!forceFull) {
        const partialEndpoint = '/api/complaints?limit=2000';
        const partialResponse = await fetch(partialEndpoint);
        const partialResult = await partialResponse.json();

        if (partialResult.success) {
          const partialData = partialResult.data || [];
          if (partialData.length > 0) {
            setOriginal(partialData);
            setData(partialData);
            setIsPartialData(true);
            if (partialResult.lastScrapedAt) {
              setLastUpdated(partialResult.lastScrapedAt);
            }
          }
        }
      }

      if (!forceFull) {
        setLoading(false);
      }

      const fullEndpoint = `/api/complaints?fetchAll=true${refresh ? '&refresh=1' : ''}`;
      const fullResponse = await fetch(fullEndpoint);
      const fullResult = await fullResponse.json();

      if (fullResult.success) {
        const fullData = fullResult.data || [];
        if (fullData.length > 0) {
          setOriginal(fullData);
          setData(fullData);
          setIsPartialData(false);
          
          const timestamp = scrapeTimestamp || fullResult.lastScrapedAt;
          if (timestamp) {
            setLastUpdated(timestamp);
          }
        } else if (forceFull) {
          setOriginal([]);
          setData([]);
          setError('कोई डेटा नहीं मिला');
        }
      } else if (forceFull) {
        setError(fullResult.error || 'डेटा प्राप्त करने में त्रुटि');
      }

    } catch (err: any) {
      setError('डेटा प्राप्त करने में त्रुटि: ' + err.message);
    } finally {
      setLoading(false);
    }
  };
  */



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

  const computeResolutionTimeMinutes = (row: any) => {
    const openStr = String(row['Complaint Date and Time'] || row['Complaint Date'] || '');
    const closeStr = String(row['Closed Date'] || '');
    const open = parsePossibleDate(openStr);
    const close = parsePossibleDate(closeStr);
    if (!open || !close) return null;
    const diffMs = close.getTime() - open.getTime();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
    return Math.floor(diffMs / 60000);
  };

  const computeResolutionTime = (row: any) => {
    const minutes = computeResolutionTimeMinutes(row);
    if (minutes === null) return '';
    return formatDuration(minutes * 60000);
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const [isPending, startTransition] = useTransition();

  const handleMonthChange = (val: string) => {
    startTransition(() => {
      setMonthFilter(val);
      if (val !== 'All') {
        setFromDT('');
        setToDT('');
        setActivePreset('');
        setSelectedShift('');
        setCustomDate('');
      }
    });
  };

  const filtered = useMemo(() => {
    let rows = [...original];
    if (sortColumn) {
      rows = rows.sort((a, b) => {
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
  }, [original, sortColumn, sortDirection]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, currentPage]);

  const totalPages = Math.ceil(filtered.length / rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [original]);

  // Calculate daily counts for calendar
  const dailyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of original) {
      const val = String(row['Complaint Date and Time'] || row['Complaint Date'] || '');
      const dt = parsePossibleDate(val);
      if (dt) {
        // Use local date string YYYY-MM-DD
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, [original]);

  const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };

  const applyShiftPreset = (shift: 'today_morning' | 'today_day' | 'today_night' | 'yesterday_morning' | 'yesterday_day' | 'yesterday_night' | 'today_field_a' | 'today_field_b' | 'today_field_c' | 'yesterday_field_a' | 'yesterday_field_b' | 'yesterday_field_c') => {
    setActivePreset(''); // Clear active preset when shift is selected
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const labelMap: Record<string, string> = {
      today_morning: 'Today - Control Room Morning (07:00 AM–03:00 PM)',
      today_day: 'Today - Control Room Day (03:00 PM–11:00 PM)',
      today_night: 'Today - Control Room Night (11:00 PM–07:00 AM)',
      yesterday_morning: 'Yesterday - Control Room Morning (07:00 AM–03:00 PM)',
      yesterday_day: 'Yesterday - Control Room Day (03:00 PM–11:00 PM)',
      yesterday_night: 'Yesterday - Control Room Night (11:00 PM–07:00 AM)',
      today_field_a: 'Today - Field Shift A (08:00 AM–04:00 PM)',
      today_field_b: 'Today - Field Shift B (04:00 PM–12:00 AM)',
      today_field_c: 'Today - Field Shift C (12:00 AM–08:00 AM)',
      yesterday_field_a: 'Yesterday - Field Shift A (08:00 AM–04:00 PM)',
      yesterday_field_b: 'Yesterday - Field Shift B (04:00 PM–12:00 AM)',
      yesterday_field_c: 'Yesterday - Field Shift C (12:00 AM–08:00 AM)',
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
      case 'today_field_a': {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 0, 0);
        setRange(start, end);
        break;
      }
      case 'today_field_b': {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 0, 0);
        const end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        end.setHours(0, 0, 0, 0);
        setRange(start, end);
        break;
      }
      case 'today_field_c': {
        const start = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime());
        end.setHours(8, 0, 0, 0);
        setRange(start, end);
        break;
      }
      case 'yesterday_field_a': {
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 8, 0, 0);
        const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 16, 0, 0);
        setRange(start, end);
        break;
      }
      case 'yesterday_field_b': {
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 16, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
        setRange(start, end);
        break;
      }
      case 'yesterday_field_c': {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0);
        setRange(start, end);
        break;
      }
    }
    setSelectedShift(labelMap[shift]);
  };

  const applyCustomDateShift = (shiftType: 'morning' | 'day' | 'night' | 'field_a' | 'field_b' | 'field_c') => {
    if (!customDate) {
      alert('⚠️ Please select a date first!');
      return;
    }
    setActivePreset(''); // Clear active preset
    const date = new Date(customDate);
    const labelMap: Record<string, string> = {
      morning: `${customDate} - Control Room Morning (07:00 AM–03:00 PM)`,
      day: `${customDate} - Control Room Day (03:00 PM–11:00 PM)`,
      night: `${customDate} - Control Room Night (11:00 PM–07:00 AM)`,
      field_a: `${customDate} - Field Shift A (08:00 AM–04:00 PM)`,
      field_b: `${customDate} - Field Shift B (04:00 PM–12:00 AM)`,
      field_c: `${customDate} - Field Shift C (12:00 AM–08:00 AM)`,
    };
    const setRange = (start: Date, end: Date) => {
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(end));
    };
    switch (shiftType) {
      case 'morning': {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 15, 0, 0);
        setRange(start, end);
        break;
      }
      case 'day': {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 15, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 0, 0);
        setRange(start, end);
        break;
      }
      case 'night': {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 0, 0);
        const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        nextDay.setHours(7, 0, 0, 0);
        setRange(start, nextDay);
        break;
      }
      case 'field_a': {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 8, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 16, 0, 0);
        setRange(start, end);
        break;
      }
      case 'field_b': {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 16, 0, 0);
        const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        nextDay.setHours(0, 0, 0, 0);
        setRange(start, nextDay);
        break;
      }
      case 'field_c': {
        const start = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime());
        end.setHours(8, 0, 0, 0);
        setRange(start, end);
        break;
      }
    }
    setSelectedShift(labelMap[shiftType]);
  };

  const applyPreset = (type: 'fromNov2025ToNow' | 'today' | 'last24h' | 'thisMonth' | 'toNow' | 'yesterday') => {
    const now = new Date();
    if (type === 'fromNov2025ToNow') {
      setFromDT('2025-11-01T00:00');
      setToDT(formatDateTimeLocal(now));
      setActivePreset('fromNov2025ToNow');
    } else if (type === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(now));
      setActivePreset('today');
    } else if (type === 'yesterday') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(end));
      setActivePreset('yesterday');
    } else if (type === 'last24h') {
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(now));
      setActivePreset('last24h');
    } else if (type === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      setFromDT(formatDateTimeLocal(start));
      setToDT(formatDateTimeLocal(now));
      setActivePreset('thisMonth');
    } else if (type === 'toNow') {
      setToDT(formatDateTimeLocal(now));
      setActivePreset('toNow');
    }
  };

  const clearAllFilters = () => {
    const todayFilters = getDefaultTodayFilters();
    setSearch(todayFilters.search);
    setDivisionFilter(todayFilters.division);
    setSubDivisionFilter(todayFilters.subDivision);
    setSubStationFilter(todayFilters.subStation);
    setStatusFilter(todayFilters.status);
    setClosedStatusFilter(todayFilters.closedStatus);
    setFromDT(todayFilters.fromDT);
    setToDT(todayFilters.toDT);
    setMonthFilter(todayFilters.monthFilter);
    setSelectedShift('');
    setActivePreset('');
    setCustomDate('');
  };

  const SkeletonBlock = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded ${className}`} style={{ backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
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
      const division = String(r['Division'] || '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] || '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] || '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      ssMap.set(key, (ssMap.get(key) || 0) + 1);
    }
    const topSS = Array.from(ssMap.entries())
      .map(([key, count]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { count, division, subDivision, subStation };
      })
      .sort((a, b) => b.count - a.count);
    const ssBody = topSS.map(r => [r.division, r.subDivision, r.subStation, String(r.count)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Sub Station', 'Total Complaints']],
      body: ssBody,
      theme: 'grid',
      styles: { fontSize: 14, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 15, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' }, 2: { halign: 'left' } } as any,
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

    addHeader('Detailed - FRT vs Control Room');
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
        return { ...stats, division, subDivision, subStation };
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
          addHeader('Detailed - FRT vs Control Room');
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

  const exportDivisionCount = () => {
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

    addHeader('Division-wise Total Complaint Count');
    const divMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Division'] || '').trim() || 'Unknown';
      divMap.set(s, (divMap.get(s) || 0) + 1);
    }
    const divRows = Array.from(divMap.entries()).sort((a, b) => b[1] - a[1]);
    const divBody = divRows.map(([name, count]) => [name, String(count)]);
    const divSum = divRows.reduce((acc, [, c]) => acc + (c as number), 0);
    divBody.push(['Grand Total', String(divSum)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total Complaints']],
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
          addHeader('Division-wise Total Complaint Count');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === divBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('division-count.pdf');
  };

  const exportSubDivisionCount = () => {
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

    addHeader('Sub Division-wise Total Complaint Count');
    const subDivMap = new Map<string, number>();
    for (const r of rows) {
      const division = String(r['Division'] || '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] || '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      subDivMap.set(key, (subDivMap.get(key) || 0) + 1);
    }
    const subDivRows = Array.from(subDivMap.entries())
      .map(([key, count]) => {
        const [division, subDivision] = key.split('|');
        return { count, division, subDivision };
      })
      .sort((a, b) => b.count - a.count);
    const subDivBody = subDivRows.map(r => [r.division, r.subDivision, String(r.count)]);
    const subDivSum = subDivRows.reduce((acc, r) => acc + r.count, 0);
    subDivBody.push(['Grand Total', '', String(subDivSum)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Total Complaints']],
      body: subDivBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Sub Division-wise Total Complaint Count');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === subDivBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('subdivision-count.pdf');
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
      const s = String(r['Complaint Date and Time'] || '').trim();
      const match = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
      let date = 'Unknown';
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        date = `${day}/${month}/${year}`;
      } else {
        // Fallback: try parsing as standard Date if string is like "Dec 7, 2025" or ISO
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          date = `${dd}/${mm}/${yyyy}`;
        }
      }
      dateTotalMap.set(date, (dateTotalMap.get(date) || 0) + 1);
    }
    const dateTotalRows = Array.from(dateTotalMap.entries()).sort((a, b) => {
      const parse = (dStr: string) => {
        const m = dStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        // Return max integer for unknown so they go to the bottom in ascending order? 
        // Or 0? 0 puts them at start. User says 8 before 7, implies 2025-12-08 before 2025-12-07?
        // Wait, 8 < 7 is mathematically false. Ascending is A to Z (Early to Late).
        // 07 Dec < 08 Dec.
        // If user sees 08 before 07, it's Descending.
        // If the user says "problems is 8 before 7", they mean it SHOULD NOT be that way.
        // So they want Ascending.
        // My code does `da - db`.
        // Maybe the user *wants* descending? "8 pehle, 7 baad mein"?
        // No, typically lists are 1, 2, 3...
        // If 8 is before 7, that is Descending.
        // If the user says "problems is 8 before 7", they mean it SHOULD NOT be that way.
        // So they want Ascending.
        // My code does `da - db`.
        // Let's assume standard behavior.
        // If any date failed to parse, it becomes 0.
        // If 7 failed parse, it is 0. 8 is >0. 7 comes before 8.
        // If 8 failed parse, it is 0. 7 is >0. 8 comes before 7.
        // Maybe 8th Failed to parse?
        // 08/12/2025 vs 07/12/2025.
        // Let's force robust parsing here too just in case the key isn't perfectly normalized?
        // But the loop normalizes it.
        return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime() : 0;
      };

      const tA = parse(a[0]);
      const tB = parse(b[0]);
      if (tA === 0 && tB !== 0) return 1; // Unknowns at bottom
      if (tB === 0 && tA !== 0) return -1;
      return tA - tB;
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

  const exportSubDivisionSummary = () => {
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

    addHeader('Sub Division-wise Summary');
    const subDivMap = new Map<string, { division: string; total: number; closed: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      const entry = subDivMap.get(key) || { division, total: 0, closed: 0, pending: 0 };
      entry.total += 1;
      if (isClosedRow(r)) entry.closed += 1;
      subDivMap.set(key, entry);
    }
    for (const [k, v] of subDivMap) {
      v.pending = Math.max(0, v.total - v.closed);
      subDivMap.set(k, v);
    }
    const subDivRows = Array.from(subDivMap.entries())
      .map(([key, v]) => {
        const [, subDivision] = key.split('|');
        return { subDivision, ...v };
      })
      .sort((a, b) => b.total - a.total);
    const grandSubDiv = rows.reduce((acc, r) => {
      acc.total += 1;
      if (isClosedRow(r)) acc.closed += 1;
      return acc;
    }, { total: 0, closed: 0 });
    const grandSubDivPending = Math.max(0, grandSubDiv.total - grandSubDiv.closed);
    const subDivBody = subDivRows.map(r => [r.division, r.subDivision, String(r.total), String(r.closed), String(r.pending)]);
    subDivBody.push(['Grand Total', '', String(grandSubDiv.total), String(grandSubDiv.closed), String(grandSubDivPending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Total', 'Closed', 'Pending']],
      body: subDivBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Sub Division-wise Summary');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === subDivBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('subdivision-summary.pdf');
  };

  const exportSubStationSummary = () => {
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

    addHeader('Sub Station-wise Summary');
    const subStnMap = new Map<string, { division: string; subDivision: string; total: number; closed: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      const entry = subStnMap.get(key) || { division, subDivision, total: 0, closed: 0, pending: 0 };
      entry.total += 1;
      if (isClosedRow(r)) entry.closed += 1;
      subStnMap.set(key, entry);
    }
    for (const [k, v] of subStnMap) {
      v.pending = Math.max(0, v.total - v.closed);
      subStnMap.set(k, v);
    }
    const subStnRows = Array.from(subStnMap.entries())
      .map(([key, v]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { ...v, division, subDivision, subStation };
      })
      .sort((a, b) => b.total - a.total);
    const grandSubStn = rows.reduce((acc, r) => {
      acc.total += 1;
      if (isClosedRow(r)) acc.closed += 1;
      return acc;
    }, { total: 0, closed: 0 });
    const grandSubStnPending = Math.max(0, grandSubStn.total - grandSubStn.closed);
    const subStnBody = subStnRows.map(r => [r.division, r.subDivision, r.subStation, String(r.total), String(r.closed), String(r.pending)]);
    subStnBody.push(['Grand Total', '', '', String(grandSubStn.total), String(grandSubStn.closed), String(grandSubStnPending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed', 'Pending']],
      body: subStnBody,
      theme: 'grid',
      styles: { fontSize: 14, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 15, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' }, 2: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Sub Station-wise Summary');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === subStnBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('substation-summary.pdf');
  };

  const exportClosedStatusDivision = () => {
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

    addHeader('Within/Beyond Status - Division-wise');
    const csMap = new Map<string, { total: number; closedWithin: number; closedBeyond: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = csMap.get(division) || { total: 0, closedWithin: 0, closedBeyond: 0 };
      entry.total += 1;
      if (closedStatus === 'Closed Within') entry.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') entry.closedBeyond += 1;
      csMap.set(division, entry);
    }
    const csRows = Array.from(csMap.entries())
      .map(([div, stats]) => ({ division: div, ...stats }))
      .sort((a, b) => b.total - a.total);
    const csGrand = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      acc.total += 1;
      if (closedStatus === 'Closed Within') acc.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') acc.closedBeyond += 1;
      return acc;
    }, { total: 0, closedWithin: 0, closedBeyond: 0 });
    const csBody = csRows.map(r => [r.division, String(r.total), String(r.closedWithin), String(r.closedBeyond)]);
    csBody.push(['Grand Total', String(csGrand.total), String(csGrand.closedWithin), String(csGrand.closedBeyond)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Total', 'Closed Within', 'Closed Beyond']],
      body: csBody,
      theme: 'grid',
      styles: { fontSize: 16, cellPadding: 12, halign: 'center', minCellHeight: 28 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 17, fontStyle: 'bold', halign: 'center', minCellHeight: 32 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Within/Beyond Status - Division-wise');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === csBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('closed-status-division.pdf');
  };

  const exportClosedStatusSubDivision = () => {
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

    addHeader('Within/Beyond Status - Sub Division-wise');
    const csMap = new Map<string, { total: number; closedWithin: number; closedBeyond: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = csMap.get(key) || { total: 0, closedWithin: 0, closedBeyond: 0 };
      entry.total += 1;
      if (closedStatus === 'Closed Within') entry.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') entry.closedBeyond += 1;
      csMap.set(key, entry);
    }
    const csRows = Array.from(csMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision] = key.split('|');
        return { division, subDivision, ...stats };
      })
      .sort((a, b) => b.total - a.total);
    const csGrand = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      acc.total += 1;
      if (closedStatus === 'Closed Within') acc.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') acc.closedBeyond += 1;
      return acc;
    }, { total: 0, closedWithin: 0, closedBeyond: 0 });
    const csBody = csRows.map(r => [r.division, r.subDivision, String(r.total), String(r.closedWithin), String(r.closedBeyond)]);
    csBody.push(['Grand Total', '', String(csGrand.total), String(csGrand.closedWithin), String(csGrand.closedBeyond)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Total', 'Closed Within', 'Closed Beyond']],
      body: csBody,
      theme: 'grid',
      styles: { fontSize: 15, cellPadding: 11, halign: 'center', minCellHeight: 26 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 16, fontStyle: 'bold', halign: 'center', minCellHeight: 30 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Within/Beyond Status - Sub Division-wise');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === csBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('closed-status-subdivision.pdf');
  };

  const exportClosedStatusSubStation = () => {
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

    addHeader('Within/Beyond Status - Sub Station-wise');
    const csMap = new Map<string, { total: number; closedWithin: number; closedBeyond: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = csMap.get(key) || { total: 0, closedWithin: 0, closedBeyond: 0 };
      entry.total += 1;
      if (closedStatus === 'Closed Within') entry.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') entry.closedBeyond += 1;
      csMap.set(key, entry);
    }
    const csRows = Array.from(csMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { division, subDivision, subStation, ...stats };
      })
      .sort((a, b) => b.total - a.total);
    const csGrand = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      acc.total += 1;
      if (closedStatus === 'Closed Within') acc.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') acc.closedBeyond += 1;
      return acc;
    }, { total: 0, closedWithin: 0, closedBeyond: 0 });
    const csBody = csRows.map(r => [r.division, r.subDivision, r.subStation, String(r.total), String(r.closedWithin), String(r.closedBeyond)]);
    csBody.push(['Grand Total', '', '', String(csGrand.total), String(csGrand.closedWithin), String(csGrand.closedBeyond)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed Within', 'Closed Beyond']],
      body: csBody,
      theme: 'grid',
      styles: { fontSize: 13, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 14, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' }, 2: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Within/Beyond Status - Sub Station-wise');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === csBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('closed-status-substation.pdf');
  };

  const exportAreaTypeBreakdown = () => {
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

    addHeader('Area Type - Within/Beyond Analysis');
    const atMap = new Map<string, { within: number; beyond: number }>();
    for (const r of rows) {
      const areaType = String(r['Area Type'] ?? '').trim() || 'Unknown';
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = atMap.get(areaType) || { within: 0, beyond: 0 };
      if (closedStatus === 'Closed Within') entry.within += 1;
      else if (closedStatus === 'Closed Beyond') entry.beyond += 1;
      atMap.set(areaType, entry);
    }

    const atRows = Array.from(atMap.entries())
      .map(([area, stats]) => ({
        area,
        within: stats.within,
        beyond: stats.beyond,
        total: stats.within + stats.beyond
      }))
      .sort((a, b) => b.total - a.total);

    const atGrand = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      if (closedStatus === 'Closed Within') acc.within += 1;
      else if (closedStatus === 'Closed Beyond') acc.beyond += 1;
      return acc;
    }, { within: 0, beyond: 0 });

    const atBody = atRows.map(r => [
      r.area,
      String(r.within),
      String(r.beyond),
      String(r.total)
    ]);
    atBody.push([
      'Grand Total',
      String(atGrand.within),
      String(atGrand.beyond),
      String(atGrand.within + atGrand.beyond)
    ]);

    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Area Type', 'Closed Within', 'Closed Beyond', 'Total']],
      body: atBody,
      theme: 'grid',
      styles: { fontSize: 14, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 15, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Area Type - Within/Beyond Analysis');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === atBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('area-type-breakdown.pdf');
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

  const exportSubDivisionClosedBreakdown = () => {
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

    addHeader('Sub Division - FRT vs Control Room');
    const subDivBreakdownMap = new Map<string, { division: string; total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = subDivBreakdownMap.get(key) || { division, total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      subDivBreakdownMap.set(key, entry);
    }
    for (const [k, v] of subDivBreakdownMap) {
      v.pending = Math.max(0, v.total - v.closed);
      subDivBreakdownMap.set(k, v);
    }
    const subDivBreakRows = Array.from(subDivBreakdownMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision] = key.split('|');
        return { ...stats, division, subDivision };
      })
      .sort((a, b) => b.total - a.total);
    const grandSubDivBreak = rows.reduce((acc, r) => {
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
    grandSubDivBreak.pending = Math.max(0, grandSubDivBreak.total - grandSubDivBreak.closed);
    const subDivBreakBody = subDivBreakRows.map(r => [r.division, r.subDivision, String(r.total), String(r.closed), String(r.controlRoom), String(r.frt), String(r.pending)]);
    subDivBreakBody.push(['Grand Total', '', String(grandSubDivBreak.total), String(grandSubDivBreak.closed), String(grandSubDivBreak.controlRoom), String(grandSubDivBreak.frt), String(grandSubDivBreak.pending)]);
    autoTable(doc, {
      startY: selectedShift ? 130 : 115,
      head: [['Division', 'Sub Division', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']],
      body: subDivBreakBody,
      theme: 'grid',
      styles: { fontSize: 14, cellPadding: 10, halign: 'center', minCellHeight: 24 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 15, fontStyle: 'bold', halign: 'center', minCellHeight: 28 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } } as any,
      margin: { top: selectedShift ? 130 : 115, left: 40, right: 40 },
      tableWidth: 'auto',
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) {
          addHeader('Sub Division - FRT vs Control Room');
        }
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === subDivBreakBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 252, 231];
        }
      },
    });

    doc.save('subdivision-closed-breakdown.pdf');
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

    addHeader('Date-wise - FRT vs Control Room');
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
          addHeader('Date-wise - FRT vs Control Room');
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

    addHeader('Division - FRT vs Control Room');
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
          addHeader('Division - FRT vs Control Room');
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
    addHeader('Division - FRT vs Control Room');
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
          addHeader('Division - FRT vs Control Room');
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
    addHeader('Date-wise - FRT vs Control Room');
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
          addHeader('Date-wise - FRT vs Control Room');
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
    addHeader('Detailed - FRT vs Control Room');
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
        return { ...stats, division, subDivision, subStation };
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
          addHeader('Detailed - FRT vs Control Room');
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
      const s = String(r['Complaint Date and Time'] || '').trim();
      const match = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
      let key = 'Unknown';
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        key = `${day}/${month}/${year}`;
      }
      if (key !== 'Unknown') {
        controlRoomMap.set(key, (controlRoomMap.get(key) || 0) + 1);
      }
    }

    // Group FRT by date
    const frtMap = new Map<string, number>();
    for (const r of frtClosed) {
      const s = String(r['Complaint Date and Time'] || '').trim();
      const match = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
      let key = 'Unknown';
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        key = `${day}/${month}/${year}`;
      }
      if (key !== 'Unknown') {
        frtMap.set(key, (frtMap.get(key) || 0) + 1);
      }
    }

    // Get all unique dates
    const allDates = new Set([...controlRoomMap.keys(), ...frtMap.keys()]);
    const sortedDates = Array.from(allDates).sort((a, b) => {
      const parse = (dStr: string) => {
        const m = dStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime() : 0;
      };

      const tA = parse(a);
      const tB = parse(b);
      // Ensure Unknowns or failures go to end or handled consistently
      if (tA === 0 && tB !== 0) return 1;
      if (tB === 0 && tA !== 0) return -1;
      return tA - tB;
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

    // Warning for large exports
    if (rows.length > 5000) {
      const confirm = window.confirm(`⚠️ You are exporting ${rows.length} rows. This may take some time. Continue?`);
      if (!confirm) return;
    }

    // Dynamic import - load only when needed
    const { ExcelJS, saveAs } = await loadExcelJS();
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
    // Fix periodText definition
    const periodParts: string[] = [];
    if (fromDT) periodParts.push(`From: ${new Date(fromDT).toLocaleString()}`);
    if (toDT) periodParts.push(`To: ${new Date(toDT).toLocaleString()}`);
    const periodText = periodParts.length ? periodParts.join(' - ') : 'All Time';

    const statusApplied = statusFilter ? statusFilter : 'All';
    const closedStatusApplied = closedStatusFilter ? closedStatusFilter : 'All';
    const uniqueDivisions = Array.from(new Set(rows.map(r => String((r as any)['Division'] || '').trim()).filter(Boolean))).sort();
    const uniqueStatuses = Array.from(new Set(rows.map(r => String((r as any)['Status'] || '').trim()).filter(Boolean))).sort();
    const uniqueClosedStatuses = Array.from(new Set(rows.map(r => String((r as any)['Closed Status'] || '').trim()).filter(Boolean))).sort();
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
    wsCover.addRow([]);
    wsCover.addRow([]);
    wsCover.addRow(['Quick Navigation']);
    wsCover.getRow(wsCover.lastRow.number).font = { bold: true, size: 12, color: { argb: theme.info } };
    const navLinks = [
      { text: '📊 All Complaints - Complete Data', sheet: '2. All Complaints Data' },
      { text: '📋 Division-wise Summary', sheet: '3. Division Summary' },
      { text: '📅 Date-wise Total Complaint Count', sheet: '4. Date-wise Total Count' },
      { text: '🔍 Complaint Status Breakdown', sheet: '5. Status Breakdown' },
      { text: '🎯 Division - FRT vs Control Room', sheet: '6. Division Closed Breakdown' },
      { text: '📊 Detailed - FRT vs Control Room', sheet: '7. Detailed Closed Breakdown' },
      { text: '📅 Date-wise - FRT vs Control Room', sheet: '8. Date-wise Closed Breakdown' },
      { text: '🏢 Sub Station-wise Total Complaint Count', sheet: '9. Sub Station Wise Count' },
      { text: '📋 Sub Division-wise Summary', sheet: '10. Sub Division Summary' },
      { text: '🏢 Sub Station-wise Summary', sheet: '11. Sub Station Summary' },
      { text: '🎯 Sub Division - FRT vs Control Room', sheet: '12. Sub Div Closed Breakdown' },
      { text: '📊 Division-wise Total Complaint Count', sheet: '13. Division Count' },
      { text: '📊 Sub Division-wise Total Complaint Count', sheet: '14. Sub Division Count' },
      { text: '✅ Within/Beyond Status - Division-wise', sheet: '15. Closed Status Division' },
      { text: '✅ Within/Beyond Status - Sub Division-wise', sheet: '16. Closed Status Sub Div' },
      { text: '✅ Within/Beyond Status - Sub Station-wise', sheet: '17. Closed Status Sub Stn' },
      { text: '🗺️ Area Type - Within/Beyond Analysis', sheet: '18. Area Type Breakdown' },
      { text: '⏱️ Average Resolution Time (Minutes) by Area Type', sheet: '19. Avg Res Time Area Type' },
    ];
    navLinks.forEach(link => {
      const row = wsCover.addRow([link.text]);
      const cell = row.getCell(1);
      cell.value = { text: link.text, hyperlink: `#'${link.sheet}'!A1` };
      cell.font = { color: { argb: 'FF0563C1' }, underline: true };
      cell.alignment = { vertical: 'middle' };
    });
    wsCover.getColumn(1).width = 42;
    wsCover.getColumn(2).width = 80;


    // Sheet 1: Bulk Data
    const wsData = wb.addWorksheet('2. All Complaints Data', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsData, 'All Complaints - Complete Data', `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}   |   ${periodSubtitle}`);

    const baseHeaders = Object.keys(rows[0]);
    const headers = (() => {
      const arr = [...baseHeaders];
      const idx = arr.indexOf('Closed Date');
      if (idx >= 0) arr.splice(idx + 1, 0, 'Resolution Time', 'Resolution Time (Minutes)');
      else arr.push('Resolution Time', 'Resolution Time (Minutes)');
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
        if (h === 'Resolution Time (Minutes)') return computeResolutionTimeMinutes(r);
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
        if (isClosed) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // light green
          statusCell.font = { bold: true, color: { argb: 'FF065F46' } }; // dark green text
        } else if (statusStr.includes('pending')) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } }; // light red
          statusCell.font = { bold: true, color: { argb: 'FF991B1B' } }; // dark red text
        } else {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // light amber
          statusCell.font = { bold: true, color: { argb: 'FF92400E' } }; // dark amber text
        }
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
      'Resolution Time (Minutes)': 22,
    };
    headers.forEach((h, i) => {
      const column = wsData.getColumn(i + 1);
      column.width = widthMap[h] || 18;
      // wrap remarks
      if (h === 'Closing Remarks') {
        column.alignment = { wrapText: true, vertical: 'top' };
      }
      if (h === 'Resolution Time (Minutes)') {
        column.numFmt = '0';
        column.alignment = { vertical: 'middle', horizontal: 'center' };
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
        return { ...stats, division, subDivision, subStation };
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
      const division = String(r['Division'] || '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] || '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] || '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      ssMap.set(key, (ssMap.get(key) || 0) + 1);
    }
    const topSS = Array.from(ssMap.entries())
      .map(([key, count]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { count, division, subDivision, subStation };
      })
      .sort((a, b) => b.count - a.count);
    wsTopSS.addRow(['Division', 'Sub Division', 'Sub Station', 'Total Complaints']);
    styleHeaderRow(wsTopSS, 3);
    topSS.forEach(r => wsTopSS.addRow([r.division, r.subDivision, r.subStation, r.count]));
    wsTopSS.getColumn(1).width = 24;
    wsTopSS.getColumn(2).width = 24;
    wsTopSS.getColumn(3).width = 28;
    wsTopSS.getColumn(4).width = 18;
    const ssEnd = wsTopSS.lastRow.number;
    for (let r = 3; r <= ssEnd; r++) {
      wsTopSS.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 3 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsTopSS, 4, ssEnd);

    // Sheet 9: Sub Division Summary
    const wsSubDivSummary = wb.addWorksheet('10. Sub Division Summary', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsSubDivSummary, 'Sub Division-wise Summary', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const subDivMap = new Map<string, { division: string; total: number; closed: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      const entry = subDivMap.get(key) || { division, total: 0, closed: 0, pending: 0 };
      entry.total += 1;
      if (isClosedRow(r)) entry.closed += 1;
      subDivMap.set(key, entry);
    }
    for (const [k, v] of subDivMap) {
      v.pending = Math.max(0, v.total - v.closed);
      subDivMap.set(k, v);
    }
    const subDivRows = Array.from(subDivMap.entries())
      .map(([key, v]) => {
        const [, subDivision] = key.split('|');
        return { subDivision, ...v };
      })
      .sort((a, b) => b.total - a.total);
    const grandSubDiv = rows.reduce((acc, r) => {
      acc.total += 1;
      if (isClosedRow(r)) acc.closed += 1;
      return acc;
    }, { total: 0, closed: 0 });
    const grandSubDivPending = Math.max(0, grandSubDiv.total - grandSubDiv.closed);
    wsSubDivSummary.addRow(['Division', 'Sub Division', 'Total', 'Closed', 'Pending']);
    styleHeaderRow(wsSubDivSummary, 3);
    subDivRows.forEach(r => wsSubDivSummary.addRow([r.division, r.subDivision, r.total, r.closed, r.pending]));
    wsSubDivSummary.addRow(['Grand Total', '', grandSubDiv.total, grandSubDiv.closed, grandSubDivPending]);
    wsSubDivSummary.getColumn(1).width = 24;
    wsSubDivSummary.getColumn(2).width = 24;
    wsSubDivSummary.getColumn(3).width = 14;
    wsSubDivSummary.getColumn(4).width = 14;
    wsSubDivSummary.getColumn(5).width = 14;
    const subDivSumEnd = wsSubDivSummary.lastRow.number;
    for (let r = 3; r <= subDivSumEnd; r++) {
      wsSubDivSummary.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 2 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsSubDivSummary, 4, subDivSumEnd);
    const subDivGt = wsSubDivSummary.getRow(subDivSumEnd);
    subDivGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 10: Sub Station Summary
    const wsSubStnSummary = wb.addWorksheet('11. Sub Station Summary', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsSubStnSummary, 'Sub Station-wise Summary', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const subStnMap = new Map<string, { division: string; subDivision: string; total: number; closed: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      const entry = subStnMap.get(key) || { division, subDivision, total: 0, closed: 0, pending: 0 };
      entry.total += 1;
      if (isClosedRow(r)) entry.closed += 1;
      subStnMap.set(key, entry);
    }
    for (const [k, v] of subStnMap) {
      v.pending = Math.max(0, v.total - v.closed);
      subStnMap.set(k, v);
    }
    const subStnRows = Array.from(subStnMap.entries())
      .map(([key, v]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { ...v, division, subDivision, subStation };
      })
      .sort((a, b) => b.total - a.total);
    const grandSubStn = rows.reduce((acc, r) => {
      acc.total += 1;
      if (isClosedRow(r)) acc.closed += 1;
      return acc;
    }, { total: 0, closed: 0 });
    const grandSubStnPending = Math.max(0, grandSubStn.total - grandSubStn.closed);
    wsSubStnSummary.addRow(['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed', 'Pending']);
    styleHeaderRow(wsSubStnSummary, 3);
    subStnRows.forEach(r => wsSubStnSummary.addRow([r.division, r.subDivision, r.subStation, r.total, r.closed, r.pending]));
    wsSubStnSummary.addRow(['Grand Total', '', '', grandSubStn.total, grandSubStn.closed, grandSubStnPending]);
    wsSubStnSummary.getColumn(1).width = 24;
    wsSubStnSummary.getColumn(2).width = 24;
    wsSubStnSummary.getColumn(3).width = 28;
    wsSubStnSummary.getColumn(4).width = 12;
    wsSubStnSummary.getColumn(5).width = 12;
    wsSubStnSummary.getColumn(6).width = 12;
    const subStnSumEnd = wsSubStnSummary.lastRow.number;
    for (let r = 3; r <= subStnSumEnd; r++) {
      wsSubStnSummary.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 3 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsSubStnSummary, 4, subStnSumEnd);
    const subStnGt = wsSubStnSummary.getRow(subStnSumEnd);
    subStnGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 11: Sub Division Closed Breakdown
    const wsSubDivBreak = wb.addWorksheet('12. Sub Div Closed Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsSubDivBreak, 'Sub Division - FRT vs Control Room', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const subDivBreakdownMap = new Map<string, { division: string; total: number; closed: number; controlRoom: number; frt: number; pending: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isClosed = isClosedRow(r);
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      const entry = subDivBreakdownMap.get(key) || { division, total: 0, closed: 0, controlRoom: 0, frt: 0, pending: 0 };
      entry.total += 1;
      if (isClosed) {
        entry.closed += 1;
        if (isControlRoom) entry.controlRoom += 1;
        else entry.frt += 1;
      }
      subDivBreakdownMap.set(key, entry);
    }
    for (const [k, v] of subDivBreakdownMap) {
      v.pending = Math.max(0, v.total - v.closed);
      subDivBreakdownMap.set(k, v);
    }
    const subDivBreakRows = Array.from(subDivBreakdownMap.entries())
      .map(([key, stats]) => {
        const [division, subDivision] = key.split('|');
        return { ...stats, division, subDivision };
      })
      .sort((a, b) => b.total - a.total);
    const grandSubDivBreak = rows.reduce((acc, r) => {
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
    grandSubDivBreak.pending = Math.max(0, grandSubDivBreak.total - grandSubDivBreak.closed);
    wsSubDivBreak.addRow(['Division', 'Sub Division', 'Total', 'Closed', 'Control Room', 'FRT', 'Pending']);
    styleHeaderRow(wsSubDivBreak, 3);
    subDivBreakRows.forEach(r => wsSubDivBreak.addRow([r.division, r.subDivision, r.total, r.closed, r.controlRoom, r.frt, r.pending]));
    wsSubDivBreak.addRow(['Grand Total', '', grandSubDivBreak.total, grandSubDivBreak.closed, grandSubDivBreak.controlRoom, grandSubDivBreak.frt, grandSubDivBreak.pending]);
    wsSubDivBreak.getColumn(1).width = 24;
    wsSubDivBreak.getColumn(2).width = 24;
    wsSubDivBreak.getColumn(3).width = 12;
    wsSubDivBreak.getColumn(4).width = 12;
    wsSubDivBreak.getColumn(5).width = 16;
    wsSubDivBreak.getColumn(6).width = 12;
    wsSubDivBreak.getColumn(7).width = 12;
    const subDivBreakEnd = wsSubDivBreak.lastRow.number;
    for (let r = 3; r <= subDivBreakEnd; r++) {
      wsSubDivBreak.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 2 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsSubDivBreak, 4, subDivBreakEnd);
    const subDivBreakGt = wsSubDivBreak.getRow(subDivBreakEnd);
    subDivBreakGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 12: Division Count
    const wsDivCount = wb.addWorksheet('13. Division Count', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsDivCount, 'Division-wise Total Complaint Count', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const divCountMap = new Map<string, number>();
    for (const r of rows) {
      const s = String(r['Division'] || '').trim() || 'Unknown';
      divCountMap.set(s, (divCountMap.get(s) || 0) + 1);
    }
    const divCountRows = Array.from(divCountMap.entries()).sort((a, b) => b[1] - a[1]);
    wsDivCount.addRow(['Division', 'Total Complaints']);
    styleHeaderRow(wsDivCount, 3);
    divCountRows.forEach(([name, count]) => wsDivCount.addRow([name, count]));
    const divCountSum = divCountRows.reduce((acc, [, c]) => acc + (c as number), 0);
    wsDivCount.addRow(['Grand Total', divCountSum]);
    wsDivCount.getColumn(1).width = 36;
    wsDivCount.getColumn(2).width = 20;
    const divCountEnd = wsDivCount.lastRow.number;
    for (let r = 3; r <= divCountEnd; r++) {
      wsDivCount.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsDivCount, 4, divCountEnd);
    const divCountGt = wsDivCount.getRow(divCountEnd);
    divCountGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 13: Sub Division Count
    const wsSubDivCount = wb.addWorksheet('14. Sub Division Count', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsSubDivCount, 'Sub Division-wise Total Complaint Count', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const subDivCountMap = new Map<string, number>();
    for (const r of rows) {
      const division = String(r['Division'] || '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] || '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      subDivCountMap.set(key, (subDivCountMap.get(key) || 0) + 1);
    }
    const subDivCountRows = Array.from(subDivCountMap.entries())
      .map(([key, count]) => {
        const [division, subDivision] = key.split('|');
        return { count, division, subDivision };
      })
      .sort((a, b) => b.count - a.count);
    wsSubDivCount.addRow(['Division', 'Sub Division', 'Total Complaints']);
    styleHeaderRow(wsSubDivCount, 3);
    subDivCountRows.forEach(r => wsSubDivCount.addRow([r.division, r.subDivision, r.count]));
    const subDivCountSum = subDivCountRows.reduce((acc, r) => acc + r.count, 0);
    wsSubDivCount.addRow(['Grand Total', '', subDivCountSum]);
    wsSubDivCount.getColumn(1).width = 24;
    wsSubDivCount.getColumn(2).width = 24;
    wsSubDivCount.getColumn(3).width = 20;
    const subDivCountEnd = wsSubDivCount.lastRow.number;
    for (let r = 3; r <= subDivCountEnd; r++) {
      wsSubDivCount.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 2 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsSubDivCount, 4, subDivCountEnd);
    const subDivCountGt = wsSubDivCount.getRow(subDivCountEnd);
    subDivCountGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 14: Closed Status Division
    const wsClosedStatusDiv = wb.addWorksheet('15. Closed Status Division', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsClosedStatusDiv, 'Within/Beyond Status - Division-wise', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const csMapDiv = new Map<string, { total: number; closedWithin: number; closedBeyond: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = csMapDiv.get(division) || { total: 0, closedWithin: 0, closedBeyond: 0 };
      entry.total += 1;
      if (closedStatus === 'Closed Within') entry.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') entry.closedBeyond += 1;
      csMapDiv.set(division, entry);
    }
    const csRowsDiv = Array.from(csMapDiv.entries())
      .map(([div, stats]) => ({ division: div, ...stats }))
      .sort((a, b) => b.total - a.total);
    const csGrandDiv = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      acc.total += 1;
      if (closedStatus === 'Closed Within') acc.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') acc.closedBeyond += 1;
      return acc;
    }, { total: 0, closedWithin: 0, closedBeyond: 0 });
    wsClosedStatusDiv.addRow(['Division', 'Total', 'Closed Within', 'Closed Beyond']);
    styleHeaderRow(wsClosedStatusDiv, 3);
    csRowsDiv.forEach(r => wsClosedStatusDiv.addRow([r.division, r.total, r.closedWithin, r.closedBeyond]));
    wsClosedStatusDiv.addRow(['Grand Total', csGrandDiv.total, csGrandDiv.closedWithin, csGrandDiv.closedBeyond]);
    wsClosedStatusDiv.getColumn(1).width = 36;
    wsClosedStatusDiv.getColumn(2).width = 14;
    wsClosedStatusDiv.getColumn(3).width = 18;
    wsClosedStatusDiv.getColumn(4).width = 18;
    const csEndDiv = wsClosedStatusDiv.lastRow.number;
    for (let r = 3; r <= csEndDiv; r++) {
      wsClosedStatusDiv.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsClosedStatusDiv, 4, csEndDiv);
    const csDivGt = wsClosedStatusDiv.getRow(csEndDiv);
    csDivGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 15: Closed Status Sub Division
    const wsClosedStatusSubDiv = wb.addWorksheet('16. Closed Status Sub Div', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsClosedStatusSubDiv, 'Within/Beyond Status - Sub Division-wise', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const csMapSubDiv = new Map<string, { total: number; closedWithin: number; closedBeyond: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}`;
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = csMapSubDiv.get(key) || { total: 0, closedWithin: 0, closedBeyond: 0 };
      entry.total += 1;
      if (closedStatus === 'Closed Within') entry.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') entry.closedBeyond += 1;
      csMapSubDiv.set(key, entry);
    }
    const csRowsSubDiv = Array.from(csMapSubDiv.entries())
      .map(([key, stats]) => {
        const [division, subDivision] = key.split('|');
        return { division, subDivision, ...stats };
      })
      .sort((a, b) => b.total - a.total);
    const csGrandSubDiv = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      acc.total += 1;
      if (closedStatus === 'Closed Within') acc.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') acc.closedBeyond += 1;
      return acc;
    }, { total: 0, closedWithin: 0, closedBeyond: 0 });
    wsClosedStatusSubDiv.addRow(['Division', 'Sub Division', 'Total', 'Closed Within', 'Closed Beyond']);
    styleHeaderRow(wsClosedStatusSubDiv, 3);
    csRowsSubDiv.forEach(r => wsClosedStatusSubDiv.addRow([r.division, r.subDivision, r.total, r.closedWithin, r.closedBeyond]));
    wsClosedStatusSubDiv.addRow(['Grand Total', '', csGrandSubDiv.total, csGrandSubDiv.closedWithin, csGrandSubDiv.closedBeyond]);
    wsClosedStatusSubDiv.getColumn(1).width = 24;
    wsClosedStatusSubDiv.getColumn(2).width = 24;
    wsClosedStatusSubDiv.getColumn(3).width = 14;
    wsClosedStatusSubDiv.getColumn(4).width = 18;
    wsClosedStatusSubDiv.getColumn(5).width = 18;
    const csEndSubDiv = wsClosedStatusSubDiv.lastRow.number;
    for (let r = 3; r <= csEndSubDiv; r++) {
      wsClosedStatusSubDiv.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 2 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsClosedStatusSubDiv, 4, csEndSubDiv);
    const csSubDivGt = wsClosedStatusSubDiv.getRow(csEndSubDiv);
    csSubDivGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 16: Closed Status Sub Station
    const wsClosedStatusSubStn = wb.addWorksheet('17. Closed Status Sub Stn', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsClosedStatusSubStn, 'Within/Beyond Status - Sub Station-wise', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const csMapSubStn = new Map<string, { total: number; closedWithin: number; closedBeyond: number }>();
    for (const r of rows) {
      const division = String(r['Division'] ?? '').trim() || 'Unknown';
      const subDivision = String(r['Sub Division'] ?? '').trim() || 'Unknown';
      const subStation = String(r['Sub Station'] ?? '').trim() || 'Unknown';
      const key = `${division}|${subDivision}|${subStation}`;
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = csMapSubStn.get(key) || { total: 0, closedWithin: 0, closedBeyond: 0 };
      entry.total += 1;
      if (closedStatus === 'Closed Within') entry.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') entry.closedBeyond += 1;
      csMapSubStn.set(key, entry);
    }
    const csRowsSubStn = Array.from(csMapSubStn.entries())
      .map(([key, stats]) => {
        const [division, subDivision, subStation] = key.split('|');
        return { division, subDivision, subStation, ...stats };
      })
      .sort((a, b) => b.total - a.total);
    const csGrandSubStn = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      acc.total += 1;
      if (closedStatus === 'Closed Within') acc.closedWithin += 1;
      else if (closedStatus === 'Closed Beyond') acc.closedBeyond += 1;
      return acc;
    }, { total: 0, closedWithin: 0, closedBeyond: 0 });
    wsClosedStatusSubStn.addRow(['Division', 'Sub Division', 'Sub Station', 'Total', 'Closed Within', 'Closed Beyond']);
    styleHeaderRow(wsClosedStatusSubStn, 3);
    csRowsSubStn.forEach(r => wsClosedStatusSubStn.addRow([r.division, r.subDivision, r.subStation, r.total, r.closedWithin, r.closedBeyond]));
    wsClosedStatusSubStn.addRow(['Grand Total', '', '', csGrandSubStn.total, csGrandSubStn.closedWithin, csGrandSubStn.closedBeyond]);
    wsClosedStatusSubStn.getColumn(1).width = 24;
    wsClosedStatusSubStn.getColumn(2).width = 24;
    wsClosedStatusSubStn.getColumn(3).width = 28;
    wsClosedStatusSubStn.getColumn(4).width = 12;
    wsClosedStatusSubStn.getColumn(5).width = 16;
    wsClosedStatusSubStn.getColumn(6).width = 16;
    const csEndSubStn = wsClosedStatusSubStn.lastRow.number;
    for (let r = 3; r <= csEndSubStn; r++) {
      wsClosedStatusSubStn.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col <= 3 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsClosedStatusSubStn, 4, csEndSubStn);
    const csSubStnGt = wsClosedStatusSubStn.getRow(csEndSubStn);
    csSubStnGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 18: Area Type Breakdown
    const wsAreaType = wb.addWorksheet('18. Area Type Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
    addTitle(wsAreaType, 'Area Type - Within/Beyond Analysis', `Total Complaints: ${rows.length}   |   ${periodSubtitle}`);
    const atMap = new Map<string, { within: number; beyond: number }>();
    for (const r of rows) {
      const areaType = String(r['Area Type'] ?? '').trim() || 'Unknown';
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      const entry = atMap.get(areaType) || { within: 0, beyond: 0 };
      if (closedStatus === 'Closed Within') entry.within += 1;
      else if (closedStatus === 'Closed Beyond') entry.beyond += 1;
      atMap.set(areaType, entry);
    }
    const atRows = Array.from(atMap.entries())
      .map(([area, stats]) => ({
        area,
        within: stats.within,
        beyond: stats.beyond,
        total: stats.within + stats.beyond
      }))
      .sort((a, b) => b.total - a.total);
    const atGrand = rows.reduce((acc, r) => {
      const closedStatus = String(r['Closed Status'] ?? '').trim();
      if (closedStatus === 'Closed Within') acc.within += 1;
      else if (closedStatus === 'Closed Beyond') acc.beyond += 1;
      return acc;
    }, { within: 0, beyond: 0 });
    wsAreaType.addRow(['Area Type', 'Closed Within', 'Closed Beyond', 'Total']);
    styleHeaderRow(wsAreaType, 3);
    atRows.forEach(r => wsAreaType.addRow([r.area, r.within, r.beyond, r.total]));
    wsAreaType.addRow(['Grand Total', atGrand.within, atGrand.beyond, atGrand.within + atGrand.beyond]);
    wsAreaType.getColumn(1).width = 36;
    wsAreaType.getColumn(2).width = 18;
    wsAreaType.getColumn(3).width = 18;
    wsAreaType.getColumn(4).width = 14;
    const atEnd = wsAreaType.lastRow.number;
    for (let r = 3; r <= atEnd; r++) {
      wsAreaType.getRow(r).eachCell((cell: any) => {
        cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
        cell.alignment = { vertical: 'middle', horizontal: r === 3 ? 'center' : (cell.col === 1 ? 'left' : 'center') };
      });
    }
    setAlternatingRows(wsAreaType, 4, atEnd);
    const atGt = wsAreaType.getRow(atEnd);
    atGt.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: theme.titleColor } };
    });

    // Sheet 19: Average Resolution Time by Area Type
    const wsAreaTypeAvg = wb.addWorksheet('19. Avg Res Time Area Type', { views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }] });
    const areaTypeResolutionRows: Array<{ monthKey: string; monthLabel: string; areaType: string; minutes: number }> = [];
    const areaTypesSet = new Set<string>();
    for (const r of rows) {
      const minutes = computeResolutionTimeMinutes(r);
      const open = parsePossibleDate(String(r['Complaint Date and Time'] || r['Complaint Date'] || ''));
      if (minutes === null || !open) continue;
      const areaType = String(r['Area Type'] ?? '').trim() || 'Unknown';
      const monthKey = `${open.getFullYear()}-${String(open.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = `${open.toLocaleString('en-US', { month: 'short' })}-${open.getFullYear()}`;
      areaTypeResolutionRows.push({ monthKey, monthLabel, areaType, minutes });
      areaTypesSet.add(areaType);
    }

    addTitle(
      wsAreaTypeAvg,
      'Average Resolution Time (Minutes) by Area Type',
      `Closed complaints with valid resolution time: ${areaTypeResolutionRows.length}   |   ${periodSubtitle}`
    );

    const areaTypes = Array.from(areaTypesSet).sort((a, b) => {
      if (a === 'Unknown' && b !== 'Unknown') return 1;
      if (b === 'Unknown' && a !== 'Unknown') return -1;
      return a.localeCompare(b);
    });

    if (areaTypes.length === 0) {
      wsAreaTypeAvg.getCell('A3').value = 'No complaints with valid resolution time were found for the selected filters.';
      wsAreaTypeAvg.getCell('A3').font = { italic: true, color: { argb: theme.metaColor } };
      wsAreaTypeAvg.getColumn(1).width = 80;
    } else {
      const monthAreaStats = new Map<string, { label: string; areaStats: Map<string, { total: number; count: number }> }>();
      for (const entry of areaTypeResolutionRows) {
        const monthEntry = monthAreaStats.get(entry.monthKey) || { label: entry.monthLabel, areaStats: new Map<string, { total: number; count: number }>() };
        const stats = monthEntry.areaStats.get(entry.areaType) || { total: 0, count: 0 };
        stats.total += entry.minutes;
        stats.count += 1;
        monthEntry.areaStats.set(entry.areaType, stats);
        monthAreaStats.set(entry.monthKey, monthEntry);
      }

      wsAreaTypeAvg.getCell(3, 1).value = 'Month';
      wsAreaTypeAvg.getCell(3, 2).value = 'AREA TYPE';
      wsAreaTypeAvg.mergeCells(3, 1, 4, 1);
      if (areaTypes.length > 1) {
        wsAreaTypeAvg.mergeCells(3, 2, 3, areaTypes.length + 1);
      }
      areaTypes.forEach((areaType, index) => {
        wsAreaTypeAvg.getCell(4, index + 2).value = `${areaType} (Min)`;
      });

      const avgHeaderLastCol = areaTypes.length + 1;
      for (let rowNum = 3; rowNum <= 4; rowNum++) {
        for (let colNum = 1; colNum <= avgHeaderLastCol; colNum++) {
          const cell = wsAreaTypeAvg.getCell(rowNum, colNum);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
          cell.font = { bold: true, color: { argb: theme.titleColor }, size: rowNum === 3 ? 13 : 11 };
          cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        }
      }
      wsAreaTypeAvg.getRow(3).height = 24;
      wsAreaTypeAvg.getRow(4).height = 22;

      const monthRows = Array.from(monthAreaStats.entries()).sort((a, b) => b[0].localeCompare(a[0]));
      monthRows.forEach(([, monthEntry]) => {
        const rowValues: Array<string | number | null> = [monthEntry.label];
        areaTypes.forEach(areaType => {
          const stats = monthEntry.areaStats.get(areaType);
          rowValues.push(stats ? Number((stats.total / stats.count).toFixed(2)) : null);
        });
        wsAreaTypeAvg.addRow(rowValues);
      });

      wsAreaTypeAvg.getColumn(1).width = 18;
      areaTypes.forEach((_, index) => {
        const column = wsAreaTypeAvg.getColumn(index + 2);
        column.width = 16;
        column.numFmt = '0.00';
      });

      const avgBodyStart = 5;
      const avgBodyEnd = wsAreaTypeAvg.lastRow.number;
      for (let r = 3; r <= avgBodyEnd; r++) {
        wsAreaTypeAvg.getRow(r).eachCell((cell: any) => {
          cell.border = { top: theme.border, left: theme.border, bottom: theme.border, right: theme.border };
          if (r >= avgBodyStart) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          }
        });
      }
      setAlternatingRows(wsAreaTypeAvg, avgBodyStart, avgBodyEnd);
    }

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

  const exportReviewExcel = async () => {
    const getReviewDateTime = (row: Record<string, unknown>) => {
      const dateStr = String(row['Complaint Date and Time'] || row['Complaint Date'] || '');
      const parsed = parsePossibleDate(dateStr);
      if (parsed) return parsed.getTime();

      const fallback = new Date(dateStr);
      const time = fallback.getTime();
      return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
    };
    const rows = [...filtered].sort((a, b) => getReviewDateTime(a) - getReviewDateTime(b));
    if (rows.length === 0) return;

    if (rows.length > 5000) {
      const confirmExport = window.confirm(`You are exporting ${rows.length} rows. This may take some time. Continue?`);
      if (!confirmExport) return;
    }

    const formatReviewDateTime = (dateStr: string) => {
      if (!dateStr) return '';

      const parsed = parsePossibleDate(dateStr);
      if (parsed) {
        const day = String(parsed.getDate()).padStart(2, '0');
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const hours24 = parsed.getHours();
        const minutes = String(parsed.getMinutes()).padStart(2, '0');
        const period = hours24 >= 12 ? 'PM' : 'AM';
        const hours12 = hours24 % 12 || 12;
        return `${day}/${month}/${parsed.getFullYear()} ${hours12}:${minutes} ${period}`;
      }

      const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

      const dateMatch = dateStr.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
      if (dateMatch) {
        return `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3]}`;
      }

      return dateStr;
    };

    const { ExcelJS, saveAs } = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FRT Report Dashboard';
    wb.created = new Date();
    wb.modified = new Date();
    wb.properties = {
      title: 'Excel For Review',
      subject: 'Review export',
      category: 'Report',
      description: 'Filtered complaint data prepared for review',
      lastModifiedBy: 'FRT Report Dashboard',
    };

    const ws = wb.addWorksheet('Excel For Review', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
    type ExcelCell = { fill?: unknown; font?: unknown; alignment?: unknown; border?: unknown };
    const headers = ['Date', 'Division', 'Substation', 'Complaint No', 'Consumer Name', 'Consumer Mobile'];
    const headerRow = ws.addRow(headers);
    headerRow.height = 26;
    headerRow.eachCell((cell: ExcelCell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4DDCE' } };
      cell.font = { bold: true, size: 13, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });

    rows.forEach((row) => {
      ws.addRow([
        formatReviewDateTime(String(row['Complaint Date and Time'] || row['Complaint Date'] || '')),
        String(row['Division'] ?? ''),
        String(row['Sub Station'] ?? row['Substation'] ?? ''),
        String(row['Complaint Number'] ?? row['Complaint No'] ?? ''),
        String(row['Consumer Name'] ?? ''),
        String(row['Consumer Mobile'] ?? ''),
      ]);
    });

    [22, 22, 24, 22, 30, 18].forEach((width, index) => {
      ws.getColumn(index + 1).width = width;
    });
    ws.getColumn(4).numFmt = '@';
    ws.getColumn(6).numFmt = '@';
    ws.autoFilter = { from: 'A1', to: 'F1' };

    for (let r = 2; r <= ws.lastRow.number; r++) {
      ws.getRow(r).eachCell((cell: ExcelCell) => {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const safeShift = selectedShift ? selectedShift.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
    const fileName = `excel-for-review-${yyyy}${mm}${dd}-${hh}${mi}${safeShift ? '-' + safeShift : ''}.xlsx`;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, fileName);
  };

  const exportRepeatedCompliantsByMobile = async () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const { ExcelJS, saveAs } = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Repeat Complaints (Mobile)');
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

    // Aggregate by Mobile
    const mobileMap = new Map<string, { mobile: string; name: string; address: string; total: number; pending: number; closed: number; timestamps: string[] }>();
    rows.forEach(r => {
      const mobile = r['Consumer Mobile'] ? String(r['Consumer Mobile']).trim() : null;
      if (!mobile || mobile.length < 5) return; // Basic validation

      const entry = mobileMap.get(mobile) || { mobile, name: r['Consumer Name'], address: r['Consumer Address'], total: 0, pending: 0, closed: 0, timestamps: [] as string[] };
      entry.total += 1;
      const status = String(r['Status'] || '').toLowerCase();
      if (status.includes('pending')) entry.pending += 1;
      else if (status.includes('closed')) entry.closed += 1;
      entry.timestamps.push(String(r['Complaint Date and Time'] || ''));
      mobileMap.set(mobile, entry);
    });

    // Filter > 1 complaint and Sort by Total DESC
    const sortedData = Array.from(mobileMap.values())
      .filter(x => x.total > 1)
      .sort((a, b) => b.total - a.total);

    // Title
    const titleRow = ws.addRow(['Repeat Complainers Analysis (By Mobile Number)']);
    titleRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    ws.mergeCells(1, 1, 1, 6);

    // Subtitle
    const subtitleRow = ws.addRow([`Generated: ${nowStr} | Total Recognized Repeaters: ${sortedData.length}`]);
    subtitleRow.font = { italic: true, size: 10 };
    ws.mergeCells(2, 1, 2, 6);

    // Headers
    const headerRow = ws.addRow(['Mobile Number', 'Consumer Name (Latest)', 'Address (Latest)', 'Total Complaints', 'Pending', 'Closed']);
    headerRow.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Data
    sortedData.forEach(d => {
      ws.addRow([d.mobile, d.name, d.address, d.total, d.pending, d.closed]);
    });

    // Widths
    ws.getColumn(1).width = 15;
    ws.getColumn(2).width = 25;
    ws.getColumn(3).width = 30;
    ws.getColumn(4).width = 15;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 10;

    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `repeat_complaints_mobile_${now.getTime()}.xlsx`);
  };

  const exportRepeatedCompliantsByNameAddress = async () => {
    const rows = filtered;
    if (rows.length === 0) return;
    const { ExcelJS, saveAs } = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Repeat Complaints (Name+Address)');
    const now = new Date();
    const nowStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

    // Aggregate by Name + Address
    const keyMap = new Map<string, { mobile: string; name: string; address: string; total: number; pending: number; closed: number }>();
    rows.forEach(r => {
      const name = r['Consumer Name'] ? String(r['Consumer Name']).trim() : '';
      const address = r['Consumer Address'] ? String(r['Consumer Address']).trim() : '';
      if (!name) return;

      const key = `${name}|${address}`.toLowerCase();
      const entry = keyMap.get(key) || { mobile: r['Consumer Mobile'], name, address, total: 0, pending: 0, closed: 0 };
      entry.total += 1;
      const status = String(r['Status'] || '').toLowerCase();
      if (status.includes('pending')) entry.pending += 1;
      else if (status.includes('closed')) entry.closed += 1;
      keyMap.set(key, entry);
    });

    // Filter > 1 complaint and Sort by Total DESC
    const sortedData = Array.from(keyMap.values())
      .filter(x => x.total > 1)
      .sort((a, b) => b.total - a.total);

    // Title
    const titleRow = ws.addRow(['Repeat Complainers Analysis (By Name & Address)']);
    titleRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDB2777' } };
    ws.mergeCells(1, 1, 1, 6);

    // Subtitle
    const subtitleRow = ws.addRow([`Generated: ${nowStr} | Total Recognized Repeaters: ${sortedData.length}`]);
    subtitleRow.font = { italic: true, size: 10 };
    ws.mergeCells(2, 1, 2, 6);

    // Headers
    const headerRow = ws.addRow(['Consumer Name', 'Address', 'Last Known Mobile', 'Total Complaints', 'Pending', 'Closed']);
    headerRow.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Data
    sortedData.forEach(d => {
      ws.addRow([d.name, d.address, d.mobile, d.total, d.pending, d.closed]);
    });

    // Widths
    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 15;
    ws.getColumn(4).width = 15;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 10;

    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `repeat_complaints_consumer_${now.getTime()}.xlsx`);
  };

  const dashboardStats = useMemo(() => {
    const total = filtered.length;
    let closed = 0;
    let within = 0;
    let beyond = 0;

    for (const row of filtered) {
      if (isClosedRow(row)) {
        closed += 1;
      }

      const closedStatus = String(row['Closed Status'] || '').trim();
      if (closedStatus === 'Closed Within') within += 1;
      if (closedStatus === 'Closed Beyond') beyond += 1;
    }

    const pending = Math.max(0, total - closed);
    const currentScope = selectedShift || (monthFilter !== 'All' ? monthFilter : 'Current filters');

    return [
      {
        label: 'Total Complaints',
        value: total,
        helper: currentScope,
        icon: FiBarChart2,
        cardClass: 'border-slate-200 bg-white',
        iconClass: 'bg-slate-900 text-white'
      },
      {
        label: 'Closed',
        value: closed,
        helper: total ? `${Math.round((closed / total) * 100)}% resolved` : 'No resolved complaints',
        icon: FiActivity,
        cardClass: 'border-emerald-200 bg-emerald-50/70',
        iconClass: 'bg-emerald-600 text-white'
      },
      {
        label: 'Pending',
        value: pending,
        helper: pending ? 'Needs follow-up' : 'Nothing pending',
        icon: FiClock,
        cardClass: 'border-amber-200 bg-amber-50/70',
        iconClass: 'bg-amber-500 text-white'
      },
      {
        label: 'Closed Beyond',
        value: beyond,
        helper: `Within SLA: ${within}`,
        icon: FiTrendingUp,
        cardClass: 'border-rose-200 bg-rose-50/70',
        iconClass: 'bg-rose-600 text-white'
      }
    ];
  }, [filtered, monthFilter, selectedShift]);

  const ResultsSkeleton = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-3">
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonBlock className="h-8 w-20" />
                <SkeletonBlock className="h-3 w-24" />
              </div>
              <SkeletonBlock className="h-12 w-12 rounded-2xl" />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-56" />
            <SkeletonBlock className="h-4 w-36" />
          </div>
          <SkeletonBlock className="h-10 w-28 rounded-xl" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {Array.from({ length: 6 }).map((__, cellIndex) => (
                <SkeletonBlock key={cellIndex} className="h-6 rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50/80 p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
              <Image src="/logo.png" alt="FRT Logo" width={52} height={52} className="rounded-lg" priority />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Today-first loading
                </span>
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Server-side filters
                </span>
              </div>
              <h1 className="text-xl md:text-3xl font-bold">FRT बाराबंकी - सप्लाई कंप्लेंट रिपोर्ट</h1>
              <p className="text-sm text-slate-600 md:text-base">Fast daily view, safer refresh sync, and cleaner exports for complaint analysis.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">

            <button
              onClick={async () => {
                setIsRefreshing(true);
                setError('');
                const startTime = Date.now();
                try {
                  const result = await refreshData();
                  const duration = Math.round((Date.now() - startTime) / 1000);

                  if (!result.success) {
                    throw new Error(result.error || 'Refresh failed');
                  }

                  const newRows = result.stats?.new || 0;
                  const updatedRows = result.stats?.updated || 0;
                  alert(`Refresh complete in ${duration}s.\n\nNew: ${newRows} | Updated: ${updatedRows}`);
                  return;
                  /*
                  console.log('🔄 Starting refresh...');
                  
                  const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout after 3 minutes')), 180000)
                  );
                  
                  const fetchPromise = fetch('/api/scrape?refresh=1');
                  
                  const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
                  
                  const contentType = response.headers.get('content-type');
                  if (!response.ok || !contentType?.includes('application/json')) {
                    const text = await response.text();
                    throw new Error(`Server error: ${text.substring(0, 100)}...`);
                  }
                  
                  const result = await response.json();
                  const duration = Math.round((Date.now() - startTime) / 1000);
                  
                  if (result.success) {
                    const dbResponse = await fetch('/api/complaints?fetchAll=true&refresh=1');
                    const dbResult = await dbResponse.json();
                    if (dbResult.success) {
                      const dataArray = dbResult.data || [];
                      setOriginal(dataArray);
                      setData(dataArray);
                      setIsPartialData(false);
                      
                      const timestamp = result.lastScrapedAt || dbResult.lastScrapedAt;
                      if (timestamp) {
                        setLastUpdated(timestamp);
                      }
                      
                      const newRows = result.stats?.new || result.new_rows || 0;
                      const updatedRows = result.stats?.updated || result.updated_rows || 0;
                      
                      alert(`✅ Refresh complete in ${duration}s!\n\n📊 New: ${newRows} | Updated: ${updatedRows}\n📈 Total: ${dataArray.length} complaints`);
                    }
                  } else {
                    setError(result.error || 'Refresh failed');
                    alert(`❌ Refresh failed: ${result.error || 'Unknown error'}\n\n💡 Tip: Website might be slow. Try again in a minute.`);
                  }
                  */
                } catch (err: any) {
                  const duration = Math.round((Date.now() - startTime) / 1000);
                  console.error('Refresh error:', err);
                  
                  let errorMsg = err.message || 'Unknown error';
                  if (errorMsg.includes('timeout')) {
                    errorMsg = 'Website is too slow or down. Please try again later.';
                  } else if (errorMsg.includes('fetch')) {
                    errorMsg = 'Network error. Check your internet connection.';
                  }
                  
                  setError(errorMsg);
                  alert(`❌ Refresh failed after ${duration}s\n\n${errorMsg}\n\n💡 Tips:\n• Wait 1-2 minutes and try again\n• Check if website is accessible\n• Try during off-peak hours`);
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isRefreshing ? (<><FiClock /> Refreshing...</>) : (<><FiRefreshCw /> Sync Latest</>)}
            </button>

          </div>
        </div>
        </header>

        {lastUpdated && (
          <div className="bg-amber-50 border-l-4 border-amber-500 text-amber-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ Data last updated on: {lastUpdated}</p>
          </div>
        )}

        {false && (
          <div className="bg-blue-50 border-l-4 border-blue-500 text-blue-800 px-4 py-3 rounded">
            <p className="font-medium flex items-center gap-2">
              <FiInfo className="text-lg shrink-0" />
                Rocket Mode Active 🚀: Loaded recent data instantly. Fetching full history in background...
              </p>
          </div>
        )}

        {false && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-lg p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-6">
                <SkeletonBlock className="h-12 w-12 rounded-lg" />
                <div className="flex-1">
                  <SkeletonBlock className="h-6 w-48 mb-2" />
                  <SkeletonBlock className="h-4 w-32" />
                </div>
                <SkeletonBlock className="h-10 w-28 rounded-xl" />
              </div>
              <div className="space-y-5">
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                  <SkeletonBlock className="h-5 w-32 mb-4" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <SkeletonBlock className="h-10 lg:col-span-2" />
                    <SkeletonBlock className="h-10" />
                    <SkeletonBlock className="h-10" />
                    <SkeletonBlock className="h-10" />
                  </div>
                </div>
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                  <SkeletonBlock className="h-5 w-40 mb-4" />
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <SkeletonBlock key={i} className="h-8 w-24 rounded-lg" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-md border border-gray-100">
              <div className="p-6">
                <div className="flex gap-3 mb-4">
                  <SkeletonBlock className="h-7 w-48" />
                  <SkeletonBlock className="h-7 w-24 rounded-full" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="grid grid-cols-6 gap-3 items-center">
                      <SkeletonBlock className="h-6 col-span-1" />
                      <SkeletonBlock className="h-6 col-span-1" />
                      <SkeletonBlock className="h-6 col-span-1" />
                      <SkeletonBlock className="h-6 col-span-1" />
                      <SkeletonBlock className="h-6 col-span-1" />
                      <SkeletonBlock className="h-6 col-span-1" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {true && (
          <>
            <div className="mb-6">
              <FilterBar
                search={search}
                setSearch={setSearch}
                divisionFilter={divisionFilter}
                setDivisionFilter={setDivisionFilter}
                divisionOptions={divisionOptions}
                subDivisionFilter={subDivisionFilter}
                setSubDivisionFilter={setSubDivisionFilter}
                subDivisionOptions={subDivisionOptions}
                subStationFilter={subStationFilter}
                setSubStationFilter={setSubStationFilter}
                subStationOptions={subStationOptions}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                statusOptions={statusOptions}
                closedStatusFilter={closedStatusFilter}
                setClosedStatusFilter={setClosedStatusFilter}
                closedStatusOptions={closedStatusOptions}
                fromDT={fromDT}
                setFromDT={setFromDT}
                toDT={toDT}
                setToDT={setToDT}
                selectedShift={selectedShift}
                setSelectedShift={setSelectedShift}
                activePreset={activePreset}
                applyPreset={applyPreset}
                applyShiftPreset={applyShiftPreset}
                customDate={customDate} setCustomDate={setCustomDate}
                applyCustomDateShift={applyCustomDateShift}
                clearAllFilters={clearAllFilters}
                onApply={applyCurrentFilters}
                loading={loading || isPending}
                dailyCounts={dailyCounts}
                monthFilter={monthFilter}
                setMonthFilter={handleMonthChange}
                monthOptions={monthOptions}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-3">
                        <SkeletonBlock className="h-4 w-28" />
                        <SkeletonBlock className="h-8 w-20" />
                        <SkeletonBlock className="h-3 w-24" />
                      </div>
                      <SkeletonBlock className="h-12 w-12 rounded-2xl" />
                    </div>
                  </div>
                ))
              ) : (
                dashboardStats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className={`rounded-2xl border p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${stat.cardClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-600">{stat.label}</p>
                          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{stat.value}</p>
                          <p className="mt-2 text-xs font-medium text-slate-500">{stat.helper}</p>
                        </div>
                        <div className={`rounded-2xl p-3 shadow-sm ${stat.iconClass}`}>
                          <Icon className="text-xl" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
              <p className="font-medium flex items-start gap-2">
                <FiInfo className="mt-0.5 shrink-0 text-lg" />
                <span>
                  Showing today's complaints by default. Change filters, then use Apply Filters to fetch matching data from Supabase.
                  Refresh sync re-scrapes from the last successful update minus 1 day to catch delayed complaints safely.
                </span>
              </p>
            </div>

            {loading ? (
              <ResultsSkeleton />
            ) : filtered.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FiBarChart2 className="text-sky-600 text-lg" />
                    <span className="font-semibold text-gray-700">Showing {((currentPage - 1) * rowsPerPage) + 1}-{Math.min(currentPage * rowsPerPage, filtered.length)} of {filtered.length} complaints</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={exportSummaryPDF}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-indigo-800"
                    >
                      <FiBarChart2 className="text-lg" /> <span>Summary PDF</span>
                    </button>
                    <button
                      onClick={() => router.push('/charts')}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-slate-800"
                    >
                      <FiBarChart2 className="text-lg" /> <span>View Charts</span>
                    </button>
                    <button
                      onClick={() => router.push('/deep-analysis')}
                      className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-pink-700"
                    >
                      <FiActivity className="text-lg" /> <span>Deep Analysis</span>
                    </button>
                    <button
                      onClick={exportTrendChartsPDF}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-blue-800"
                    >
                      <FiTrendingUp className="text-lg" /> <span>Charts PDF</span>
                    </button>
                    <button
                      onClick={() => setShowReportModal(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-emerald-800"
                    >
                      <FiLayers className="text-lg" /> <span>Detailed Reports</span>
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setShowExcelMenu((value) => !value)}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-sky-800"
                        aria-haspopup="menu"
                        aria-expanded={showExcelMenu}
                      >
                        <FiDownload className="text-lg" /> <span>Excel (.xlsx)</span>
                      </button>
                      {showExcelMenu && (
                        <div className="absolute left-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:left-auto sm:right-0" role="menu">
                          <button
                            onClick={() => {
                              setShowExcelMenu(false);
                              exportExcel();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-sky-50 hover:text-sky-800"
                            role="menuitem"
                          >
                            <FiDownload className="text-base" /> <span>Current Excel</span>
                          </button>
                          <button
                            onClick={() => {
                              setShowExcelMenu(false);
                              exportReviewExcel();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-800"
                            role="menuitem"
                          >
                            <FiFileText className="text-base" /> <span>Excel For Review</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-5 text-yellow-900 shadow-sm">
                <p className="font-semibold">No complaints found for the current filters.</p>
                <p className="mt-1 text-sm">Try another date range, a broader preset, or clear filters and fetch again.</p>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <>
            <div className="bg-white rounded-xl shadow-md border border-gray-100">
              <div className="overflow-x-auto max-h-[70vh] relative">
                <table className="min-w-full divide-y divide-gray-200 text-xs md:text-sm">
                  <thead className="bg-gradient-to-r from-gray-100 to-gray-50 sticky top-0 z-10 shadow-sm">
                    <tr>
                      {(() => {
                        const preferredOrder = [
                          'Complaint Number',
                          'Consumer Name',
                          'Consumer Mobile',
                          'Consumer Address',
                          'Complaint Type',
                          'Complaint Sub Type',
                          'Status',
                          'Closed Status',
                          'Complaint Date and Time',
                          'Closed Date',
                          'Resolution Time',
                          'Area Type',
                          'Division',
                          'Sub Division',
                          'Sub Station',
                          'Closed By',
                          'Closing Remarks'
                        ];
                        const firstRowKeys = Object.keys(filtered[0] || {});
                        const otherKeys = firstRowKeys.filter(k => !preferredOrder.includes(k) && k !== 'Resolution Time');
                        const finalHeaders = [...preferredOrder, ...otherKeys];

                        return finalHeaders.map((header) => (
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
                        ));
                      })()}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {(() => {
                      const preferredOrder = [
                        'Complaint Number',
                        'Consumer Name',
                        'Consumer Mobile',
                        'Consumer Address',
                        'Complaint Type',
                        'Complaint Sub Type',
                        'Status',
                        'Closed Status',
                        'Complaint Date and Time',
                        'Closed Date',
                        'Resolution Time',
                        'Area Type',
                        'Division',
                        'Sub Division',
                        'Sub Station',
                        'Closed By',
                        'Closing Remarks'
                      ];
                      const firstRowKeys = Object.keys(filtered[0] || {});
                      const otherKeys = firstRowKeys.filter(k => !preferredOrder.includes(k) && k !== 'Resolution Time');
                      const finalHeaders = [...preferredOrder, ...otherKeys];

                      return paginatedData.map((row, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          {finalHeaders.map((h, i) => {
                            let display: any = (row as any)[h];
                            if (h === 'Resolution Time') display = computeResolutionTime(row);
                            const isRemarks = h === 'Closing Remarks';
                            const isClosedStatus = h === 'Closed Status';

                            let cellContent;
                            if (isClosedStatus) {
                              const status = String(display || '').trim();
                              const isWithin = status === 'Closed Within';
                              const isBeyond = status === 'Closed Beyond';
                              cellContent = (
                                <span className={`px-2 py-1 rounded-full font-medium ${isWithin ? 'bg-green-100 text-green-700' : isBeyond ? 'bg-red-100 text-red-700' : 'text-gray-600'}`}>
                                  {status}
                                </span>
                              );
                            } else if (isRemarks) {
                              cellContent = <span title={String(display || '')} className="block truncate">{String(display || '')}</span>;
                            } else if (h === 'Consumer Name' || h === 'Consumer Address') {
                              const contentStr = String(display || '');
                              cellContent = (
                                <div className="flex items-center gap-1 group">
                                  <div title={contentStr} className="truncate max-w-[120px] md:max-w-[150px]">
                                    {contentStr}
                                  </div>
                                  {contentStr && (
                                    <button
                                      onClick={() => setSelectedCellData({ title: h, content: contentStr })}
                                      className="text-gray-400 hover:text-blue-600 flex-shrink-0 md:opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                    >
                                      <FiInfo size={14} />
                                    </button>
                                  )}
                                </div>
                              );
                            } else {
                              cellContent = String(display ?? '');
                            }

                            return (
                              <td key={i} className="px-4 md:px-6 py-3 whitespace-nowrap text-gray-900 max-w-[14rem] md:max-w-xs">
                                {cellContent}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4 pb-4">
                <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">First</button>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">Prev</button>
                <span className="px-4 py-1 bg-gray-100 rounded">Page {currentPage} of {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">Next</button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">Last</button>
              </div>
            )}
          </>
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
                      onClick={() => { exportSubDivisionSummary(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 hover:border-indigo-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-indigo-500 p-3 rounded-lg group-hover:bg-indigo-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-indigo-700 transition">Sub Division-wise Summary</div>
                        <div className="text-xs text-gray-600">Total, Closed, Pending by Sub Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportSubStationSummary(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 hover:border-indigo-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-indigo-500 p-3 rounded-lg group-hover:bg-indigo-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-indigo-700 transition">Sub Station-wise Summary</div>
                        <div className="text-xs text-gray-600">Total, Closed, Pending by Sub Station</div>
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
                  <h3 className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">📋</span> Within/Beyond Status Reports
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => { exportClosedStatusDivision(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 hover:border-orange-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-orange-500 p-3 rounded-lg group-hover:bg-orange-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-orange-700 transition">Within/Beyond Status - Division</div>
                        <div className="text-xs text-gray-600">Closed Within vs Closed Beyond by Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportClosedStatusSubDivision(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 hover:border-orange-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-orange-500 p-3 rounded-lg group-hover:bg-orange-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-orange-700 transition">Within/Beyond Status - Sub Division</div>
                        <div className="text-xs text-gray-600">Closed Within vs Closed Beyond by Sub Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportClosedStatusSubStation(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 hover:border-orange-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-orange-500 p-3 rounded-lg group-hover:bg-orange-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-orange-700 transition">Within/Beyond Status - Sub Station</div>
                        <div className="text-xs text-gray-600">Closed Within vs Closed Beyond by Sub Station</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportAreaTypeBreakdown(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 hover:border-orange-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-orange-500 p-3 rounded-lg group-hover:bg-orange-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-orange-700 transition">Area Type - Within/Beyond Analysis</div>
                        <div className="text-xs text-gray-600">Within/Beyond status by Area Type</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">🔍</span> FRT vs Control Room Reports
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
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Division - FRT vs Control Room</div>
                        <div className="text-xs text-gray-600">FRT vs Control Room by Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportSubDivisionClosedBreakdown(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-200 hover:border-emerald-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-emerald-500 p-3 rounded-lg group-hover:bg-emerald-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Sub Division - FRT vs Control Room</div>
                        <div className="text-xs text-gray-600">FRT vs Control Room by Sub Division</div>
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
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Date-wise - FRT vs Control Room</div>
                        <div className="text-xs text-gray-600">FRT vs Control Room by Date</div>
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
                        <div className="font-semibold text-gray-800 group-hover:text-emerald-700 transition">Detailed - FRT vs Control Room</div>
                        <div className="text-xs text-gray-600">FRT vs Control Room (Division → Sub Division → Sub Station)</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">📅</span> Total Count Reports
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => { exportDivisionCount(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 hover:border-purple-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-slate-700 p-3 rounded-lg group-hover:bg-purple-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-purple-700 transition">Division-wise Count</div>
                        <div className="text-xs text-gray-600">Total Complaints by Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportSubDivisionCount(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 hover:border-purple-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-slate-700 p-3 rounded-lg group-hover:bg-purple-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-purple-700 transition">Sub Division-wise Count</div>
                        <div className="text-xs text-gray-600">Total Complaints by Sub Division</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportDatewiseTotalCount(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 hover:border-purple-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-slate-700 p-3 rounded-lg group-hover:bg-purple-600 transition">
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
                      <div className="bg-slate-700 p-3 rounded-lg group-hover:bg-purple-600 transition">
                        <FiFileText className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-purple-700 transition">Sub Station-wise Count</div>
                        <div className="text-xs text-gray-600">Total Complaints by Sub Station</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-pink-700 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <span className="text-lg">🧠</span> Deep Analysis - Consumer Insights
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => { exportRepeatedCompliantsByMobile(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-pink-50 to-rose-50 border-2 border-pink-200 hover:border-pink-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-pink-600 p-3 rounded-lg group-hover:bg-pink-700 transition">
                        <FiTrendingUp className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-pink-700 transition">Top Repeaters (By Mobile)</div>
                        <div className="text-xs text-gray-600">Frequent complainers sharing same mobile</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportRepeatedCompliantsByNameAddress(); setShowReportModal(false); }}
                      className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-pink-50 to-rose-50 border-2 border-pink-200 hover:border-pink-400 hover:shadow-md rounded-lg transition-all text-left group"
                    >
                      <div className="bg-pink-600 p-3 rounded-lg group-hover:bg-pink-700 transition">
                        <FiTrendingUp className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 group-hover:text-pink-700 transition">Top Repeaters (Name & Address)</div>
                        <div className="text-xs text-gray-600">Frequent consumers by Name + Address</div>
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
                    <div className="text-sm text-blue-100">Combined PDF with all 12 reports</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
        {selectedCellData && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full transform scale-100 transition-all p-6 relative">
              <button
                onClick={() => setSelectedCellData(null)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>

              <h3 className="text-xl font-bold text-gray-900 mb-4 pr-10 border-b border-gray-100 pb-2">
                {selectedCellData.title}
              </h3>

              <div className="bg-gray-50 rounded-xl p-4 text-gray-700 text-base leading-relaxed break-words border border-gray-100 max-h-[60vh] overflow-y-auto">
                {selectedCellData.content}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setSelectedCellData(null)}
                  className="bg-gray-900 hover:bg-black text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div >
  );
}





