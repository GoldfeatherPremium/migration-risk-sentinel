export type Severity = "error" | "warning" | "info";
export type SeverityOrOff = Severity | "off";
export type Confidence = "definite" | "heuristic";
export type RuleCategory = "syntax" | "destructive" | "data" | "index" | "quality";

export interface MigrationFile {
  path: string;
  content: string;
}

export interface Finding {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  confidence: Confidence;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  remediation: string;
  /** Stable hash used for baselines; independent of line numbers. */
  fingerprint: string;
}

export interface SuppressedFinding extends Finding {
  suppression: { kind: "inline" | "file" | "baseline"; reason: string | null };
}

export interface RuleMeta {
  id: string;
  name: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  confidence: Confidence;
  description: string;
  rationale: string;
  remediation: string;
  limitations: string[];
  options?: Record<string, { type: "number" | "boolean"; default: number | boolean; description: string }>;
}

export interface FileResult {
  path: string;
  statements: number;
  findings: Finding[];
}

export interface AnalysisSummary {
  error: number;
  warning: number;
  info: number;
  total: number;
  suppressed: number;
  filesAnalyzed: number;
  filesExcluded: number;
}

export interface AnalysisResult {
  tool: { name: string; version: string };
  dialect: "postgres";
  summary: AnalysisSummary;
  files: FileResult[];
  findings: Finding[];
  suppressed: SuppressedFinding[];
  excludedFiles: string[];
  rules: { id: string; name: string; severity: SeverityOrOff }[];
  config: import("./config.js").ResolvedConfig;
}
