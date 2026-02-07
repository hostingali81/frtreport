'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getComplaintsData } from '../lib/serverActions';

interface DataContextType {
  data: any[];
  loading: boolean;
  lastUpdated: string;
  refreshData: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

let memoryCache: { data: any[]; lastScrapedAt: string; timestamp: number } | null = null;

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchData = async (refresh = false) => {
    setLoading(true);
    try {
      if (refresh) memoryCache = null;
      
      const result = await getComplaintsData();
      
      if (result.data && result.data.length > 0) {
        setData(result.data);
        
        // Always update timestamp when we get new data
        if (result.lastScrapedAt) {
          setLastUpdated(result.lastScrapedAt);
        }
        
        memoryCache = {
          data: result.data,
          lastScrapedAt: result.lastScrapedAt || '',
          timestamp: Date.now()
        };
      }
    } catch (err) {
      console.error('Data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (memoryCache) {
      const age = Date.now() - memoryCache.timestamp;
      
      if (age < 10 * 60 * 1000) {
        setData(memoryCache.data);
        setLastUpdated(memoryCache.lastScrapedAt);
        setLoading(false);
        return;
      }
    }
    
    fetchData();
  }, []);

  return (
    <DataContext.Provider value={{ data, loading, lastUpdated, refreshData: () => fetchData(true) }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
