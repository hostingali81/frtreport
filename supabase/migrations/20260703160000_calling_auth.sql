-- FRT Calling App — authentication + roles (Phase 3).
-- Three roles: 'operator' (calls), 'admin' (all-operator reports), 'super_admin'
-- (user management + reports). Custom auth (not Supabase Auth): passwords are
-- scrypt-hashed by the app; sessions are HMAC-signed cookies.

create table if not exists public.app_users (
  id            bigserial primary key,
  username      text not null unique,
  password_hash text not null,                 -- scrypt$<saltHex>$<hashHex>
  role          text not null default 'operator'
                  check (role in ('operator', 'admin', 'super_admin')),
  display_name  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- Tie each call to the authenticated operator (server-derived, not client input).
alter table public.call_logs add column if not exists operator_id bigint references public.app_users(id) on delete set null;
create index if not exists call_logs_operator_id_idx on public.call_logs (operator_id);

-- Backend accesses this with the service role (bypasses RLS); nothing readable
-- with the anon key.
alter table public.app_users enable row level security;
