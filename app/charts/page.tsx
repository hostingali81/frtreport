'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TrendCharts from '../components/TrendCharts';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import Image from 'next/image';

export default function ChartsPage() {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const fetchData = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/scrape');
      const result = await response.json();
      
      if (result.success && result.data && result.data.length > 0) {
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
              className="inline-flex items-center gap-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg transition"
            >
              <FiArrowLeft /> Back
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 md:px-5 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition"
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

        {!loading && !error && data.length > 0 && (
          <TrendCharts data={data} isClosedRow={isClosedRow} />
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
