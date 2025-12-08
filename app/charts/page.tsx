'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import TrendCharts from '../components/TrendCharts';
import { FiArrowLeft, FiRefreshCw, FiFilter, FiSearch, FiClock, FiLayers } from 'react-icons/fi';
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
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('');

  const isClosedRow = (row: any) => {
    const statusRaw = String(row['Status'] ?? '').trim();
    const statusLower = statusRaw.toLowerCase();
    const closedDate = String(row['Closed Date'] ?? '').trim();

    if (statusLower === 'complaint closed') return true;
    if (statusLower === 'pending') return false;

    if (closedDate.length > 0) return true;
    if (statusLower.includes('closed') || statusLower.includes('resolve')) return true;
    if (statusLower.includes('attend') && statusLower.includes('confirm')) return true;
    return false;
  };

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

  const filtered = useMemo(() => {
    let rows = original;
    if (search.trim()) {
      rows = rows.filter(row =>
        Object.values(row).some(v => String(v || '').toLowerCase().includes(search.trim().toLowerCase()))
      );
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
    if (divisionFilter) rows = rows.filter(row => String(row['Division'] ?? '').trim() === divisionFilter);
    if (subDivisionFilter) rows = rows.filter(row => String(row['Sub Division'] ?? '').trim() === subDivisionFilter);
    if (subStationFilter) rows = rows.filter(row => String(row['Sub Station'] ?? '').trim() === subStationFilter);
    return rows;
  }, [original, search, fromDT, toDT, statusFilter, divisionFilter, subDivisionFilter, subStationFilter]);

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
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0);
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
        const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
        const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 8, 0, 0);
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
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 8, 0, 0);
        setRange(start, end);
        break;
      }
    }
    setSelectedShift(labelMap[shiftType]);
  };

  const applyPreset = (type: 'fromNov2025ToNow' | 'today' | 'last24h' | 'thisMonth' | 'toNow') => {
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
    setStatusFilter('');
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
      const response = await fetch('/api/scrape');
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
            <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-sky-600 p-2.5 rounded-lg">
                    <FiFilter className="text-white text-xl" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Filters</h2>
                    <p className="text-xs text-gray-500">Refine your chart data</p>
                  </div>
                </div>
                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white font-bold py-2.5 px-5 rounded-xl shadow-md hover:shadow-lg transition-all"
                >
                  <FiFilter className="text-lg" /> <span>Clear All</span>
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="flex flex-col lg:col-span-2">
                    <label className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                      <FiSearch className="text-gray-400" /> Search
                    </label>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search keywords..."
                      className="border-2 border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none w-full"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-gray-600 mb-2">Division</label>
                    <Select
                      value={divisionFilter ? { value: divisionFilter, label: divisionFilter } : null}
                      onChange={(option) => {
                        setDivisionFilter(option?.value || '');
                      }}
                      options={[{ value: '', label: 'All' }, ...divisionOptions.map(s => ({ value: s, label: s }))]}
                      isClearable
                      placeholder="All"
                      className="text-sm"
                      styles={{
                        control: (base) => ({ ...base, minHeight: '38px', fontSize: '14px' }),
                        menu: (base) => ({ ...base, fontSize: '14px' })
                      }}
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-gray-600 mb-2">Sub Division</label>
                    <Select
                      value={subDivisionFilter ? { value: subDivisionFilter, label: subDivisionFilter } : null}
                      onChange={(option) => {
                        const selectedSubDiv = option?.value || '';
                        setSubDivisionFilter(selectedSubDiv);
                        if (selectedSubDiv) {
                          const parentDiv = findParentForSubDivision(selectedSubDiv);
                          if (parentDiv) setDivisionFilter(parentDiv);
                        }
                      }}
                      options={[{ value: '', label: 'All' }, ...subDivisionOptions.map(s => ({ value: s, label: s }))]}
                      isClearable
                      placeholder="All"
                      className="text-sm"
                      styles={{
                        control: (base) => ({ ...base, minHeight: '38px', fontSize: '14px' }),
                        menu: (base) => ({ ...base, fontSize: '14px' })
                      }}
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-gray-600 mb-2">Sub Station</label>
                    <Select
                      value={subStationFilter ? { value: subStationFilter, label: subStationFilter } : null}
                      onChange={(option) => {
                        const selectedSubStn = option?.value || '';
                        setSubStationFilter(selectedSubStn);
                        if (selectedSubStn) {
                          const parents = findParentsForSubStation(selectedSubStn);
                          if (parents) {
                            setDivisionFilter(parents.division);
                            setSubDivisionFilter(parents.subDivision);
                          }
                        }
                      }}
                      options={[{ value: '', label: 'All' }, ...subStationOptions.map(s => ({ value: s, label: s }))]}
                      isClearable
                      placeholder="All"
                      className="text-sm"
                      styles={{
                        control: (base) => ({ ...base, minHeight: '38px', fontSize: '14px' }),
                        menu: (base) => ({ ...base, fontSize: '14px' })
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-gray-600 mb-2">Status</label>
                    <Select
                      value={statusFilter ? { value: statusFilter, label: statusFilter } : null}
                      onChange={(option) => setStatusFilter(option?.value || '')}
                      options={[{ value: '', label: 'All' }, ...statusOptions.map(s => ({ value: s, label: s }))]}
                      isClearable
                      placeholder="All"
                      className="text-sm"
                      styles={{
                        control: (base) => ({ ...base, minHeight: '38px', fontSize: '14px' }),
                        menu: (base) => ({ ...base, fontSize: '14px' })
                      }}
                    />
                  </div>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center gap-2 mb-4">
                    <FiClock className="text-blue-500 text-lg" />
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Date Range</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <label className="text-xs font-semibold text-gray-600 mb-2">From (Date & Time)</label>
                      <input
                        type="datetime-local"
                        value={fromDT}
                        onChange={(e) => setFromDT(e.target.value)}
                        className="border-2 border-gray-200 rounded-lg px-4 py-2.5 text-sm w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-xs font-semibold text-gray-600 mb-2">To (Date & Time)</label>
                      <input
                        type="datetime-local"
                        value={toDT}
                        onChange={(e) => setToDT(e.target.value)}
                        className="border-2 border-gray-200 rounded-lg px-4 py-2.5 text-sm w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 mt-4">
                  <div className="flex items-center gap-2 mb-4">
                    <FiClock className="text-indigo-600 text-lg" />
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Quick Presets</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => { applyPreset('fromNov2025ToNow'); setSelectedShift(''); }} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${activePreset === 'fromNov2025ToNow' && !selectedShift ? 'bg-indigo-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'}`}>📅 Nov-2025 → Now</button>
                    <button onClick={() => { applyPreset('today'); setSelectedShift(''); }} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${activePreset === 'today' && !selectedShift ? 'bg-indigo-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'}`}>📆 Today</button>
                    <button onClick={() => { applyPreset('last24h'); setSelectedShift(''); }} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${activePreset === 'last24h' && !selectedShift ? 'bg-indigo-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'}`}>⏰ Last 24h</button>
                    <button onClick={() => { applyPreset('thisMonth'); setSelectedShift(''); }} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${activePreset === 'thisMonth' && !selectedShift ? 'bg-indigo-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'}`}>📊 This Month</button>
                    <button onClick={() => { applyPreset('toNow'); setSelectedShift(''); }} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${activePreset === 'toNow' && !selectedShift ? 'bg-indigo-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'}`}>⚡ Set To = Now</button>
                  </div>
                </div>
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 mt-4">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="bg-primary-600 p-1.5 rounded-lg">
                      <FiLayers className="text-white text-base" />
                    </div>
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Shift Presets</h3>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="bg-sky-600 w-3 h-3 rounded-full"></div>
                        <h4 className="text-sm font-bold text-sky-700">Control Room Shifts</h4>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">🔙 Yesterday</div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => applyShiftPreset('yesterday_morning')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Yesterday - Control Room Morning') ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>🌅 Morning (7AM–3PM)</button>
                          <button onClick={() => applyShiftPreset('yesterday_day')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Yesterday - Control Room Day') ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>☀️ Day (3PM–11PM)</button>
                          <button onClick={() => applyShiftPreset('yesterday_night')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Yesterday - Control Room Night') ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>🌙 Night (11PM–7AM)</button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">📅 Today</div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => applyShiftPreset('today_morning')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Today - Control Room Morning') ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>🌅 Morning (7AM–3PM)</button>
                          <button onClick={() => applyShiftPreset('today_day')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Today - Control Room Day') ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>☀️ Day (3PM–11PM)</button>
                          <button onClick={() => applyShiftPreset('today_night')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Today - Control Room Night') ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>🌙 Night (11PM–7AM)</button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="bg-emerald-500 w-3 h-3 rounded-full"></div>
                        <h4 className="text-sm font-bold text-emerald-700">Field Shifts</h4>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">🔙 Yesterday</div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => applyShiftPreset('yesterday_field_a')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Yesterday - Field Shift A') ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="A" /> Shift A (8AM–4PM)</button>
                          <button onClick={() => applyShiftPreset('yesterday_field_b')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Yesterday - Field Shift B') ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="B" /> Shift B (4PM–12AM)</button>
                          <button onClick={() => applyShiftPreset('yesterday_field_c')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Yesterday - Field Shift C') ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="C" /> Shift C (12AM–8AM)</button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">📅 Today</div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => applyShiftPreset('today_field_a')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Today - Field Shift A') ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="A" /> Shift A (8AM–4PM)</button>
                          <button onClick={() => applyShiftPreset('today_field_b')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Today - Field Shift B') ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="B" /> Shift B (4PM–12AM)</button>
                          <button onClick={() => applyShiftPreset('today_field_c')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Today - Field Shift C') ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="C" /> Shift C (12AM–8AM)</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-5 shadow-sm border border-gray-200 mt-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="bg-amber-600 p-1.5 rounded-lg">
                      <FiClock className="text-white text-base" />
                    </div>
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Custom Date Shift Selector</h3>
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-col">
                      <label className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                        📅 Select Date
                      </label>
                      <input
                        type="date"
                        value={customDate}
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="border-2 border-gray-200 rounded-lg px-4 py-2.5 text-sm w-full max-w-xs focus:ring-2 focus:ring-sky-500 focus:border-sky-500 focus:outline-none bg-white transition-all"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-sky-600 mb-2 flex items-center gap-1">
                        <div className="bg-sky-500 w-2 h-2 rounded-full"></div> Control Room Shifts
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => applyCustomDateShift('morning')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Control Room Morning') && selectedShift.includes(customDate) ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>🌅 Morning (7AM–3PM)</button>
                        <button onClick={() => applyCustomDateShift('day')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Control Room Day') && selectedShift.includes(customDate) ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>☀️ Day (3PM–11PM)</button>
                        <button onClick={() => applyCustomDateShift('night')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Control Room Night') && selectedShift.includes(customDate) ? 'bg-sky-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>🌙 Night (11PM–7AM)</button>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-emerald-600 mb-2 flex items-center gap-1">
                        <div className="bg-emerald-500 w-2 h-2 rounded-full"></div> Field Shifts
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => applyCustomDateShift('field_a')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Field Shift A') && selectedShift.includes(customDate) ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="A" /> Shift A (8AM–4PM)</button>
                        <button onClick={() => applyCustomDateShift('field_b')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Field Shift B') && selectedShift.includes(customDate) ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="B" /> Shift B (4PM–12AM)</button>
                        <button onClick={() => applyCustomDateShift('field_c')} className={`text-xs font-medium px-3 py-2 rounded-lg border transition-all ${selectedShift.includes('Field Shift C') && selectedShift.includes(customDate) ? 'bg-emerald-700 text-white shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}><ShiftBadge letter="C" /> Shift C (12AM–8AM)</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
