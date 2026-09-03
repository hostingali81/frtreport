'use server';

import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

function getFetchAllMaxRecords() {
  const value = process.env.COMPLAINTS_FETCH_ALL_MAX_RECORDS;
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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
    const maxRecords = getFetchAllMaxRecords();
    
    while (maxRecords === null || from < maxRecords) {
      const to = maxRecords === null
        ? from + batchSize - 1
        : Math.min(from + batchSize - 1, maxRecords - 1);
      const { data, error } = await supabase
        .from('complaints')
        .select('complaint_number, division, sub_division, sub_station, consumer_name, consumer_mobile, consumer_address, complaint_type, complaint_sub_type, status, closed_status, closed_by, complaint_date, closed_date, closing_remarks, area_type, feeder')
        // NULLS FIRST matches idx_complaints_date_id (complaint_date DESC, id
        // DESC); the default NULLS LAST cannot use it, so every .range() batch
        // re-sorted the whole 188k-row table. complaint_date has no nulls, so
        // the rows and their order are unchanged.
        .order('complaint_date', { ascending: false, nullsFirst: true })
        .range(from, to);
      
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

    const formatDT = (dt: string | null) => {
      if (!dt) return null;
      return new Date(dt).toLocaleString('en-US', {
        timeZone: 'Asia/Kolkata',
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      }).replace(',', '');
    };
    
    const dataArray = allData.map(row => ({
      'Complaint Number': row.complaint_number,
      'Division': row.division,
      'Sub Division': row.sub_division,
      'Sub Station': row.sub_station,
      'Consumer Name': row.consumer_name,
      'Consumer Mobile': row.consumer_mobile,
      'Consumer Address': row.consumer_address,
      'Complaint Type': row.complaint_type,
      'Complaint Sub Type': row.complaint_sub_type,
      'Status': row.status,
      'Closed Status': row.closed_status,
      'Closed By': row.closed_by,
      'Complaint Date and Time': formatDT(row.complaint_date),
      'Closed Date': formatDT(row.closed_date),
      'Closing Remarks': row.closing_remarks,
      'Area Type': row.area_type,
      'Feeder': row.feeder
    }));
    
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
