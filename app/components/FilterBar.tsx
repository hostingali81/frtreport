'use client';

import React, { useState } from 'react';
import Select from 'react-select';
import { FiSearch, FiFilter, FiCalendar, FiClock, FiX, FiLayers, FiChevronDown, FiChevronUp } from 'react-icons/fi';

import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

interface FilterBarProps {

  // Dropdowns
  divisionFilter: string;
  setDivisionFilter: (val: string) => void;
  divisionOptions: string[];

  subDivisionFilter: string;
  setSubDivisionFilter: (val: string) => void;
  subDivisionOptions: string[];

  subStationFilter: string;
  setSubStationFilter: (val: string) => void;
  subStationOptions: string[];

  statusFilter: string;
  setStatusFilter: (val: string) => void;
  statusOptions: string[];

  // Closed Status
  closedStatusFilter: string;
  setClosedStatusFilter: (val: string) => void;
  closedStatusOptions: string[];

  // Date Range
  fromDT: string;
  setFromDT: (val: string) => void;
  toDT: string;
  setToDT: (val: string) => void;

  // Presets & Shifts
  selectedShift: string;
  setSelectedShift: (val: string) => void;
  activePreset: string;
  applyPreset: (preset: 'fromNov2025ToNow' | 'today' | 'last24h' | 'thisMonth' | 'toNow' | 'yesterday') => void;
  applyShiftPreset: (shift: any) => void;

  // Custom Date Shift
  customDate: string;
  setCustomDate: (val: string) => void;
  applyCustomDateShift: (shiftType: 'morning' | 'day' | 'night' | 'field_a' | 'field_b' | 'field_c') => void;

  // Actions
  clearAllFilters: () => void;
  onApply?: () => void;
  loading?: boolean;

  // Month Filter
  monthFilter?: string;
  setMonthFilter?: (val: string) => void;
  monthOptions?: { value: string; label: string }[];

  // Data for Calendar
  dailyCounts?: Record<string, number>;
}

const buildDateTimeLocal = (date: Date, hours: number, minutes: number) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const partMap = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${partMap.year}-${partMap.month}-${partMap.day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export default function FilterBar({

  divisionFilter, setDivisionFilter, divisionOptions,
  subDivisionFilter, setSubDivisionFilter, subDivisionOptions,
  subStationFilter, setSubStationFilter, subStationOptions,
  statusFilter, setStatusFilter, statusOptions,
  closedStatusFilter, setClosedStatusFilter, closedStatusOptions,
  fromDT, setFromDT, toDT, setToDT,
  selectedShift, setSelectedShift, activePreset, applyPreset, applyShiftPreset,
  customDate, setCustomDate, applyCustomDateShift,
  clearAllFilters, onApply, loading, dailyCounts = {},
  monthFilter, setMonthFilter, monthOptions = []
}: FilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const defaultTodayRange = React.useMemo(() => {
    const now = new Date();
    return {
      fromDT: buildDateTimeLocal(now, 0, 0),
      toDT: buildDateTimeLocal(now, 23, 59)
    };
  }, []);

  React.useEffect(() => {
    if (customDate) setDateError(null);
  }, [customDate]);

  // Auto-dismiss error after 3 seconds
  React.useEffect(() => {
    if (dateError) {
      const timer = setTimeout(() => setDateError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [dateError]);

  // Helper to count active filters
  const activeCount = [
    divisionFilter, subDivisionFilter, subStationFilter, statusFilter, closedStatusFilter,
    fromDT && fromDT !== defaultTodayRange.fromDT ? fromDT : null,
    toDT && toDT !== defaultTodayRange.toDT ? toDT : null,
    selectedShift,
    (monthFilter !== 'All' && monthFilter !== '') ? monthFilter : null
  ].filter(Boolean).length;

  const selectStyles = {
    control: (base: any) => ({ ...base, minHeight: '38px', fontSize: '14px', borderRadius: '0.5rem', borderColor: '#e5e7eb' }),
    menu: (base: any) => ({ ...base, fontSize: '14px' })
  };

  const toOptions = (arr: string[]) => [{ value: '', label: 'All' }, ...arr.map(s => ({ value: s, label: s }))];

  const formatDate = (dtStr: string) => {
    if (!dtStr) return '...';
    const d = new Date(dtStr);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Calendar Helpers
  const onDateChange = (value: any) => {
    if (!value) return;
    const d = value as Date;
    // Set fromDT to Start of Day (00:00)
    // Set toDT to End of Day (23:59) (or next day 00:00 depending on filter logic, usually end of day helpful)
    // Filter logic in parent uses <= toDT probably, or <. Let's check parent logic.
    // Parent page.tsx: if (toDate && dt > toDate) return false; (Wait, if toDate is 23:59:59 it works?)
    // Let's set it to 23:59:59.

    // Construct local YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());

    setFromDT(`${yyyy}-${mm}-${dd}T00:00`);
    setToDT(`${yyyy}-${mm}-${dd}T23:59`);
  };

  const tileContent = ({ date, view }: { date: Date, view: string }) => {
    if (view === 'month') {
      const pad = (n: number) => String(n).padStart(2, '0');
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const count = dailyCounts[key];
      if (count) {
        return (
          <div className="flex justify-center mt-1">
            <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 rounded-full border border-red-200 shadow-sm">
              {count}
            </span>
          </div>
        );
      }
    }
    return null;
  };

  const tileDisabled = ({ date, view }: { date: Date, view: string }) => {
    // Only disable in month view to allow navigation between months/years
    if (view === 'month') {
      const pad = (n: number) => String(n).padStart(2, '0');
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      // Logic: Disable if NO count for this day
      // (If you want to allow clicking '0' count, remove this. But user said "jo dates data main nhi hai wo disabled dikhe")
      return !dailyCounts[key];
    }
    return false;
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-visible hover:shadow-xl transition-shadow duration-300 relative z-20">
      {/* Top Bar: Always Visible */}
      <div className="p-4 flex flex-col lg:flex-row gap-4 items-center justify-between bg-gradient-to-r from-gray-50/50 via-white to-gray-50/50">

        {/* Left: Search & Toggle */}
        <div className="flex items-center gap-3 w-full lg:w-auto flex-1 flex-wrap">


          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all active:scale-95 shadow-sm border ${isExpanded ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'}`}
          >
            <FiFilter className={isExpanded ? 'text-white' : 'text-gray-500'} />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${isExpanded ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}`}>{activeCount}</span>
            )}
            {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
          </button>

          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all active:scale-95 shadow-sm border ${showCalendar ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-200' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'}`}
          >
            <FiCalendar className={showCalendar ? 'text-white' : 'text-gray-500'} />
            <span className="hidden sm:inline">Calendar</span>
          </button>

          {/* Month Filter Dropdown */}
          {setMonthFilter && (
            <div className="w-40 flex items-center gap-2">
              <Select
                instanceId="fb-month"
                options={monthOptions}
                value={monthOptions?.find(o => o.value === monthFilter)}
                onChange={(opt) => setMonthFilter(opt?.value || '')}
                className="basic-single text-sm flex-1"
                classNamePrefix="select"
                placeholder="Month"
                isClearable={false}
                isSearchable={true}
                isDisabled={loading}
                styles={{
                  control: (base) => ({
                    ...base,
                    minHeight: '42px',
                    borderRadius: '0.75rem',
                    borderColor: '#e5e7eb',
                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                  }),
                }}
              />
              {loading && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              )}
            </div>
          )}
        </div>

        {/* Right: Date Range & Actions */}
        <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
          {/* Compact Date Range Display (if selected) */}
          {(fromDT || toDT) && !isExpanded && (
            <div className="hidden xl:flex items-center gap-2 text-xs font-medium text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 shadow-sm">
              <FiClock className="text-blue-600" />
              <span>{formatDate(fromDT)}</span>
              <span className="text-blue-400">→</span>
              <span>{formatDate(toDT)}</span>
            </div>
          )}

          {onApply && (
            <button
              onClick={onApply}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              <FiFilter className={loading ? 'animate-pulse' : ''} />
              <span>{loading ? 'Fetching...' : 'Apply Filters'}</span>
            </button>
          )}

          {activeCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="text-red-600 hover:text-red-700 active:text-red-900 text-sm font-medium flex items-center gap-1 hover:underline px-2 transition active:scale-95"
            >
              <FiX /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Calendar Dropdown Area */}
      {showCalendar && (
        <div className="p-4 bg-white border-t border-gray-100 flex justify-center animate-fadeIn">
          <div className="max-w-md w-full">
            <p className="text-center text-sm text-gray-500 mb-2">Select a date to filter (Badges show total complaints)</p>
            <Calendar
              onChange={onDateChange}
              tileContent={tileContent}
              tileDisabled={tileDisabled}
              className="shadow-sm border border-gray-200 rounded-lg w-full !font-sans"
            />
          </div>
        </div>
      )}

      {/* Expanded Section: Advanced Filters */}
      {isExpanded && (
        <div className="p-5 border-t border-gray-100 bg-white animate-fadeIn">

          {/* 1. Primary Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Division</label>
              <Select
                instanceId="fb-division"
                value={divisionFilter ? { value: divisionFilter, label: divisionFilter } : null}
                onChange={(opt) => setDivisionFilter(opt?.value || '')}
                options={toOptions(divisionOptions)}
                styles={selectStyles}
                className="text-sm"
                placeholder="All Divisions"
                isClearable
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Sub Division</label>
              <Select
                instanceId="fb-subdivision"
                value={subDivisionFilter ? { value: subDivisionFilter, label: subDivisionFilter } : null}
                onChange={(opt) => setSubDivisionFilter(opt?.value || '')}
                options={toOptions(subDivisionOptions)}
                styles={selectStyles}
                className="text-sm"
                placeholder="All Sub Divisions"
                isClearable
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Sub Station</label>
              <Select
                instanceId="fb-substation"
                value={subStationFilter ? { value: subStationFilter, label: subStationFilter } : null}
                onChange={(opt) => setSubStationFilter(opt?.value || '')}
                options={toOptions(subStationOptions)}
                styles={selectStyles}
                className="text-sm"
                placeholder="All Sub Stations"
                isClearable
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Status</label>
              <Select
                instanceId="fb-status"
                value={statusFilter ? { value: statusFilter, label: statusFilter } : null}
                onChange={(opt) => setStatusFilter(opt?.value || '')}
                options={toOptions(statusOptions)}
                styles={selectStyles}
                className="text-sm"
                placeholder="All Statuses"
                isClearable
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Closed Status</label>
              <Select
                instanceId="fb-closedstatus"
                value={closedStatusFilter ? { value: closedStatusFilter, label: closedStatusFilter } : null}
                onChange={(opt) => setClosedStatusFilter(opt?.value || '')}
                options={toOptions(closedStatusOptions)}
                styles={selectStyles}
                className="text-sm"
                placeholder="Closed Status"
                isClearable
              />
            </div>
          </div>

          <div className="border-t border-gray-100 my-4"></div>

          {/* 2. Date & Presets Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

            {/* Left: Date Range & Quick Presets (Col Span 5) */}
            <div className="xl:col-span-5 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <FiCalendar /> Date Range
                </h3>
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                  <div className="flex-1">
                    <input
                      type="datetime-local"
                      value={fromDT}
                      onChange={(e) => setFromDT(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <span className="text-gray-400">to</span>
                  <div className="flex-1">
                    <input
                      type="datetime-local"
                      value={toDT}
                      onChange={(e) => setToDT(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Quick Presets</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'today', label: 'Today', icon: '📆' },
                    { id: 'yesterday', label: 'Yesterday', icon: 'back' },
                    { id: 'last24h', label: 'Last 24h', icon: '⏰' },
                    { id: 'thisMonth', label: 'This Month', icon: '📊' },
                    { id: 'fromNov2025ToNow', label: 'Nov 25 →', icon: '📅' },
                  ].map((preset: any) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        if (preset.id === 'yesterday') {
                          // Special handling for yesterday if passed as generic preset in app logic, 
                          // but here we assume the parent handler knows what 'yesterday' string means
                          // OR we manually construct it if the parent expects a specific call.
                          // Based on props, applyPreset takes specific strings.
                          applyPreset('yesterday');
                        } else {
                          applyPreset(preset.id);
                        }
                        setSelectedShift('');
                      }}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all active:scale-95 ${activePreset === preset.id && !selectedShift
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                      {preset.icon === 'back' ? <FiClock className="inline mr-1" /> : preset.icon} {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Middle: Shift Presets (Col Span 7) */}
            <div className="xl:col-span-7">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FiLayers /> Shift Selectors
              </h3>

              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 flex flex-col gap-4">
                {/* Standard Shifts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Control Room */}
                  <div>
                    <div className="text-xs font-bold text-blue-700 mb-2 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-600"></div> Control Room</div>
                    <div className="space-y-2">
                      <div className="flex gap-1 items-center">
                        <span className="text-[10px] font-semibold text-gray-400 w-12">Today</span>
                        <div className="flex gap-1 flex-1">
                          {['today_morning', 'today_day', 'today_night'].map(s => {
                            const shiftName = s.split('_')[1]; // morning, day, night
                            const capShiftName = shiftName.charAt(0).toUpperCase() + shiftName.slice(1);
                            // Strict check using startsWith to avoid "Today" matching "day"
                            const isActive = selectedShift.startsWith('Today') && selectedShift.includes(`Control Room ${capShiftName}`);
                            return (
                              <button key={s} onClick={() => applyShiftPreset(s)}
                                className={`flex-1 text-[10px] py-1.5 rounded border transition active:scale-95 ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-white/50 border-gray-200 text-gray-600'}`}>
                                {capShiftName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-1 items-center">
                        <span className="text-[10px] font-semibold text-gray-400 w-12">Yest.</span>
                        <div className="flex gap-1 flex-1">
                          {['yesterday_morning', 'yesterday_day', 'yesterday_night'].map(s => {
                            const shiftName = s.split('_')[1];
                            const capShiftName = shiftName.charAt(0).toUpperCase() + shiftName.slice(1);
                            const isActive = selectedShift.startsWith('Yesterday') && selectedShift.includes(`Control Room ${capShiftName}`);
                            return (
                              <button key={s} onClick={() => applyShiftPreset(s)}
                                className={`flex-1 text-[10px] py-1.5 rounded border transition active:scale-95 ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-white/50 border-gray-200 text-gray-600'}`}>
                                {capShiftName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Field */}
                  <div>
                    <div className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-600"></div> Field</div>
                    <div className="space-y-2">
                      <div className="flex gap-1 items-center">
                        <span className="text-[10px] font-semibold text-gray-400 w-12">Today</span>
                        <div className="flex gap-1 flex-1">
                          {['today_field_a', 'today_field_b', 'today_field_c'].map(s => {
                            const letter = s.slice(-1).toUpperCase();
                            const isActive = selectedShift.startsWith('Today') && selectedShift.includes(`Field Shift ${letter}`);
                            return (
                              <button key={s} onClick={() => applyShiftPreset(s)}
                                className={`flex-1 text-[10px] py-1.5 rounded border transition active:scale-95 flex items-center justify-center ${isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-white/50 border-gray-200 text-gray-600'}`}>
                                <span className="font-bold">{letter}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-1 items-center">
                        <span className="text-[10px] font-semibold text-gray-400 w-12">Yest.</span>
                        <div className="flex gap-1 flex-1">
                          {['yesterday_field_a', 'yesterday_field_b', 'yesterday_field_c'].map(s => {
                            const letter = s.slice(-1).toUpperCase();
                            const isActive = selectedShift.startsWith('Yesterday') && selectedShift.includes(`Field Shift ${letter}`);
                            return (
                              <button key={s} onClick={() => applyShiftPreset(s)}
                                className={`flex-1 text-[10px] py-1.5 rounded border transition active:scale-95 flex items-center justify-center ${isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-white/50 border-gray-200 text-gray-600'}`}>
                                <span className="font-bold">{letter}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Custom Date Shift Selector */}
                <div className="pt-3 mt-1 border-t border-gray-200">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Custom Date Shift:</label>
                      <input
                        type="date"
                        value={customDate}
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <div className="flex gap-1">
                        {['morning', 'day', 'night'].map(s => {
                          const capS = s.charAt(0).toUpperCase() + s.slice(1);
                          const isActive = customDate && selectedShift.startsWith(customDate) && selectedShift.includes(`Control Room ${capS}`);
                          return (
                            <button key={s}
                              onClick={() => {
                                if (!customDate) {
                                  setDateError('Please select a date first!');
                                  return;
                                }
                                applyCustomDateShift(s as any);
                              }}
                              className={`px-2 py-1 text-[10px] font-medium rounded border transition active:scale-95 ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200'}`}>
                              {capS}
                            </button>
                          );
                        })}
                      </div>
                      <div className="w-px h-4 bg-gray-300 mx-1"></div>
                      <div className="flex gap-1">
                        {['field_a', 'field_b', 'field_c'].map(s => {
                          const letter = s.split('_')[1].toUpperCase();
                          const isActive = customDate && selectedShift.startsWith(customDate) && selectedShift.includes(`Field Shift ${letter}`);
                          return (
                            <button key={s}
                              onClick={() => {
                                if (!customDate) {
                                  setDateError('Please select a date first!');
                                  return;
                                }
                                applyCustomDateShift(s as any);
                              }}
                              className={`px-2 py-1 text-[10px] font-medium rounded border transition active:scale-95 ${isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'}`}>
                              Sh-{letter}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {dateError && (
                      <p className="text-[10px] text-red-600 font-bold ml-[110px] animate-pulse">
                        ⚠️ {dateError}
                      </p>
                    )}
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      )}

      {/* Active Shift Indicator Banner (if any) */}
      {selectedShift && (
        <div className="bg-sky-50 px-4 py-2 border-t border-sky-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sky-800 text-sm font-medium">
            <FiLayers className="text-sky-600" />
            <span>Active Shift: <b>{selectedShift}</b></span>
          </div>
          <button onClick={() => setSelectedShift('')} className="text-sky-600 hover:text-sky-800 active:text-sky-900 text-xs underline transition active:scale-95">
            Clear Shift
          </button>
        </div>
      )}
    </div>
  );
}
