import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/site-chrome";
import { Workbench } from "@/components/workbench";
import { EXAMPLES } from "@/lib/examples";

export const Route = createFileRoute("/analyzer")({
  head: () => ({
    meta: [
      { title: "Analyzer — Supabase Migration Guard" },
      { name: "description", content: "Paste or upload SQL migrations and analyze them locally in your browser for risky PostgreSQL changes." },
      { property: "og:title", content: "Analyzer — Supabase Migration Guard" },
      { property: "og:description", content: "Analyze SQL migrations locally in your browser. Nothing is uploaded." },
    ],
  }),
  component: AnalyzerPage,
});

function AnalyzerPage() {
  return (
    <>
      <PageHeader eyebrow="Analyzer" title="Check a migration before you merge it">
        Paste SQL, upload one or more <code>.sql</code> files (max 1 MB each), and run the same engine the CLI uses. Everything happens in this browser tab.
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Workbench initialFiles={[{ path: "migration.sql", content: "" }]} examples={EXAMPLES} />
      </div>
    </>
  );
}
