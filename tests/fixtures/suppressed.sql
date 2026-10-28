-- migration-guard-ignore MIG001 -- reason: table retired in RFC-12
drop table public.old_reports;
alter table public.users drop column fax; -- migration-guard-ignore MIG002
truncate public.tmp_import;
