# Configuration

Loaded from `migration-guard.config.json`, `.migration-guard.json` (working directory) or `--config <file>`. Invalid JSON, unknown keys, unknown rule IDs and unknown options are rejected with exit code 2.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `rules` | object | `{}` | `"MIG001": "error" \| "warning" \| "info" \| "off"` or `{ "severity": ..., "options": {...} }` |
| `exclude` | string[] | `[]` | Globs (`**`, `*`, `?`) matched against paths relative to the working directory; patterns without `/` also match file names |
| `failOn` | string | `error` | Minimum severity that produces exit code 1; `never` disables |
| `assumeImplicitTransaction` | boolean | `false` | Treat multi-statement files as running in a transaction (MIG021 warning) |
| `baseline` | string[] | `[]` | Finding fingerprints to ignore |

When a severity is explicitly configured, it replaces any contextual severity the rule would choose (e.g. MIG005 normally downgrades to `info` for replaced indexes).

## Rule options

- `MIG023.threshold` (number, default 3) — lock-taking statements on one table before reporting.
- `MIG032.minStatements` (number, default 2) — DDL statements before requiring an explicit transaction.

## Suppressions

```sql
-- migration-guard-ignore MIG001 -- reason text
drop table old_reports;                         -- applies to the next statement

alter table users drop column fax; -- migration-guard-ignore MIG002   (same line)

-- migration-guard-ignore-file MIG003,MIG033 -- applies to the whole file
-- migration-guard-ignore all
```

Suppressed findings are reported in `suppressed` with their kind (`inline`, `file`, `baseline`) and reason.

## Baselines

```bash
supabase-migration-guard scan supabase/migrations --write-baseline .migration-guard-baseline.json
supabase-migration-guard scan supabase/migrations --baseline .migration-guard-baseline.json
```

Baseline file format: `{ "version": 1, "fingerprints": ["<16 hex chars>", ...] }`.
