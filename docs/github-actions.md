# GitHub Actions

The composite action in `packages/github-action` runs the analyzer on a GitHub runner. It never connects to a database and requires no secrets.

## What it does

1. Sets up Node.js (`actions/setup-node`, pinned by commit SHA — verify the SHA against the upstream release).
2. Copies `packages/core` and `packages/cli` into `$RUNNER_TEMP`, installs pinned `zod`, `typescript` and `@types/node`, and compiles the CLI.
3. Runs `scan` and appends the Markdown report to the job summary.
4. Optionally writes SARIF (`sarif-file`) for `github/codeql-action/upload-sarif`.
5. Exits with the CLI's exit code, so the step fails when findings reach `fail-on`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `path` | `supabase/migrations` | Space-separated directories/files |
| `fail-on` | `error` | `error`, `warning`, `info` or `never` |
| `config` | — | Path to a config JSON file |
| `sarif-file` | — | Write SARIF to this path |
| `node-version` | `20` | Node.js version |

Output `exit-code`: 0 ok, 1 findings at threshold, 2 configuration error, 3 file error.

## Annotations

The action does not post PR comments or annotations itself. Inline annotations appear only if you upload the SARIF file to GitHub code scanning (requires `security-events: write`; availability depends on your plan/repository visibility).

## Example

See [examples/migration-guard.yml](examples/migration-guard.yml). The repository's own `.github/workflows/migration-guard-self-test.yml` verifies that a safe fixture passes and a destructive fixture fails with exit code 1 and produces SARIF.
