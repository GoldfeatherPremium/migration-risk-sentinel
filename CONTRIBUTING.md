# Contributing

Thanks for helping improve Supabase Migration Guard.

## Setup

```bash
npm install
npm test          # vitest (rules, analyzer, reporters, CLI)
npm run lint
npm run typecheck
npm run build:cli
npm run dev       # web app
```

Node.js 20+ is required.

## Adding or changing a rule

1. Edit `packages/core/src/rules.ts`. New rules need a new stable ID (never reuse IDs), `description`, `rationale`, `remediation`, `limitations` and `confidence`.
2. Use the parsed statement model in `packages/core/src/parser.ts`. Do not classify SQL with regular expressions over raw text.
3. Add **at least one positive and one negative test** to `tests/rules.test.ts`. Add fixtures to `tests/fixtures/` for realistic cases.
4. When certainty depends on unknown context (table size, data, runner behaviour), mark the rule `heuristic` and say so in the message or limitations.
5. Never auto-modify or execute SQL.
6. Update `CHANGELOG.md` under "Unreleased" and the rule table in `README.md`.

## Pull requests

- Keep changes focused; include tests.
- Documentation must describe actual behaviour only.
- CI runs lint, typecheck, tests, the web build, the CLI build and an action self-test.

## Reporting false positives

Use the "False positive / false negative" issue template with a minimal SQL snippet. Remove sensitive identifiers and never include credentials or production data.

## Security

Do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
