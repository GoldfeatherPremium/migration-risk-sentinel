import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PageHeader, SeverityBadge } from "@/components/site-chrome";
import { getRuleMeta, PLANNED_RULES, type RuleCategory } from "@/lib/core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Rules — Supabase Migration Guard" },
      { name: "description", content: "Every implemented migration rule with severity, rationale, remediation and known limitations." },
      { property: "og:title", content: "Rules — Supabase Migration Guard" },
      { property: "og:description", content: "Implemented and planned PostgreSQL migration safety rules." },
    ],
  }),
  component: RulesPage,
});

const CATS: { id: RuleCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "syntax", label: "Syntax" },
  { id: "destructive", label: "Destructive" },
  { id: "data", label: "Data & schema" },
  { id: "index", label: "Index & locks" },
  { id: "quality", label: "Migration quality" },
];

function RulesPage() {
  const rules = useMemo(() => getRuleMeta(), []);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<RuleCategory | "all">("all");
  const list = rules.filter(
    (r) => (cat === "all" || r.category === cat) && `${r.id} ${r.name} ${r.description}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <PageHeader eyebrow="Rule reference" title={`${rules.length} implemented rules`}>
        Rules marked <em>heuristic</em> cannot see table size, data or lock contention and may produce false positives. Severities are defaults and can be overridden.
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative md:w-72">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules" className="pl-8" aria-label="Search rules" />
          </div>
          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={cn("rounded-md border px-2.5 py-1 text-sm", cat === c.id ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted")}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {list.map((r) => (
            <article key={r.id} id={r.id} className="rounded-lg border bg-card p-4 md:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{r.id}</span>
                <h2 className="font-medium">{r.name}</h2>
                <SeverityBadge severity={r.defaultSeverity} />
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{r.confidence}</span>
              </div>
              <p className="mt-2 text-sm">{r.description}</p>
              <div className="mt-3 grid gap-4 text-sm md:grid-cols-3">
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why it matters</h3>
                  <p className="mt-1">{r.rationale}</p>
                </div>
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Safer alternative</h3>
                  <p className="mt-1">{r.remediation}</p>
                </div>
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Limitations</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                    {r.limitations.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                  {r.options && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      options: {Object.entries(r.options).map(([k, o]) => `${k} (default ${String(o.default)})`).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
          {list.length === 0 && <p className="text-sm text-muted-foreground">No rules match.</p>}
        </div>

        <h2 className="mt-12 text-xl font-semibold">Planned — not implemented yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">These rules do not run today. They are listed so contributors know what is being considered.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {PLANNED_RULES.map((r) => (
            <div key={r.id} className="rounded-lg border border-dashed p-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{r.id}</span>
                <span className="font-medium">{r.name}</span>
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">planned</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
