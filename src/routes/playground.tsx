import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/site-chrome";
import { Workbench } from "@/components/workbench";
import { EXAMPLES } from "@/lib/examples";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playground")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Playground — Supabase Migration Guard" },
      {
        name: "description",
        content: "Explore risky and safe sample SQL migrations and inspect live analyzer findings.",
      },
      { property: "og:title", content: "Playground — Supabase Migration Guard" },
      {
        property: "og:description",
        content: "Risky and safe sample migrations analyzed live in your browser.",
      },
    ],
  }),
  component: PlaygroundPage,
});

function PlaygroundPage() {
  const [selected, setSelected] = useState(EXAMPLES[0].id);
  const ex = EXAMPLES.find((e) => e.id === selected)!;
  return (
    <>
      <PageHeader eyebrow="Playground" title="Sample migrations, real analysis">
        All SQL here is sample data from the project's test fixtures. Press Analyze to run the
        engine — results are computed live, never pre-recorded.
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {EXAMPLES.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelected(e.id)}
              className={cn(
                "shrink-0 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors",
                selected === e.id ? "border-primary bg-accent" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "mr-2 font-mono text-[10px] uppercase",
                  e.kind === "risky"
                    ? "text-sev-error"
                    : e.kind === "safe"
                      ? "text-primary"
                      : "text-sev-info",
                )}
              >
                {e.kind}
              </span>
              {e.title}
            </button>
          ))}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{ex.description}</p>
        <Workbench key={ex.id} initialFiles={ex.files} examples={EXAMPLES} sampleNotice />
      </div>
    </>
  );
}
