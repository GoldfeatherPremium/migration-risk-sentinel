alter table public.orders add constraint orders_customer_fk foreign key (customer_id) references public.customers (id);
