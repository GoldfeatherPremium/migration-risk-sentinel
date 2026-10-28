# Supabase Migration Guard

Static analysis for PostgreSQL and Supabase SQL migrations. It flags destructive changes, lock-heavy DDL and changes likely to fail on existing data, with exact source locations and safer alternatives.

> **Status: early development (v0.1.0, unreleased).** Not yet published to npm. No releases exist yet. Static analysis cannot guarantee a migration is safe; findings are meant to support human review.

## What's included (verified by the test suite)

- **Core engine** (`packages/core`) — TypeScript, no React or network dependencies. PostgreSQL-aware lexer (strings, `E''`, dollar quotes, nested comments, quoted identifiers), statement splitter (handles `BEGIN ATOMIC` bodies) and a recursive-descent statement classifier. 21 rules, configuration, inline suppressions, baselines, deterministic JSON / Markdown / SARIF 2.1.0 reporters.
- **CLI** (`packages/cli`) — `scan` with recursive `.sql` discovery, `--format text|json|markdown|sarif`, config loading/validation, `--fail-on`, `--exclude`, `--baseline`, `--write-baseline`, documented exit codes.
- **GitHub Action** (`packages/github-action`) — composite action that builds the CLI, writes a job summary, optionally writes SARIF and fails at your threshold. No database or secrets.
- **Web app** (`src/`) — analyzer (paste/upload, rule overrides, filters, grouping, excerpts, exports), playground with sample fixtures, rule reference and docs. Runs the same engine in the browser.

## Repository layout

```
packages/core/            analysis engine (lexer, parser, rules, reporters)
packages/cli/             Node CLI (supabase-migration-guard)
packages/github-action/   composite GitHub Action
src/                      web app (TanStack Start + React + Tailwind + shadcn/ui)
tests/                    vitest suites + SQL fixtures
docs/                     documentation and example workflow
.github/                  CI, self-test workflow, templates, Dependabot
```

The web app lives at the repository root (`src/`) rather than `apps/web/` because the hosting template requires it; it imports the core engine directly from `packages/core/src`.

## Quick start

```bash
npm install
npm test               # 70+ tests: rules, analyzer, reporters, CLI exit codes
npm run build:cli      # compiles to packages/cli/dist
npm run scan -- ./supabase/migrations
node packages/cli/dist/cli/src/cli.js scan ./supabase/migrations --format sarif -o report.sarif
npm run dev            # web app
```

### CLI

```
supabase-migration-guard scan [paths...] [--format text|json|markdown|sarif] [--config file]
                              [--fail-on error|warning|info|never] [--output file]
                              [--exclude glob]... [--baseline file] [--write-baseline file]
supabase-migration-guard rules | --help | --version
```

| Exit code | Meaning |
| --- | --- |
| 0 | No findings at or above the failure threshold |
| 1 | Findings at or above the threshold (`failOn`, default `error`) |
| 2 | Usage or configuration error |
| 3 | File system error (missing path, unreadable or oversized file) |

### GitHub Actions

See [`docs/examples/migration-guard.yml`](docs/examples/migration-guard.yml) and [`docs/github-actions.md`](docs/github-actions.md). The action is exercised by `.github/workflows/migration-guard-self-test.yml`.

### Configuration

`migration-guard.config.json` (or `.migration-guard.json`, or `--config`):

```json
{
  "rules": { "MIG032": "off", "MIG023": { "severity": "warning", "options": { "threshold": 2 } } },
  "exclude": ["supabase/seed.sql"],
  "failOn": "error",
  "assumeImplicitTransaction": false,
  "baseline": []
}
```

Inline suppression: `-- migration-guard-ignore MIG001 -- reason` (next statement or same line) and `-- migration-guard-ignore-file MIG003,MIG033`. Details in [`docs/configuration.md`](docs/configuration.md).

## Rules

| ID | Rule | Default | Confidence |
| --- | --- | --- | --- |
| MIG000 | SQL syntax problem | error | definite |
| MIG001 | DROP TABLE | error | definite |
| MIG002 | DROP COLUMN | error | definite |
| MIG003 | TRUNCATE TABLE | error | definite |
| MIG004 | DROP SCHEMA | error | definite |
| MIG005 | DROP INDEX | warning | heuristic |
| MIG010 | Unsafe NOT NULL column | error | heuristic |
| MIG011 | Column type change | warning | heuristic |
| MIG012 | Unique constraint on existing data | warning | heuristic |
| MIG013 | Foreign key validated immediately | warning | heuristic |
| MIG014 | UPDATE/DELETE without WHERE | error | definite |
| MIG015 | Broad UPDATE/DELETE | warning | heuristic |
| MIG020 | CREATE INDEX without CONCURRENTLY | warning | heuristic |
| MIG021 | CONCURRENTLY inside a transaction | error | definite |
| MIG022 | Expensive index rebuild or table rewrite | warning | heuristic |
| MIG023 | Repeated locks on the same table | info | heuristic |
| MIG030 | Duplicate schema change | warning | heuristic |
| MIG031 | Suspicious migration ordering | warning | heuristic |
| MIG032 | No explicit transaction | info | heuristic |
| MIG033 | Irreversible change without recovery plan | warning | heuristic |
| MIG034 | Empty migration | warning | definite |

Full rationale, remediation and limitations: [`docs/rules.md`](docs/rules.md) or the web app's Rules page.

## Limitations

- Not a complete PostgreSQL grammar. Statements outside the classifier's scope are skipped, never guessed. MIG000 checks lexical errors, parenthesis balance and the leading command only.
- Table size, data, locks and application compatibility are unknown. Heuristic rules say so.
- Only explicit `BEGIN`/`COMMIT` is understood; implicit runner transactions need `assumeImplicitTransaction`.
- A clean report is not proof of safety.

## Privacy and security

Analysis is local: browser or your Node process. No uploads, accounts, credentials, telemetry or SQL execution. The web app loads fonts from Google Fonts (no SQL is sent). See [`SECURITY.md`](SECURITY.md) and [`docs/privacy.md`](docs/privacy.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
