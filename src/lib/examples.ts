/**
 * Sample SQL shown in the analyzer and playground. These are the same files
 * used by the automated test suite (tests/fixtures), loaded as raw text.
 */
const raw = import.meta.glob("../../tests/fixtures/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const project = import.meta.glob("../../tests/fixtures/project/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function file(name: string): string {
  const key = Object.keys(raw).find((k) => k.endsWith(`/${name}`));
  return key ? raw[key] : "";
}

export interface Example {
  id: string;
  title: string;
  kind: "risky" | "safe" | "edge";
  description: string;
  files: { path: string; content: string }[];
}

export const EXAMPLES: Example[] = [
  {
    id: "destructive",
    title: "Destructive operations",
    kind: "risky",
    description: "DROP TABLE, DROP COLUMN, TRUNCATE, DROP SCHEMA, DROP INDEX.",
    files: [{ path: "destructive.sql", content: file("destructive.sql") }],
  },
  {
    id: "not-null",
    title: "NOT NULL columns",
    kind: "risky",
    description: "NOT NULL without default, constant default, volatile default.",
    files: [{ path: "add_column_not_null.sql", content: file("add_column_not_null.sql") }],
  },
  {
    id: "concurrent-tx",
    title: "CONCURRENTLY in a transaction",
    kind: "risky",
    description: "CREATE INDEX CONCURRENTLY inside BEGIN/COMMIT fails in PostgreSQL.",
    files: [
      { path: "concurrent_in_transaction.sql", content: file("concurrent_in_transaction.sql") },
    ],
  },
  {
    id: "dml",
    title: "UPDATE / DELETE without WHERE",
    kind: "risky",
    description: "Whole-table writes next to a targeted update.",
    files: [{ path: "dml_without_where.sql", content: file("dml_without_where.sql") }],
  },
  {
    id: "type",
    title: "Column type change",
    kind: "risky",
    description: "ALTER COLUMN ... TYPE with USING.",
    files: [{ path: "type_change.sql", content: file("type_change.sql") }],
  },
  {
    id: "cross-file",
    title: "Cross-file ordering & duplicates",
    kind: "risky",
    description:
      "Three migration files: a foreign key added before its table exists, and a duplicate CREATE TABLE.",
    files: Object.entries(project)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ path: `supabase/migrations/${k.split("/").pop()}`, content: v })),
  },
  {
    id: "safe",
    title: "Safe table creation",
    kind: "safe",
    description: "New table with constraints, index and RLS in one file — no findings expected.",
    files: [{ path: "safe_create_table.sql", content: file("safe_create_table.sql") }],
  },
  {
    id: "concurrent-ok",
    title: "Concurrent index (standalone)",
    kind: "safe",
    description: "CREATE INDEX CONCURRENTLY in its own file, outside a transaction.",
    files: [{ path: "concurrent_ok.sql", content: file("concurrent_ok.sql") }],
  },
  {
    id: "comments",
    title: "Misleading comments & strings",
    kind: "edge",
    description:
      "Keywords inside comments, strings, dollar quotes and quoted identifiers must not trigger rules.",
    files: [{ path: "comments_and_quotes.sql", content: file("comments_and_quotes.sql") }],
  },
  {
    id: "suppressed",
    title: "Inline suppressions",
    kind: "edge",
    description: "migration-guard-ignore comments with reasons.",
    files: [{ path: "suppressed.sql", content: file("suppressed.sql") }],
  },
  {
    id: "invalid",
    title: "Invalid SQL",
    kind: "edge",
    description: "Unbalanced parenthesis and unterminated string.",
    files: [{ path: "invalid.sql", content: file("invalid.sql") }],
  },
];
