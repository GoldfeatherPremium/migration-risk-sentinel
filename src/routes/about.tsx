import { createFileRoute } from "@tanstack/react-router";
import { CodeBlock, PageHeader } from "@/components/site-chrome";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About & Contributing — Supabase Migration Guard" },
      { name: "description", content: "Project goals, how to contribute rules and fixes, and how to report security issues." },
      { property: "og:title", content: "About & Contributing — Supabase Migration Guard" },
      { property: "og:description", content: "Goals of the project and how to contribute." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <>
      <PageHeader eyebrow="About" title="Goals and contributing">
        Supabase Migration Guard is an MIT-licensed project in early development. It has no releases yet.
      </PageHeader>
      <article className="prose-doc mx-auto max-w-3xl px-4 py-8">
        <h2>Goals</h2>
        <ul>
          <li>Surface risky PostgreSQL migration changes during code review, before they reach production.</li>
          <li>Be honest about certainty: separate definite problems from heuristics and document every limitation.</li>
          <li>Keep SQL private: analysis runs locally, with no accounts, credentials or telemetry.</li>
          <li>Stay small and deterministic so results are reproducible in CI.</li>
        </ul>

        <h2>Contributing</h2>
        <p>Contributions are welcome — especially new rules, false-positive fixes and real-world SQL fixtures.</p>
        <CodeBlock>{`npm install
npm test            # vitest: rules, analyzer, reporters, CLI
npm run lint
npm run typecheck
npm run dev         # web app`}</CodeBlock>
        <h3>Adding a rule</h3>
        <ul>
          <li>Add a definition to <code>packages/core/src/rules.ts</code> with a new stable ID, metadata and limitations.</li>
          <li>Add at least one positive and one negative test in <code>tests/rules.test.ts</code>; add a fixture if useful.</li>
          <li>The rules page and SARIF output pick up metadata automatically.</li>
          <li>Update <code>CHANGELOG.md</code>.</li>
        </ul>
        <p>
          Read <a href={SITE.contributingUrl} target="_blank" rel="noreferrer">CONTRIBUTING.md</a>, browse the <a href={SITE.issuesUrl} target="_blank" rel="noreferrer">issue tracker</a>, and report vulnerabilities privately according to the <a href={SITE.securityUrl} target="_blank" rel="noreferrer">security policy</a>.
        </p>
        {!SITE.repoConfigured && (
          <p className="rounded-md border border-dashed p-3 text-sm">
            Repository links currently point to a placeholder. Set <code>VITE_REPO_URL</code> to the real repository URL when it exists.
          </p>
        )}
      </article>
    </>
  );
}
