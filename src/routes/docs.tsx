import { createFileRoute, Link } from "@tanstack/react-router";
import { CodeBlock, PageHeader } from "@/components/site-chrome";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — Supabase Migration Guard" },
      {
        name: "description",
        content:
          "Install and use the Migration Guard CLI and GitHub Action, configure rules, suppress findings and understand limitations.",
      },
      { property: "og:title", content: "Documentation — Supabase Migration Guard" },
      {
        property: "og:description",
        content: "CLI, GitHub Actions, configuration, suppressions, privacy model and limitations.",
      },
    ],
  }),
  component: DocsPage,
});

const TOC = [
  ["install", "Installation"],
  ["cli", "CLI usage"],
  ["exit-codes", "Exit codes"],
  ["actions", "GitHub Actions"],
  ["config", "Configuration"],
  ["suppress", "Suppressions & baselines"],
  ["api", "Library API"],
  ["rules", "Rule reference"],
  ["false-positives", "Reporting false positives"],
  ["privacy", "Security & privacy"],
  ["limitations", "Limitations & FAQ"],
] as const;

function DocsPage() {
  return (
    <>
      <PageHeader eyebrow="Documentation" title="Using Migration Guard">
        Everything here describes the current implementation (v0.1.0). If something is not
        documented, assume it is not supported yet.
      </PageHeader>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Contents" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:block lg:space-y-1.5">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted-foreground hover:text-foreground">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose-doc min-w-0 max-w-3xl">
          <h2 id="install">Installation</h2>
          <p>
            Requires Node.js 20 or newer. The package is <strong>not yet published to npm</strong>;
            build it from source:
          </p>
          <CodeBlock>{`git clone ${SITE.repoUrl}.git
cd supabase-migration-guard
npm install
npm run build:cli      # compiles packages/core + packages/cli to packages/cli/dist
npm run scan -- ./supabase/migrations`}</CodeBlock>

          <h2 id="cli">CLI usage</h2>
          <CodeBlock>{`supabase-migration-guard scan ./supabase/migrations
supabase-migration-guard scan ./supabase/migrations --format json
supabase-migration-guard scan ./supabase/migrations --format markdown
supabase-migration-guard scan ./supabase/migrations --format sarif -o report.sarif
supabase-migration-guard scan migrations/ extra.sql --fail-on warning --exclude "**/seed.sql"
supabase-migration-guard rules        # list rules and effective default severities
supabase-migration-guard --help | --version`}</CodeBlock>
          <p>
            Directories are searched recursively for <code>.sql</code> files (skipping{" "}
            <code>node_modules</code> and <code>.git</code>). Files are analyzed in path order,
            which matches Supabase's timestamp-prefixed names. Without a path argument,{" "}
            <code>./supabase/migrations</code> is scanned.
          </p>

          <h2 id="exit-codes">Exit codes</h2>
          <ul>
            <li>
              <code>0</code> — no findings at or above the failure threshold (<code>failOn</code>,
              default <code>error</code>).
            </li>
            <li>
              <code>1</code> — findings at or above the threshold.
            </li>
            <li>
              <code>2</code> — usage or configuration error (bad flag, invalid JSON, unknown rule
              ID).
            </li>
            <li>
              <code>3</code> — file system error (missing path, unreadable file, file larger than 2
              MB).
            </li>
          </ul>

          <h2 id="actions">GitHub Actions</h2>
          <p>
            The repository ships a composite action in <code>packages/github-action</code>. It
            builds the CLI from source with pinned npm packages, scans your migrations, writes a
            Markdown job summary, optionally writes SARIF, and fails the step at your threshold. It
            needs no database and no secrets.
          </p>
          <CodeBlock>{`jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write   # only for SARIF upload
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: OWNER/supabase-migration-guard/packages/github-action@<commit-sha>
        with:
          path: supabase/migrations
          fail-on: error
          sarif-file: migration-guard.sarif
      - uses: github/codeql-action/upload-sarif@<verified-sha>
        if: always() && hashFiles('migration-guard.sarif') != ''
        with:
          sarif_file: migration-guard.sarif`}</CodeBlock>
          <p>
            Inputs: <code>path</code>, <code>fail-on</code>, <code>config</code>,{" "}
            <code>sarif-file</code>, <code>node-version</code>. Output: <code>exit-code</code>.
            Inline pull-request annotations are only available through GitHub code scanning when you
            upload SARIF; the action itself does not post comments.
          </p>

          <h2 id="config">Configuration</h2>
          <p>
            The CLI loads <code>migration-guard.config.json</code> or{" "}
            <code>.migration-guard.json</code> from the working directory, or the file passed with{" "}
            <code>--config</code>. Unknown keys and rule IDs are rejected.
          </p>
          <CodeBlock>{`{
  "rules": {
    "MIG032": "off",
    "MIG020": "error",
    "MIG023": { "severity": "warning", "options": { "threshold": 2 } }
  },
  "exclude": ["supabase/seed.sql", "**/*_down.sql"],
  "failOn": "error",                 // error | warning | info | never
  "assumeImplicitTransaction": false, // flag CONCURRENTLY in multi-statement files
  "baseline": []                     // fingerprints to ignore
}`}</CodeBlock>
          <p>
            Exclusion globs support <code>**</code>, <code>*</code> and <code>?</code>. Patterns
            without a slash also match the file name.
          </p>

          <h2 id="suppress">Suppressions & baselines</h2>
          <CodeBlock>{`-- migration-guard-ignore MIG001 -- reason: table retired in RFC-12
drop table public.old_reports;

alter table users drop column fax; -- migration-guard-ignore MIG002

-- migration-guard-ignore-file MIG003,MIG033 -- staging cleanup
-- migration-guard-ignore all`}</CodeBlock>
          <p>
            A <code>migration-guard-ignore</code> comment applies to the next statement (or the
            statement on the same line). <code>-ignore-file</code> applies to the whole file.
            Suppressed findings are still listed in reports with their reason.
          </p>
          <p>
            Baselines let you adopt the tool on an existing project:{" "}
            <code>scan --write-baseline baseline.json</code> records fingerprints of current
            findings; <code>scan --baseline baseline.json</code> ignores them. Fingerprints hash the
            rule, file and statement text, so they survive line shifts but change when the statement
            changes.
          </p>

          <h2 id="api">Library API</h2>
          <CodeBlock>{`import { analyzeMigration, toSarif } from "./packages/core/src/index";

const result = analyzeMigration({
  files: [{ path: "supabase/migrations/001.sql", content: sql }],
  config: { rules: { MIG032: "off" } },
  dialect: "postgres",
});
result.summary;   // { error, warning, info, total, suppressed, filesAnalyzed, filesExcluded }
result.files;     // findings grouped by file
result.findings;  // deterministic order: file, line, column, rule`}</CodeBlock>

          <h2 id="rules">Rule reference</h2>
          <p>
            See the <Link to="/rules">rules page</Link> for every rule's rationale, remediation and
            limitations.
          </p>

          <h2 id="false-positives">Reporting false positives</h2>
          <p>
            Open a{" "}
            <a href={SITE.newIssueUrl} target="_blank" rel="noreferrer">
              "False positive / false negative" issue
            </a>{" "}
            with the rule ID, a minimal SQL snippet (remove sensitive names), your PostgreSQL
            version and how migrations are executed (explicit transactions, Supabase CLI, other
            runner). Never paste credentials or production data.
          </p>

          <h2 id="privacy">Security & privacy</h2>
          <ul>
            <li>
              The web analyzer runs entirely in your browser. SQL you paste or upload is read with
              the File API and never sent to a server, analytics or third party.
            </li>
            <li>
              The CLI and GitHub Action run locally / on your runner. They make no network requests
              during analysis; the action downloads pinned npm packages once to build the CLI.
            </li>
            <li>
              No authentication, database connection, password or service-role key is ever
              requested. SQL is never executed.
            </li>
            <li>
              Uploads are limited to <code>.sql</code> files up to 1 MB each (50 files). File names
              are sanitized and all content is rendered as text.
            </li>
            <li>
              No telemetry. The web app loads IBM Plex fonts from Google Fonts, which reveals your
              IP address to Google; SQL is not part of that request. Self-host the fonts if that
              matters to you.
            </li>
            <li>
              Report vulnerabilities privately as described in{" "}
              <a href={SITE.securityUrl} target="_blank" rel="noreferrer">
                SECURITY.md
              </a>
              .
            </li>
          </ul>

          <h2 id="limitations">Limitations & FAQ</h2>
          <h3>Is this a full PostgreSQL parser?</h3>
          <p>
            No. It uses a PostgreSQL-aware lexer (strings, dollar quotes, nested comments, quoted
            identifiers) and a recursive-descent classifier for the statements the rules need.
            Full-grammar parsers such as libpg_query require native or large WASM builds; this is a
            deliberate trade-off for a dependency-light engine that runs identically in the browser
            and Node. Syntax checking (MIG000) is therefore limited.
          </p>
          <h3>Does a clean report mean my migration is safe?</h3>
          <p>
            No. It means none of the implemented rules matched. Table size, data distribution, lock
            contention and application compatibility are unknown to static analysis.
          </p>
          <h3>Does it understand the Supabase CLI's transaction handling?</h3>
          <p>
            Only explicit <code>BEGIN</code>/<code>COMMIT</code> is detected with certainty. If your
            runner wraps each file in a transaction, enable <code>assumeImplicitTransaction</code>{" "}
            and disable MIG032.
          </p>
          <h3>Why is a table I created in an earlier migration treated as "existing"?</h3>
          <p>
            Because by the time a later migration runs in production, that table may already contain
            data. Only tables created earlier in the <em>same file</em> are treated as new.
          </p>
        </article>
      </div>
    </>
  );
}
