import { z } from "zod";
import { parseFile, type Finding } from "@/lib/core";

export const explanationInput = z.object({
  consent: z.literal(true),
  sql: z.string().trim().min(1).max(12000),
  ruleId: z.string().regex(/^MIG\d{3}$/),
}).strict();

/** Use the parser's statement boundaries, not line or regex SQL classification. */
export function findingStatement(source: string, finding: Finding): string {
  const statement = parseFile(finding.file, source).statements.find(
    (s) => finding.line >= s.loc.line && finding.line <= s.loc.endLine,
  );
  return statement?.text ?? "";
}