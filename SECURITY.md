# Security Policy

## Supported versions

The project is pre-release (0.x). Only the `main` branch receives fixes.

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's **"Report a vulnerability"** (private security advisory) on this repository. If that is unavailable, contact the maintainers listed in the repository settings. Do not open a public issue.

Include: affected component (core, CLI, action, web app), version/commit, reproduction steps and impact. We aim to acknowledge reports within 7 days. There is no bug bounty.

## Security model

- Analysis is static. SQL is never executed and no database connection is made.
- The web analyzer runs entirely in the browser; SQL is not transmitted. Uploads are restricted to `.sql` files ≤ 1 MB (max 50) and rendered as text only.
- The CLI reads local files (≤ 2 MB each) and makes no network requests.
- The GitHub Action builds the CLI by installing pinned npm packages (`zod`, `typescript`, `@types/node`) and requests no secrets.
- No telemetry is collected. The web app loads fonts from Google Fonts.
- The project has not undergone an independent security audit.
