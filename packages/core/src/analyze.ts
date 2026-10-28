import { isExcluded, resolveConfig, type ResolvedConfig } from "./config.js";
import { parseFile, type ParsedFile, type SourceLocation, type Statement } from "./parser.js";
import { RULES, type FileContext, type RawReport, type RuleDefinition } from "./rules.js";
import type {
  AnalysisResult,
  Finding,
  MigrationFile,
  Severity,
  SuppressedFinding,
} from "./types.js";
import { VERSION } from "./version.js";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES = 5000;

export class AnalyzerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerInputError";
  }
}

export interface AnalyzeOptions {
  files: MigrationFile[];
  config?: unknown;
  dialect?: "postgres";
}

/** FNV-1a 32-bit, run twice with different seeds -> 16 hex chars. */
function hash(input: string): string {
  const h = (seed: number) => {
    let x = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      x ^= input.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, "0");
  };
  return h(0x811c9dc5) + h(0x01000193 ^ 0x5bd1e995);
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function buildContext(file: ParsedFile, cfg: ResolvedConfig): FileContext {
  const inTransaction: boolean[] = [];
  let inTx = false;
  let hasExplicitTransaction = false;
  const createdTables = new Map<string, number>();
  const createdIndexes = new Map<string, number>();
  for (const s of file.statements) {
    const p = s.parsed;
    if (p.kind === "begin") {
      inTransaction.push(false);
      inTx = true;
      hasExplicitTransaction = true;
      continue;
    }
    if (p.kind === "commit" || p.kind === "rollback") {
      inTransaction.push(inTx);
      inTx = false;
      continue;
    }
    inTransaction.push(inTx);
    if (p.kind === "create_table" && !createdTables.has(p.table.key))
      createdTables.set(p.table.key, s.index);
    if (p.kind === "create_index" && p.name && !createdIndexes.has(p.name.key))
      createdIndexes.set(p.name.key, s.index);
  }
  return {
    file,
    inTransaction,
    hasExplicitTransaction,
    createdTables,
    createdIndexes,
    assumeImplicitTransaction: cfg.assumeImplicitTransaction,
  };
}

interface Directive {
  ids: Set<string>;
  reason: string | null;
}

const DIRECTIVE_RX =
  /^\s*migration-guard-ignore(-file)?\s+([A-Za-z0-9_,\s]+?)(?:\s+(?:--|:)\s*(.*?))?\s*$/;

function parseDirective(text: string): { file: boolean; d: Directive } | null {
  const m = DIRECTIVE_RX.exec(text);
  if (!m) return null;
  const ids = new Set(
    m[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((x) => x.toUpperCase()),
  );
  return { file: !!m[1], d: { ids, reason: m[3]?.trim() || null } };
}

function matches(d: Directive, ruleId: string): boolean {
  return d.ids.has(ruleId) || d.ids.has("ALL");
}

const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function compareFindings(a: Finding, b: Finding): number {
  return (
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    a.line - b.line ||
    a.column - b.column ||
    a.ruleId.localeCompare(b.ruleId) ||
    SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
    (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)
  );
}

export function analyzeMigration(options: AnalyzeOptions): AnalysisResult {
  if (!options || !Array.isArray(options.files))
    throw new AnalyzerInputError("`files` must be an array of { path, content }.");
  if (options.dialect !== undefined && options.dialect !== "postgres")
    throw new AnalyzerInputError(`Unsupported dialect: ${String(options.dialect)}`);
  if (options.files.length > MAX_FILES)
    throw new AnalyzerInputError(`Too many files (max ${MAX_FILES}).`);
  const paths = new Set<string>();
  for (const f of options.files) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string")
      throw new AnalyzerInputError("Each file needs a string `path` and string `content`.");
    if (f.content.length > MAX_FILE_BYTES)
      throw new AnalyzerInputError(`${f.path} exceeds the ${MAX_FILE_BYTES} byte limit.`);
    const p = normalizePath(f.path);
    if (paths.has(p)) throw new AnalyzerInputError(`Duplicate file path: ${p}`);
    paths.add(p);
  }

  const config = resolveConfig(options.config, RULES);
  const all = options.files.map((f) => ({
    path: normalizePath(f.path),
    content: f.content.replace(/^\uFEFF/, ""),
  }));
  const excludedFiles = all
    .filter((f) => isExcluded(f.path, config.exclude))
    .map((f) => f.path)
    .sort();
  const included = all
    .filter((f) => !excludedFiles.includes(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const parsed = included.map((f) => parseFile(f.path, f.content));
  const contexts = parsed.map((p) => buildContext(p, config));
  const byPath = new Map(contexts.map((c) => [c.file.path, c]));

  const raw: { finding: Finding; stmt?: Statement }[] = [];
  const occurrence = new Map<string, number>();

  const makeReporter =
    (rule: RuleDefinition, severity: Severity, ctx: FileContext) => (r: RawReport) => {
      const loc: SourceLocation = r.loc ??
        r.statement?.loc ?? { line: 1, column: 1, endLine: 1, endColumn: 1 };
      const stmtNorm = r.statement ? r.statement.tokens.map((t) => t.raw).join(" ") : "";
      const base = `${rule.id}|${ctx.file.path}|${stmtNorm}|${r.message}`;
      const n = occurrence.get(base) ?? 0;
      occurrence.set(base, n + 1);
      // Rule-level severity override wins over the rule's contextual default only when explicitly configured.
      const configured = config.rules[rule.id].severity as Severity;
      const effective = configured !== rule.defaultSeverity ? configured : (r.severity ?? severity);
      raw.push({
        stmt: r.statement,
        finding: {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: effective,
          confidence: r.confidence ?? rule.confidence,
          file: ctx.file.path,
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn,
          message: r.message,
          remediation: rule.remediation,
          fingerprint: hash(`${base}|${n}`),
        },
      });
    };

  for (const rule of RULES) {
    const rc = config.rules[rule.id];
    if (rc.severity === "off") continue;
    const sev = rc.severity;
    for (const ctx of contexts) {
      const report = makeReporter(rule, sev, ctx);
      if (rule.checkFile) rule.checkFile(ctx, report, rc.options);
      if (rule.checkStatement)
        for (const s of ctx.file.statements) rule.checkStatement(s, ctx, report, rc.options);
    }
    if (rule.checkProject) {
      rule.checkProject(contexts, (path) => makeReporter(rule, sev, byPath.get(path)!), rc.options);
    }
  }

  // Suppression
  const fileDirectives = new Map<string, Directive[]>();
  for (const ctx of contexts) {
    const list: Directive[] = [];
    for (const c of ctx.file.comments) {
      const d = c.type === "comment" ? parseDirective(c.value) : null;
      if (d?.file) list.push(d.d);
    }
    fileDirectives.set(ctx.file.path, list);
  }
  const baseline = new Set(config.baseline);
  const findings: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  for (const { finding, stmt } of raw) {
    const fd = fileDirectives.get(finding.file)!.find((d) => matches(d, finding.ruleId));
    if (fd) {
      suppressed.push({ ...finding, suppression: { kind: "file", reason: fd.reason } });
      continue;
    }
    if (stmt) {
      const comments = [...stmt.leadingComments, ...stmt.trailingComments];
      let inline: Directive | undefined;
      for (const c of comments) {
        const d = c.type === "comment" ? parseDirective(c.value) : null;
        if (d && !d.file && matches(d.d, finding.ruleId)) {
          inline = d.d;
          break;
        }
      }
      if (inline) {
        suppressed.push({ ...finding, suppression: { kind: "inline", reason: inline.reason } });
        continue;
      }
    }
    if (baseline.has(finding.fingerprint)) {
      suppressed.push({ ...finding, suppression: { kind: "baseline", reason: null } });
      continue;
    }
    findings.push(finding);
  }
  findings.sort(compareFindings);
  suppressed.sort(compareFindings);

  const summary = {
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    total: findings.length,
    suppressed: suppressed.length,
    filesAnalyzed: included.length,
    filesExcluded: excludedFiles.length,
  };

  return {
    tool: { name: "supabase-migration-guard", version: VERSION },
    dialect: "postgres",
    summary,
    files: contexts.map((c) => ({
      path: c.file.path,
      statements: c.file.statements.length,
      findings: findings.filter((f) => f.file === c.file.path),
    })),
    findings,
    suppressed,
    excludedFiles,
    rules: RULES.map((r) => ({ id: r.id, name: r.name, severity: config.rules[r.id].severity })),
    config,
  };
}

/** True when findings reach the configured failure threshold. */
export function shouldFail(
  result: AnalysisResult,
  failOn: Severity | "never" = result.config.failOn,
): boolean {
  if (failOn === "never") return false;
  const limit = SEV_ORDER[failOn];
  return result.findings.some((f) => SEV_ORDER[f.severity] <= limit);
}
