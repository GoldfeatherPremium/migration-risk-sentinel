-- Must run outside a transaction block.
create index concurrently if not exists orders_created_idx on public.orders (created_at);
