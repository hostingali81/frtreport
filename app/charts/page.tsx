'use client';

import { useEffect, useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import TrendCharts from '../components/TrendCharts';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import FilterBar from '../components/FilterBar';
import Image from 'next/image';
import Select from 'react-select';

export default function ChartsPage() {
  const router = useRouter();
  const [original, setOriginal] = useState<any[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [fromDT, setFromDT] = useState('');
  const [toDT, setToDT] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [subDivisionFilter, setSubDivisionFilter] = useState('');
  const [subStationFilter, setSubStationFilter] = useState('');
  const [closedStatusFilter, setClosedStatusFilter] = useState('');
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('');
  const [monthFilter, setMonthFilter] = useState<string>('All');

  const isClosedRow = (row: any) => {
    const statusRaw = String(row['Status'] ?? '').trim();
    const statusLower = statusRaw.toLowerCase();
    const closedDate = String(row['Closed Date'] ?? '').trim();

    if (statusLower === 'complaint closed') return true;
    if (statusLower === 'pending') return false;

    if (closedDate.length > 0) return true;
    if (statusLower.includes('closed') || statusLower.includes('resolve')) return true;
    if (statusLower.includes('attend') && statusLower.includes('confirm')) return true;
    if (statusLower.includes('attend') && statusLower.includes('confirm')) return true;
    return false;
  };

  const parsePossibleDate = (value: string) => {
    const clean = value.trim();
    if (!clean) return null;
    const match = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      // Note: handling time if present
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

  const closedStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of original) {
      // Use the helper logic or raw column if available. 
      // The main page uses raw 'Closed Status' column if it exists in data, or derives it.
      // Based on main page, it uses the 'Closed Status' column directly.
      const s = String(r['Closed Status'] ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [original]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of original) {
      const s = String(r['Status'] ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [original]);

  const divisionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of original) {
      const s = String(r['Division'] ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [original]);

  const subDivisionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of original) {
      const s = String(r['Sub Division'] ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [original]);

  const subStationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of original) {
      const s = String(r['Sub Station'] ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [original]);

  const findParentsForSubStation = (subStation: string) => {
    const record = original.find(r => String(r['Sub Station'] ?? '').trim() === subStation);
    if (record) {
      return {
        division: String(record['Division'] ?? '').trim(),
        subDivision: String(record['Sub Division'] ?? '').trim()
      };
    }
    return null;
  };

  const findParentForSubDivision = (subDivision: string) => {
    const record = original.find(r => String(r['Sub Division'] ?? '').trim() === subDivision);
    if (record) {
      return String(record['Division'] ?? '').trim();
    }
    return '';
  };



  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    original.forEach(r => {
      const val = String(r['Complaint Date and Time'] || r['Complaint Date'] || '');
      const d = parsePossibleDate(val);
      if (d) {
        const key = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        months.add(key);
      }
    });
    const options = Array.from(months).map(m => ({ value: m, label: m }));
    return [{ value: 'All', label: 'All Months' }, ...options];
  }, [original]);

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
    let rows = original;
    if (search.trim()) {
      rows = rows.filter(row =>
        Object.values(row).some(v => String(v || '').toLowerCase().includes(search.trim().toLowerCase()))
      );
    }

    // Month Filter Logic
    if (monthFilter && monthFilter !== 'All') {
      rows = rows.filter(row => {
        const val = String(row['Complaint Date and Time'] || row['Complaint Date'] || '');
        const dt = parsePossibleDate(val);
        if (!dt) return false;
        return dt.toLocaleString('en-US', { month: 'long', year: 'numeric' }) === monthFilter;
      });
    }

    if (fromDT || toDT) {
      const fromDate = fromDT ? new Date(fromDT) : null;
      const toDate = toDT ? new Date(toDT) : null;
      rows = rows.filter(row => {
        const val = String(row['Complaint Date and Time'] || '');
        const dt = parsePossibleDate(val);
        if (!dt) return false;
        if (fromDate && dt < fromDate) return false;
        if (toDate && dt > toDate) return false;
        return true;
      });
    }
    if (statusFilter) rows = rows.filter(row => String(row['Status'] ?? '').trim() === statusFilter);
    if (closedStatusFilter) rows = rows.filter(row => String(row['Closed Status'] ?? '').trim() === closedStatusFilter);
    if (divisionFilter) rows = rows.filter(row => String(row['Division'] ?? '').trim() === divisionFilter);
    if (subDivisionFilter) rows = rows.filter(row => String(row['Sub Division'] ?? '').trim() === subDivisionFilter);
    if (subStationFilter) rows = rows.filter(row => String(row['Sub Station'] ?? '').trim() === subStationFilter);
    return rows;
  }, [original, search, fromDT, toDT, statusFilter, closedStatusFilter, divisionFilter, subDivisionFilter, subStationFilter, monthFilter]);

  useEffect(() => {
    setData(filtered);
  }, [filtered]);

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
    setActivePreset('');
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
    setActivePreset('');
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
    setSearch('');
    setDivisionFilter('');
    setSubDivisionFilter('');
    setSubStationFilter('');
    setSubStationFilter('');
    setStatusFilter('');
    setClosedStatusFilter('');
    setFromDT('');
    setToDT('');
    setSelectedShift('');
    setActivePreset('');
  };

  const ShiftBadge = ({ letter }: { letter: string }) => (
    <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-600 text-white text-xs font-bold rounded-md mr-2 shadow-sm border border-emerald-500/50">
      {letter}
    </span>
  );

  const fetchData = async () => {
    setLoading(true);
    setError('');

    try {
      // Fetch ALL records for accurate trends/analysis
      const response = await fetch('/api/complaints?fetchAll=true');
      const result = await response.json();

      if (result.success && result.data && result.data.length > 0) {
        setOriginal(result.data);
        setData(result.data);
      } else {
        setError('कोई डेटा नहीं मिला');
      }
    } catch (err: any) {
      setError('डेटा प्राप्त करने में त्रुटि: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="FRT Logo" width={56} height={56} className="rounded-lg" priority />
            <div>
              <h1 className="text-xl md:text-3xl font-bold">📊 Interactive Trend Charts</h1>
              <p className="text-gray-500 text-sm md:text-base">Visual analysis of complaint trends</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2 px-4 md:px-5 rounded-lg transition shadow-sm"
            >
              <FiArrowLeft /> Back
            </button>
            <button
              onClick={() => router.push('/deep-analysis')}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg transition shadow-sm"
            >
              <span className="text-lg">🔍</span> Deep Analysis
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition shadow-sm"
            >
              <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </header>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 font-semibold">Loading charts...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ {error}</p>
          </div>
        )}

        {!loading && !error && original.length > 0 && (
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
                applyPreset={applyPreset as any}
                applyShiftPreset={applyShiftPreset}
                customDate={customDate}
                setCustomDate={setCustomDate}
                applyCustomDateShift={applyCustomDateShift}
                clearAllFilters={clearAllFilters}
                onRefresh={fetchData}
                loading={loading || isPending}
                dailyCounts={{}}
                monthFilter={monthFilter}
                setMonthFilter={handleMonthChange}
                monthOptions={monthOptions}
              />
            </div>
            <TrendCharts data={data} isClosedRow={isClosedRow} />
          </>
        )}

        {!loading && !error && data.length === 0 && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ No data available to display charts</p>
          </div>
        )}
      </div>
    </div>
  );
}
