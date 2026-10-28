import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Lock, ShieldCheck, Terminal, Workflow } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { CodeBlock, SeverityBadge } from "@/components/site-chrome";
import { analyzeMigration, getRuleMeta } from "@/lib/core";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Supabase Migration Guard — catch risky SQL migrations before deploy" },
      { name: "description", content: "Open-source static analyzer for PostgreSQL and Supabase migrations. Web app, CLI and GitHub Action. Runs locally, never touches your database." },
      { property: "og:title", content: "Supabase Migration Guard" },
      { property: "og:description", content: "Catch destructive and lock-heavy PostgreSQL migrations before they ship." },
    ],
  }),
  component: Home,
});

const SAMPLE = `-- 20250312_add_status.sql
alter table public.orders
  add column status text not null;

create index orders_status_idx on public.orders (status);`;

function Home() {
  const rules = useMemo(() => getRuleMeta(), []);
  // Computed live by the real engine on every render — not a hardcoded result.
  const sample = useMemo(() => analyzeMigration({ files: [{ path: "20250312_add_status.sql", content: SAMPLE }], config: { rules: { MIG032: "off" } } }), []);

  return (
    <>
      <section className="grid-paper border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-sev-warning" /> v0.1.0 · early development
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
              Catch risky database migrations <span className="text-primary">before they merge.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              A static analyzer for PostgreSQL and Supabase SQL migrations. It flags destructive changes, lock-heavy DDL and changes likely to fail on existing data — with exact locations and safer alternatives.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/analyzer">Analyze SQL <ArrowRight /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/docs">Read the docs</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Runs locally. Never connects to a database. Cannot guarantee safety — it surfaces risk for human review.</p>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="font-mono text-xs text-muted-foreground">20250312_add_status.sql</span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">sample · live analysis</span>
            </div>
            <CodeBlock className="rounded-none">{SAMPLE}</CodeBlock>
            <ul className="divide-y">
              {sample.findings.map((f) => (
                <li key={f.fingerprint} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <span className="font-mono text-xs">{f.ruleId}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">L{f.line}:{f.column}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{f.message}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Lock, title: "Local by default", body: "The web analyzer runs in your browser; the CLI runs in your Node process. No uploads, telemetry or credentials." },
            { icon: Terminal, title: "CLI with CI-friendly output", body: "Text, JSON, Markdown and SARIF output. Exit codes distinguish findings from configuration errors." },
            { icon: Workflow, title: "GitHub Actions", body: "A composite action that writes a job summary, fails on your threshold and can emit SARIF for code scanning." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border bg-card p-5">
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-card/50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Quick start</h2>
            <p className="mt-2 text-muted-foreground">The CLI is not published to npm yet. Build it from the repository:</p>
            <CodeBlock className="mt-4">{`git clone ${SITE.repoUrl}.git
cd supabase-migration-guard
npm install
npm run build:cli
node packages/cli/dist/cli/src/cli.js scan ./supabase/migrations
node packages/cli/dist/cli/src/cli.js scan ./supabase/migrations --format sarif`}</CodeBlock>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <a className="text-primary underline underline-offset-4" href={SITE.repoUrl} target="_blank" rel="noreferrer">Repository</a>
              <a className="text-primary underline underline-offset-4" href={SITE.issuesUrl} target="_blank" rel="noreferrer">Issues</a>
              <a className="text-primary underline underline-offset-4" href={SITE.releasesUrl} target="_blank" rel="noreferrer">Releases</a>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">What it does not do</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>• It does not know your table sizes, data or traffic. Lock and rewrite warnings are heuristics.</li>
              <li>• It is not a complete PostgreSQL parser: it uses a PostgreSQL-aware lexer and a statement classifier. Unrecognized statements are skipped, not guessed.</li>
              <li>• It never executes, rewrites or "auto-fixes" SQL.</li>
              <li>• A clean report is not proof of safety. Test migrations against a copy of production data.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">{rules.length} implemented rules</h2>
          <Link to="/rules" className="text-sm text-primary underline underline-offset-4">Full reference</Link>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
              <SeverityBadge severity={r.defaultSeverity} />
            </div>
          ))}
        </div>
        <div className="mt-10 flex items-center gap-3 rounded-lg border bg-accent p-4 text-sm text-accent-foreground">
          <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden />
          Found a false positive or a missed risk? <a href={SITE.newIssueUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">Open an issue</a> with a minimal SQL example.
        </div>
      </section>
    </>
  );
}
