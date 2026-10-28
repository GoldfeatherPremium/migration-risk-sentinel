update public.orders set archived = true;
delete from public.sessions;
update public.orders set archived = false where id = 42;
