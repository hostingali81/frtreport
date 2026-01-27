'use server';

import { createClient } from '@supabase/supabase-js';
import { getCachedData, setCachedData } from './cache';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function getComplaintsData() {
  
  if (!supabase) return { data: [], lastScrapedAt: null };

  const cached = getCachedData();
  if (cached) {
    return cached;
  }

  try {
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    const maxRecords = 50000;
    
    while (from < maxRecords) {
      const { data, error } = await supabase
        .from('complaints')
        .select('raw_data')
        .order('complaint_date', { ascending: false })
        .range(from, from + batchSize - 1);
      
      if (error || !data || data.length === 0) break;
      
      allData = allData.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    
    const { data: metadata } = await supabase
      .from('scrape_metadata')
      .select('last_scrape_at')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastScrapedAt = metadata?.last_scrape_at 
      ? new Date(metadata.last_scrape_at).toLocaleString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })
      : null;

    const dataArray = allData.map(row => row.raw_data);
    setCachedData(dataArray, lastScrapedAt);

    return { data: dataArray, lastScrapedAt };
  } catch (err) {
    console.error('Server fetch error:', err);
    return { data: [], lastScrapedAt: null };
  }
}
