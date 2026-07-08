const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { error: insErr } = await supabase.from('complaints').insert({ complaint_number: 'TEST_123' }).select('id');
  console.log('Error:', insErr);
  if (!insErr) {
     await supabase.from('complaints').delete().eq('complaint_number', 'TEST_123');
  }
}
run();
