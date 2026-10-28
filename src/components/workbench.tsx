import { Check, Copy, Download, FileCode2, Play, Plus, Search, Settings2, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeBlock, SeverityBadge } from "@/components/site-chrome";
import {
  analyzeMigration,
  ConfigError,
  getRuleMeta,
  toJSON,
  toMarkdown,
  toSarif,
  type AnalysisResult,
  type Finding,
  type Severity,
  type SeverityOrOff,
} from "@/lib/core";
import type { Example } from "@/lib/examples";
import { download, readSqlFiles } from "@/lib/upload";
import { cn } from "@/lib/utils";

const RULES = getRuleMeta();
type GroupBy = "severity" | "file" | "rule";
const SEVS: Severity[] = ["error", "warning", "info"];

interface Props {
  initialFiles: { path: string; content: string }[];
  examples: Example[];
  /** Label shown above the editor when the content is sample data. */
  sampleNotice?: boolean;
}

export function Workbench({ initialFiles, examples, sampleNotice }: Props) {
  const [files, setFiles] = useState(initialFiles);
  const [active, setActive] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, SeverityOrOff>>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set(SEVS));
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("severity");
  const [showSettings, setShowSettings] = useState(false);
  const [isSample, setIsSample] = useState(!!sampleNotice);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = files[active] ?? files[0];

  function run(target = files) {
    try {
      const rules: Record<string, SeverityOrOff> = {};
      for (const [id, sev] of Object.entries(overrides)) rules[id] = sev;
      const r = analyzeMigration({ files: target, config: { rules }, dialect: "postgres" });
      setResult(r);
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof ConfigError ? e.issues.join("; ") : (e as Error).message);
    }
  }

  function loadExample(id: string) {
    const ex = examples.find((e) => e.id === id);
    if (!ex) return;
    const next = ex.files.map((f) => ({ ...f }));
    setFiles(next);
    setActive(0);
    setIsSample(true);
    run(next);
  }

  async function onUpload(list: FileList | null) {
    if (!list?.length) return;
    const { files: added, rejected } = await readSqlFiles(list, isSample ? 0 : files.length);
    for (const r of rejected) toast.error(`${r.name}: ${r.reason}`);
    if (!added.length) return;
    const base = isSample || (files.length === 1 && !files[0].content.trim()) ? [] : files;
    const taken = new Set(base.map((f) => f.path));
    const renamed = added.map((f) => {
      let p = f.path;
      let i = 2;
      while (taken.has(p)) p = f.path.replace(/\.sql$/i, `_${i++}.sql`);
      taken.add(p);
      return { ...f, path: p };
    });
    const next = [...base, ...renamed];
    setFiles(next);
    setActive(base.length);
    setIsSample(false);
    toast.success(`Loaded ${added.length} file(s) locally`);
  }

  function updateContent(content: string) {
    setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, content } : f)));
    setIsSample(false);
  }

  function addFile() {
    const taken = new Set(files.map((f) => f.path));
    let n = files.length + 1;
    while (taken.has(`migration_${n}.sql`)) n++;
    setFiles([...files, { path: `migration_${n}.sql`, content: "" }]);
    setActive(files.length);
  }

  function removeFile(i: number) {
    if (files.length === 1) {
      setFiles([{ path: "migration.sql", content: "" }]);
      return;
    }
    setFiles(files.filter((_, k) => k !== i));
    setActive(Math.max(0, active >= i ? active - 1 : active));
  }

  const visible = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.findings.filter(
      (f) => sevFilter.has(f.severity) && (!q || `${f.ruleId} ${f.ruleName} ${f.message} ${f.file}`.toLowerCase().includes(q)),
    );
  }, [result, sevFilter, query]);

  const groups = useMemo(() => {
    const m = new Map<string, Finding[]>();
    const keyOf = (f: Finding) => (groupBy === "severity" ? f.severity : groupBy === "file" ? f.file : `${f.ruleId} · ${f.ruleName}`);
    const order = groupBy === "severity" ? SEVS : null;
    for (const f of visible) {
      const k = keyOf(f);
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    const entries = [...m.entries()];
    if (order) entries.sort((a, b) => order.indexOf(a[0] as Severity) - order.indexOf(b[0] as Severity));
    else entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [visible, groupBy]);

  const sourceByPath = useMemo(() => new Map(files.map((f) => [f.path, f.content])), [files]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Input */}
      <section aria-label="SQL input" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Load example"
            className="h-9 max-w-full rounded-md border bg-card px-2 text-sm"
            value=""
            onChange={(e) => loadExample(e.target.value)}
          >
            <option value="" disabled>
              Load sample SQL…
            </option>
            {(["risky", "safe", "edge"] as const).map((k) => (
              <optgroup key={k} label={k === "risky" ? "Risky" : k === "safe" ? "Safe" : "Edge cases"}>
                {examples.filter((e) => e.kind === k).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload /> Upload .sql
          </Button>
          <input ref={fileInput} type="file" accept=".sql,text/plain,application/sql" multiple hidden onChange={(e) => { void onUpload(e.target.files); e.target.value = ""; }} />
          <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>
            <Settings2 /> Rules
          </Button>
        </div>

        {showSettings && (
          <div className="max-h-72 overflow-y-auto rounded-lg border bg-card p-3">
            <p className="mb-2 text-xs text-muted-foreground">Override severity or turn rules off for this session.</p>
            <ul className="space-y-1.5">
              {RULES.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-mono text-xs text-muted-foreground">{r.id}</span> {r.name}</span>
                  <select
                    aria-label={`Severity for ${r.id}`}
                    className="h-7 rounded border bg-background px-1 text-xs"
                    value={overrides[r.id] ?? r.defaultSeverity}
                    onChange={(e) => setOverrides({ ...overrides, [r.id]: e.target.value as SeverityOrOff })}
                  >
                    {(["error", "warning", "info", "off"] as const).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/60 px-1">
            {files.map((f, i) => (
              <div key={f.path} className={cn("flex shrink-0 items-center border-b-2 border-transparent", i === active && "border-primary")}>
                <button onClick={() => setActive(i)} className={cn("flex items-center gap-1.5 px-2 py-2 font-mono text-xs", i === active ? "text-foreground" : "text-muted-foreground")}>
                  <FileCode2 className="h-3.5 w-3.5" aria-hidden /> {f.path}
                </button>
                <button onClick={() => removeFile(i)} className="p-1 text-muted-foreground hover:text-foreground" aria-label={`Remove ${f.path}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button onClick={addFile} className="ml-1 shrink-0 p-2 text-muted-foreground hover:text-foreground" aria-label="Add file">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {isSample && <p className="border-b bg-sev-warning-soft px-3 py-1.5 text-xs text-sev-warning">Sample data — edit freely or upload your own files.</p>}
          <textarea
            aria-label={`SQL for ${current?.path}`}
            value={current?.content ?? ""}
            onChange={(e) => updateContent(e.target.value)}
            spellCheck={false}
            placeholder="-- Paste a migration here&#10;alter table public.orders add column status text not null;"
            className="block h-80 w-full resize-y bg-code p-4 font-mono text-[13px] leading-relaxed text-code-foreground outline-none placeholder:text-code-muted lg:h-[28rem]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => run()}>
            <Play /> Analyze {files.length > 1 ? `${files.length} files` : ""}
          </Button>
          <p className="text-xs text-muted-foreground">Runs entirely in your browser. SQL is never sent anywhere or executed.</p>
        </div>
      </section>

      {/* Results */}
      <section aria-label="Findings" className="min-w-0 space-y-3">
        {error && <div className="rounded-lg border border-sev-error/40 bg-sev-error-soft p-3 text-sm text-sev-error">{error}</div>}
        {!result && !error && (
          <div className="grid-paper flex h-full min-h-60 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Results from the analyzer will appear here after you press Analyze.
          </div>
        )}
        {result && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {SEVS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    const n = new Set(sevFilter);
                    if (n.has(s)) n.delete(s);
                    else n.add(s);
                    setSevFilter(n);
                  }}
                  aria-pressed={sevFilter.has(s)}
                  className={cn("rounded-lg border bg-card p-2 text-left transition-opacity", !sevFilter.has(s) && "opacity-40")}
                >
                  <div className="text-2xl font-semibold tabular-nums">{result.summary[s]}</div>
                  <SeverityBadge severity={s} />
                </button>
              ))}
              <div className="rounded-lg border bg-card p-2">
                <div className="text-2xl font-semibold tabular-nums">{result.summary.suppressed}</div>
                <span className="font-mono text-[11px] uppercase text-muted-foreground">suppressed</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search findings" className="pl-8" aria-label="Search findings" />
              </div>
              <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="h-9 rounded-md border bg-card px-2 text-sm">
                <option value="severity">By severity</option>
                <option value="file">By file</option>
                <option value="rule">By rule</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => download("migration-guard.json", toJSON(result), "application/json")}><Download /> JSON</Button>
              <Button variant="outline" size="sm" onClick={() => download("migration-guard.md", toMarkdown(result), "text/markdown")}><Download /> Markdown</Button>
              <Button variant="outline" size="sm" onClick={() => download("migration-guard.sarif", toSarif(result), "application/sarif+json")}><Download /> SARIF</Button>
            </div>

            {result.findings.length === 0 && (
              <div className="rounded-lg border bg-accent p-4 text-sm text-accent-foreground">
                No findings from {result.summary.filesAnalyzed} file(s). This does not prove the migration is safe — it means none of the implemented rules matched.
              </div>
            )}

            <div className="space-y-5">
              {groups.map(([key, list]) => (
                <div key={key}>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {groupBy === "severity" ? <SeverityBadge severity={key as Severity} /> : <span className="truncate font-mono text-xs">{key}</span>}
                    <span className="text-muted-foreground">{list.length}</span>
                  </h3>
                  <ul className="space-y-2">
                    {list.map((f) => (
                      <FindingCard key={`${f.fingerprint}-${f.line}-${f.column}`} f={f} source={sourceByPath.get(f.file) ?? ""} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {result.suppressed.length > 0 && (
              <details className="rounded-lg border bg-card p-3 text-sm">
                <summary className="cursor-pointer">Suppressed findings ({result.suppressed.length})</summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {result.suppressed.map((s) => (
                    <li key={s.fingerprint} className="font-mono text-xs">
                      {s.file}:{s.line} {s.ruleId} — {s.suppression.kind}{s.suppression.reason ? ` (${s.suppression.reason})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function excerpt(source: string, line: number) {
  const lines = source.split(/\r?\n/);
  const from = Math.max(1, line - 1);
  const to = Math.min(lines.length, line + 1);
  const out: { n: number; text: string }[] = [];
  for (let n = from; n <= to; n++) out.push({ n, text: lines[n - 1] ?? "" });
  return out;
}

function FindingCard({ f, source }: { f: Finding; source: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <span className="font-mono text-xs font-medium">{f.ruleId}</span>
        <span className="text-xs text-muted-foreground">{f.ruleName}</span>
        {f.confidence === "heuristic" && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">heuristic</span>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{f.file}:{f.line}:{f.column}</span>
      </div>
      <p className="mt-2 text-sm">{f.message}</p>
      <div className="mt-2 overflow-x-auto rounded bg-code py-1.5 font-mono text-[12px] text-code-foreground">
        {excerpt(source, f.line).map((l) => (
          <div key={l.n} className={cn("flex whitespace-pre px-2", l.n === f.line && "bg-sev-error/25")}>
            <span className="w-8 shrink-0 select-none pr-2 text-right text-code-muted">{l.n}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-start gap-2 rounded bg-accent/60 p-2 text-xs text-accent-foreground">
        <p className="flex-1">{f.remediation}</p>
        <button
          aria-label="Copy remediation"
          className="shrink-0 rounded p-1 hover:bg-background"
          onClick={() => {
            void navigator.clipboard.writeText(f.remediation).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </li>
  );
}

export { CodeBlock };
