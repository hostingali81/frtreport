'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import FilterBar from '../components/FilterBar';
import { useData } from '../context/DataContext';
import { useComplaintFilters } from '../hooks/useComplaintFilters';

const LoadingSkeleton = () => (
  <div className="w-full h-96 bg-gray-100 rounded-2xl animate-pulse flex items-center justify-center text-gray-400 font-medium">
    Loading Charts...
  </div>
);

const TrendCharts = dynamic(() => import('../components/TrendCharts'), { ssr: false, loading: () => <LoadingSkeleton /> });
const DeepDivePanel = dynamic(() => import('../components/DeepDivePanel'), { ssr: false, loading: () => <LoadingSkeleton /> });
const MonthComparison = dynamic(() => import('../components/MonthComparison'), { ssr: false, loading: () => <LoadingSkeleton /> });
const ConsumerInsights = dynamic(() => import('../components/ConsumerInsights'), { ssr: false, loading: () => <LoadingSkeleton /> });
const FeederReport = dynamic(() => import('../components/FeederReport'), { ssr: false, loading: () => <LoadingSkeleton /> });

type TabId = 'trends' | 'deep' | 'months' | 'consumers' | 'feeders';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'deep', label: 'Deep Analysis', icon: '🔬' },
  { id: 'feeders', label: 'Feeder Report', icon: '⚡' },
  { id: 'trends', label: 'Trends', icon: '📈' },
  { id: 'months', label: 'Month Comparison', icon: '📅' },
  { id: 'consumers', label: 'Repeat Consumers', icon: '👥' }
];

const formatMins = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
};

// Analytics dashboard: the old Charts + Deep Analysis pages merged into one
// page. Everything renders from server-computed stats (no row downloads);
// sections live in tabs so only the active one mounts.
export default function AnalyticsPage() {
  const { stats, statsLoading, refreshData, applyFilters } = useData();
  const router = useRouter();
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('deep');

  const { filterBarProps, buildFilters } = useComplaintFilters();

  const applyCurrentFilters = async () => {
    setError('');
    try {
      await applyFilters(buildFilters(), { withRows: false });
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics data');
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
      avgRes: resN > 0 ? formatMins(resSum / resN) : '—',
      feeders: (stats.byFeeder ?? []).length
    };
  }, [stats]);

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="FRT Logo" width={56} height={56} className="rounded-lg" priority />
            <div>
              <h1 className="text-xl md:text-3xl font-bold">📊 Analytics Dashboard</h1>
              <p className="text-gray-500 text-sm md:text-base">Trends, deep analysis, consumers & feeder report — one place</p>
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
              onClick={async () => {
                setError('');
                const result = await refreshData();
                if (!result.success) {
                  setError(result.error || 'Refresh failed');
                }
              }}
              disabled={statsLoading}
              className="inline-flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition shadow-sm"
            >
              <FiRefreshCw className={statsLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded">
            <p className="font-semibold">⚠️ {error}</p>
          </div>
        )}

        <FilterBar
          {...filterBarProps}
          onApply={applyCurrentFilters}
          loading={statsLoading}
        />

        {/* KPI strip */}
        {!statsLoading && kpis && kpis.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
              <p className="text-2xl font-bold text-gray-900">{kpis.total.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Pending</p>
              <p className="text-2xl font-bold text-red-600">{kpis.pending.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Closed Within</p>
              <p className="text-2xl font-bold text-green-600">{kpis.within.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Closed Beyond</p>
              <p className="text-2xl font-bold text-amber-600">{kpis.beyond.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Resolution</p>
              <p className="text-2xl font-bold text-blue-700">{kpis.avgRes}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Feeders</p>
              <p className="text-2xl font-bold text-indigo-600">{kpis.feeders}</p>
            </div>
          </div>
        )}

        {/* Section tabs */}
        <div className="sticky top-2 z-20">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>{tab.label}
              </button>
            ))}
          </div>
        </div>

        {statsLoading && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-b-4 border-blue-600"></div>
                <p className="font-semibold text-gray-700">Loading analytics...</p>
              </div>
            </div>
          </div>
        )}

        {!statsLoading && !error && (!stats || stats.total === 0) && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 px-4 py-3 rounded">
            <p className="font-semibold">No complaints found for the current filters.</p>
            <p className="mt-1 text-sm">Try another date range, a broader preset, or clear filters.</p>
          </div>
        )}

        {!statsLoading && !error && stats && stats.total > 0 && (
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
