drop table if exists public.legacy_orders cascade;
alter table public.users drop column middle_name;
truncate table public.audit_log;
drop schema archive cascade;
drop index public.users_email_idx;
