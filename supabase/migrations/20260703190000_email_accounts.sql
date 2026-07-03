-- FRT Calling App — email login + password reset (Phase 3b).
-- Login id becomes email; username is kept (now optional) for back-compat.

alter table public.app_users add column if not exists email text;
create unique index if not exists app_users_email_key on public.app_users (lower(email)) where email is not null;

-- username was NOT NULL UNIQUE; new accounts are email-only, so make it optional.
alter table public.app_users alter column username drop not null;

-- Single-use, time-limited password reset tokens (only the SHA-256 hash is stored).
create table if not exists public.password_reset_tokens (
  id         bigserial primary key,
  user_id    bigint not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_hash_idx on public.password_reset_tokens (token_hash);
create index if not exists password_reset_tokens_user_idx on public.password_reset_tokens (user_id);

alter table public.password_reset_tokens enable row level security;
