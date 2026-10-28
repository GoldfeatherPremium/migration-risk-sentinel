import { describe, expect, it } from "vitest";
import { analyzeMigration } from "../packages/core/src/index.js";
import { explanationInput, findingStatement } from "../src/lib/ai-context";

describe("Claude privacy boundary", () => {
  it("rejects requests without explicit consent", () => {
    expect(
      explanationInput.safeParse({ sql: "DROP TABLE orders;", ruleId: "MIG001" }).success,
    ).toBe(false);
    expect(
      explanationInput.safeParse({ consent: false, sql: "DROP TABLE orders;", ruleId: "MIG001" })
        .success,
    ).toBe(false);
    expect(
      explanationInput.safeParse({ consent: true, sql: "DROP TABLE orders;", ruleId: "MIG001" })
        .success,
    ).toBe(true);
  });
  it("bounds shared SQL at 12000 characters", () => {
    expect(
      explanationInput.safeParse({ consent: true, sql: "x".repeat(12000), ruleId: "MIG001" })
        .success,
    ).toBe(true);
    expect(
      explanationInput.safeParse({ consent: true, sql: "x".repeat(12001), ruleId: "MIG001" })
        .success,
    ).toBe(false);
  });
  it("selects only the flagged parsed statement, not adjacent private SQL", () => {
    const sql =
      "SELECT 'private; value';\nDROP TABLE public.orders;\nSELECT 'another private value';";
    const finding = analyzeMigration({
      files: [{ path: "migration.sql", content: sql }],
    }).findings.find((f) => f.ruleId === "MIG001");
    if (!finding) throw new Error("Expected DROP TABLE finding");
    expect(findingStatement(sql, finding)).toBe("DROP TABLE public.orders");
  });
});
