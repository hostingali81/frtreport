'use client';

import { ReactNode, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiActivity, FiArrowLeft, FiClock, FiDatabase, FiLoader, FiPhoneCall, FiRefreshCw, FiRepeat, FiTrendingUp, FiZap } from 'react-icons/fi';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import FilterBar from '../components/FilterBar';
import { useData } from '../context/DataContext';
import { useComplaintFilters } from '../hooks/useComplaintFilters';

const LoadingSkeleton = () => (
  <div className="flex h-96 w-full items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-400 shadow-sm">
    Loading charts...
  </div>
);

const TrendCharts = dynamic(() => import('../components/TrendCharts'), { ssr: false, loading: () => <LoadingSkeleton /> });
const DeepDivePanel = dynamic(() => import('../components/DeepDivePanel'), { ssr: false, loading: () => <LoadingSkeleton /> });
const MonthComparison = dynamic(() => import('../components/MonthComparison'), { ssr: false, loading: () => <LoadingSkeleton /> });
const ConsumerInsights = dynamic(() => import('../components/ConsumerInsights'), { ssr: false, loading: () => <LoadingSkeleton /> });
const FeederReport = dynamic(() => import('../components/FeederReport'), { ssr: false, loading: () => <LoadingSkeleton /> });
const CallingReport = dynamic(() => import('../components/CallingReport'), { ssr: false, loading: () => <LoadingSkeleton /> });

type TabId = 'trends' | 'deep' | 'months' | 'consumers' | 'feeders' | 'calling';

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'deep', label: 'Deep Analysis', icon: <FiActivity /> },
  { id: 'feeders', label: 'Feeder Report', icon: <FiZap /> },
  { id: 'trends', label: 'Trends', icon: <FiTrendingUp /> },
  { id: 'months', label: 'Month Comparison', icon: <FiDatabase /> },
  { id: 'consumers', label: 'Repeat Consumers', icon: <FiRepeat /> },
  { id: 'calling', label: 'Calling Report', icon: <FiPhoneCall /> }
];

const formatMins = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
};

// Analytics dashboard (moved here from /charts; that URL now redirects). The
// complaint tabs render from server-computed stats (no row downloads) and
// sections live in tabs so only the active one mounts. The Calling Report tab
// is a separate universe (live_complaints + call_logs from the calling app)
// with its own date filter, so the complaints FilterBar/KPIs hide on it.
export default function AnalyticsPage() {
  const { stats, statsLoading, refreshData, applyFilters } = useData();
  const router = useRouter();
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('deep');
  const [isSyncing, setIsSyncing] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const { filterBarProps, buildFilters } = useComplaintFilters();

  const applyCurrentFilters = async () => {
    setError('');
    try {
      await applyFilters(buildFilters(), { withRows: false });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics data');
    }
  };

  const kpis = useMemo(() => {
    if (!stats) return null;
    const closedStatusCount = (key: string) =>
      stats.byClosedStatus?.find((s) => s.k === key)?.n ?? 0;
    const resSum = stats.daily.reduce((sum, d) => sum + d.resSum, 0);
    const resN = stats.daily.reduce((sum, d) => sum + d.resN, 0);
    return {
      total: stats.total,
      pending: closedStatusCount('Pending'),
      within: closedStatusCount('Closed Within'),
      beyond: closedStatusCount('Closed Beyond'),
      avgRes: resN > 0 ? formatMins(resSum / resN) : '-',
      feeders: (stats.byFeeder ?? []).length
    };
  }, [stats]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <Image src="/logo.png" alt="FRT Logo" width={52} height={52} className="rounded-md" priority />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Executive Analytics</p>
                <h1 className="text-xl font-bold tracking-tight text-slate-950 md:text-3xl">Analytics Dashboard</h1>
                <p className="text-sm text-gray-500 md:text-base">Trends, deep analysis, consumers, feeder and calling reports in one place.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setNavigating(true);
                  router.push('/');
                }}
                disabled={navigating}
                className="inline-flex items-center gap-2 rounded-md bg-slate-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95 disabled:cursor-wait disabled:bg-slate-500 md:px-5"
              >
                {navigating ? <FiLoader className="animate-spin" /> : <FiArrowLeft />} Back
              </button>
              <button
                onClick={async () => {
                  setError('');
                  setIsSyncing(true);
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
                  } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'Refresh failed';
                    setError(message);
                    alert(`Refresh failed\n\n${message}`);
                  } finally {
                    setIsSyncing(false);
                  }
                }}
                disabled={isSyncing || statsLoading}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-400 md:px-5"
              >
                {isSyncing ? (<><FiClock className="animate-pulse" /> Refreshing...</>) : (<><FiRefreshCw /> Sync Latest</>)}
              </button>
            </div>
          </div>
        </header>

        {error && activeTab !== 'calling' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <p className="font-semibold">{error}</p>
          </div>
        )}

        {activeTab !== 'calling' && (
          <FilterBar
            {...filterBarProps}
            onApply={applyCurrentFilters}
            loading={statsLoading}
          />
        )}

        {activeTab !== 'calling' && !statsLoading && kpis && kpis.total > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Total', value: kpis.total, color: 'text-slate-900' },
              { label: 'Pending', value: kpis.pending, color: 'text-red-600' },
              { label: 'Closed Within', value: kpis.within, color: 'text-green-600' },
              { label: 'Closed Beyond', value: kpis.beyond, color: 'text-amber-600' },
              { label: 'Avg Resolution', value: kpis.avgRes, color: 'text-blue-700' },
              { label: 'Feeders', value: kpis.feeders, color: 'text-indigo-600' }
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
                <p className={`text-2xl font-bold ${item.color}`}>
                  {typeof item.value === 'number' ? item.value.toLocaleString('en-IN') : item.value}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="sticky top-2 z-10">
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
                }`}
              >
                <span className="text-base">{tab.icon}</span>{tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'calling' && (
          <div className="pb-8">
            <CallingReport />
          </div>
        )}

        {activeTab !== 'calling' && statsLoading && (
          <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-b-4 border-blue-600"></div>
                <p className="font-semibold text-gray-700">Loading analytics...</p>
              </div>
            </div>
          </div>
        )}

        {activeTab !== 'calling' && !statsLoading && !error && (!stats || stats.total === 0) && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-yellow-800">
            <p className="font-semibold">No complaints found for the current filters.</p>
            <p className="mt-1 text-sm">Try another date range, a broader preset, or clear filters.</p>
          </div>
        )}

        {activeTab !== 'calling' && !statsLoading && !error && stats && stats.total > 0 && (
          <div className="pb-8">
            {activeTab === 'trends' && <TrendCharts stats={stats} />}
            {activeTab === 'deep' && <DeepDivePanel stats={stats} />}
            {activeTab === 'months' && <MonthComparison stats={stats} />}
            {activeTab === 'consumers' && <ConsumerInsights stats={stats} />}
            {activeTab === 'feeders' && <FeederReport stats={stats} />}
          </div>
        )}
      </div>
    </div>
  );
}
