create or replace function public.touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  delete from public.cache; -- inside a function body, not executed by the migration
  return new;
end;
$$;

alter table
  public.orders
  add column
    priority int
    not null;
