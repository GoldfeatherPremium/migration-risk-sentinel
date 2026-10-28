import { z } from "zod";
import type { Severity, SeverityOrOff } from "./types.js";

const severityOrOff = z.enum(["error", "warning", "info", "off"]);

const ruleSetting = z.union([
  severityOrOff,
  z
    .object({
      severity: severityOrOff.optional(),
      options: z.record(z.union([z.number(), z.boolean()])).optional(),
    })
    .strict(),
]);

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    rules: z.record(z.string().regex(/^MIG\d{3}$/, "Rule IDs look like MIG001"), ruleSetting).default({}),
    exclude: z.array(z.string().min(1)).default([]),
    failOn: z.enum(["error", "warning", "info", "never"]).default("error"),
    assumeImplicitTransaction: z.boolean().default(false),
    baseline: z.array(z.string().regex(/^[0-9a-f]{16}$/, "Baseline entries are 16-char hex fingerprints")).default([]),
  })
  .strict();

export type UserConfig = z.input<typeof ConfigSchema>;

export interface ResolvedConfig {
  rules: Record<string, { severity: SeverityOrOff; options: Record<string, number | boolean> }>;
  exclude: string[];
  failOn: Severity | "never";
  assumeImplicitTransaction: boolean;
  baseline: string[];
}

export class ConfigError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export function resolveConfig(
  input: unknown,
  knownRules: { id: string; defaultSeverity: Severity; options?: Record<string, { default: number | boolean }> }[],
): ResolvedConfig {
  const parsed = ConfigSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const cfg = parsed.data;
  const known = new Map(knownRules.map((r) => [r.id, r]));
  const issues: string[] = [];
  for (const id of Object.keys(cfg.rules)) {
    if (!known.has(id)) issues.push(`rules.${id}: unknown rule ID`);
  }
  if (issues.length) throw new ConfigError(issues);

  const rules: ResolvedConfig["rules"] = {};
  for (const r of [...knownRules].sort((a, b) => a.id.localeCompare(b.id))) {
    const setting = cfg.rules[r.id];
    const defaults: Record<string, number | boolean> = {};
    for (const [k, v] of Object.entries(r.options ?? {})) defaults[k] = v.default;
    if (setting === undefined) rules[r.id] = { severity: r.defaultSeverity, options: defaults };
    else if (typeof setting === "string") rules[r.id] = { severity: setting, options: defaults };
    else {
      for (const k of Object.keys(setting.options ?? {})) {
        if (!(k in defaults)) issues.push(`rules.${r.id}.options.${k}: unknown option`);
        else if (typeof setting.options![k] !== typeof defaults[k]) issues.push(`rules.${r.id}.options.${k}: expected ${typeof defaults[k]}`);
      }
      rules[r.id] = { severity: setting.severity ?? r.defaultSeverity, options: { ...defaults, ...setting.options } };
    }
  }
  if (issues.length) throw new ConfigError(issues);
  return {
    rules,
    exclude: [...cfg.exclude],
    failOn: cfg.failOn,
    assumeImplicitTransaction: cfg.assumeImplicitTransaction,
    baseline: [...new Set(cfg.baseline)].sort(),
  };
}

/** Minimal glob matcher supporting **, *, ? on POSIX-style paths. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function isExcluded(path: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const rx = globToRegExp(p);
    if (rx.test(path)) return true;
    // Allow patterns without directories to match the basename.
    if (!p.includes("/")) return rx.test(path.split("/").pop() ?? path);
    return false;
  });
}
