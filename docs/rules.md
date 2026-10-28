# Rule reference

Generated from rule metadata in packages/core/src/rules.ts.

## MIG000 — SQL syntax problem

- Default severity: **error** · Confidence: **definite** · Category: syntax

The lexer or statement checker found a definite syntax problem (unterminated string, unbalanced parentheses, unrecognized command).

**Why it matters.** A migration that does not parse will fail at deploy time, possibly after earlier statements already ran.

**Safer alternative.** Fix the reported syntax problem and run the migration against a local database (e.g. `supabase db reset`).

**Limitations.**
- Only lexical structure, parenthesis balance and the leading command keyword are verified; this is not a full PostgreSQL grammar check.
- Valid SQL that starts with an uncommon command may be reported as unrecognized.

## MIG001 — DROP TABLE

- Default severity: **error** · Confidence: **definite** · Category: destructive

Dropping a table permanently deletes its data.

**Why it matters.** DROP TABLE removes all rows, indexes, triggers and policies; running application code that still reads the table will fail.

**Safer alternative.** Deploy application code that no longer uses the table first, take a backup or rename the table (e.g. `ALTER TABLE t RENAME TO t_deprecated`) and drop it in a later migration.

**Limitations.**
- Tables created earlier in the same file are ignored (temporary scaffolding).
- IF EXISTS does not make the operation safer and is not required.

## MIG002 — DROP COLUMN

- Default severity: **error** · Confidence: **definite** · Category: destructive

Dropping a column permanently deletes its data and breaks code that still references it.

**Why it matters.** Application instances deployed before the migration may still SELECT or INSERT the column, causing errors during rollout.

**Safer alternative.** Stop reading and writing the column in application code, deploy, then drop it in a follow-up migration. Back up the data if it may be needed.

**Limitations.**
- Cannot tell whether application code still references the column.

## MIG003 — TRUNCATE TABLE

- Default severity: **error** · Confidence: **definite** · Category: destructive

TRUNCATE deletes every row and takes an ACCESS EXCLUSIVE lock.

**Why it matters.** Truncating in a migration usually destroys production data and blocks all access to the table while it runs.

**Safer alternative.** Avoid TRUNCATE in migrations. If you really need to clear data, do it as an explicit, reviewed operational task with a backup.

**Limitations.**
- Tables created earlier in the same file are ignored.

## MIG004 — DROP SCHEMA

- Default severity: **error** · Confidence: **definite** · Category: destructive

Dropping a schema removes it and, with CASCADE, every object inside it.

**Why it matters.** Schemas such as public, auth or storage in Supabase contain critical objects; dropping them is rarely intended.

**Safer alternative.** Drop individual objects explicitly and review each one. Never drop Supabase-managed schemas.

**Limitations.**
- Cannot see which objects the schema contains.

## MIG005 — DROP INDEX

- Default severity: **warning** · Confidence: **heuristic** · Category: destructive

Dropping an index can degrade query performance; without CONCURRENTLY it blocks the table.

**Why it matters.** Queries that relied on the index may switch to sequential scans. A plain DROP INDEX takes an ACCESS EXCLUSIVE lock on the table.

**Safer alternative.** Confirm no queries depend on the index (pg_stat_user_indexes.idx_scan). Use DROP INDEX CONCURRENTLY outside a transaction block for busy tables.

**Limitations.**
- Reported as info when the same index is recreated later in the file (replacement) — see MIG022.
- Ignored when the index was created earlier in the same file.

## MIG010 — Unsafe NOT NULL column

- Default severity: **error** · Confidence: **heuristic** · Category: data

Adding a NOT NULL column without a default, or setting NOT NULL on an existing column, fails on populated tables.

**Why it matters.** PostgreSQL rejects ADD COLUMN ... NOT NULL without DEFAULT if any row exists. SET NOT NULL scans the whole table under an ACCESS EXCLUSIVE lock. Volatile defaults force a full table rewrite.

**Safer alternative.** Add the column as nullable (or with a constant DEFAULT), backfill in batches, then add `CHECK (col IS NOT NULL) NOT VALID`, VALIDATE it, and finally SET NOT NULL.

**Limitations.**
- Cannot know whether the table is empty; empty tables are safe.
- Constant defaults are treated as safe (PostgreSQL 11+ fast default).
- Tables created earlier in the same file are ignored.

## MIG011 — Column type change

- Default severity: **warning** · Confidence: **heuristic** · Category: data

ALTER COLUMN ... TYPE can rewrite the table and fail on existing values.

**Why it matters.** Most type changes rewrite every row and rebuild indexes under an ACCESS EXCLUSIVE lock. Incompatible values make the migration fail.

**Safer alternative.** Add a new column with the target type, backfill in batches, switch the application, then drop the old column. Some changes (e.g. varchar(n) to text) are cheap — verify on a copy of production data.

**Limitations.**
- Does not know the old type, so binary-compatible changes that skip rewrites are still reported.
- Tables created earlier in the same file are ignored.

## MIG012 — Unique constraint on existing data

- Default severity: **warning** · Confidence: **heuristic** · Category: data

Adding a UNIQUE / PRIMARY KEY constraint or unique index fails if duplicates already exist.

**Why it matters.** The migration fails when existing rows violate uniqueness, and building the index blocks writes unless done concurrently.

**Safer alternative.** Check for duplicates first (`SELECT col, count(*) ... GROUP BY col HAVING count(*) > 1`). Build `CREATE UNIQUE INDEX CONCURRENTLY`, then `ADD CONSTRAINT ... UNIQUE USING INDEX`.

**Limitations.**
- Cannot see existing data.
- `USING INDEX` constraints and tables created earlier in the same file are ignored.

## MIG013 — Foreign key validated immediately

- Default severity: **warning** · Confidence: **heuristic** · Category: data

Adding a FOREIGN KEY without NOT VALID checks every row and locks both tables.

**Why it matters.** Orphaned rows make the migration fail, and validation holds a SHARE ROW EXCLUSIVE lock on both tables for the duration of the scan.

**Safer alternative.** Add the constraint with NOT VALID, then run `ALTER TABLE ... VALIDATE CONSTRAINT ...` in a separate migration. Clean up orphans first.

**Limitations.**
- Cannot see existing data.
- Foreign keys on new columns (always NULL) and tables created earlier in the same file are ignored.

## MIG014 — UPDATE/DELETE without WHERE

- Default severity: **error** · Confidence: **definite** · Category: data

An UPDATE or DELETE with no WHERE clause affects every row in the table.

**Why it matters.** Whole-table writes are slow, generate heavy WAL, hold row locks on every row and are frequently a mistake.

**Safer alternative.** Add a WHERE clause. For intentional backfills, process rows in batches outside the schema migration.

**Limitations.**
- Reported as info for tables created earlier in the same file.
- Statements filtered only by a USING/FROM join without WHERE are reported.

## MIG015 — Broad UPDATE/DELETE

- Default severity: **warning** · Confidence: **heuristic** · Category: data

UPDATE/DELETE with an always-true or non-selective WHERE clause needs manual review.

**Why it matters.** Predicates such as `WHERE true`, `WHERE 1 = 1` or only `IS NULL` checks typically touch most of the table.

**Safer alternative.** Narrow the predicate or run the backfill in bounded batches (e.g. by primary key ranges) outside the migration.

**Limitations.**
- Selectivity is estimated from predicate shape only; reported as info unless the predicate is trivially true.

## MIG020 — CREATE INDEX without CONCURRENTLY

- Default severity: **warning** · Confidence: **heuristic** · Category: index

A plain CREATE INDEX blocks writes to the table until the build finishes.

**Why it matters.** On large or busy tables, building an index without CONCURRENTLY holds a SHARE lock that blocks INSERT/UPDATE/DELETE.

**Safer alternative.** Use CREATE INDEX CONCURRENTLY in its own migration file outside a transaction block. CONCURRENTLY is slower, cannot run in a transaction, and can leave an INVALID index on failure that must be dropped.

**Limitations.**
- Table size is unknown; small tables are fine.
- Tables created earlier in the same file are ignored.

## MIG021 — CONCURRENTLY inside a transaction

- Default severity: **error** · Confidence: **definite** · Category: index

CREATE/DROP INDEX CONCURRENTLY and REINDEX CONCURRENTLY cannot run inside a transaction block.

**Why it matters.** PostgreSQL raises `cannot run inside a transaction block`, failing the migration.

**Safer alternative.** Move the concurrent statement to its own migration file without BEGIN/COMMIT. Confirm your migration runner does not wrap files in a transaction.

**Limitations.**
- Explicit BEGIN/COMMIT is detected with certainty. Runners that wrap each file in an implicit transaction are only flagged when `assumeImplicitTransaction` is enabled (reported as warning).

## MIG022 — Expensive index rebuild or table rewrite

- Default severity: **warning** · Confidence: **heuristic** · Category: index

REINDEX, CLUSTER, VACUUM FULL and SET TABLESPACE rebuild data under heavy locks; drop-and-recreate leaves a gap.

**Why it matters.** These operations rewrite tables or indexes and block reads and/or writes for their duration.

**Safer alternative.** Prefer REINDEX CONCURRENTLY (outside transactions), pg_repack for table rewrites, and CREATE INDEX CONCURRENTLY a replacement before dropping the old index.

**Limitations.**
- Duration depends on data size, which is unknown.

## MIG023 — Repeated locks on the same table

- Default severity: **info** · Confidence: **heuristic** · Category: index

Several lock-taking statements target the same existing table in one file.

**Why it matters.** Each ALTER TABLE / non-concurrent CREATE INDEX re-acquires a strong lock; queued locks can stall application traffic.

**Safer alternative.** Combine ALTER TABLE actions into one statement where possible, set `lock_timeout`, and split long-running steps into separate migrations.

**Limitations.**
- Lock duration is unknown; the threshold is configurable via `threshold`.

## MIG030 — Duplicate schema change

- Default severity: **warning** · Confidence: **heuristic** · Category: quality

The same table, index or column is created more than once across the analyzed files.

**Why it matters.** Duplicate CREATE statements fail on deploy or indicate conflicting migrations from parallel branches.

**Safer alternative.** Remove the duplicate or merge the conflicting migrations. IF NOT EXISTS hides the duplicate but does not reconcile differing definitions.

**Limitations.**
- Statements with IF NOT EXISTS are skipped.
- Objects dropped between the two creations are not considered duplicates.

## MIG031 — Suspicious migration ordering

- Default severity: **warning** · Confidence: **heuristic** · Category: quality

A migration references a table that is only created by a later migration file.

**Why it matters.** Migrations run in filename order; referencing an object before it exists fails on fresh databases (CI, local resets, preview branches).

**Safer alternative.** Rename the files so dependencies run first, or move the statement into the later migration.

**Limitations.**
- Only tables created within the analyzed file set are considered; objects created outside SQL migrations are unknown.
- Files are ordered by path, matching Supabase's timestamp-prefixed naming.

## MIG032 — No explicit transaction

- Default severity: **info** · Confidence: **heuristic** · Category: quality

A file with several schema changes has no explicit BEGIN/COMMIT.

**Why it matters.** If a runner executes statements one by one, a failure mid-file leaves the schema half-migrated.

**Safer alternative.** Wrap related changes in BEGIN ... COMMIT, unless your runner already uses a transaction per file or the file contains CONCURRENTLY statements.

**Limitations.**
- Many runners (including the Supabase CLI) manage transactions themselves; disable this rule if so.
- Files containing CONCURRENTLY operations are skipped.

## MIG033 — Irreversible change without recovery plan

- Default severity: **warning** · Confidence: **heuristic** · Category: quality

The file contains data-destroying changes but no comment describing a rollback or recovery strategy.

**Why it matters.** Dropped data cannot be restored by a down-migration; reviewers need to know how to recover.

**Safer alternative.** Add a comment such as `-- recovery: restore from backup taken at <step>` or `-- rollback: ...` explaining how to recover, and take a backup before deploying.

**Limitations.**
- Looks for comments containing rollback/down/recovery/revert/restore/backup; it cannot judge the plan's quality.

## MIG034 — Empty migration

- Default severity: **warning** · Confidence: **definite** · Category: quality

The migration file contains no executable SQL.

**Why it matters.** Empty migrations are usually accidental (forgotten content or a bad merge) and clutter migration history.

**Safer alternative.** Add the intended SQL or delete the file.

**Limitations.**
- A file containing only comments counts as empty.

## Planned (not implemented)

- MIG040 — RLS not enabled on new public table: Supabase: tables in the public schema exposed via the Data API without ENABLE ROW LEVEL SECURITY.
- MIG041 — Overly permissive policy: Supabase: policies using `USING (true)` for write operations.
- MIG042 — Renamed column or table: RENAME breaks application code that still uses the old name during rollout.
- MIG043 — Missing lock_timeout: Lock-taking DDL without SET lock_timeout can queue behind long transactions.
