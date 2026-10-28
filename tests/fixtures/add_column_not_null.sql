alter table public.orders add column status text not null;
alter table public.orders add column region text not null default 'eu';
alter table public.orders add column token uuid default gen_random_uuid();
