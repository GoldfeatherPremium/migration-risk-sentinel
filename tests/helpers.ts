import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeMigration } from "../packages/core/src/index.js";

export const FIXTURES = resolve(__dirname, "fixtures");

export function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

export function analyzeSql(sql: string, config?: unknown, path = "migration.sql") {
  return analyzeMigration({ files: [{ path, content: sql }], config, dialect: "postgres" });
}

/** Rule IDs reported for the SQL (MIG032 off by default to keep tests focused). */
export function ids(sql: string, config: Record<string, unknown> = {}): string[] {
  const rules = { MIG032: "off", MIG033: "off", ...((config.rules as object) ?? {}) };
  return analyzeSql(sql, { ...config, rules }).findings.map((f) => f.ruleId);
}
