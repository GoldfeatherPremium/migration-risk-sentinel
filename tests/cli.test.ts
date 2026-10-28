// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, run } from "../packages/cli/src/run.js";
import { FIXTURES } from "./helpers";

function cli(args: string[], cwd = FIXTURES) {
  let stdout = "";
  let stderr = "";
  const code = run(args, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), cwd });
  return { code, stdout, stderr };
}

describe("CLI", () => {
  it("prints help and version", () => {
    expect(cli(["--help"]).stdout).toContain("Usage:");
    expect(cli(["--version"]).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exits 1 when error findings exist, 0 for safe files", () => {
    expect(cli(["scan", "destructive.sql"]).code).toBe(EXIT.FINDINGS);
    expect(cli(["scan", "safe_create_table.sql"]).code).toBe(EXIT.OK);
  });

  it("respects --fail-on", () => {
    expect(cli(["scan", "index_creation.sql"]).code).toBe(EXIT.OK);
    expect(cli(["scan", "index_creation.sql", "--fail-on", "warning"]).code).toBe(EXIT.FINDINGS);
    expect(cli(["scan", "destructive.sql", "--fail-on", "never"]).code).toBe(EXIT.OK);
  });

  it("scans directories recursively and outputs deterministic JSON", () => {
    const a = cli(["scan", "project", "--format", "json"]);
    const b = cli(["scan", "project", "--format", "json"]);
    expect(a.stdout).toBe(b.stdout);
    const r = JSON.parse(a.stdout);
    expect(r.summary.filesAnalyzed).toBe(3);
    expect(r.files[0].path).toBe("project/supabase/migrations/20240101000000_init.sql");
  });

  it("outputs markdown and sarif", () => {
    expect(cli(["scan", "destructive.sql", "--format", "markdown"]).stdout).toContain(
      "## Supabase Migration Guard report",
    );
    expect(JSON.parse(cli(["scan", "destructive.sql", "--format", "sarif"]).stdout).version).toBe(
      "2.1.0",
    );
  });

  it("uses exit code 3 for missing paths and 2 for usage/config errors", () => {
    expect(cli(["scan", "does-not-exist"]).code).toBe(EXIT.IO);
    expect(cli(["scan", "destructive.sql", "--format", "xml"]).code).toBe(EXIT.USAGE);
    expect(cli(["frobnicate"]).code).toBe(EXIT.USAGE);
    const dir = mkdtempSync(join(tmpdir(), "mg-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ rules: { MIG001: "loud" } }));
    writeFileSync(join(dir, "a.sql"), "select 1;");
    const r = cli(["scan", ".", "--config", "bad.json"], dir);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.stderr).toContain("rules.MIG001");
    writeFileSync(join(dir, "broken.json"), "{");
    expect(cli(["scan", ".", "--config", "broken.json"], dir).code).toBe(EXIT.USAGE);
  });

  it("loads config files automatically and supports baselines", () => {
    const dir = mkdtempSync(join(tmpdir(), "mg-"));
    writeFileSync(join(dir, "m.sql"), "drop table a;");
    expect(cli(["scan", "."], dir).code).toBe(EXIT.FINDINGS);
    writeFileSync(
      join(dir, "migration-guard.config.json"),
      JSON.stringify({ rules: { MIG001: "warning" } }),
    );
    expect(cli(["scan", "."], dir).code).toBe(EXIT.OK);
    writeFileSync(join(dir, "migration-guard.config.json"), "{}");
    expect(cli(["scan", ".", "--write-baseline", "base.json"], dir).code).toBe(EXIT.OK);
    expect(
      JSON.parse(readFileSync(join(dir, "base.json"), "utf8")).fingerprints.length,
    ).toBeGreaterThan(0);
    expect(cli(["scan", ".", "--baseline", "base.json"], dir).code).toBe(EXIT.OK);
  });

  it("runs as a real process via the entry point", () => {
    const entry = resolve(__dirname, "../packages/cli/src/cli.ts");
    const p = spawnSync("bun", [entry, "scan", "destructive.sql", "--format", "json"], {
      cwd: FIXTURES,
      encoding: "utf8",
    });
    if (p.error) return; // bun unavailable: covered by in-process tests above
    expect(p.status).toBe(1);
    expect(JSON.parse(p.stdout).summary.error).toBeGreaterThan(0);
  });
});
