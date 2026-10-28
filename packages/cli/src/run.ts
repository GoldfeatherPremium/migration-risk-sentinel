import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  AnalyzerInputError,
  ConfigError,
  MAX_FILE_BYTES,
  VERSION,
  analyzeMigration,
  shouldFail,
  toJSON,
  toMarkdown,
  toSarif,
  type AnalysisResult,
} from "../../core/src/index.js";

export const EXIT = { OK: 0, FINDINGS: 1, USAGE: 2, IO: 3 } as const;

export interface IO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
}

const CONFIG_NAMES = ["migration-guard.config.json", ".migration-guard.json"];

export const HELP = `supabase-migration-guard ${VERSION}
Static analysis for PostgreSQL / Supabase SQL migrations. Never connects to a database.

Usage:
  supabase-migration-guard scan [paths...] [options]
  supabase-migration-guard rules
  supabase-migration-guard --help | --version

Paths default to ./supabase/migrations. Directories are searched recursively for .sql files.

Options:
  -f, --format <text|json|markdown|sarif>   Output format (default: text)
  -c, --config <file>                       Config file (default: migration-guard.config.json or .migration-guard.json)
      --fail-on <error|warning|info|never>  Exit 1 when findings reach this severity (overrides config)
  -o, --output <file>                       Write the report to a file instead of stdout
      --exclude <glob>                      Exclude files (repeatable)
      --baseline <file>                     Ignore findings whose fingerprints are listed in this baseline file
      --write-baseline <file>               Write current findings to a baseline file and exit 0
  -h, --help                                Show help
  -v, --version                             Show version

Exit codes:
  0  no findings at or above the failure threshold
  1  findings at or above the failure threshold
  2  usage or configuration error
  3  file system error (missing path, unreadable file)
`;

class IOError extends Error {}
class UsageError extends Error {}

function discover(target: string, out: string[]) {
  let st;
  try {
    st = statSync(target);
  } catch {
    throw new IOError(`Path not found: ${target}`);
  }
  if (st.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(target).sort();
    } catch (e) {
      throw new IOError(`Cannot read directory ${target}: ${(e as Error).message}`);
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git") continue;
      const full = resolve(target, name);
      const s = statSync(full);
      if (s.isDirectory()) discover(full, out);
      else if (s.isFile() && name.toLowerCase().endsWith(".sql")) out.push(full);
    }
  } else if (st.isFile()) {
    if (!target.toLowerCase().endsWith(".sql")) throw new UsageError(`Not a .sql file: ${target}`);
    out.push(resolve(target));
  }
}

function loadJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new IOError(`Cannot read ${what} ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ConfigError([`${what} ${path} is not valid JSON: ${(e as Error).message}`]);
  }
}

function formatText(r: AnalysisResult): string {
  const out: string[] = [];
  for (const file of r.files) {
    if (!file.findings.length) continue;
    out.push(file.path);
    for (const f of file.findings) {
      out.push(`  ${f.line}:${f.column}  ${f.severity.padEnd(7)}  ${f.ruleId}  ${f.message}${f.confidence === "heuristic" ? " (heuristic)" : ""}`);
      out.push(`           fix: ${f.remediation}`);
    }
    out.push("");
  }
  const s = r.summary;
  out.push(`${s.filesAnalyzed} file(s) analyzed: ${s.error} error(s), ${s.warning} warning(s), ${s.info} info, ${s.suppressed} suppressed.`);
  return out.join("\n") + "\n";
}

export function run(argv: string[], io: IO): number {
  try {
    if (argv.length === 0 || argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
      io.stdout(HELP);
      return argv.length === 0 ? EXIT.USAGE : EXIT.OK;
    }
    if (argv[0] === "version" || argv[0] === "--version" || argv[0] === "-v") {
      io.stdout(`${VERSION}\n`);
      return EXIT.OK;
    }
    if (argv[0] === "rules") {
      const r = analyzeMigration({ files: [] });
      for (const rule of r.rules) io.stdout(`${rule.id}  ${rule.severity.padEnd(7)}  ${rule.name}\n`);
      return EXIT.OK;
    }
    if (argv[0] !== "scan") throw new UsageError(`Unknown command: ${argv[0]}. Run with --help.`);

    let parsed;
    try {
      parsed = parseArgs({
        args: argv.slice(1),
        allowPositionals: true,
        options: {
          format: { type: "string", short: "f", default: "text" },
          config: { type: "string", short: "c" },
          "fail-on": { type: "string" },
          output: { type: "string", short: "o" },
          exclude: { type: "string", multiple: true },
          baseline: { type: "string" },
          "write-baseline": { type: "string" },
        },
      });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    const v = parsed.values;
    const format = v.format as string;
    if (!["text", "json", "markdown", "sarif"].includes(format)) throw new UsageError(`Invalid --format: ${format}`);
    const failOnArg = v["fail-on"] as string | undefined;
    if (failOnArg && !["error", "warning", "info", "never"].includes(failOnArg)) throw new UsageError(`Invalid --fail-on: ${failOnArg}`);

    // Config
    let config: Record<string, unknown> = {};
    const cfgPath = v.config ? resolve(io.cwd, v.config as string) : CONFIG_NAMES.map((n) => resolve(io.cwd, n)).find((p) => existsSync(p));
    if (v.config && !existsSync(cfgPath!)) throw new IOError(`Config file not found: ${v.config}`);
    if (cfgPath) {
      const loaded = loadJson(cfgPath, "config file");
      if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) throw new ConfigError(["config file must contain a JSON object"]);
      config = { ...(loaded as Record<string, unknown>) };
    }
    if (failOnArg) config.failOn = failOnArg;
    if (v.exclude) config.exclude = [...((config.exclude as string[]) ?? []), ...(v.exclude as string[])];
    if (v.baseline) {
      const b = loadJson(resolve(io.cwd, v.baseline as string), "baseline file") as { fingerprints?: unknown };
      if (!b || !Array.isArray(b.fingerprints)) throw new ConfigError(["baseline file must contain a `fingerprints` array"]);
      config.baseline = [...((config.baseline as string[]) ?? []), ...(b.fingerprints as string[])];
    }

    const targets = parsed.positionals.length ? parsed.positionals : ["supabase/migrations"];
    const abs: string[] = [];
    for (const t of targets) discover(resolve(io.cwd, t), abs);
    const unique = [...new Set(abs)].sort();
    const files = unique.map((p) => {
      const size = statSync(p).size;
      if (size > MAX_FILE_BYTES) throw new IOError(`${p} exceeds ${MAX_FILE_BYTES} bytes`);
      let content: string;
      try {
        content = readFileSync(p, "utf8");
      } catch (e) {
        throw new IOError(`Cannot read ${p}: ${(e as Error).message}`);
      }
      return { path: relative(io.cwd, p).split(sep).join("/"), content };
    });

    const result = analyzeMigration({ files, config, dialect: "postgres" });

    if (v["write-baseline"]) {
      const fp = [...new Set(result.findings.map((f) => f.fingerprint))].sort();
      writeFileSync(resolve(io.cwd, v["write-baseline"] as string), JSON.stringify({ version: 1, fingerprints: fp }, null, 2) + "\n");
      io.stderr(`Wrote ${fp.length} fingerprint(s) to ${v["write-baseline"]}\n`);
      return EXIT.OK;
    }

    const report =
      format === "json" ? toJSON(result) : format === "markdown" ? toMarkdown(result) : format === "sarif" ? toSarif(result) : formatText(result);
    if (v.output) writeFileSync(resolve(io.cwd, v.output as string), report);
    else io.stdout(report);
    if (files.length === 0) io.stderr("warning: no .sql files found\n");
    return shouldFail(result) ? EXIT.FINDINGS : EXIT.OK;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof UsageError || e instanceof AnalyzerInputError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT.USAGE;
    }
    if (e instanceof IOError) {
      io.stderr(`error: ${e.message}\n`);
      return EXIT.IO;
    }
    io.stderr(`error: ${(e as Error).message}\n`);
    return EXIT.IO;
  }
}
