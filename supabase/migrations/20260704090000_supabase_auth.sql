-- Move to Supabase Auth (GoTrue). Users live in auth.users; app metadata (role,
-- display name, active) lives in `profiles`, keyed by the auth user's UUID.
-- The old custom-auth tables are dropped.

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  role          text not null default 'operator' check (role in ('operator', 'admin', 'super_admin')),
  display_name  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create index if not exists profiles_email_idx on public.profiles (lower(email));
alter table public.profiles enable row level security;

-- call_logs.operator_id was bigint -> app_users(id); make it uuid -> profiles(id).
alter table public.call_logs drop constraint if exists call_logs_operator_id_fkey;
drop index if exists public.call_logs_operator_id_idx;
alter table public.call_logs drop column if exists operator_id;
alter table public.call_logs add column operator_id uuid references public.profiles(id) on delete set null;
create index if not exists call_logs_operator_id_idx on public.call_logs (operator_id);

-- Remove the custom-auth tables (Supabase Auth replaces them).
drop table if exists public.password_reset_tokens;
drop table if exists public.app_users;
