// App configuration.
//
// The Supabase URL + anon key are public (shipped in every Supabase client).
// API_BASE_URL points at the Next.js backend. Default is the deployed Vercel app
// so an installed APK works over the internet. Override for local dev:
//   - Android emulator  -> --dart-define=API_BASE_URL=http://10.0.2.2:3000
//   - Physical device   -> --dart-define=API_BASE_URL=http://<PC-LAN-IP>:3000
class Config {
  static const supabaseUrl = 'https://eabjfbpspxnmmxiezysb.supabase.co';
  static const supabaseAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhYmpmYnBzcHhubW14aWV6eXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzMzM5MTgsImV4cCI6MjA3NzkwOTkxOH0.sQdrTCmsdWQkT78QyDw69ZDi3Ukp8vm52itvTAOPzAg';

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://frtreport.vercel.app',
  );

  // Self-update manifest published by scripts/release-app.mjs (public bucket).
  static const updateManifestUrl =
      '$supabaseUrl/storage/v1/object/public/app-updates/latest.json';
}
