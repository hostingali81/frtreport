'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { FiDownload, FiRefreshCw, FiFileText, FiClock, FiBarChart2, FiTrendingUp, FiLayers, FiInfo, FiActivity, FiCalendar } from 'react-icons/fi';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { buildFilterParams, getDefaultTodayFilters, useData } from './context/DataContext';
import { loadExcelJS } from './utils/lazyImports';

// Dynamic imports for heavy components
const FilterBar = dynamic(() => import('./components/FilterBar'), { ssr: false });

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Rows per export round trip. A mapped row is ~580 bytes, so 5k slices stay
// under the serverless response size limit and well inside the time budget.
const EXPORT_CHUNK_SIZE = 5000;

// Excel has no native chart API in ExcelJS, so report charts are painted on a
// canvas and embedded as images. Greys + black outlines only, to match the
// monochrome print styling of the sheets they sit under.
type ChartSeries = { name: string; values: number[]; shade: string };

const niceStep = (rough: number) => {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
};

const compactNumber = (value: number) => {
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return String(Math.round(value));
};

const renderMonochromeChart = (opts: {
  title: string;
  subtitle?: string;
  categories: string[];
  series: ChartSeries[];
  kind: 'line' | 'bar';
  width?: number;
  height?: number;
}) => {
  const W = opts.width ?? 660;
  const H = opts.height ?? 300;
  const SCALE = 2; // draw at 2x so the embedded PNG stays crisp when printed

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(SCALE, SCALE);

  const FONT = 'Calibri, Arial, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillText(opts.title, W / 2, 18);
  if (opts.subtitle) {
    ctx.font = `10px ${FONT}`;
    ctx.fillText(opts.subtitle, W / 2, 36);
  }

  const padTop = opts.subtitle ? 52 : 40;
  const padBottom = opts.series.length > 1 ? 52 : 38;
  const padLeft = 52;
  const padRight = 14;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const yBase = padTop + plotH;

  const maxValue = Math.max(1, ...opts.series.flatMap((s) => s.values));
  const step = niceStep(maxValue / 4);
  // Extra headroom so the value printed above the tallest bar/point still fits.
  const top = Math.max(step, Math.ceil((maxValue * 1.12) / step) * step);

  ctx.font = `10px ${FONT}`;
  for (let v = 0; v <= top + 1e-6; v += step) {
    const y = yBase - (v / top) * plotH;
    ctx.strokeStyle = v === 0 ? '#000000' : '#D9D9D9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.fillText(compactNumber(v), padLeft - 6, y);
  }

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, yBase);
  ctx.lineTo(padLeft + plotW, yBase);
  ctx.stroke();

  const slot = plotW / Math.max(opts.categories.length, 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  opts.categories.forEach((label, i) => {
    ctx.fillText(label, padLeft + slot * (i + 0.5), yBase + 13);
  });

  if (opts.kind === 'bar') {
    const groupPad = slot * 0.18;
    const barW = Math.max(2, (slot - groupPad * 2) / opts.series.length);
    opts.series.forEach((serie, si) => {
      serie.values.forEach((value, i) => {
        const barH = (value / top) * plotH;
        const x = padLeft + slot * i + groupPad + si * barW;
        ctx.fillStyle = serie.shade;
        ctx.fillRect(x, yBase - barH, barW - 1, barH);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.7;
        ctx.strokeRect(x, yBase - barH, barW - 1, barH);

        if (value <= 0) return;
        // Value above the column: printed flat when the bar is wide enough,
        // otherwise turned on its side so neighbouring labels never collide.
        const text = value.toLocaleString('en-IN');
        ctx.font = `8px ${FONT}`;
        ctx.fillStyle = '#000000';
        const textW = ctx.measureText(text).width;
        const centreX = x + (barW - 1) / 2;
        if (textW <= barW - 2) {
          ctx.textAlign = 'center';
          ctx.fillText(text, centreX, yBase - barH - 6);
        } else {
          ctx.save();
          ctx.translate(centreX, yBase - barH - 4);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left';
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
        ctx.font = `10px ${FONT}`;
      });
    });
  } else {
    opts.series.forEach((serie) => {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      serie.values.forEach((value, i) => {
        const x = padLeft + slot * (i + 0.5);
        const y = yBase - (value / top) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      serie.values.forEach((value, i) => {
        const x = padLeft + slot * (i + 0.5);
        const y = yBase - (value / top) * plotH;
        ctx.fillStyle = serie.shade;
        ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 3, y - 3, 6, 6);
        if (serie.values.length <= 14) {
          // White backing so the label stays readable where the line is steep.
          const text = value.toLocaleString('en-IN');
          ctx.font = `9px ${FONT}`;
          ctx.textAlign = 'center';
          const textW = ctx.measureText(text).width;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(x - textW / 2 - 2, y - 18, textW + 4, 11);
          ctx.fillStyle = '#000000';
          ctx.fillText(text, x, y - 12);
          ctx.font = `10px ${FONT}`;
        }
      });
    });
  }

  if (opts.series.length > 1) {
    const swatch = 10;
    const gap = 18;
    ctx.font = `10px ${FONT}`;
    const widths = opts.series.map((s) => swatch + 5 + ctx.measureText(s.name).width);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (opts.series.length - 1);
    let x = padLeft + (plotW - totalWidth) / 2;
    const y = H - 14;
    opts.series.forEach((serie, i) => {
      ctx.fillStyle = serie.shade;
      ctx.fillRect(x, y - swatch / 2, swatch, swatch);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x, y - swatch / 2, swatch, swatch);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.fillText(serie.name, x + swatch + 5, y);
      x += widths[i] + gap;
    });
  }

  return canvas.toDataURL('image/png');
};

export default function Home() {
  const {
    stats,
    statsLoading,
    lastUpdated: contextLastUpdated,
    refreshData,
    applyFilters,
    filterOptions,
    currentFilters
  } = useData();

  const router = useRouter();

  // Server-paginated table state: only the visible page (100 rows) is
  // downloaded; counts and dashboard cards come from the stats RPC.
  const [tableRows, setTableRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [tableLoading, setTableLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const allRowsCacheRef = useRef<{ key: string; rows: any[] } | null>(null);
  const exportNeedsRefreshRef = useRef(false);
  // Unfiltered slim dataset shared by the month-wise exports (substation and
  // circle/division); reused across clicks until the next data refresh.
  const monthwiseRowsCacheRef = useRef<any[] | null>(null);
  const monthwiseNeedsRefreshRef = useRef(false);

  useEffect(() => {
    router.prefetch('/analytics');
  }, [router]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const loading = statsLoading || tableLoading || isRefreshing;

  const [error, setError] = useState('');
  const defaultFilters = currentFilters ?? getDefaultTodayFilters();

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

  // Every date string the API hands back is MM/DD/YYYY hh:mm AM (Postgres
  // to_char on the RPC path, en-US toLocaleString on the paged path). Reading
  // the first part as the day pushed every date after the 12th into a later
  // month - and past December, into a later year - which is what wrecked the
  // month columns and the resolution-time maths.
  const parsePossibleDate = (value: string) => {
    const clean = value.trim();
    if (!clean) return null;

    const match = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!match) return null;

    let month = parseInt(match[1], 10);
    let day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    // Tolerate a stray DD/MM string rather than dropping the row.
    if (month > 12 && day <= 12) {
      [month, day] = [day, month];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

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

    return new Date(year, month - 1, day, hours, minutes);
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
      // Stats only; the table fetches its own page when currentFilters change.
      await applyFilters({
        division: divisionFilter,
        subDivision: subDivisionFilter,
        subStation: subStationFilter,
        status: statusFilter,
        closedStatus: closedStatusFilter,
        fromDT,
        toDT,
        monthFilter
      }, { withRows: false });
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
      if (val) {
        setFromDT('');
        setToDT('');
        setActivePreset('');
        setSelectedShift('');
        setCustomDate('');
      }
    });
  };

  // Fetch one table page from the server (sorted there too).
  const loadTablePage = async (page: number, options: { refresh?: boolean } = {}) => {
    setTableLoading(true);

    try {
      const params = buildFilterParams(currentFilters);
      params.set('page', String(page));
      params.set('limit', String(rowsPerPage));
      if (sortColumn) {
        params.set('sortBy', sortColumn);
        params.set('sortDir', sortDirection);
      }
      if (options.refresh) params.set('refresh', '1');

      const response = await fetch(`/api/complaints?${params.toString()}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch complaints');
      }

      setTableRows(result.data || []);
      setTotalCount(result.total || 0);
    } catch (err: any) {
      setTableRows([]);
      setTotalCount(0);
      setError(err.message || 'Failed to fetch complaints');
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    void loadTablePage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilters, sortColumn, sortDirection]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    void loadTablePage(page);
  };

  const totalPages = Math.ceil(totalCount / rowsPerPage);

  // Walks the export dataset in keyset-paginated slices. One giant fetchAll
  // response used to die on the server (memory/60s budget) for wide filters
  // like Nov-to-now, and the client saw the platform's HTML error page as
  // "Unexpected token 'A'".
  const fetchAllRowsChunked = async (
    key: string,
    options: { refresh?: boolean; onProgress?: (fetched: number) => void } = {}
  ): Promise<any[]> => {
    const rows: any[] = [];
    let cursor: { date: string; id: number } | null = null;

    for (;;) {
      const params = new URLSearchParams(key);
      params.set('pageSize', String(EXPORT_CHUNK_SIZE));
      if (options.refresh) params.set('refresh', '1');
      if (cursor) {
        params.set('afterDate', cursor.date);
        params.set('afterId', String(cursor.id));
      }

      const response = await fetch(`/api/complaints?${params.toString()}`);
      const body = await response.text();

      let result: any;
      try {
        result = JSON.parse(body);
      } catch {
        throw new Error(
          `Server returned a non-JSON response (HTTP ${response.status}) after ${rows.length} rows: ${body.slice(0, 120)}`
        );
      }

      if (!response.ok || !result.success) {
        throw new Error(result?.error || `Failed to fetch rows for export (HTTP ${response.status})`);
      }

      for (const row of result.data || []) rows.push(row);
      options.onProgress?.(rows.length);

      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    return rows;
  };

  // Exports and detailed reports still need every matching row; fetch them
  // only when the user actually asks, and reuse across exports of the same
  // filter set.
  const ensureAllRows = async (): Promise<any[]> => {
    const params = buildFilterParams(currentFilters);
    params.set('fetchAll', 'true');
    const key = params.toString();

    if (!exportNeedsRefreshRef.current && allRowsCacheRef.current?.key === key) {
      return allRowsCacheRef.current.rows;
    }

    setExportLoading(true);
    setExportProgress(0);
    try {
      const rows = await fetchAllRowsChunked(key, {
        refresh: exportNeedsRefreshRef.current,
        onProgress: setExportProgress
      });

      allRowsCacheRef.current = { key, rows };
      exportNeedsRefreshRef.current = false;
      return rows;
    } catch (err: any) {
      alert(`Export data fetch failed: ${err.message || 'unknown error'}`);
      throw err;
    } finally {
      setExportLoading(false);
    }
  };

  // Calendar baubles come from the stats RPC (per-IST-date totals).
  const dailyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const day of stats?.daily ?? []) {
      counts[day.d] = day.n;
    }
    return counts;
  }, [stats]);

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

  const exportDivisionSummary = async () => {
    const rows = await ensureAllRows();
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

  const exportSubStationCount = async () => {
    const rows = await ensureAllRows();
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

  const exportDetailedClosedBreakdown = async () => {
    const rows = await ensureAllRows();
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

  const exportDivisionCount = async () => {
    const rows = await ensureAllRows();
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

  const exportSubDivisionCount = async () => {
    const rows = await ensureAllRows();
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

  const exportDatewiseTotalCount = async () => {
    const rows = await ensureAllRows();
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

  const exportSubDivisionSummary = async () => {
    const rows = await ensureAllRows();
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

  const exportSubStationSummary = async () => {
    const rows = await ensureAllRows();
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

  const exportClosedStatusDivision = async () => {
    const rows = await ensureAllRows();
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

  const exportClosedStatusSubDivision = async () => {
    const rows = await ensureAllRows();
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

  const exportClosedStatusSubStation = async () => {
    const rows = await ensureAllRows();
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

  const exportAreaTypeBreakdown = async () => {
    const rows = await ensureAllRows();
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

  const exportStatusBreakdown = async () => {
    const rows = await ensureAllRows();
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

  const exportSubDivisionClosedBreakdown = async () => {
    const rows = await ensureAllRows();
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

  const exportDatewiseClosedBreakdown = async () => {
    const rows = await ensureAllRows();
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

  const exportDivisionClosedBreakdown = async () => {
    const rows = await ensureAllRows();
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

  const exportDetailedReportPDF = async () => {
    const rows = await ensureAllRows();
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

  const exportSummaryPDF = async () => {
    const rows = await ensureAllRows();
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
    const rows = await ensureAllRows();
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
    const rows = await ensureAllRows();
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
    wsCover.addRow([`Filters: Status="${statusApplied}"`]);
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

    // Make time bold in date columns
    const toRichDateTime = (val: string) => {
      const timeMatch = val.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (!timeMatch) return val;
      const datepart = val.substring(0, val.indexOf(timeMatch[1]));
      return {
        richText: [
          { text: datepart },
          { font: { bold: true, size: 11 }, text: timeMatch[1] }
        ]
      };
    };

    // Status cell colors are applied in the single styling pass below
    const statusClasses: Array<'closed' | 'pending' | 'other'> = [];
    for (const r of rows) {
      const minutes = computeResolutionTimeMinutes(r);
      const rowVals = headers.map(h => {
        if (h === 'Resolution Time') return minutes === null ? '' : formatDuration(minutes * 60000);
        if (h === 'Resolution Time (Minutes)') return minutes;
        if (h === 'Complaint Date and Time') return toRichDateTime(formatDateTime(String((r as any)[h] ?? '')));
        if (h === 'Closed Date') return toRichDateTime(formatDateTime(String((r as any)[h] ?? '')));
        return String((r as any)[h] ?? '');
      });
      wsData.addRow(rowVals);

      const statusStr = String((r as any)['Status'] ?? '').trim().toLowerCase();
      statusClasses.push(isClosedRow(r) ? 'closed' : statusStr.includes('pending') ? 'pending' : 'other');
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
    // borders + alt rows + status colors in one pass. Shared style objects
    // instead of per-cell property assignment: ExcelJS allocates a style per
    // cell otherwise, and dedupes shared references at write time.
    const bodyEnd = wsData.lastRow.number;
    const fullBorder = {
      top: theme.border,
      left: theme.border,
      bottom: theme.border,
      right: theme.border,
    };
    const altRowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.altFill } };
    // [0] = normal row, [1] = alternating row (alt fill wins over any base fill)
    const stylePair = (style: Record<string, unknown>): Record<string, unknown>[] => [
      { border: fullBorder, ...style },
      { border: fullBorder, ...style, fill: altRowFill },
    ];
    const defaultCellStyles = stylePair({ alignment: { vertical: 'middle' } });
    const remarksCellStyles = stylePair({ alignment: { wrapText: true, vertical: 'top' } });
    const minutesCellStyles = stylePair({ alignment: { vertical: 'middle', horizontal: 'center' }, numFmt: '0' });
    const statusCellStyles: Record<'closed' | 'pending' | 'other', Record<string, unknown>[]> = {
      closed: stylePair({
        alignment: { vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }, // light green
        font: { bold: true, color: { argb: 'FF065F46' } }, // dark green text
      }),
      pending: stylePair({
        alignment: { vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } }, // light red
        font: { bold: true, color: { argb: 'FF991B1B' } }, // dark red text
      }),
      other: stylePair({
        alignment: { vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }, // light amber
        font: { bold: true, color: { argb: 'FF92400E' } }, // dark amber text
      }),
    };
    const remarksColNumber = headers.indexOf('Closing Remarks') + 1;
    const minutesColNumber = headers.indexOf('Resolution Time (Minutes)') + 1;
    for (let r = bodyStart; r <= bodyEnd; r++) {
      const alt = (r - bodyStart) % 2;
      const statusStyleForRow = statusCellStyles[statusClasses[r - bodyStart]];
      wsData.getRow(r).eachCell((cell: any, colNumber: number) => {
        if (colNumber === statusColIndex) cell.style = statusStyleForRow[alt];
        else if (colNumber === remarksColNumber) cell.style = remarksCellStyles[alt];
        else if (colNumber === minutesColNumber) cell.style = minutesCellStyles[alt];
        else cell.style = defaultCellStyles[alt];
      });
    }
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

    // Fast deflate: noticeably quicker to generate for a slightly larger file
    const buf = await wb.xlsx.writeBuffer({ zip: { compressionOptions: { level: 1 } } });
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
    const rows = [...(await ensureAllRows())].sort((a, b) => getReviewDateTime(a) - getReviewDateTime(b));
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

    const getReviewMobileNumber = (value: unknown) => {
      const digits = String(value ?? '').replace(/\D/g, '');
      return digits ? Number(digits) : '';
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
        getReviewMobileNumber(row['Consumer Mobile']),
      ]);
    });

    [22, 22, 24, 22, 30, 18].forEach((width, index) => {
      ws.getColumn(index + 1).width = width;
    });
    ws.getColumn(4).numFmt = '@';
    ws.getColumn(6).numFmt = '0';

    // Shared style objects (one per column format) instead of per-cell
    // property assignment; numFmt repeated here because assigning cell.style
    // replaces the column-applied format on existing cells.
    const reviewBodyStyle = {
      alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      border: {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      },
    };
    const reviewComplaintNoStyle = { ...reviewBodyStyle, numFmt: '@' };
    const reviewMobileStyle = { ...reviewBodyStyle, numFmt: '0' };
    for (let r = 2; r <= ws.lastRow.number; r++) {
      ws.getRow(r).eachCell((cell: { style?: unknown }, colNumber: number) => {
        cell.style = colNumber === 4 ? reviewComplaintNoStyle : colNumber === 6 ? reviewMobileStyle : reviewBodyStyle;
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

    // Fast deflate: noticeably quicker to generate for a slightly larger file
    const buf = await wb.xlsx.writeBuffer({ zip: { compressionOptions: { level: 1 } } });
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, fileName);
  };

  const exportRepeatedCompliantsByMobile = async () => {
    const rows = await ensureAllRows();
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
    const rows = await ensureAllRows();
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

  // Unfiltered slim dataset behind both month-wise exports: only the handful
  // of fields they read, downloaded once and reused until the next refresh.
  const ensureMonthwiseRows = async (): Promise<any[]> => {
    const cached = monthwiseNeedsRefreshRef.current ? null : monthwiseRowsCacheRef.current;
    if (cached) return cached;

    setExportProgress(0);
    const key = new URLSearchParams({
      fetchAll: 'true',
      fields: 'Division,Sub Station,Area Type,Complaint Date and Time'
    }).toString();
    const rows = await fetchAllRowsChunked(key, {
      refresh: monthwiseNeedsRefreshRef.current,
      onProgress: setExportProgress
    });

    monthwiseRowsCacheRef.current = rows;
    monthwiseNeedsRefreshRef.current = false;
    return rows;
  };

  const exportSubstationMonthwiseExcel = async () => {
    setExportLoading(true);
    try {
      // Start loading ExcelJS while the data downloads
      const excelLibPromise = loadExcelJS();
      excelLibPromise.catch(() => { /* surfaced at the await below */ });

      // 1. Fetch all data ignoring active filters. Only the fields this
      // report reads are requested (much smaller download), and the result
      // is reused across clicks until the next data refresh.
      const rows = await ensureMonthwiseRows();
      if (rows.length === 0) {
        alert('No complaints data found to export.');
        return;
      }

      // 2. Parse dates, group by substation and division, and collect month keys
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      const monthMap = new Map<string, number>(); // monthKey -> sortVal (y * 12 + m)
      const substationMap = new Map<string, { division: string; subStation: string; monthCounts: Record<string, number> }>();

      rows.forEach((r: any) => {
        const division = String(r['Division'] || '').trim() || 'Unknown';
        const subStation = String(r['Sub Station'] || r['Substation'] || '').trim();

        const dateStr = String(r['Complaint Date and Time'] || r['Complaint Date'] || '');
        const parsedDate = parsePossibleDate(dateStr);
        if (!parsedDate) return;

        const m = parsedDate.getMonth();
        const y = parsedDate.getFullYear();
        const monthKey = `${monthNames[m]}-${y}`;
        const sortVal = y * 12 + m;

        monthMap.set(monthKey, sortVal);

        const rowKey = `${division}|${subStation}`;
        if (!substationMap.has(rowKey)) {
          substationMap.set(rowKey, {
            division,
            subStation,
            monthCounts: {}
          });
        }

        const entry = substationMap.get(rowKey)!;
        entry.monthCounts[monthKey] = (entry.monthCounts[monthKey] || 0) + 1;
      });

      // 3. Sort months chronologically: oldest first, latest last
      const sortedMonthKeys = Array.from(monthMap.entries())
        .sort((a, b) => a[1] - b[1])
        .map(entry => entry[0]);

      // 4. Sort rows by division (ascending), then substation (ascending)
      const sortedRows = Array.from(substationMap.values())
        .sort((a, b) => {
          const divCompare = a.division.localeCompare(b.division);
          if (divCompare !== 0) return divCompare;
          return a.subStation.localeCompare(b.subStation);
        });

      // 5. Build workbook (ExcelJS was loading in parallel with the fetch)
      const { ExcelJS, saveAs } = await excelLibPromise;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'FRT Report Dashboard';
      wb.created = new Date();
      wb.modified = new Date();
      wb.properties = {
        title: 'Month-wise Substation Complaints Count',
        subject: 'Complaints Count by Substation and Month',
        category: 'Report',
        description: 'Complete data showing monthly complaints count per substation sorted by division',
        lastModifiedBy: 'FRT Report Dashboard',
      };

      // Monochrome print styling: black rules and greys only, so the sheet
      // reads the same on screen, in print and on a photocopy.
      const theme = {
        border: { style: 'thin' as const, color: { argb: 'FF000000' } },
        headerFill: 'FF000000',
        headerFontColor: 'FFFFFFFF',
      };

      // Alternating grey bands mark the division blocks instead of colours.
      const greyBands = ['FFFFFFFF', 'FFF2F2F2'];

      const uniqueDivisions = Array.from(new Set(sortedRows.map(r => r.division))).sort();
      const divisionColorMap = new Map<string, string>();
      uniqueDivisions.forEach((divisionName, index) => {
        divisionColorMap.set(divisionName, greyBands[index % greyBands.length]);
      });

      // Helper to style any sheet (headers & rows)
      const styleSheet = (ws: any, hasDivisionColumn: boolean, getRowColor?: (r: number) => string | null) => {
        const endRowNumber = ws.lastRow.number;
        const totalColNum = ws.columnCount;

        // Header style (Row 1)
        const headerRow = ws.getRow(1);
        headerRow.height = 26;
        headerRow.eachCell((cell: any, colNum: number) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.headerFill } };
          cell.font = { bold: true, size: 11, color: { argb: theme.headerFontColor } };
          cell.border = {
            top: theme.border,
            left: theme.border,
            bottom: theme.border,
            right: theme.border
          };

          // Alignment logic
          let alignment = 'center';
          if (hasDivisionColumn) {
            if (colNum === 2 || colNum === 3) alignment = 'left';
          } else {
            if (colNum === 2) alignment = 'left';
          }

          cell.alignment = {
            vertical: 'middle',
            horizontal: alignment,
            wrapText: true
          };
        });

        // Shared style objects for the bulk rows: per-cell property
        // assignment allocates a style per cell (the slow path in ExcelJS),
        // and shared references also serialize faster at write time.
        const bodyBorder = {
          top: theme.border,
          left: theme.border,
          bottom: theme.border,
          right: theme.border
        };
        const totalColStyle = {
          border: bodyBorder,
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }, // matches the bottom total row
          font: { bold: true, size: 11, color: { argb: 'FF000000' } }, // Bold totals
          alignment: { vertical: 'middle', horizontal: 'center' },
        };
        const bodyStyleCache = new Map<string, Record<string, unknown>>();
        const bodyStyleFor = (horizontal: string, rowColor: string | null) => {
          const key = `${horizontal}|${rowColor || ''}`;
          let style = bodyStyleCache.get(key);
          if (!style) {
            style = {
              border: bodyBorder,
              alignment: { vertical: 'middle', horizontal },
              ...(rowColor ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } } } : {}),
            };
            bodyStyleCache.set(key, style);
          }
          return style;
        };

        // Data rows style (Row 2 to endRowNumber - 1)
        for (let r = 2; r < endRowNumber; r++) {
          const row = ws.getRow(r);
          row.height = 20;

          const rowColor = getRowColor ? getRowColor(r) : null;

          row.eachCell({ includeEmpty: true }, (cell: any, colNum: number) => {
            if (colNum === totalColNum) {
              cell.style = totalColStyle;
              return;
            }
            const isLeft = hasDivisionColumn ? (colNum === 2 || colNum === 3) : colNum === 2;
            cell.style = bodyStyleFor(isLeft ? 'left' : 'center', rowColor);
          });
        }

        // Grand Total row style (Row endRowNumber)
        const totalRowStyleCenter = {
          border: {
            top: { style: 'double', color: { argb: 'FF000000' } },
            left: theme.border,
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            right: theme.border
          },
          font: { bold: true, size: 11, color: { argb: 'FF000000' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } },
          alignment: { vertical: 'middle', horizontal: 'center' },
        };
        const totalRowStyleLeft = { ...totalRowStyleCenter, alignment: { vertical: 'middle', horizontal: 'left' } };
        const totalRow = ws.getRow(endRowNumber);
        totalRow.height = 22;
        totalRow.eachCell({ includeEmpty: true }, (cell: any, colNum: number) => {
          cell.style = colNum === 2 ? totalRowStyleLeft : totalRowStyleCenter;
        });
      };

      // 6. Create Sheet 1: "All Division"
      const wsAll = wb.addWorksheet('All Division', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
      });

      // Headers: Sr No, Division, Sub Stations, and then Month columns + Total
      const headersAll = ['Sr No', 'Division', 'Sub Stations', ...sortedMonthKeys, 'Total'];
      wsAll.addRow(headersAll);

      // Add Data Rows for "All Division" and accumulate totals
      const colTotalsAll = Array(sortedMonthKeys.length).fill(0);
      let grandTotalAll = 0;

      sortedRows.forEach((row, index) => {
        const rowValues: any[] = [
          index + 1, // Sr No
          row.division, // Division
          row.subStation // Sub Stations
        ];

        let rowTotal = 0;
        sortedMonthKeys.forEach((monthKey, colIdx) => {
          const count = row.monthCounts[monthKey] || 0;
          rowValues.push(count > 0 ? count : null);
          rowTotal += count;
          colTotalsAll[colIdx] += count;
        });

        rowValues.push(rowTotal > 0 ? rowTotal : null); // row total
        grandTotalAll += rowTotal;

        wsAll.addRow(rowValues);
      });

      // Add Grand Total row for "All Division"
      const totalRowValuesAll = [
        '', // Sr No
        'Total', // Division label
        '', // Sub Stations
        ...colTotalsAll.map(t => t > 0 ? t : null),
        grandTotalAll > 0 ? grandTotalAll : null
      ];
      wsAll.addRow(totalRowValuesAll);

      // Set column widths for "All Division"
      wsAll.getColumn(1).width = 8;   // Sr No
      wsAll.getColumn(2).width = 24;  // Division
      wsAll.getColumn(3).width = 35;  // Sub Stations
      sortedMonthKeys.forEach((_, colIndex) => {
        wsAll.getColumn(colIndex + 4).width = 16; // Months
      });
      wsAll.getColumn(sortedMonthKeys.length + 4).width = 18; // Total

      // Apply styling to "All Division" with dynamic row colors based on division
      const getAllDivisionRowColor = (r: number) => {
        const rowData = sortedRows[r - 2];
        if (!rowData) return null;
        return divisionColorMap.get(rowData.division) || null;
      };
      styleSheet(wsAll, true, getAllDivisionRowColor);

      // 7. Create division-specific sheets
      uniqueDivisions.forEach(divisionName => {
        // Sanitize sheet name: limit to 31 chars and remove invalid chars: \ / ? * [ ] :
        const sanitizedSheetName = divisionName
          .replace(/[*?:\[\]\/\\+]/g, '')
          .substring(0, 31)
          .trim() || 'Division';

        const wsDiv = wb.addWorksheet(sanitizedSheetName, {
          views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
        });

        // Headers: Sr No, Sub Stations, and then Month columns + Total
        const headersDiv = ['Sr No', 'Sub Stations', ...sortedMonthKeys, 'Total'];
        wsDiv.addRow(headersDiv);

        // Filter, add data, and accumulate totals for this division
        const colTotalsDiv = Array(sortedMonthKeys.length).fill(0);
        let grandTotalDiv = 0;

        const divisionRows = sortedRows.filter(r => r.division === divisionName);
        divisionRows.forEach((row, index) => {
          const rowValues: any[] = [
            index + 1, // Sr No
            row.subStation // Sub Stations
          ];

          let rowTotal = 0;
          sortedMonthKeys.forEach((monthKey, colIdx) => {
            const count = row.monthCounts[monthKey] || 0;
            rowValues.push(count > 0 ? count : null);
            rowTotal += count;
            colTotalsDiv[colIdx] += count;
          });

          rowValues.push(rowTotal > 0 ? rowTotal : null); // row total
          grandTotalDiv += rowTotal;

          wsDiv.addRow(rowValues);
        });

        // Add Grand Total row for division sheet
        const totalRowValuesDiv = [
          '', // Sr No
          'Total', // Sub Stations label
          ...colTotalsDiv.map(t => t > 0 ? t : null),
          grandTotalDiv > 0 ? grandTotalDiv : null
        ];
        wsDiv.addRow(totalRowValuesDiv);

        // Set column widths for division sheet
        wsDiv.getColumn(1).width = 8;   // Sr No
        wsDiv.getColumn(2).width = 35;  // Sub Stations
        sortedMonthKeys.forEach((_, colIndex) => {
          wsDiv.getColumn(colIndex + 3).width = 16; // Months
        });
        wsDiv.getColumn(sortedMonthKeys.length + 3).width = 18; // Total

        // Apply styling to division sheet
        styleSheet(wsDiv, false);
      });

      // 8. Save Workbook
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mi = String(now.getMinutes()).padStart(2, '0');
      
      const fileName = `substation-monthwise-complaints-${yyyy}${mm}${dd}-${hh}${mi}.xlsx`;
      // Fast deflate: noticeably quicker to generate for a slightly larger file
      const buf = await wb.xlsx.writeBuffer({ zip: { compressionOptions: { level: 1 } } });
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, fileName);

    } catch (err: any) {
      alert(`Export failed: ${err.message || 'unknown error'}`);
    } finally {
      setExportLoading(false);
    }
  };

  // Month x field-shift distribution: one circle-level sheet followed by one
  // sheet per division (division sheets also split Rural/Urban).
  const exportCircleDivisionShiftExcel = async () => {
    setExportLoading(true);
    try {
      const excelLibPromise = loadExcelJS();
      excelLibPromise.catch(() => { /* surfaced at the await below */ });

      const rows = await ensureMonthwiseRows();
      if (rows.length === 0) {
        alert('No complaints data found to export.');
        return;
      }

      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      type ShiftKey = 'A' | 'B' | 'C';
      // Same windows as the dashboard's Field Shift presets.
      const shiftOf = (hour: number): ShiftKey => {
        if (hour >= 8 && hour < 16) return 'A';
        if (hour >= 16) return 'B';
        return 'C';
      };

      // Per month the counts are kept split by area type, so a division sheet
      // can print a Rural row and an Urban row under every month.
      type ShiftCount = { A: number; B: number; C: number; total: number };
      type Bucket = { rural: ShiftCount; urban: ShiftCount };
      const newShiftCount = (): ShiftCount => ({ A: 0, B: 0, C: 0, total: 0 });
      const newBucket = (): Bucket => ({ rural: newShiftCount(), urban: newShiftCount() });
      const addShiftCount = (target: ShiftCount, source: ShiftCount) => {
        target.A += source.A;
        target.B += source.B;
        target.C += source.C;
        target.total += source.total;
      };
      const combined = (bucket: Bucket): ShiftCount => {
        const out = newShiftCount();
        addShiftCount(out, bucket.rural);
        addShiftCount(out, bucket.urban);
        return out;
      };

      const monthMeta = new Map<string, { label: string; sort: number }>();
      const circleBuckets = new Map<string, Bucket>();
      const divisionBuckets = new Map<string, Map<string, Bucket>>();

      let minDate: Date | null = null;
      let maxDate: Date | null = null;
      let skipped = 0;

      rows.forEach((r: any) => {
        const parsed = parsePossibleDate(String(r['Complaint Date and Time'] || ''));
        if (!parsed) {
          skipped++;
          return;
        }

        if (!minDate || parsed < minDate) minDate = parsed;
        if (!maxDate || parsed > maxDate) maxDate = parsed;

        const y = parsed.getFullYear();
        const m = parsed.getMonth();
        const monthKey = `${monthNames[m]}-${y}`;
        monthMeta.set(monthKey, { label: `${monthNames[m]} ${y}`, sort: y * 12 + m });

        const division = String(r['Division'] || '').trim() || 'Unknown';
        const areaType = String(r['Area Type'] || '').trim().toLowerCase();
        const shift = shiftOf(parsed.getHours());

        const bump = (bucket: Bucket) => {
          // Only Urban is reported separately; everything else (Rural plus the
          // handful of Class1/Industrial/blank rows) counts as Rural so that
          // Rural + Urban always reconciles with Total.
          const target = areaType === 'urban' ? bucket.urban : bucket.rural;
          target[shift]++;
          target.total++;
        };

        let circleBucket = circleBuckets.get(monthKey);
        if (!circleBucket) {
          circleBucket = newBucket();
          circleBuckets.set(monthKey, circleBucket);
        }
        bump(circleBucket);

        let divisionMonths = divisionBuckets.get(division);
        if (!divisionMonths) {
          divisionMonths = new Map<string, Bucket>();
          divisionBuckets.set(division, divisionMonths);
        }
        let divisionBucket = divisionMonths.get(monthKey);
        if (!divisionBucket) {
          divisionBucket = newBucket();
          divisionMonths.set(monthKey, divisionBucket);
        }
        bump(divisionBucket);
      });

      const sortedMonthKeys = Array.from(monthMeta.entries())
        .sort((a, b) => a[1].sort - b[1].sort)
        .map(([key]) => key);
      const sortedDivisions = Array.from(divisionBuckets.keys()).sort((a, b) => a.localeCompare(b));


      const { ExcelJS, saveAs } = await excelLibPromise;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'FRT Report Dashboard';
      wb.created = new Date();
      wb.modified = new Date();
      wb.properties = {
        title: 'Monthly Complaint Distribution by Field Shift',
        subject: 'Circle and Division-wise monthly complaint counts split by field shift',
        category: 'Report',
        description: 'Barabanki circle summary followed by one sheet per division',
        lastModifiedBy: 'FRT Report Dashboard',
      };

      const generatedOn = new Date();
      const formatLongDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${monthNames[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
      const formatLongDateTime = (d: Date) => {
        const hours24 = d.getHours();
        const hours12 = hours24 % 12 || 12;
        const period = hours24 >= 12 ? 'PM' : 'AM';
        return `${formatLongDate(d)}, ${hours12}:${String(d.getMinutes()).padStart(2, '0')} ${period}`;
      };
      const periodText = minDate && maxDate
        ? `${formatLongDate(minDate)} to ${formatLongDate(maxDate)}`
        : 'All available data';

      // Monochrome print palette: black rules, white body, two greys. Nothing
      // in this workbook relies on colour to be readable on a photocopy.
      const ink = {
        black: 'FF000000',
        white: 'FFFFFFFF',
        zebra: 'FFF2F2F2',
        total: 'FFD9D9D9',
      };
      const FONT = 'Calibri';
      const thin = { style: 'thin' as const, color: { argb: ink.black } };
      const medium = { style: 'medium' as const, color: { argb: ink.black } };
      const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

      // One sheet builder for both scopes: the circle sheet is the same table
      // without the Rural/Urban split.
      const buildSheet = (options: {
        sheetName: string;
        scopeLine: string;
        buckets: Map<string, Bucket>;
        withAreaType: boolean;
      }) => {
        const { sheetName, scopeLine, buckets, withAreaType } = options;
        const columns = [
          'MONTH',
          ...(withAreaType ? ['AREA TYPE'] : []),
          'SHIFT A\n08:00 AM - 04:00 PM',
          'SHIFT B\n04:00 PM - 12:00 AM',
          'SHIFT C\n12:00 AM - 08:00 AM',
          'TOTAL'
        ];
        const lastCol = columns.length;
        const labelCols = withAreaType ? 2 : 1; // leading text columns
        const sheetTotal = Array.from(buckets.values()).reduce((acc, b) => acc + combined(b).total, 0);

        const ws = wb.addWorksheet(sheetName, {
          // No frozen panes - the sheet should open as a plain page.
          views: [{ showGridLines: false }],
          pageSetup: {
            orientation: 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            horizontalCentered: true,
            margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
          }
        });
        ws.headerFooter = {
          oddFooter: '&L&"Calibri,Italic"&9FRT Barabanki - Monthly Complaint Distribution by Field Shift&R&"Calibri,Italic"&9Page &P of &N'
        };

        const mergedRow = (height: number) => {
          const row = ws.addRow(['']);
          ws.mergeCells(row.number, 1, row.number, lastCol);
          row.height = height;
          return row.getCell(1);
        };
        const label = (text: string, value: string) => ({
          richText: [
            { font: { name: FONT, bold: true, size: 10, color: { argb: ink.black } }, text },
            { font: { name: FONT, size: 10, color: { argb: ink.black } }, text: value }
          ]
        });

        // --- Report header block ---------------------------------------
        const titleCell = mergedRow(24);
        titleCell.value = 'FRT BARABANKI - SUPPLY COMPLAINT MONITORING';
        titleCell.font = { name: FONT, bold: true, size: 12, color: { argb: ink.black } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

        const subtitleCell = mergedRow(28);
        subtitleCell.value = 'MONTHLY COMPLAINT DISTRIBUTION BY FIELD SHIFT';
        subtitleCell.font = { name: FONT, bold: true, size: 15, color: { argb: ink.black }, underline: 'single' };
        subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };

        const scopeCell = mergedRow(22);
        scopeCell.value = scopeLine.toUpperCase();
        scopeCell.font = { name: FONT, bold: true, size: 11, color: { argb: ink.black } };
        scopeCell.alignment = { vertical: 'middle', horizontal: 'center' };
        scopeCell.border = { bottom: medium };

        const metaCell = mergedRow(18);
        metaCell.value = label(
          'Period:  ',
          `${periodText}        Total Complaints:  ${sheetTotal.toLocaleString('en-IN')}        Generated:  ${formatLongDateTime(generatedOn)}`
        );
        metaCell.alignment = { vertical: 'middle', horizontal: 'center' };

        ws.addRow([]).height = 8; // breathing room above the table

        // --- Table -----------------------------------------------------
        const headerRow = ws.addRow(columns);
        headerRow.height = 32;
        headerRow.eachCell((cell: any, colNum: number) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink.black } };
          cell.font = { name: FONT, bold: true, size: 10, color: { argb: ink.white } };
          cell.border = { top: medium, left: thin, bottom: medium, right: thin };
          cell.alignment = { vertical: 'middle', horizontal: colNum <= labelCols ? 'left' : 'center', wrapText: true };
        });
        const headerRowNumber = headerRow.number;
        ws.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;

        const addDataRow = (values: any[], style: {
          bold?: boolean;
          fill?: string;
          topBorder?: any;
          bottomBorder?: any;
        } = {}) => {
          const row = ws.addRow(values);
          row.height = style.bold ? 21 : 19;
          row.eachCell({ includeEmpty: true }, (cell: any, colNum: number) => {
            const isLabel = colNum <= labelCols;
            cell.border = {
              top: style.topBorder || thin,
              left: thin,
              bottom: style.bottomBorder || thin,
              right: thin
            };
            cell.alignment = { vertical: 'middle', horizontal: isLabel ? 'left' : 'center' };
            cell.font = {
              name: FONT,
              size: style.bold ? 10.5 : 10,
              bold: !!style.bold || colNum === 1 || colNum === lastCol,
              color: { argb: ink.black }
            };
            if (!isLabel) cell.numFmt = '#,##0';
            if (style.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
          });
          return row;
        };

        const totals = newBucket();
        const doubleTop = { style: 'double' as const, color: { argb: ink.black } };

        sortedMonthKeys.forEach((monthKey, index) => {
          const bucket = buckets.get(monthKey) || newBucket();
          const monthLabel = monthMeta.get(monthKey)?.label || monthKey;
          const monthTotal = combined(bucket);
          addShiftCount(totals.rural, bucket.rural);
          addShiftCount(totals.urban, bucket.urban);

          if (!withAreaType) {
            addDataRow(
              [monthLabel, monthTotal.A, monthTotal.B, monthTotal.C, monthTotal.total],
              { fill: index % 2 === 1 ? ink.zebra : undefined }
            );
            return;
          }

          // Division sheets: one row per area type, then the month's own total.
          const first = addDataRow([monthLabel, 'Rural', bucket.rural.A, bucket.rural.B, bucket.rural.C, bucket.rural.total]);
          addDataRow(['', 'Urban', bucket.urban.A, bucket.urban.B, bucket.urban.C, bucket.urban.total]);
          const last = addDataRow(
            ['', 'Month Total', monthTotal.A, monthTotal.B, monthTotal.C, monthTotal.total],
            { bold: true, fill: ink.zebra, bottomBorder: medium }
          );
          ws.mergeCells(first.number, 1, last.number, 1);
          ws.getCell(first.number, 1).alignment = { vertical: 'middle', horizontal: 'left' };
        });

        const grandTotal = combined(totals);
        if (withAreaType) {
          const g1 = addDataRow(
            ['GRAND TOTAL', 'Rural', totals.rural.A, totals.rural.B, totals.rural.C, totals.rural.total],
            { bold: true, fill: ink.total, topBorder: doubleTop }
          );
          addDataRow(
            ['', 'Urban', totals.urban.A, totals.urban.B, totals.urban.C, totals.urban.total],
            { bold: true, fill: ink.total }
          );
          const g3 = addDataRow(
            ['', 'Total', grandTotal.A, grandTotal.B, grandTotal.C, grandTotal.total],
            { bold: true, fill: ink.total, bottomBorder: medium }
          );
          ws.mergeCells(g1.number, 1, g3.number, 1);
          ws.getCell(g1.number, 1).alignment = { vertical: 'middle', horizontal: 'left' };
        } else {
          addDataRow(
            ['GRAND TOTAL', grandTotal.A, grandTotal.B, grandTotal.C, grandTotal.total],
            { bold: true, fill: ink.total, topBorder: doubleTop, bottomBorder: medium }
          );
        }

        ws.getColumn(1).width = 20;
        if (withAreaType) ws.getColumn(2).width = 15;
        for (let c = labelCols + 1; c <= lastCol; c++) {
          ws.getColumn(c).width = c === lastCol ? 14 : 16;
        }

        // --- Charts ------------------------------------------------------
        const monthShortLabels = sortedMonthKeys.map((key) => {
          const [name, year] = key.split('-');
          return `${name.slice(0, 3)} ${year.slice(2)}`;
        });
        const bucketFor = (key: string) => buckets.get(key) || newBucket();

        const chartHeadingRow = ws.addRow([]);
        chartHeadingRow.height = 26;
        ws.mergeCells(chartHeadingRow.number, 1, chartHeadingRow.number, lastCol);
        const chartHeading = chartHeadingRow.getCell(1);
        chartHeading.value = 'GRAPHICAL SUMMARY';
        chartHeading.font = { name: FONT, bold: true, size: 12, color: { argb: ink.black } };
        chartHeading.alignment = { vertical: 'middle', horizontal: 'center' };
        chartHeading.border = { top: medium, bottom: medium };

        let chartAnchorRow = chartHeadingRow.number + 1;
        const placeChart = (dataUrl: string) => {
          if (!dataUrl) return;
          const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });
          ws.addImage(imageId, {
            tl: { col: 0.2, row: chartAnchorRow },
            ext: { width: 660, height: 300 }
          });
          chartAnchorRow += 22; // ~300px of default-height rows, plus a gap
        };

        placeChart(renderMonochromeChart({
          title: 'COMPLAINT TREND - MONTH ON MONTH',
          categories: monthShortLabels,
          kind: 'line',
          series: [{
            name: 'Total Complaints',
            shade: '#000000',
            values: sortedMonthKeys.map((key) => combined(bucketFor(key)).total)
          }]
        }));

        placeChart(renderMonochromeChart({
          title: 'SHIFT-WISE DISTRIBUTION',
          subtitle: 'Shift A: 08:00 AM - 04:00 PM     Shift B: 04:00 PM - 12:00 AM     Shift C: 12:00 AM - 08:00 AM',
          categories: monthShortLabels,
          kind: 'bar',
          series: [
            { name: 'Shift A', shade: '#1A1A1A', values: sortedMonthKeys.map((key) => combined(bucketFor(key)).A) },
            { name: 'Shift B', shade: '#8C8C8C', values: sortedMonthKeys.map((key) => combined(bucketFor(key)).B) },
            { name: 'Shift C', shade: '#E0E0E0', values: sortedMonthKeys.map((key) => combined(bucketFor(key)).C) }
          ]
        }));

        placeChart(renderMonochromeChart({
          title: 'AREA TYPE DISTRIBUTION',
          categories: monthShortLabels,
          kind: 'bar',
          series: [
            { name: 'Rural', shade: '#4D4D4D', values: sortedMonthKeys.map((key) => bucketFor(key).rural.total) },
            { name: 'Urban', shade: '#E0E0E0', values: sortedMonthKeys.map((key) => bucketFor(key).urban.total) }
          ]
        }));

        return ws;
      };

      buildSheet({
        sheetName: 'Barabanki Circle',
        scopeLine: 'Circle: Barabanki  (all divisions consolidated)',
        buckets: circleBuckets,
        withAreaType: false
      });

      // Excel caps sheet names at 31 chars and rejects []:*?/\
      const usedSheetNames = new Set<string>(['Barabanki Circle']);
      const toSheetName = (division: string) => {
        const base = division.replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Division';
        let name = base;
        let suffix = 2;
        while (usedSheetNames.has(name)) {
          name = `${base.slice(0, 28)} ${suffix++}`;
        }
        usedSheetNames.add(name);
        return name;
      };

      sortedDivisions.forEach((division) => {
        buildSheet({
          sheetName: toSheetName(division),
          scopeLine: `Division: ${division}  |  Barabanki Circle`,
          buckets: divisionBuckets.get(division)!,
          withAreaType: true
        });
      });

      if (skipped > 0) {
        console.warn(`Circle/division shift export: ${skipped} rows skipped (unreadable complaint date).`);
      }

      const yyyy = generatedOn.getFullYear();
      const mm = String(generatedOn.getMonth() + 1).padStart(2, '0');
      const dd = String(generatedOn.getDate()).padStart(2, '0');
      const hh = String(generatedOn.getHours()).padStart(2, '0');
      const mi = String(generatedOn.getMinutes()).padStart(2, '0');
      const fileName = `circle-division-monthwise-shift-${yyyy}${mm}${dd}-${hh}${mi}.xlsx`;

      const buf = await wb.xlsx.writeBuffer({ zip: { compressionOptions: { level: 1 } } });
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, fileName);
    } catch (err: any) {
      alert(`Export failed: ${err.message || 'unknown error'}`);
    } finally {
      setExportLoading(false);
    }
  };

  const dashboardStats = useMemo(() => {
    // All card numbers come from the stats RPC: closed = per-day closed
    // counts summed (control room + FRT), within/beyond from byClosedStatus.
    const total = stats?.total ?? 0;
    const closed = (stats?.daily ?? []).reduce((acc, day) => acc + day.cr + day.frt, 0);
    const byClosedStatus = stats?.byClosedStatus ?? [];
    const within = byClosedStatus.find((entry) => entry.k === 'Closed Within')?.n ?? 0;
    const beyond = byClosedStatus.find((entry) => entry.k === 'Closed Beyond')?.n ?? 0;

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
  }, [stats, monthFilter, selectedShift]);

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
      {exportLoading && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-white shadow-lg">
          <span className="inline-flex items-center gap-2 font-semibold">
            <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></span>
            Preparing export... fetching all matching complaints
            {exportProgress > 0 && ` (${exportProgress.toLocaleString('en-IN')} rows)`}
          </span>
        </div>
      )}
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

                  // Fresh data scraped: reload the visible page and make the
                  // next export bypass the server-side fetchAll cache.
                  exportNeedsRefreshRef.current = true;
                  allRowsCacheRef.current = null;
                  monthwiseNeedsRefreshRef.current = true;
                  monthwiseRowsCacheRef.current = null;
                  setCurrentPage(1);
                  void loadTablePage(1);

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
            ) : totalCount > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FiBarChart2 className="text-sky-600 text-lg" />
                    <span className="font-semibold text-gray-700">Showing {((currentPage - 1) * rowsPerPage) + 1}-{Math.min(currentPage * rowsPerPage, totalCount)} of {totalCount} complaints</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={exportSummaryPDF}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-indigo-800"
                    >
                      <FiBarChart2 className="text-lg" /> <span>Summary PDF</span>
                    </button>
                    <button
                      onClick={() => router.push('/analytics')}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-slate-800"
                    >
                      <FiBarChart2 className="text-lg" /> <span>Analytics & Charts</span>
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
                          <button
                            onClick={() => {
                              setShowExcelMenu(false);
                              exportSubstationMonthwiseExcel();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-800"
                            role="menuitem"
                          >
                            <FiCalendar className="text-base" /> <span>Month-wise Substation</span>
                          </button>
                          <button
                            onClick={() => {
                              setShowExcelMenu(false);
                              exportCircleDivisionShiftExcel();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-800"
                            role="menuitem"
                          >
                            <FiLayers className="text-base" /> <span>Circle &amp; Division (Month × Shift)</span>
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

        {!loading && totalCount > 0 && (
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
                          'Feeder',
                          'Closed By',
                          'Closing Remarks'
                        ];
                        const firstRowKeys = Object.keys(tableRows[0] || {});
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
                        'Feeder',
                        'Closed By',
                        'Closing Remarks'
                      ];
                      const firstRowKeys = Object.keys(tableRows[0] || {});
                      const otherKeys = firstRowKeys.filter(k => !preferredOrder.includes(k) && k !== 'Resolution Time');
                      const finalHeaders = [...preferredOrder, ...otherKeys];

                      return tableRows.map((row, index) => (
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
                <button onClick={() => goToPage(1)} disabled={currentPage === 1 || tableLoading} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">First</button>
                <button onClick={() => goToPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1 || tableLoading} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">Prev</button>
                <span className="px-4 py-1 bg-gray-100 rounded">Page {currentPage} of {totalPages}</span>
                <button onClick={() => goToPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages || tableLoading} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">Next</button>
                <button onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages || tableLoading} className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300">Last</button>
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





