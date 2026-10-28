-- Safe: new table with constraints and indexes in the same migration.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);
create index profiles_created_at_idx on public.profiles (created_at);
alter table public.profiles enable row level security;
