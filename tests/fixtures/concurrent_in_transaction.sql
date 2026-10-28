begin;
create index concurrently orders_created_idx on public.orders (created_at);
commit;
