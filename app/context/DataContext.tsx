'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

export interface ComplaintFilters {

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

export interface RepeatConsumer {
  mobile: string;
  name: string;
  address: string;
  total: number;
  pending: number;
  closed: number;
  complaints: Record<string, string>[];
}

// Shape of the get_complaints_stats RPC payload (served by /api/complaints/stats).
export interface ChartStats {
  total: number;
  byDivision: { k: string; n: number }[];
  bySubStation: { k: string; n: number }[];
  byAreaType: { k: string; n: number }[];
  byClosedStatus: { k: string; n: number }[];
  // Feeder-wise rollup grouped by (substation, feeder) — the same feeder name
  // under two substations is two different feeders. Rows without a feeder
  // (scraped before the FRT report exposed the column) are excluded, so
  // sum(n) < total is expected.
  byFeeder?: { k: string; ss: string; n: number; pending: number; beyond: number; resSum: number; resN: number }[];
  beyondByDivision: { k: string; n: number }[];
  daily: { d: string; n: number; cr: number; frt: number; resSum: number; resN: number }[];
  months: { key: string; label: string; total: number; beyond: number; resSum: number; resN: number }[];
  monthHeat: { m: string; dow: number; hr: number; n: number }[];
  monthSubStation: { m: string; k: string; n: number; resSum: number; resN: number }[];
  monthDivision: { m: string; k: string; n: number; resSum: number; resN: number }[];
  repeatMobile: RepeatConsumer[];
  repeatNameAddr: RepeatConsumer[];
}

interface DataContextType {
  data: any[];
  loading: boolean;
  stats: ChartStats | null;
  statsLoading: boolean;
  lastUpdated: string;
  currentFilters: ComplaintFilters;
  filterOptions: FilterOptions;
  applyFilters: (filters: ComplaintFilters, options?: { withRows?: boolean }) => Promise<void>;
  ensureRows: () => Promise<void>;
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

export function buildFilterParams(filters: ComplaintFilters) {
  const resolved = resolveFilters(filters);
  const params = new URLSearchParams();


  if (resolved.division) params.set('division', resolved.division);
  if (resolved.subDivision) params.set('subDivision', resolved.subDivision);
  if (resolved.subStation) params.set('subStation', resolved.subStation);
  if (resolved.status) params.set('status', resolved.status);
  if (resolved.closedStatus) params.set('closedStatus', resolved.closedStatus);
  if (resolved.fromDT) params.set('fromDate', resolved.fromDT);
  if (resolved.toDT) params.set('toDate', resolved.toDT);

  return params;
}

function buildQueryString(filters: ComplaintFilters) {
  const params = buildFilterParams(filters);
  params.set('fetchAll', 'true');
  return params.toString();
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<any[]>([]);
  // No page loads rows automatically anymore (the homepage table is
  // server-paginated), so rows start "not loading".
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ChartStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(emptyOptions);
  const [currentFilters, setCurrentFilters] = useState<ComplaintFilters>(getDefaultTodayFilters);

  // Filters the currently loaded rows correspond to. Chart pages fetch only
  // stats, so rows can go stale; the main page calls ensureRows() to refetch.
  const rowsFiltersRef = useRef<ComplaintFilters | null>(null);
  const currentFiltersRef = useRef<ComplaintFilters>(currentFilters);
  const rowsInFlightRef = useRef<{ filters: ComplaintFilters; promise: Promise<void> } | null>(null);

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

  const loadStats = async (
    filters: ComplaintFilters,
    options: { forceRefresh?: boolean } = {}
  ) => {
    setStatsLoading(true);

    try {
      const params = buildFilterParams(filters);
      if (options.forceRefresh) params.set('refresh', '1');
      const response = await fetch(`/api/complaints/stats?${params.toString()}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch stats');
      }

      setStats(result.stats || null);

      if (result.lastScrapedAt) {
        setLastUpdated(result.lastScrapedAt);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
      setStats(null);
      throw error;
    } finally {
      setStatsLoading(false);
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

    const task = (async () => {
      const queryString = buildQueryString(filters);
      const url = `/api/complaints?${queryString}${forceRefresh ? '&refresh=1' : ''}`;
      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch complaints');
      }

      setData(result.data || []);
      rowsFiltersRef.current = filters;

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
    })();

    const inFlightEntry = { filters, promise: task.catch(() => undefined) as Promise<void> };
    rowsInFlightRef.current = inFlightEntry;

    try {
      await task;
    } catch (error) {
      console.error('Failed to load complaints:', error);
      setData([]);
      rowsFiltersRef.current = null;
      throw error;
    } finally {
      if (rowsInFlightRef.current === inFlightEntry) {
        rowsInFlightRef.current = null;
      }
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const applyFilters = async (
    filters: ComplaintFilters,
    options: { withRows?: boolean } = {}
  ) => {
    const { withRows = true } = options;

    setCurrentFilters(filters);
    currentFiltersRef.current = filters;

    if (withRows) {
      await Promise.all([
        loadComplaints(filters),
        loadStats(filters).catch(() => undefined)
      ]);
    } else {
      await loadStats(filters);
    }
  };

  // Fetch rows for the current filters if the loaded rows don't match them
  // (e.g. filters were changed from a stats-only chart page).
  const ensureRows = async () => {
    const filters = currentFiltersRef.current;
    if (rowsFiltersRef.current && areFiltersEqual(rowsFiltersRef.current, filters)) {
      return;
    }
    const inFlight = rowsInFlightRef.current;
    if (inFlight && areFiltersEqual(inFlight.filters, filters)) {
      await inFlight.promise;
      return;
    }
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

      const filters = currentFiltersRef.current;
      const rowsAreCurrent =
        rowsFiltersRef.current && areFiltersEqual(rowsFiltersRef.current, filters);

      const tasks: Promise<unknown>[] = [loadStats(filters, { forceRefresh: true }).catch(() => undefined)];
      if (rowsAreCurrent) {
        tasks.push(loadComplaints(filters, { forceRefresh: true, silent: true }));
      } else {
        // Rows are stale anyway; let the main page refetch them on demand.
        rowsFiltersRef.current = null;
      }
      await Promise.all(tasks);

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
    currentFiltersRef.current = initialFilters;
    const cachedOptions = readClientCache<FilterOptions>('localStorage', FILTER_OPTIONS_CACHE_KEY, FILTER_OPTIONS_CACHE_TTL);

    if (cachedOptions) {
      setFilterOptions(normalizeFilterOptions(cachedOptions));
    }

    void loadStats(initialFilters).catch(() => undefined);
    void fetchOptions();
  }, []);

  return (
    <DataContext.Provider
      value={{
        data,
        loading,
        stats,
        statsLoading,
        lastUpdated,
        currentFilters,
        filterOptions,
        applyFilters,
        ensureRows,
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
