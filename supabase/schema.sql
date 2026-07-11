-- Run this once in the Supabase SQL editor for this project.

create extension if not exists pgcrypto;

create table if not exists saju_draws (
  id uuid primary key default gen_random_uuid(),
  birth_date date not null,
  birth_time time,
  gender text check (gender in ('male', 'female')),
  analysis text not null,
  numbers int[] not null,
  bonus int not null,
  created_at timestamptz not null default now()
);

-- Birth date/time is personal data: keep this table locked down.
-- The API writes with the service_role key, which bypasses RLS, so no
-- policies are needed for the app to work. Enabling RLS with zero
-- policies means anon/authenticated keys get no access at all.
alter table saju_draws enable row level security;
