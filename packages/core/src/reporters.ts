import { getRuleMeta } from "./rules.js";
import type { AnalysisResult, Finding } from "./types.js";

/** Stable JSON output (no timestamps, deterministic ordering). */
export function toJSON(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

function mdEscape(s: string): string {
  return s.replace(/[|\\`*_<>[\]]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
}

const ICON: Record<Finding["severity"], string> = { error: "❌", warning: "⚠️", info: "ℹ️" };

export function toMarkdown(result: AnalysisResult): string {
  const s = result.summary;
  const lines: string[] = [];
  lines.push("## Supabase Migration Guard report", "");
  lines.push(
    `Analyzer version ${result.tool.version} · ${s.filesAnalyzed} file(s) analyzed${s.filesExcluded ? ` · ${s.filesExcluded} excluded` : ""}`,
    "",
  );
  lines.push(
    "| Errors | Warnings | Info | Suppressed |",
    "| ---: | ---: | ---: | ---: |",
    `| ${s.error} | ${s.warning} | ${s.info} | ${s.suppressed} |`,
    "",
  );
  if (result.findings.length === 0) {
    lines.push(
      "No findings. Static analysis cannot guarantee a migration is safe — review lock and data impact for production.",
      "",
    );
    return lines.join("\n");
  }
  for (const file of result.files) {
    if (!file.findings.length) continue;
    lines.push(`### \`${file.path.replace(/`/g, "")}\``, "");
    lines.push("| Severity | Rule | Location | Finding |", "| --- | --- | --- | --- |");
    for (const f of file.findings) {
      lines.push(
        `| ${ICON[f.severity]} ${f.severity} | ${f.ruleId} ${mdEscape(f.ruleName)} | L${f.line}:${f.column} | ${mdEscape(f.message)}${f.confidence === "heuristic" ? " _(heuristic)_" : ""} |`,
      );
    }
    lines.push("");
  }
  const used = [...new Set(result.findings.map((f) => f.ruleId))].sort();
  lines.push("<details><summary>Remediation</summary>", "");
  for (const id of used) {
    const f = result.findings.find((x) => x.ruleId === id)!;
    lines.push(`- **${id} ${mdEscape(f.ruleName)}** — ${mdEscape(f.remediation)}`);
  }
  lines.push("", "</details>", "");
  return lines.join("\n");
}

const SARIF_LEVEL: Record<Finding["severity"], "error" | "warning" | "note"> = {
  error: "error",
  warning: "warning",
  info: "note",
};

export function toSarif(result: AnalysisResult, options: { informationUri?: string } = {}): string {
  const meta = getRuleMeta();
  const ruleIndex = new Map(meta.map((r, i) => [r.id, i]));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "supabase-migration-guard",
            version: result.tool.version,
            semanticVersion: result.tool.version,
            ...(options.informationUri ? { informationUri: options.informationUri } : {}),
            rules: meta.map((r) => ({
              id: r.id,
              name: r.name.replace(/[^A-Za-z0-9]+/g, ""),
              shortDescription: { text: r.name },
              fullDescription: { text: r.description },
              help: { text: `${r.remediation}\n\nLimitations: ${r.limitations.join(" ")}` },
              defaultConfiguration: { level: SARIF_LEVEL[r.defaultSeverity] },
              properties: { category: r.category, confidence: r.confidence },
            })),
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          ruleIndex: ruleIndex.get(f.ruleId) ?? 0,
          level: SARIF_LEVEL[f.severity],
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file.split("/").map(encodeURIComponent).join("/") },
                region: {
                  startLine: f.line,
                  startColumn: f.column,
                  endLine: f.endLine,
                  endColumn: Math.max(f.endColumn, f.column),
                },
              },
            },
          ],
          partialFingerprints: { "migrationGuard/v1": f.fingerprint },
          properties: { confidence: f.confidence },
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
