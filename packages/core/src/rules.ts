import type { Token } from "./lexer.js";
import type { ParsedFile, QualifiedName, SourceLocation, Statement } from "./parser.js";
import type { Confidence, RuleMeta, Severity } from "./types.js";

export interface FileContext {
  file: ParsedFile;
  /** Per statement: inside an explicit BEGIN ... COMMIT block. */
  inTransaction: boolean[];
  hasExplicitTransaction: boolean;
  /** Table key -> statement index where it is first created in this file. */
  createdTables: Map<string, number>;
  /** Index key -> statement index where it is first created in this file. */
  createdIndexes: Map<string, number>;
  assumeImplicitTransaction: boolean;
}

export interface RawReport {
  statement?: Statement;
  loc?: SourceLocation;
  message: string;
  severity?: Severity;
  confidence?: Confidence;
}
export type Report = (r: RawReport) => void;
export type Options = Record<string, number | boolean>;

export interface RuleDefinition extends RuleMeta {
  checkStatement?(stmt: Statement, ctx: FileContext, report: Report, options: Options): void;
  checkFile?(ctx: FileContext, report: Report, options: Options): void;
  checkProject?(files: FileContext[], reportFor: (path: string) => Report, options: Options): void;
}

export const HEURISTIC_NOTE = "Heuristic: table size, row contents and lock contention are unknown to static analysis.";

function createdEarlier(ctx: FileContext, table: QualifiedName, stmt: Statement): boolean {
  const idx = ctx.createdTables.get(table.key);
  return idx !== undefined && idx < stmt.index;
}

const VOLATILE_FUNCS = new Set([
  "RANDOM", "GEN_RANDOM_UUID", "UUID_GENERATE_V1", "UUID_GENERATE_V4", "UUIDV7", "UUID_GENERATE_V7",
  "CLOCK_TIMESTAMP", "TIMEOFDAY", "NEXTVAL", "TXID_CURRENT", "GEN_RANDOM_BYTES",
]);

function hasVolatileCall(tokens: Token[]): string | null {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === "word" && VOLATILE_FUNCS.has(t.upper) && tokens[k + 1]?.value === "(") return t.value;
  }
  return null;
}

function isTrivialPredicate(where: Token[]): boolean {
  if (where.length === 1 && where[0].type === "word" && where[0].upper === "TRUE") return true;
  if (where.length === 3 && where[1].type === "op" && where[1].value === "=") {
    const [a, , b] = where;
    if ((a.type === "number" || a.type === "string") && a.type === b.type && a.value === b.value) return true;
  }
  return false;
}

function isBroadPredicate(where: Token[]): boolean {
  const selective = where.some(
    (t) =>
      (t.type === "op" && ["=", "<", ">", "<=", ">=", "~", "~~"].includes(t.value)) ||
      (t.type === "word" && ["IN", "BETWEEN", "LIKE", "ILIKE", "ANY", "EXISTS", "SIMILAR"].includes(t.upper)),
  );
  return !selective;
}

const IRREVERSIBLE_MARKER = /\b(rollback|down|recovery|revert|restore|backup)\b/i;

export const RULES: RuleDefinition[] = [
  {
    id: "MIG000",
    name: "SQL syntax problem",
    category: "syntax",
    defaultSeverity: "error",
    confidence: "definite",
    description: "The lexer or statement checker found a definite syntax problem (unterminated string, unbalanced parentheses, unrecognized command).",
    rationale: "A migration that does not parse will fail at deploy time, possibly after earlier statements already ran.",
    remediation: "Fix the reported syntax problem and run the migration against a local database (e.g. `supabase db reset`).",
    limitations: [
      "Only lexical structure, parenthesis balance and the leading command keyword are verified; this is not a full PostgreSQL grammar check.",
      "Valid SQL that starts with an uncommon command may be reported as unrecognized.",
    ],
    checkFile(ctx, report) {
      for (const e of ctx.file.lexErrors) {
        report({ loc: { line: e.line, column: e.col, endLine: e.line, endColumn: e.col + 1 }, message: e.message });
      }
      for (const s of ctx.file.statements) {
        for (const e of s.syntaxErrors) report({ statement: s, loc: e.loc, message: e.message });
      }
    },
  },
  {
    id: "MIG001",
    name: "DROP TABLE",
    category: "destructive",
    defaultSeverity: "error",
    confidence: "definite",
    description: "Dropping a table permanently deletes its data.",
    rationale: "DROP TABLE removes all rows, indexes, triggers and policies; running application code that still reads the table will fail.",
    remediation: "Deploy application code that no longer uses the table first, take a backup or rename the table (e.g. `ALTER TABLE t RENAME TO t_deprecated`) and drop it in a later migration.",
    limitations: ["Tables created earlier in the same file are ignored (temporary scaffolding).", "IF EXISTS does not make the operation safer and is not required."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "drop" || p.objectType !== "TABLE") return;
      const names = p.names.filter((n) => !createdEarlier(ctx, n, s));
      if (!names.length) return;
      report({
        statement: s,
        message: `DROP TABLE permanently deletes ${names.map((n) => n.display).join(", ")}${p.cascade ? " and dependent objects (CASCADE)" : ""}.`,
      });
    },
  },
  {
    id: "MIG002",
    name: "DROP COLUMN",
    category: "destructive",
    defaultSeverity: "error",
    confidence: "definite",
    description: "Dropping a column permanently deletes its data and breaks code that still references it.",
    rationale: "Application instances deployed before the migration may still SELECT or INSERT the column, causing errors during rollout.",
    remediation: "Stop reading and writing the column in application code, deploy, then drop it in a follow-up migration. Back up the data if it may be needed.",
    limitations: ["Cannot tell whether application code still references the column."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "alter_table" || createdEarlier(ctx, p.table, s)) return;
      for (const a of p.actions) {
        if (a.type === "drop_column") {
          report({ statement: s, loc: a.loc, message: `Dropping column ${a.column} from ${p.table.display} permanently deletes its data.` });
        }
      }
    },
  },
  {
    id: "MIG003",
    name: "TRUNCATE TABLE",
    category: "destructive",
    defaultSeverity: "error",
    confidence: "definite",
    description: "TRUNCATE deletes every row and takes an ACCESS EXCLUSIVE lock.",
    rationale: "Truncating in a migration usually destroys production data and blocks all access to the table while it runs.",
    remediation: "Avoid TRUNCATE in migrations. If you really need to clear data, do it as an explicit, reviewed operational task with a backup.",
    limitations: ["Tables created earlier in the same file are ignored."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "truncate") return;
      const tables = p.tables.filter((t) => !createdEarlier(ctx, t, s));
      if (!tables.length) return;
      report({ statement: s, message: `TRUNCATE deletes all rows from ${tables.map((t) => t.display).join(", ")}${p.cascade ? " and referencing tables (CASCADE)" : ""}.` });
    },
  },
  {
    id: "MIG004",
    name: "DROP SCHEMA",
    category: "destructive",
    defaultSeverity: "error",
    confidence: "definite",
    description: "Dropping a schema removes it and, with CASCADE, every object inside it.",
    rationale: "Schemas such as public, auth or storage in Supabase contain critical objects; dropping them is rarely intended.",
    remediation: "Drop individual objects explicitly and review each one. Never drop Supabase-managed schemas.",
    limitations: ["Cannot see which objects the schema contains."],
    checkStatement(s, _ctx, report) {
      const p = s.parsed;
      if (p.kind !== "drop" || p.objectType !== "SCHEMA") return;
      report({ statement: s, message: `DROP SCHEMA ${p.names.map((n) => n.name).join(", ")}${p.cascade ? " CASCADE removes every object in the schema" : " removes the schema"}.` });
    },
  },
  {
    id: "MIG005",
    name: "DROP INDEX",
    category: "destructive",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "Dropping an index can degrade query performance; without CONCURRENTLY it blocks the table.",
    rationale: "Queries that relied on the index may switch to sequential scans. A plain DROP INDEX takes an ACCESS EXCLUSIVE lock on the table.",
    remediation: "Confirm no queries depend on the index (pg_stat_user_indexes.idx_scan). Use DROP INDEX CONCURRENTLY outside a transaction block for busy tables.",
    limitations: [
      "Reported as info when the same index is recreated later in the file (replacement) — see MIG022.",
      "Ignored when the index was created earlier in the same file.",
    ],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "drop" || p.objectType !== "INDEX") return;
      for (const n of p.names) {
        const created = ctx.createdIndexes.get(n.key);
        if (created !== undefined && created < s.index) continue;
        const recreated = created !== undefined && created > s.index;
        report({
          statement: s,
          severity: recreated ? "info" : undefined,
          message: recreated
            ? `Index ${n.display} is dropped and recreated later in this file; queries run without it in between.`
            : `Dropping index ${n.display}${p.concurrently ? "" : " without CONCURRENTLY locks the table"}; queries using it may slow down.`,
        });
      }
    },
  },
  {
    id: "MIG010",
    name: "Unsafe NOT NULL column",
    category: "data",
    defaultSeverity: "error",
    confidence: "heuristic",
    description: "Adding a NOT NULL column without a default, or setting NOT NULL on an existing column, fails on populated tables.",
    rationale: "PostgreSQL rejects ADD COLUMN ... NOT NULL without DEFAULT if any row exists. SET NOT NULL scans the whole table under an ACCESS EXCLUSIVE lock. Volatile defaults force a full table rewrite.",
    remediation: "Add the column as nullable (or with a constant DEFAULT), backfill in batches, then add `CHECK (col IS NOT NULL) NOT VALID`, VALIDATE it, and finally SET NOT NULL.",
    limitations: [
      "Cannot know whether the table is empty; empty tables are safe.",
      "Constant defaults are treated as safe (PostgreSQL 11+ fast default).",
      "Tables created earlier in the same file are ignored.",
    ],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "alter_table" || createdEarlier(ctx, p.table, s)) return;
      for (const a of p.actions) {
        if (a.type === "add_column") {
          if (a.generated) continue;
          const volatile = a.hasDefault ? hasVolatileCall(a.defaultTokens) : null;
          if (a.notNull && !a.hasDefault) {
            report({ statement: s, loc: a.loc, message: `Adding NOT NULL column ${a.column} to ${p.table.display} without a DEFAULT fails if the table has any rows.` });
          } else if (volatile) {
            report({ statement: s, loc: a.loc, severity: "warning", message: `Column ${a.column} uses volatile default ${volatile}(); PostgreSQL rewrites the whole table under an exclusive lock.` });
          }
        } else if (a.type === "set_not_null") {
          report({ statement: s, loc: a.loc, severity: "warning", message: `SET NOT NULL on ${p.table.display}.${a.column} scans the full table under an ACCESS EXCLUSIVE lock and fails if NULLs exist.` });
        }
      }
    },
  },
  {
    id: "MIG011",
    name: "Column type change",
    category: "data",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "ALTER COLUMN ... TYPE can rewrite the table and fail on existing values.",
    rationale: "Most type changes rewrite every row and rebuild indexes under an ACCESS EXCLUSIVE lock. Incompatible values make the migration fail.",
    remediation: "Add a new column with the target type, backfill in batches, switch the application, then drop the old column. Some changes (e.g. varchar(n) to text) are cheap — verify on a copy of production data.",
    limitations: ["Does not know the old type, so binary-compatible changes that skip rewrites are still reported.", "Tables created earlier in the same file are ignored."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "alter_table" || createdEarlier(ctx, p.table, s)) return;
      for (const a of p.actions) {
        if (a.type === "alter_column_type") {
          report({
            statement: s,
            loc: a.loc,
            message: `Changing ${p.table.display}.${a.column} to ${a.newType}${a.hasUsing ? " (with USING)" : ""} may rewrite the table and fail on incompatible values.`,
          });
        }
      }
    },
  },
  {
    id: "MIG012",
    name: "Unique constraint on existing data",
    category: "data",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "Adding a UNIQUE / PRIMARY KEY constraint or unique index fails if duplicates already exist.",
    rationale: "The migration fails when existing rows violate uniqueness, and building the index blocks writes unless done concurrently.",
    remediation: "Check for duplicates first (`SELECT col, count(*) ... GROUP BY col HAVING count(*) > 1`). Build `CREATE UNIQUE INDEX CONCURRENTLY`, then `ADD CONSTRAINT ... UNIQUE USING INDEX`.",
    limitations: ["Cannot see existing data.", "`USING INDEX` constraints and tables created earlier in the same file are ignored."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind === "alter_table" && !createdEarlier(ctx, p.table, s)) {
        for (const a of p.actions) {
          if (a.type === "add_constraint" && (a.constraintType === "unique" || a.constraintType === "primary_key") && !a.usingIndex) {
            report({ statement: s, loc: a.loc, message: `Adding a ${a.constraintType === "unique" ? "UNIQUE" : "PRIMARY KEY"} constraint on ${p.table.display} fails if duplicate rows exist and blocks writes while the index builds.` });
          }
        }
      } else if (p.kind === "create_index" && p.unique && !createdEarlier(ctx, p.table, s)) {
        report({ statement: s, message: `Unique index on ${p.table.display} fails if duplicate values already exist.` });
      }
    },
  },
  {
    id: "MIG013",
    name: "Foreign key validated immediately",
    category: "data",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "Adding a FOREIGN KEY without NOT VALID checks every row and locks both tables.",
    rationale: "Orphaned rows make the migration fail, and validation holds a SHARE ROW EXCLUSIVE lock on both tables for the duration of the scan.",
    remediation: "Add the constraint with NOT VALID, then run `ALTER TABLE ... VALIDATE CONSTRAINT ...` in a separate migration. Clean up orphans first.",
    limitations: ["Cannot see existing data.", "Foreign keys on new columns (always NULL) and tables created earlier in the same file are ignored."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "alter_table" || createdEarlier(ctx, p.table, s)) return;
      for (const a of p.actions) {
        if (a.type === "add_constraint" && a.constraintType === "foreign_key" && !a.notValid) {
          report({ statement: s, loc: a.loc, message: `Foreign key on ${p.table.display}${a.references ? ` referencing ${a.references.display}` : ""} is validated immediately; orphaned rows will fail the migration.` });
        }
      }
    },
  },
  {
    id: "MIG014",
    name: "UPDATE/DELETE without WHERE",
    category: "data",
    defaultSeverity: "error",
    confidence: "definite",
    description: "An UPDATE or DELETE with no WHERE clause affects every row in the table.",
    rationale: "Whole-table writes are slow, generate heavy WAL, hold row locks on every row and are frequently a mistake.",
    remediation: "Add a WHERE clause. For intentional backfills, process rows in batches outside the schema migration.",
    limitations: ["Reported as info for tables created earlier in the same file.", "Statements filtered only by a USING/FROM join without WHERE are reported."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if ((p.kind !== "update" && p.kind !== "delete") || p.hasWhere) return;
      const isNew = createdEarlier(ctx, p.table, s);
      report({
        statement: s,
        severity: isNew ? "info" : undefined,
        message: `${p.kind.toUpperCase()} on ${p.table.display} has no WHERE clause and affects every row.`,
      });
    },
  },
  {
    id: "MIG015",
    name: "Broad UPDATE/DELETE",
    category: "data",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "UPDATE/DELETE with an always-true or non-selective WHERE clause needs manual review.",
    rationale: "Predicates such as `WHERE true`, `WHERE 1 = 1` or only `IS NULL` checks typically touch most of the table.",
    remediation: "Narrow the predicate or run the backfill in bounded batches (e.g. by primary key ranges) outside the migration.",
    limitations: ["Selectivity is estimated from predicate shape only; reported as info unless the predicate is trivially true."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if ((p.kind !== "update" && p.kind !== "delete") || !p.hasWhere || p.whereCurrentOf) return;
      if (createdEarlier(ctx, p.table, s)) return;
      if (isTrivialPredicate(p.whereTokens)) {
        report({ statement: s, message: `${p.kind.toUpperCase()} on ${p.table.display} has an always-true WHERE clause.` });
      } else if (isBroadPredicate(p.whereTokens)) {
        report({ statement: s, severity: "info", message: `${p.kind.toUpperCase()} on ${p.table.display} uses a non-selective WHERE clause; review how many rows it touches.` });
      }
    },
  },
  {
    id: "MIG020",
    name: "CREATE INDEX without CONCURRENTLY",
    category: "index",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "A plain CREATE INDEX blocks writes to the table until the build finishes.",
    rationale: "On large or busy tables, building an index without CONCURRENTLY holds a SHARE lock that blocks INSERT/UPDATE/DELETE.",
    remediation: "Use CREATE INDEX CONCURRENTLY in its own migration file outside a transaction block. CONCURRENTLY is slower, cannot run in a transaction, and can leave an INVALID index on failure that must be dropped.",
    limitations: ["Table size is unknown; small tables are fine.", "Tables created earlier in the same file are ignored."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind !== "create_index" || p.concurrently || createdEarlier(ctx, p.table, s)) return;
      report({ statement: s, message: `CREATE INDEX on ${p.table.display} without CONCURRENTLY blocks writes while it builds.` });
    },
  },
  {
    id: "MIG021",
    name: "CONCURRENTLY inside a transaction",
    category: "index",
    defaultSeverity: "error",
    confidence: "definite",
    description: "CREATE/DROP INDEX CONCURRENTLY and REINDEX CONCURRENTLY cannot run inside a transaction block.",
    rationale: "PostgreSQL raises `cannot run inside a transaction block`, failing the migration.",
    remediation: "Move the concurrent statement to its own migration file without BEGIN/COMMIT. Confirm your migration runner does not wrap files in a transaction.",
    limitations: [
      "Explicit BEGIN/COMMIT is detected with certainty. Runners that wrap each file in an implicit transaction are only flagged when `assumeImplicitTransaction` is enabled (reported as warning).",
    ],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      const concurrent =
        (p.kind === "create_index" && p.concurrently) ||
        (p.kind === "drop" && p.objectType === "INDEX" && p.concurrently) ||
        (p.kind === "reindex" && p.concurrently);
      if (!concurrent) return;
      if (ctx.inTransaction[s.index]) {
        report({ statement: s, message: "CONCURRENTLY operations cannot run inside a BEGIN ... COMMIT transaction block." });
      } else if (ctx.assumeImplicitTransaction && ctx.file.statements.length > 1) {
        report({ statement: s, severity: "warning", confidence: "heuristic", message: "CONCURRENTLY in a multi-statement file may run in the migration runner's implicit transaction." });
      }
    },
  },
  {
    id: "MIG022",
    name: "Expensive index rebuild or table rewrite",
    category: "index",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "REINDEX, CLUSTER, VACUUM FULL and SET TABLESPACE rebuild data under heavy locks; drop-and-recreate leaves a gap.",
    rationale: "These operations rewrite tables or indexes and block reads and/or writes for their duration.",
    remediation: "Prefer REINDEX CONCURRENTLY (outside transactions), pg_repack for table rewrites, and CREATE INDEX CONCURRENTLY a replacement before dropping the old index.",
    limitations: ["Duration depends on data size, which is unknown."],
    checkStatement(s, ctx, report) {
      const p = s.parsed;
      if (p.kind === "reindex") {
        report({ statement: s, severity: p.concurrently ? "info" : undefined, message: p.concurrently ? `REINDEX ${p.target} CONCURRENTLY rebuilds indexes; it is slow and uses extra disk.` : `REINDEX ${p.target} locks out writes (and reads using the index) while rebuilding.` });
      } else if (p.kind === "cluster") {
        report({ statement: s, message: "CLUSTER rewrites the table under an ACCESS EXCLUSIVE lock." });
      } else if (p.kind === "vacuum" && p.full) {
        report({ statement: s, message: "VACUUM FULL rewrites the table under an ACCESS EXCLUSIVE lock." });
      } else if (p.kind === "alter_table") {
        for (const a of p.actions) if (a.type === "set_tablespace") report({ statement: s, loc: a.loc, message: `SET TABLESPACE rewrites ${p.table.display} under an ACCESS EXCLUSIVE lock.` });
      } else if (p.kind === "create_index" && p.name) {
        // Replacement: index with this name was dropped earlier in the same file.
        const dropped = ctx.file.statements.some(
          (o) => o.index < s.index && o.parsed.kind === "drop" && o.parsed.objectType === "INDEX" && o.parsed.names.some((n) => n.key === p.name!.key),
        );
        if (dropped) report({ statement: s, message: `Index ${p.name.display} is replaced by drop-and-recreate; create the new index concurrently under a new name first, then drop the old one.` });
      }
    },
  },
  {
    id: "MIG023",
    name: "Repeated locks on the same table",
    category: "index",
    defaultSeverity: "info",
    confidence: "heuristic",
    description: "Several lock-taking statements target the same existing table in one file.",
    rationale: "Each ALTER TABLE / non-concurrent CREATE INDEX re-acquires a strong lock; queued locks can stall application traffic.",
    remediation: "Combine ALTER TABLE actions into one statement where possible, set `lock_timeout`, and split long-running steps into separate migrations.",
    limitations: ["Lock duration is unknown; the threshold is configurable via `threshold`."],
    options: { threshold: { type: "number", default: 3, description: "Number of lock-taking statements on one table that triggers the rule." } },
    checkFile(ctx, report, options) {
      const threshold = Number(options.threshold ?? 3);
      const byTable = new Map<string, Statement[]>();
      for (const s of ctx.file.statements) {
        const p = s.parsed;
        let key: QualifiedName | null = null;
        if (p.kind === "alter_table") key = p.table;
        else if (p.kind === "create_index" && !p.concurrently) key = p.table;
        if (!key || createdEarlier(ctx, key, s)) continue;
        const list = byTable.get(key.key) ?? [];
        list.push(s);
        byTable.set(key.key, list);
      }
      for (const [key, list] of [...byTable.entries()].sort()) {
        if (list.length >= threshold) {
          report({ statement: list[0], message: `${list.length} lock-taking statements target ${key} (lines ${list.map((x) => x.loc.line).join(", ")}).` });
        }
      }
    },
  },
  {
    id: "MIG030",
    name: "Duplicate schema change",
    category: "quality",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "The same table, index or column is created more than once across the analyzed files.",
    rationale: "Duplicate CREATE statements fail on deploy or indicate conflicting migrations from parallel branches.",
    remediation: "Remove the duplicate or merge the conflicting migrations. IF NOT EXISTS hides the duplicate but does not reconcile differing definitions.",
    limitations: ["Statements with IF NOT EXISTS are skipped.", "Objects dropped between the two creations are not considered duplicates."],
    checkProject(files, reportFor) {
      const seen = new Map<string, { path: string; line: number }>();
      for (const f of files) {
        for (const s of f.file.statements) {
          const p = s.parsed;
          const keys: { k: string; label: string; act: "create" }[] = [];
          if (p.kind === "drop") {
            for (const n of p.names) {
              seen.delete(`${p.objectType === "TABLE" ? "table" : "index"}:${n.key}`);
              if (p.objectType === "TABLE") for (const k of [...seen.keys()]) if (k.startsWith(`column:${n.key}.`)) seen.delete(k);
            }
            continue;
          }
          if (p.kind === "create_table" && !p.ifNotExists && !p.temporary) keys.push({ k: `table:${p.table.key}`, label: `table ${p.table.display}`, act: "create" });
          if (p.kind === "create_index" && p.name && !p.ifNotExists) keys.push({ k: `index:${p.name.key}`, label: `index ${p.name.display}`, act: "create" });
          if (p.kind === "alter_table") {
            for (const a of p.actions) {
              if (a.type === "add_column" && !a.ifNotExists) keys.push({ k: `column:${p.table.key}.${a.column}`, label: `column ${p.table.display}.${a.column}`, act: "create" });
              if (a.type === "drop_column") seen.delete(`column:${p.table.key}.${a.column}`);
            }
          }
          for (const { k, label } of keys) {
            const prev = seen.get(k);
            if (prev) {
              reportFor(f.file.path)({ statement: s, message: `${label} is already created in ${prev.path}:${prev.line}.` });
            } else seen.set(k, { path: f.file.path, line: s.loc.line });
          }
        }
      }
    },
  },
  {
    id: "MIG031",
    name: "Suspicious migration ordering",
    category: "quality",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "A migration references a table that is only created by a later migration file.",
    rationale: "Migrations run in filename order; referencing an object before it exists fails on fresh databases (CI, local resets, preview branches).",
    remediation: "Rename the files so dependencies run first, or move the statement into the later migration.",
    limitations: ["Only tables created within the analyzed file set are considered; objects created outside SQL migrations are unknown.", "Files are ordered by path, matching Supabase's timestamp-prefixed naming."],
    checkProject(files, reportFor) {
      const firstCreate = new Map<string, number>();
      files.forEach((f, fi) => {
        for (const s of f.file.statements) if (s.parsed.kind === "create_table" && !firstCreate.has(s.parsed.table.key)) firstCreate.set(s.parsed.table.key, fi);
      });
      files.forEach((f, fi) => {
        for (const s of f.file.statements) {
          const p = s.parsed;
          const refs: QualifiedName[] = [];
          if (p.kind === "alter_table") {
            refs.push(p.table);
            for (const a of p.actions) if ((a.type === "add_constraint" || a.type === "add_column") && a.references) refs.push(a.references);
          } else if (p.kind === "create_index" || p.kind === "update" || p.kind === "delete") refs.push(p.table);
          else if (p.kind === "create_table") refs.push(...p.references);
          else if (p.kind === "truncate") refs.push(...p.tables);
          for (const r of refs) {
            const ci = firstCreate.get(r.key);
            if (ci !== undefined && ci > fi) {
              reportFor(f.file.path)({ statement: s, message: `References ${r.display}, which is first created in later file ${files[ci].file.path}.` });
            }
          }
        }
      });
    },
  },
  {
    id: "MIG032",
    name: "No explicit transaction",
    category: "quality",
    defaultSeverity: "info",
    confidence: "heuristic",
    description: "A file with several schema changes has no explicit BEGIN/COMMIT.",
    rationale: "If a runner executes statements one by one, a failure mid-file leaves the schema half-migrated.",
    remediation: "Wrap related changes in BEGIN ... COMMIT, unless your runner already uses a transaction per file or the file contains CONCURRENTLY statements.",
    limitations: ["Many runners (including the Supabase CLI) manage transactions themselves; disable this rule if so.", "Files containing CONCURRENTLY operations are skipped."],
    options: { minStatements: { type: "number", default: 2, description: "Minimum number of DDL statements before the rule applies." } },
    checkFile(ctx, report, options) {
      if (ctx.hasExplicitTransaction) return;
      const ddl = ctx.file.statements.filter((s) => ["create_table", "alter_table", "drop", "create_index", "truncate"].includes(s.parsed.kind));
      const concurrent = ctx.file.statements.some((s) => {
        const p = s.parsed;
        return (p.kind === "create_index" || p.kind === "drop" || p.kind === "reindex") && p.concurrently;
      });
      if (concurrent || ddl.length < Number(options.minStatements ?? 2)) return;
      report({ statement: ddl[0], message: `${ddl.length} schema changes without an explicit transaction; a mid-file failure may leave partial changes.` });
    },
  },
  {
    id: "MIG033",
    name: "Irreversible change without recovery plan",
    category: "quality",
    defaultSeverity: "warning",
    confidence: "heuristic",
    description: "The file contains data-destroying changes but no comment describing a rollback or recovery strategy.",
    rationale: "Dropped data cannot be restored by a down-migration; reviewers need to know how to recover.",
    remediation: "Add a comment such as `-- recovery: restore from backup taken at <step>` or `-- rollback: ...` explaining how to recover, and take a backup before deploying.",
    limitations: ["Looks for comments containing rollback/down/recovery/revert/restore/backup; it cannot judge the plan's quality."],
    checkFile(ctx, report) {
      const destructive = ctx.file.statements.find((s) => {
        const p = s.parsed;
        if (p.kind === "drop" && ["TABLE", "SCHEMA"].includes(p.objectType)) return p.names.some((n) => !createdEarlier(ctx, n, s)) || p.objectType === "SCHEMA";
        if (p.kind === "truncate") return true;
        if ((p.kind === "delete" || p.kind === "update") && !p.hasWhere) return !createdEarlier(ctx, p.table, s);
        if (p.kind === "alter_table" && !createdEarlier(ctx, p.table, s)) return p.actions.some((a) => a.type === "drop_column" || a.type === "alter_column_type");
        return false;
      });
      if (!destructive) return;
      if (ctx.file.comments.some((c) => c.type === "comment" && IRREVERSIBLE_MARKER.test(c.value))) return;
      report({ statement: destructive, message: "Irreversible change with no documented recovery strategy in this file." });
    },
  },
  {
    id: "MIG034",
    name: "Empty migration",
    category: "quality",
    defaultSeverity: "warning",
    confidence: "definite",
    description: "The migration file contains no executable SQL.",
    rationale: "Empty migrations are usually accidental (forgotten content or a bad merge) and clutter migration history.",
    remediation: "Add the intended SQL or delete the file.",
    limitations: ["A file containing only comments counts as empty."],
    checkFile(ctx, report) {
      if (ctx.file.empty && ctx.file.lexErrors.length === 0) {
        report({ loc: { line: 1, column: 1, endLine: 1, endColumn: 1 }, message: "File contains no executable SQL statements." });
      }
    },
  },
];

export const PLANNED_RULES: { id: string; name: string; description: string }[] = [
  { id: "MIG040", name: "RLS not enabled on new public table", description: "Supabase: tables in the public schema exposed via the Data API without ENABLE ROW LEVEL SECURITY." },
  { id: "MIG041", name: "Overly permissive policy", description: "Supabase: policies using `USING (true)` for write operations." },
  { id: "MIG042", name: "Renamed column or table", description: "RENAME breaks application code that still uses the old name during rollout." },
  { id: "MIG043", name: "Missing lock_timeout", description: "Lock-taking DDL without SET lock_timeout can queue behind long transactions." },
];

export function getRuleMeta(): RuleMeta[] {
  return RULES.map(({ checkFile: _a, checkProject: _b, checkStatement: _c, ...meta }) => meta);
}
