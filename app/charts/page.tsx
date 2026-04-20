'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import TrendCharts from '../components/TrendCharts';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import FilterBar from '../components/FilterBar';
import Image from 'next/image';
import { getDefaultTodayFilters, useData } from '../context/DataContext';

export default function ChartsPage() {
  const {
    data: contextData,
    loading: contextLoading,
    refreshData,
    applyFilters,
    filterOptions,
    currentFilters
  } = useData();
  const router = useRouter();
  const original = contextData;
  const [error, setError] = useState('');

  const defaultFilters = currentFilters ?? getDefaultTodayFilters();

  const [search, setSearch] = useState(defaultFilters.search);
  const [fromDT, setFromDT] = useState(defaultFilters.fromDT);
  const [toDT, setToDT] = useState(defaultFilters.toDT);
  const [statusFilter, setStatusFilter] = useState(defaultFilters.status);
  const [divisionFilter, setDivisionFilter] = useState(defaultFilters.division);
  const [subDivisionFilter, setSubDivisionFilter] = useState(defaultFilters.subDivision);
  const [subStationFilter, setSubStationFilter] = useState(defaultFilters.subStation);
  const [closedStatusFilter, setClosedStatusFilter] = useState(defaultFilters.closedStatus);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('');
  const [monthFilter, setMonthFilter] = useState<string>(defaultFilters.monthFilter);

  useEffect(() => {
    setSearch(currentFilters.search);
    setFromDT(currentFilters.fromDT);
    setToDT(currentFilters.toDT);
    setStatusFilter(currentFilters.status);
    setDivisionFilter(currentFilters.division);
    setSubDivisionFilter(currentFilters.subDivision);
    setSubStationFilter(currentFilters.subStation);
    setClosedStatusFilter(currentFilters.closedStatus);
    setMonthFilter(currentFilters.monthFilter);
  }, [currentFilters]);

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

  const closedStatusOptions = filterOptions.closedStatuses;
  const statusOptions = filterOptions.statuses;
  const divisionOptions = filterOptions.divisions;
  const subDivisionOptions = filterOptions.subDivisions;
  const subStationOptions = filterOptions.subStations;
  const monthOptions = filterOptions.months;

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

  const data = original;


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
      setError(err.message || 'Failed to load chart data');
    }
  };



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
              onClick={async () => {
                setError('');
                const result = await refreshData();
                if (!result.success) {
                  setError(result.error || 'Refresh failed');
                }
              }}
              disabled={contextLoading}
              className="inline-flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition shadow-sm"
            >
              <FiRefreshCw className={contextLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </header>

        {false && (
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

        {!error && (
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
                onApply={applyCurrentFilters}
                loading={contextLoading || isPending}
                dailyCounts={{}}
                monthFilter={monthFilter}
                setMonthFilter={handleMonthChange}
                monthOptions={monthOptions}
              />
            </div>
            {contextLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-b-4 border-blue-600"></div>
                    <p className="font-semibold text-gray-700">Loading chart data...</p>
                  </div>
                </div>
              </div>
            ) : original.length > 0 ? (
              <TrendCharts data={data} isClosedRow={isClosedRow} />
            ) : (
              <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 px-4 py-3 rounded">
                <p className="font-semibold">No complaints found for the current filters.</p>
              </div>
            )}
          </>
        )}

        {false && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ No data available to display charts</p>
          </div>
        )}
      </div>
    </div>
  );
}
