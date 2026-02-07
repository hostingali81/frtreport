'use server';

import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function getComplaintsData() {
  if (!supabase) {
    console.error('❌ Database connection not configured');
    return { 
      data: [], 
      lastScrapedAt: null, 
      error: 'Database connection unavailable. Please check configuration.' 
    };
  }

  try {
    console.log('🔄 Fetching complaints from database...');
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
      
      if (error) {
        console.error(`❌ Database query error at offset ${from}:`, error.message);
        throw new Error(`Failed to fetch complaints: ${error.message}`);
      }
      
      if (!data || data.length === 0) break;
      
      allData = allData.concat(data);
      console.log(`📊 Fetched ${allData.length} records so far...`);
      
      if (data.length < batchSize) break;
      from += batchSize;
    }
    
    console.log(`✅ Successfully fetched ${allData.length} total complaints`);
    
    const { data: metadata, error: metaError } = await supabase
      .from('scrape_metadata')
      .select('last_scrape_at')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (metaError) {
      console.warn('⚠️ Could not fetch metadata:', metaError.message);
    }

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
    
    console.log('✅ Data fetched successfully');
    return { data: dataArray, lastScrapedAt };
  } catch (err: any) {
    console.error('❌ Critical error fetching complaints:', err);
    return { 
      data: [], 
      lastScrapedAt: null, 
      error: err.message || 'An unexpected error occurred while fetching data' 
    };
  }
}
