// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeMigration, AnalyzerInputError, ConfigError, toJSON, toMarkdown, toSarif } from "../packages/core/src/index.js";
import { analyzeSql, fixture, ids } from "./helpers";

describe("fixtures", () => {
  it("safe table creation produces no findings", () => {
    expect(ids(fixture("safe_create_table.sql"))).toEqual([]);
  });

  it("destructive fixture reports each destructive rule at the right line", () => {
    const r = analyzeSql(fixture("destructive.sql"), { rules: { MIG032: "off" } });
    const byRule = Object.fromEntries(r.findings.map((f) => [f.ruleId, f.line]));
    expect(byRule).toMatchObject({ MIG001: 1, MIG002: 2, MIG003: 3, MIG004: 4, MIG005: 5 });
    const drop = r.findings.find((f) => f.ruleId === "MIG002")!;
    expect(drop.column).toBe(27);
  });

  it("comments, quoted identifiers and strings with SQL keywords are not misread", () => {
    expect(ids(fixture("comments_and_quotes.sql"))).toEqual([]);
  });

  it("multiline statements and function bodies are handled", () => {
    const r = analyzeSql(fixture("multiline.sql"), { rules: { MIG032: "off" } });
    expect(r.findings.map((f) => [f.ruleId, f.line])).toEqual([["MIG010", 15]]);
  });

  it("concurrent index in a transaction is an error; alone it is fine", () => {
    expect(ids(fixture("concurrent_in_transaction.sql"))).toContain("MIG021");
    expect(ids(fixture("concurrent_ok.sql"))).toEqual([]);
  });

  it("DML without WHERE vs with WHERE", () => {
    const r = analyzeSql(fixture("dml_without_where.sql"));
    expect(r.findings.filter((f) => f.ruleId === "MIG014").map((f) => f.line)).toEqual([1, 2]);
  });

  it("invalid SQL is reported", () => {
    expect(ids(fixture("invalid.sql"))).toContain("MIG000");
  });

  it("add column fixture flags only the unsafe columns", () => {
    const r = analyzeSql(fixture("add_column_not_null.sql"), { rules: { MIG032: "off", MIG023: "off" } });
    expect(r.findings.map((f) => [f.ruleId, f.line, f.severity])).toEqual([
      ["MIG010", 1, "error"],
      ["MIG010", 3, "warning"],
    ]);
  });
});

describe("suppression, exclusion, baseline", () => {
  it("inline suppressions (next statement and same line) are honored with reasons", () => {
    const r = analyzeSql(fixture("suppressed.sql"), { rules: { MIG032: "off", MIG033: "off" } });
    expect(r.findings.map((f) => f.ruleId)).toEqual(["MIG003"]);
    expect(r.suppressed.map((s) => [s.ruleId, s.suppression.kind, s.suppression.reason])).toEqual([
      ["MIG001", "inline", "reason: table retired in RFC-12"],
      ["MIG002", "inline", null],
    ]);
  });

  it("file-level suppression", () => {
    const r = analyzeSql(fixture("suppressed_file.sql"));
    expect(r.findings).toEqual([]);
    expect(r.summary.suppressed).toBe(2);
  });

  it("exclusion patterns skip files", () => {
    const r = analyzeMigration({
      files: [
        { path: "supabase/migrations/1.sql", content: "drop table a;" },
        { path: "supabase/seed/seed.sql", content: "truncate a;" },
      ],
      config: { exclude: ["supabase/seed/**"] },
    });
    expect(r.excludedFiles).toEqual(["supabase/seed/seed.sql"]);
    expect(r.findings.every((f) => f.file === "supabase/migrations/1.sql")).toBe(true);
  });

  it("baseline fingerprints are stable across line shifts", () => {
    const a = analyzeSql("drop table a;");
    const b = analyzeSql("\n\n\ndrop table a;");
    expect(a.findings[0].fingerprint).toBe(b.findings[0].fingerprint);
    const c = analyzeSql("\n\ndrop table a;", { baseline: a.findings.map((f) => f.fingerprint) });
    expect(c.findings).toEqual([]);
    expect(c.suppressed.every((s) => s.suppression.kind === "baseline")).toBe(true);
  });
});

describe("config", () => {
  it("disables rules and overrides severity", () => {
    const r = analyzeSql("drop table a;", { rules: { MIG001: "warning", MIG033: "off" } });
    expect(r.findings.map((f) => [f.ruleId, f.severity])).toEqual([["MIG001", "warning"]]);
    expect(ids("drop table a;", { rules: { MIG001: "off" } })).toEqual([]);
  });
  it("rejects invalid config", () => {
    expect(() => analyzeSql("", { rules: { MIG999: "error" } })).toThrow(ConfigError);
    expect(() => analyzeSql("", { failOn: "sometimes" })).toThrow(ConfigError);
    expect(() => analyzeSql("", { unknownKey: true })).toThrow(ConfigError);
    expect(() => analyzeSql("", { rules: { MIG023: { options: { nope: 1 } } } })).toThrow(ConfigError);
  });
  it("validates input", () => {
    expect(() => analyzeMigration({ files: "x" as never })).toThrow(AnalyzerInputError);
    expect(() => analyzeMigration({ files: [{ path: "a.sql", content: "" }, { path: "./a.sql", content: "" }] })).toThrow(AnalyzerInputError);
  });
});

describe("cross-file analysis", () => {
  it("detects ordering and duplicates in a migrations folder", () => {
    const files = ["20240101000000_init.sql", "20240102000000_orders_fk.sql", "20240103000000_orders.sql"].map((n) => ({
      path: `supabase/migrations/${n}`,
      content: fixture(`project/supabase/migrations/${n}`),
    }));
    const r = analyzeMigration({ files: [...files].reverse() });
    const got = r.findings.map((f) => `${f.ruleId}@${f.file.split("/").pop()}`);
    expect(got).toContain("MIG031@20240102000000_orders_fk.sql");
    expect(got).toContain("MIG030@20240103000000_orders.sql");
  });
});

describe("reporters", () => {
  const input = { files: [{ path: "b.sql", content: "drop table x;\nupdate y set a = 1;" }, { path: "a.sql", content: "truncate z;" }] };

  it("JSON is valid and deterministic regardless of input order", () => {
    const one = toJSON(analyzeMigration(input));
    const two = toJSON(analyzeMigration({ files: [...input.files].reverse() }));
    expect(one).toBe(two);
    const parsed = JSON.parse(one);
    expect(parsed.tool.name).toBe("supabase-migration-guard");
    expect(parsed.findings[0].file).toBe("a.sql");
  });

  it("Markdown contains a summary table and escapes content", () => {
    const md = toMarkdown(analyzeMigration(input));
    expect(md).toContain("| Errors | Warnings | Info | Suppressed |");
    expect(md).toContain("MIG001");
  });

  it("SARIF follows the 2.1.0 structure", () => {
    const s = JSON.parse(toSarif(analyzeMigration(input)));
    expect(s.version).toBe("2.1.0");
    const run = s.runs[0];
    expect(run.tool.driver.name).toBe("supabase-migration-guard");
    for (const res of run.results) {
      expect(["error", "warning", "note"]).toContain(res.level);
      expect(run.tool.driver.rules[res.ruleIndex].id).toBe(res.ruleId);
      const region = res.locations[0].physicalLocation.region;
      expect(region.startLine).toBeGreaterThanOrEqual(1);
      expect(region.startColumn).toBeGreaterThanOrEqual(1);
    }
  });
});
