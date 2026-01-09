'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { FiDownload, FiRefreshCw, FiBarChart2, FiTrendingUp, FiLayers, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import FilterBar from './components/FilterBar';

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const pageSize = 1000;
  
  // Filters
  const [search, setSearch] = useState('');
  const [fromDT, setFromDT] = useState('');
  const [toDT, setToDT] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [closedStatusFilter, setClosedStatusFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [subDivisionFilter, setSubDivisionFilter] = useState('');
  const [subStationFilter, setSubStationFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>('All');
  
  // Filter options (loaded once)
  const [filterOptions, setFilterOptions] = useState({
    divisions: [] as string[],
    subDivisions: [] as string[],
    subStations: [] as string[],
    statuses: [] as string[],
    closedStatuses: [] as string[]
  });

  const fetchData = useCallback(async (refresh = false, page = 1) => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
        ...(search && { search }),
        ...(divisionFilter && { division: divisionFilter }),
        ...(subDivisionFilter && { subDivision: subDivisionFilter }),
        ...(subStationFilter && { subStation: subStationFilter }),
        ...(statusFilter && { status: statusFilter }),
        ...(closedStatusFilter && { closedStatus: closedStatusFilter }),
        ...(fromDT && { fromDate: new Date(fromDT).toISOString() }),
        ...(toDT && { toDate: new Date(toDT).toISOString() })
      });

      const response = await fetch(`/api/complaints?${params}`);
      const result = await response.json();

      if (result.success) {
        setData(result.data || []);
        setTotalPages(result.pagination.totalPages);
        setTotalRecords(result.pagination.total);
        setCurrentPage(page);
        
        if (result.data?.length > 0) {
          const sample = result.data[0];
          setFilterOptions({
            divisions: [...new Set(result.data.map((r: any) => r.Division).filter(Boolean))].sort() as string[],
            subDivisions: [...new Set(result.data.map((r: any) => r['Sub Division']).filter(Boolean))].sort() as string[],
            subStations: [...new Set(result.data.map((r: any) => r['Sub Station']).filter(Boolean))].sort() as string[],
            statuses: [...new Set(result.data.map((r: any) => r.Status).filter(Boolean))].sort() as string[],
            closedStatuses: [...new Set(result.data.map((r: any) => r['Closed Status']).filter(Boolean))].sort() as string[]
          });
        }
      } else {
        setError(result.error || 'Failed to fetch data');
      }
    } catch (err: any) {
      setError('Error fetching data: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [search, divisionFilter, subDivisionFilter, subStationFilter, statusFilter, closedStatusFilter, fromDT, toDT, pageSize]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/scrape?refresh=1');
      const result = await response.json();
      if (result.success) {
        setLastUpdated(result.lastScrapedAt);
        await fetchData(false, 1);
      }
    } catch (err: any) {
      setError('Refresh failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(false, 1);
  }, []);

  useEffect(() => {
    if (currentPage > 1) {
      fetchData(false, 1);
    }
  }, [search, divisionFilter, subDivisionFilter, subStationFilter, statusFilter, closedStatusFilter, fromDT, toDT]);

  const clearAllFilters = () => {
    setSearch('');
    setDivisionFilter('');
    setSubDivisionFilter('');
    setSubStationFilter('');
    setStatusFilter('');
    setClosedStatusFilter('');
    setFromDT('');
    setToDT('');
    setMonthFilter('All');
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="FRT Logo" width={56} height={56} className="rounded-lg" priority />
            <div>
              <h1 className="text-xl md:text-3xl font-bold">FRT बाराबंकी - सप्लाई कंप्लेंट रिपोर्ट</h1>
              <p className="text-gray-500 text-sm md:text-base">Optimized with pagination & incremental scraping</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-slate-700 hover:bg-amber-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Loading...' : <><FiRefreshCw /> Refresh</>}
          </button>
        </header>

        {lastUpdated && (
          <div className="bg-amber-50 border-l-4 border-amber-500 text-amber-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ Data last updated: {lastUpdated}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <FilterBar
          search={search}
          setSearch={setSearch}
          divisionFilter={divisionFilter}
          setDivisionFilter={setDivisionFilter}
          divisionOptions={filterOptions.divisions}
          subDivisionFilter={subDivisionFilter}
          setSubDivisionFilter={setSubDivisionFilter}
          subDivisionOptions={filterOptions.subDivisions}
          subStationFilter={subStationFilter}
          setSubStationFilter={setSubStationFilter}
          subStationOptions={filterOptions.subStations}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          statusOptions={filterOptions.statuses}
          closedStatusFilter={closedStatusFilter}
          setClosedStatusFilter={setClosedStatusFilter}
          closedStatusOptions={filterOptions.closedStatuses}
          fromDT={fromDT}
          setFromDT={setFromDT}
          toDT={toDT}
          setToDT={setToDT}
          selectedShift=""
          setSelectedShift={() => {}}
          activePreset=""
          applyPreset={() => {}}
          applyShiftPreset={() => {}}
          customDate=""
          setCustomDate={() => {}}
          applyCustomDateShift={() => {}}
          clearAllFilters={clearAllFilters}
          loading={loading}
          monthFilter={monthFilter}
          setMonthFilter={setMonthFilter}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FiBarChart2 className="text-sky-600 text-lg" />
            <span className="font-semibold text-gray-700">
              Showing {data.length} of {totalRecords} complaints (Page {currentPage}/{totalPages})
            </span>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => fetchData(false, currentPage - 1)}
              disabled={currentPage === 1 || loading}
              className="px-3 py-2 bg-white border rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              <FiChevronLeft />
            </button>
            <span className="px-4 py-2 bg-white border rounded-lg">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => fetchData(false, currentPage + 1)}
              disabled={currentPage === totalPages || loading}
              className="px-3 py-2 bg-white border rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              <FiChevronRight />
            </button>
          </div>
        </div>

        {data.length > 0 && (
          <div className="bg-white rounded-xl shadow-md border border-gray-100">
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="min-w-full divide-y divide-gray-200 text-xs md:text-sm">
                <thead className="bg-gradient-to-r from-gray-100 to-gray-50 sticky top-0 z-10">
                  <tr>
                    {Object.keys(data[0] || {}).map(header => (
                      <th key={header} className="px-4 py-3 text-left font-medium text-gray-700 uppercase">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {data.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      {Object.values(row).map((val: any, i) => (
                        <td key={i} className="px-4 py-3 text-gray-600">
                          {String(val || '')}
                        </td>
                      ))}
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
