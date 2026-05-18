'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface ComplaintFilters {
  search: string;
  division: string;
  subDivision: string;
  subStation: string;
  status: string;
  closedStatus: string;
  fromDT: string;
  toDT: string;
  monthFilter: string;
}

interface FilterOptions {
  divisions: string[];
  subDivisions: string[];
  subStations: string[];
  statuses: string[];
  closedStatuses: string[];
  months: { value: string; label: string }[];
}

interface RefreshResult {
  success: boolean;
  error?: string;
  lastScrapedAt?: string;
  stats?: {
    scraped?: number;
    new?: number;
    updated?: number;
    total_in_db?: number;
    duration?: number;
  };
}

interface DataContextType {
  data: any[];
  loading: boolean;
  lastUpdated: string;
  currentFilters: ComplaintFilters;
  filterOptions: FilterOptions;
  applyFilters: (filters: ComplaintFilters) => Promise<void>;
  refreshData: () => Promise<RefreshResult>;
}

const emptyOptions: FilterOptions = {
  divisions: [],
  subDivisions: [],
  subStations: [],
  statuses: [],
  closedStatuses: [],
  months: [{ value: 'All', label: 'All Months' }]
};

const FILTER_OPTIONS_CACHE_KEY = 'frt-filter-options-v2';
const TODAY_DATA_CACHE_KEY = 'frt-today-data-v1';
const FILTER_OPTIONS_CACHE_TTL = 6 * 60 * 60 * 1000;
const TODAY_DATA_CACHE_TTL = 3 * 60 * 1000;

interface CachedEnvelope<T> {
  timestamp: number;
  value: T;
}

interface CachedTodayData {
  dayKey: string;
  filters: ComplaintFilters;
  data: any[];
  lastUpdated: string;
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

const getISTDayKey = (date: Date) => {
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

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
};

export const getDefaultTodayFilters = (): ComplaintFilters => {
  const now = new Date();

  return {
    search: '',
    division: '',
    subDivision: '',
    subStation: '',
    status: '',
    closedStatus: '',
    fromDT: buildDateTimeLocal(now, 0, 0),
    toDT: buildDateTimeLocal(now, 23, 59),
    monthFilter: ''
  };
};

const areFiltersEqual = (left: ComplaintFilters, right: ComplaintFilters) =>
  left.search === right.search &&
  left.division === right.division &&
  left.subDivision === right.subDivision &&
  left.subStation === right.subStation &&
  left.status === right.status &&
  left.closedStatus === right.closedStatus &&
  left.fromDT === right.fromDT &&
  left.toDT === right.toDT &&
  left.monthFilter === right.monthFilter;

const isTodayLandingFilters = (filters: ComplaintFilters) => areFiltersEqual(filters, getDefaultTodayFilters());

function getMonthSortTime(month: string) {
  const parsed = new Date(month);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizeFilterOptions(options: FilterOptions): FilterOptions {
  const allMonth = options.months.find((month) => month.value === 'All') || { value: 'All', label: 'All Months' };
  const months = options.months
    .filter((month) => month.value !== 'All')
    .sort((left, right) => getMonthSortTime(right.value) - getMonthSortTime(left.value));

  return {
    ...options,
    months: [allMonth, ...months]
  };
}

function readClientCache<T>(storageType: 'localStorage' | 'sessionStorage', key: string, ttl: number): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window[storageType].getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedEnvelope<T>;
    if (!parsed?.timestamp) return null;

    if (Date.now() - parsed.timestamp > ttl) {
      window[storageType].removeItem(key);
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

function writeClientCache<T>(storageType: 'localStorage' | 'sessionStorage', key: string, value: T) {
  if (typeof window === 'undefined') return;

  try {
    const payload: CachedEnvelope<T> = {
      timestamp: Date.now(),
      value
    };
    window[storageType].setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore client storage failures quietly.
  }
}

const DataContext = createContext<DataContextType | undefined>(undefined);

function resolveFilters(filters: ComplaintFilters) {
  if (filters.monthFilter && filters.monthFilter !== 'All' && !filters.fromDT && !filters.toDT) {
    const monthDate = new Date(`${filters.monthFilter} 1`);
    if (!Number.isNaN(monthDate.getTime())) {
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

      return {
        ...filters,
        fromDT: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-${String(monthStart.getDate()).padStart(2, '0')}T00:00`,
        toDT: `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}T23:59`
      };
    }
  }

  return filters;
}

function buildQueryString(filters: ComplaintFilters) {
  const resolved = resolveFilters(filters);
  const params = new URLSearchParams({ fetchAll: 'true' });

  if (resolved.search.trim()) params.set('search', resolved.search.trim());
  if (resolved.division) params.set('division', resolved.division);
  if (resolved.subDivision) params.set('subDivision', resolved.subDivision);
  if (resolved.subStation) params.set('subStation', resolved.subStation);
  if (resolved.status) params.set('status', resolved.status);
  if (resolved.closedStatus) params.set('closedStatus', resolved.closedStatus);
  if (resolved.fromDT) params.set('fromDate', resolved.fromDT);
  if (resolved.toDT) params.set('toDate', resolved.toDT);

  return params.toString();
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(emptyOptions);
  const [currentFilters, setCurrentFilters] = useState<ComplaintFilters>(getDefaultTodayFilters);

  const fetchOptions = async () => {
    try {
      const response = await fetch('/api/complaints/options');
      const result = await response.json();

      if (result.success && result.options) {
        const normalizedOptions = normalizeFilterOptions(result.options);
        setFilterOptions(normalizedOptions);
        writeClientCache('localStorage', FILTER_OPTIONS_CACHE_KEY, normalizedOptions);
      }
    } catch (error) {
      console.error('Failed to load filter options:', error);
    }
  };

  const loadComplaints = async (
    filters: ComplaintFilters,
    options: { forceRefresh?: boolean; silent?: boolean } = {}
  ) => {
    const { forceRefresh = false, silent = false } = options;

    if (!silent) {
      setLoading(true);
    }

    try {
      const queryString = buildQueryString(filters);
      const url = `/api/complaints?${queryString}${forceRefresh ? '&refresh=1' : ''}`;
      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch complaints');
      }

      setData(result.data || []);
      setCurrentFilters(filters);

      if (result.lastScrapedAt) {
        setLastUpdated(result.lastScrapedAt);
      }

      if (isTodayLandingFilters(filters)) {
        writeClientCache<CachedTodayData>('sessionStorage', TODAY_DATA_CACHE_KEY, {
          dayKey: getISTDayKey(new Date()),
          filters,
          data: result.data || [],
          lastUpdated: result.lastScrapedAt || ''
        });
      }
    } catch (error) {
      console.error('Failed to load complaints:', error);
      setData([]);
      throw error;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const applyFilters = async (filters: ComplaintFilters) => {
    await loadComplaints(filters);
  };

  const refreshData = async (): Promise<RefreshResult> => {
    setLoading(true);

    try {
      const response = await fetch('/api/scrape?refresh=1');
      const result = await response.json();

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Refresh failed'
        };
      }

      if (result.lastScrapedAt) {
        setLastUpdated(result.lastScrapedAt);
      }

      await loadComplaints(currentFilters, { forceRefresh: true, silent: true });

      return {
        success: true,
        lastScrapedAt: result.lastScrapedAt,
        stats: result.stats
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Refresh failed'
      };
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialFilters = getDefaultTodayFilters();
    const cachedOptions = readClientCache<FilterOptions>('localStorage', FILTER_OPTIONS_CACHE_KEY, FILTER_OPTIONS_CACHE_TTL);
    const cachedTodayData = readClientCache<CachedTodayData>('sessionStorage', TODAY_DATA_CACHE_KEY, TODAY_DATA_CACHE_TTL);

    if (cachedOptions) {
      setFilterOptions(normalizeFilterOptions(cachedOptions));
    }

    if (
      cachedTodayData &&
      cachedTodayData.dayKey === getISTDayKey(new Date()) &&
      areFiltersEqual(cachedTodayData.filters, initialFilters)
    ) {
      setData(cachedTodayData.data || []);
      setLastUpdated(cachedTodayData.lastUpdated || '');
      setCurrentFilters(initialFilters);
      setLoading(false);
      void loadComplaints(initialFilters, { silent: true });
    } else {
      void loadComplaints(initialFilters);
    }

    void fetchOptions();
  }, []);

  return (
    <DataContext.Provider
      value={{
        data,
        loading,
        lastUpdated,
        currentFilters,
        filterOptions,
        applyFilters,
        refreshData
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
