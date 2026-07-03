/**
 * Bootstrap / manage FRT Calling App users from the CLI. Use this to create the
 * first super-admin; after that, super-admins can manage users in the UI.
 *
 *   npx tsx scripts/create-user.ts <email> <password> <role> ["Display Name"]
 *   role = operator | admin | super_admin
 *
 * Example:
 *   npx tsx scripts/create-user.ts boss@example.com Secret123 super_admin "Control Room Boss"
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

async function main() {
  const [email, password, role, displayName] = process.argv.slice(2);
  if (!email || !password || !role) {
    console.error('Usage: npx tsx scripts/create-user.ts <email> <password> <role> ["Display Name"]');
    console.error('  role = operator | admin | super_admin');
    process.exit(1);
  }
  const { createUser } = await import('../app/lib/users');
  const { isRole } = await import('../app/lib/auth');
  if (!isRole(role)) {
    console.error(`Invalid role "${role}". Use operator | admin | super_admin.`);
    process.exit(1);
  }
  const user = await createUser({ email, password, role, display_name: displayName || null });
  console.log('Created user:', JSON.stringify({ id: user.id, email: user.email, role: user.role, display_name: user.display_name }));
}

main().catch(e => { console.error('Failed:', e?.message || e); process.exit(1); });
