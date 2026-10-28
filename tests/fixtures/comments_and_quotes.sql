/* drop table users; -- this is a comment, not SQL
   /* nested: truncate accounts; */ */
-- drop table customers;
create table "Weird ""Name""" ("DROP TABLE" text);
insert into notes (body) values ('drop table users; delete from accounts;');
select $$ truncate table x; drop schema y; $$ as body;
select $tag$ update t set a = 1; $tag$;
