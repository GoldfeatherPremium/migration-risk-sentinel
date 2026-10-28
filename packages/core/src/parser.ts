/**
 * Statement splitter and lightweight PostgreSQL statement parser.
 *
 * This is NOT a complete PostgreSQL grammar. It is a token-based,
 * recursive-descent classifier for the statement forms the migration rules
 * care about (DDL on tables/indexes/schemas, DML, transaction control).
 * Statements it does not understand are classified as "other" and are never
 * guessed at with regular expressions.
 */
import { tokenize, type LexError, type Token } from "./lexer.js";

export interface SourceLocation {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface QualifiedName {
  schema: string | null;
  name: string;
  /** Normalized key: schema defaults to "public". */
  key: string;
  display: string;
}

export type AlterAction =
  | {
      type: "add_column";
      column: string;
      notNull: boolean;
      hasDefault: boolean;
      defaultTokens: Token[];
      generated: boolean;
      references: QualifiedName | null;
      unique: boolean;
      primaryKey: boolean;
      ifNotExists: boolean;
      loc: SourceLocation;
    }
  | {
      type: "add_constraint";
      constraintName: string | null;
      constraintType: "unique" | "primary_key" | "foreign_key" | "check" | "exclude" | "unknown";
      notValid: boolean;
      usingIndex: boolean;
      references: QualifiedName | null;
      loc: SourceLocation;
    }
  | {
      type: "drop_column";
      column: string;
      ifExists: boolean;
      cascade: boolean;
      loc: SourceLocation;
    }
  | { type: "drop_constraint"; constraintName: string; loc: SourceLocation }
  | {
      type: "alter_column_type";
      column: string;
      hasUsing: boolean;
      newType: string;
      loc: SourceLocation;
    }
  | { type: "set_not_null"; column: string; loc: SourceLocation }
  | { type: "set_tablespace"; loc: SourceLocation }
  | { type: "validate_constraint"; loc: SourceLocation }
  | { type: "rename"; loc: SourceLocation }
  | { type: "other"; keyword: string; loc: SourceLocation };

export type ParsedStatement =
  | { kind: "begin" }
  | { kind: "commit" }
  | { kind: "rollback" }
  | {
      kind: "create_table";
      table: QualifiedName;
      ifNotExists: boolean;
      temporary: boolean;
      asSelect: boolean;
      references: QualifiedName[];
    }
  | {
      kind: "drop";
      objectType: string;
      names: QualifiedName[];
      ifExists: boolean;
      cascade: boolean;
      concurrently: boolean;
    }
  | { kind: "alter_table"; table: QualifiedName; ifExists: boolean; actions: AlterAction[] }
  | {
      kind: "create_index";
      name: QualifiedName | null;
      table: QualifiedName;
      unique: boolean;
      concurrently: boolean;
      ifNotExists: boolean;
    }
  | { kind: "truncate"; tables: QualifiedName[]; cascade: boolean }
  | {
      kind: "update";
      table: QualifiedName;
      hasWhere: boolean;
      whereTokens: Token[];
      whereCurrentOf: boolean;
    }
  | {
      kind: "delete";
      table: QualifiedName;
      hasWhere: boolean;
      whereTokens: Token[];
      whereCurrentOf: boolean;
    }
  | { kind: "reindex"; target: string; concurrently: boolean; name: QualifiedName | null }
  | { kind: "cluster"; table: QualifiedName | null }
  | { kind: "vacuum"; full: boolean }
  | { kind: "refresh_matview"; concurrently: boolean }
  | { kind: "other"; keyword: string };

export interface Statement {
  index: number;
  tokens: Token[];
  /** Comments that appear before this statement (since the previous one). */
  leadingComments: Token[];
  /** Comments that appear inside or on the same line after this statement. */
  trailingComments: Token[];
  text: string;
  loc: SourceLocation;
  parsed: ParsedStatement;
  /** Lightweight syntax problems detected for this statement. */
  syntaxErrors: { message: string; loc: SourceLocation }[];
}

export interface ParsedFile {
  path: string;
  source: string;
  statements: Statement[];
  comments: Token[];
  lexErrors: LexError[];
  /** True when the file contains no executable SQL (only comments/whitespace). */
  empty: boolean;
}

const KNOWN_COMMANDS = new Set([
  "ABORT",
  "ALTER",
  "ANALYZE",
  "BEGIN",
  "CALL",
  "CHECKPOINT",
  "CLOSE",
  "CLUSTER",
  "COMMENT",
  "COMMIT",
  "COPY",
  "CREATE",
  "DEALLOCATE",
  "DECLARE",
  "DELETE",
  "DISCARD",
  "DO",
  "DROP",
  "END",
  "EXECUTE",
  "EXPLAIN",
  "FETCH",
  "GRANT",
  "IMPORT",
  "INSERT",
  "LISTEN",
  "LOAD",
  "LOCK",
  "MERGE",
  "MOVE",
  "NOTIFY",
  "PREPARE",
  "REASSIGN",
  "REFRESH",
  "REINDEX",
  "RELEASE",
  "RESET",
  "REVOKE",
  "ROLLBACK",
  "SAVEPOINT",
  "SECURITY",
  "SELECT",
  "SET",
  "SHOW",
  "START",
  "TABLE",
  "TRUNCATE",
  "UNLISTEN",
  "UPDATE",
  "VACUUM",
  "VALUES",
  "WITH",
]);

export function tokenLoc(first: Token, last: Token = first): SourceLocation {
  const lines = last.raw.split("\n");
  const endLine = last.line + lines.length - 1;
  const endColumn =
    lines.length > 1 ? lines[lines.length - 1].length + 1 : last.col + last.raw.length;
  return { line: first.line, column: first.col, endLine, endColumn };
}

function isWord(t: Token | undefined, ...words: string[]): boolean {
  return !!t && t.type === "word" && words.includes(t.upper);
}
function isPunct(t: Token | undefined, p: string): boolean {
  return !!t && t.type === "punct" && t.value === p;
}

function identValue(t: Token): string {
  return t.type === "qident" ? t.value : t.value.toLowerCase();
}

function makeName(schema: string | null, name: string): QualifiedName {
  const s = schema ?? "public";
  return {
    schema,
    name,
    key: `${s}.${name}`,
    display: schema ? `${schema}.${name}` : name,
  };
}

class Cursor {
  constructor(
    public tokens: Token[],
    public pos = 0,
  ) {}
  peek(o = 0): Token | undefined {
    return this.tokens[this.pos + o];
  }
  done(): boolean {
    return this.pos >= this.tokens.length;
  }
  next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  acceptWord(...words: string[]): Token | undefined {
    const t = this.peek();
    if (isWord(t, ...words)) {
      this.pos++;
      return t;
    }
    return undefined;
  }
  acceptSeq(...words: string[]): boolean {
    for (let k = 0; k < words.length; k++) {
      if (!isWord(this.peek(k), words[k])) return false;
    }
    this.pos += words.length;
    return true;
  }
  isIdent(t: Token | undefined): boolean {
    return !!t && (t.type === "word" || t.type === "qident");
  }
  /** Parse [schema.]name (also tolerates db.schema.name by keeping last two parts). */
  parseName(): QualifiedName | null {
    const parts: string[] = [];
    const t = this.peek();
    if (!this.isIdent(t)) return null;
    parts.push(identValue(this.next()!));
    while (isPunct(this.peek(), ".") && this.isIdent(this.peek(1))) {
      this.pos++;
      parts.push(identValue(this.next()!));
    }
    if (parts.length === 1) return makeName(null, parts[0]);
    return makeName(parts[parts.length - 2], parts[parts.length - 1]);
  }
  /** Skip a balanced parenthesized group starting at current "(". */
  skipParens(): void {
    if (!isPunct(this.peek(), "(")) return;
    let depth = 0;
    while (!this.done()) {
      const t = this.next()!;
      if (isPunct(t, "(")) depth++;
      else if (isPunct(t, ")")) {
        depth--;
        if (depth === 0) return;
      }
    }
  }
}

/** Split tokens of a file into statements on top-level semicolons. */
function splitStatements(tokens: Token[]): { stmts: Token[][]; comments: Token[] } {
  const stmts: Token[][] = [];
  const comments: Token[] = [];
  let cur: Token[] = [];
  let atomicDepth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === "comment" || t.type === "meta") {
      comments.push(t);
      continue;
    }
    // SQL-standard function bodies: BEGIN ATOMIC ... END contain semicolons.
    if (t.type === "word") {
      if (t.upper === "ATOMIC" && cur.length > 0 && isWord(cur[cur.length - 1], "BEGIN"))
        atomicDepth++;
      else if (atomicDepth > 0 && t.upper === "CASE") atomicDepth++;
      else if (atomicDepth > 0 && t.upper === "END") atomicDepth--;
    }
    if (isPunct(t, ";") && atomicDepth === 0) {
      if (cur.length > 0) stmts.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length > 0) stmts.push(cur);
  return { stmts, comments };
}

/** Split tokens at top-level commas (depth 0). */
function splitTopLevel(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (isPunct(t, "(") || isPunct(t, "[")) depth++;
    else if (isPunct(t, ")") || isPunct(t, "]")) depth--;
    if (depth === 0 && isPunct(t, ",")) {
      out.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Find index of a word at paren depth 0. */
function findTopLevelWord(tokens: Token[], word: string, from = 0): number {
  let depth = 0;
  for (let k = from; k < tokens.length; k++) {
    const t = tokens[k];
    if (isPunct(t, "(")) depth++;
    else if (isPunct(t, ")")) depth--;
    else if (depth === 0 && isWord(t, word)) return k;
  }
  return -1;
}

function containsWordSeq(tokens: Token[], ...words: string[]): boolean {
  for (let k = 0; k + words.length <= tokens.length; k++) {
    let ok = true;
    for (let w = 0; w < words.length; w++) {
      if (!isWord(tokens[k + w], words[w])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

const CONSTRAINT_STARTERS = ["CONSTRAINT", "UNIQUE", "PRIMARY", "FOREIGN", "CHECK", "EXCLUDE"];

function parseAlterAction(tokens: Token[]): AlterAction {
  const c = new Cursor(tokens);
  const first = tokens[0];
  const loc = tokenLoc(first, tokens[tokens.length - 1]);

  if (c.acceptWord("ADD")) {
    const hasColumnKw = !!c.acceptWord("COLUMN");
    if (!hasColumnKw && isWord(c.peek(), ...CONSTRAINT_STARTERS)) {
      let constraintName: string | null = null;
      if (c.acceptWord("CONSTRAINT")) {
        const nt = c.next();
        if (nt) constraintName = identValue(nt);
      }
      const typeTok = c.peek();
      let constraintType:
        "unique" | "primary_key" | "foreign_key" | "check" | "exclude" | "unknown" = "unknown";
      if (isWord(typeTok, "UNIQUE")) constraintType = "unique";
      else if (isWord(typeTok, "PRIMARY")) constraintType = "primary_key";
      else if (isWord(typeTok, "FOREIGN")) constraintType = "foreign_key";
      else if (isWord(typeTok, "CHECK")) constraintType = "check";
      else if (isWord(typeTok, "EXCLUDE")) constraintType = "exclude";
      let references: QualifiedName | null = null;
      const refIdx = tokens.findIndex((t) => isWord(t, "REFERENCES"));
      if (refIdx >= 0) references = new Cursor(tokens, refIdx + 1).parseName();
      return {
        type: "add_constraint",
        constraintName,
        constraintType,
        notValid: containsWordSeq(tokens, "NOT", "VALID"),
        usingIndex: containsWordSeq(tokens, "USING", "INDEX"),
        references,
        loc,
      };
    }
    const ifNotExists = c.acceptSeq("IF", "NOT", "EXISTS");
    const colTok = c.next();
    const column = colTok ? identValue(colTok) : "";
    const rest = tokens.slice(c.pos);
    const defIdx = findTopLevelWord(rest, "DEFAULT");
    let defaultTokens: Token[] = [];
    if (defIdx >= 0) {
      // Default expression runs until the next constraint keyword at depth 0.
      const stop = [
        "NOT",
        "NULL",
        "CONSTRAINT",
        "CHECK",
        "UNIQUE",
        "PRIMARY",
        "REFERENCES",
        "GENERATED",
        "COLLATE",
      ];
      let depth = 0;
      for (let k = defIdx + 1; k < rest.length; k++) {
        const t = rest[k];
        if (isPunct(t, "(")) depth++;
        else if (isPunct(t, ")")) depth--;
        if (depth === 0 && t.type === "word" && stop.includes(t.upper) && k > defIdx + 1) break;
        defaultTokens.push(t);
      }
    }
    let references: QualifiedName | null = null;
    const refIdx = rest.findIndex((t) => isWord(t, "REFERENCES"));
    if (refIdx >= 0) references = new Cursor(rest, refIdx + 1).parseName();
    // NOT NULL at top level that isn't part of the default expression.
    let notNull = false;
    let depth = 0;
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k];
      if (isPunct(t, "(")) depth++;
      else if (isPunct(t, ")")) depth--;
      if (
        depth === 0 &&
        isWord(t, "NOT") &&
        isWord(rest[k + 1], "NULL") &&
        !defaultTokens.includes(t)
      )
        notNull = true;
    }
    const primaryKey = containsWordSeq(rest, "PRIMARY", "KEY");
    return {
      type: "add_column",
      column,
      notNull: notNull || primaryKey,
      hasDefault: defIdx >= 0,
      defaultTokens,
      generated: containsWordSeq(rest, "GENERATED"),
      references,
      unique: findTopLevelWord(rest, "UNIQUE") >= 0,
      primaryKey,
      ifNotExists,
      loc,
    };
  }

  if (c.acceptWord("DROP")) {
    if (c.acceptWord("CONSTRAINT")) {
      c.acceptSeq("IF", "EXISTS");
      const nt = c.next();
      return { type: "drop_constraint", constraintName: nt ? identValue(nt) : "", loc };
    }
    const hadColumn = !!c.acceptWord("COLUMN");
    if (
      hadColumn ||
      (c.isIdent(c.peek()) && !isWord(c.peek(), "DEFAULT", "NOT", "IDENTITY", "EXPRESSION"))
    ) {
      const ifExists = c.acceptSeq("IF", "EXISTS");
      const nt = c.next();
      return {
        type: "drop_column",
        column: nt ? identValue(nt) : "",
        ifExists,
        cascade: containsWordSeq(tokens, "CASCADE"),
        loc,
      };
    }
    return { type: "other", keyword: "DROP", loc };
  }

  if (c.acceptWord("ALTER")) {
    c.acceptWord("COLUMN");
    const colTok = c.next();
    const column = colTok ? identValue(colTok) : "";
    if (c.acceptSeq("SET", "DATA", "TYPE") || c.acceptWord("TYPE")) {
      const rest = tokens.slice(c.pos);
      const usingIdx = findTopLevelWord(rest, "USING");
      const typeToks = usingIdx >= 0 ? rest.slice(0, usingIdx) : rest;
      const collIdx = typeToks.findIndex((t) => isWord(t, "COLLATE"));
      const newType = (collIdx >= 0 ? typeToks.slice(0, collIdx) : typeToks)
        .map((t) => t.raw)
        .join(" ");
      return { type: "alter_column_type", column, hasUsing: usingIdx >= 0, newType, loc };
    }
    if (c.acceptSeq("SET", "NOT", "NULL")) return { type: "set_not_null", column, loc };
    return { type: "other", keyword: "ALTER COLUMN", loc };
  }

  if (c.acceptSeq("SET", "TABLESPACE")) return { type: "set_tablespace", loc };
  if (c.acceptSeq("VALIDATE", "CONSTRAINT")) return { type: "validate_constraint", loc };
  if (c.acceptWord("RENAME")) return { type: "rename", loc };
  return { type: "other", keyword: first?.upper ?? "", loc };
}

function parseWhere(tokens: Token[], from: number) {
  const whereIdx = findTopLevelWord(tokens, "WHERE", from);
  if (whereIdx < 0) return { hasWhere: false, whereTokens: [] as Token[], whereCurrentOf: false };
  let end = tokens.length;
  const ret = findTopLevelWord(tokens, "RETURNING", whereIdx);
  if (ret >= 0) end = ret;
  const whereTokens = tokens.slice(whereIdx + 1, end);
  return {
    hasWhere: true,
    whereTokens,
    whereCurrentOf: isWord(whereTokens[0], "CURRENT") && isWord(whereTokens[1], "OF"),
  };
}

/** For WITH ... <verb>, locate the main verb at depth 0 after the CTE list. */
function skipWith(tokens: Token[]): number {
  let depth = 0;
  for (let k = 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (isPunct(t, "(")) depth++;
    else if (isPunct(t, ")")) depth--;
    else if (
      depth === 0 &&
      isWord(t, "UPDATE", "DELETE", "INSERT", "SELECT", "MERGE") &&
      isPunct(tokens[k - 1], ")")
    )
      return k;
  }
  return 0;
}

export function parseStatementTokens(tokens: Token[]): ParsedStatement {
  let start = 0;
  if (isWord(tokens[0], "WITH")) start = skipWith(tokens);
  const c = new Cursor(tokens, start);
  const head = c.peek();
  if (!head || head.type !== "word") return { kind: "other", keyword: head?.raw ?? "" };

  switch (head.upper) {
    case "BEGIN":
    case "START":
      return { kind: "begin" };
    case "COMMIT":
    case "END":
      return { kind: "commit" };
    case "ROLLBACK":
    case "ABORT":
      if (isWord(tokens[1], "TO")) return { kind: "other", keyword: "ROLLBACK TO" };
      return { kind: "rollback" };
  }

  if (c.acceptWord("CREATE")) {
    c.acceptSeq("OR", "REPLACE");
    const unique = !!c.acceptWord("UNIQUE");
    if (c.acceptWord("INDEX")) {
      const concurrently = !!c.acceptWord("CONCURRENTLY");
      const ifNotExists = c.acceptSeq("IF", "NOT", "EXISTS");
      let name: QualifiedName | null = null;
      if (!isWord(c.peek(), "ON")) name = c.parseName();
      c.acceptWord("ON");
      c.acceptWord("ONLY");
      const table = c.parseName() ?? makeName(null, "?");
      return { kind: "create_index", name, table, unique, concurrently, ifNotExists };
    }
    c.acceptWord("GLOBAL", "LOCAL");
    const temporary = !!c.acceptWord("TEMP", "TEMPORARY");
    c.acceptWord("UNLOGGED");
    if (c.acceptWord("TABLE")) {
      const ifNotExists = c.acceptSeq("IF", "NOT", "EXISTS");
      const table = c.parseName() ?? makeName(null, "?");
      const references: QualifiedName[] = [];
      tokens.forEach((t, k) => {
        if (isWord(t, "REFERENCES")) {
          const r = new Cursor(tokens, k + 1).parseName();
          if (r) references.push(r);
        }
      });
      const asSelect = findTopLevelWord(tokens, "AS", c.pos) >= 0 && !isPunct(c.peek(), "(");
      return { kind: "create_table", table, ifNotExists, temporary, asSelect, references };
    }
    return { kind: "other", keyword: "CREATE " + (c.peek()?.upper ?? "") };
  }

  if (c.acceptWord("DROP")) {
    let objectType = "";
    if (c.acceptSeq("MATERIALIZED", "VIEW")) objectType = "MATERIALIZED VIEW";
    else {
      const t = c.next();
      objectType = t?.upper ?? "";
    }
    const concurrently = !!c.acceptWord("CONCURRENTLY");
    const ifExists = c.acceptSeq("IF", "EXISTS");
    const names: QualifiedName[] = [];
    if (
      ["TABLE", "INDEX", "SCHEMA", "VIEW", "MATERIALIZED VIEW", "SEQUENCE", "TYPE"].includes(
        objectType,
      )
    ) {
      while (!c.done()) {
        const nm = c.parseName();
        if (!nm) break;
        names.push(objectType === "SCHEMA" ? makeName(null, nm.name) : nm);
        if (isPunct(c.peek(), ",")) c.next();
        else break;
      }
    }
    return {
      kind: "drop",
      objectType,
      names,
      ifExists,
      cascade: containsWordSeq(tokens, "CASCADE"),
      concurrently,
    };
  }

  if (c.acceptWord("ALTER")) {
    if (c.acceptWord("TABLE")) {
      const ifExists = c.acceptSeq("IF", "EXISTS");
      c.acceptWord("ONLY");
      const table = c.parseName() ?? makeName(null, "?");
      if (c.peek()?.value === "*") c.next();
      const rest = tokens.slice(c.pos);
      const actions = rest.length
        ? splitTopLevel(rest)
            .filter((a) => a.length > 0)
            .map(parseAlterAction)
        : [];
      return { kind: "alter_table", table, ifExists, actions };
    }
    return { kind: "other", keyword: "ALTER " + (c.peek()?.upper ?? "") };
  }

  if (c.acceptWord("TRUNCATE")) {
    c.acceptWord("TABLE");
    c.acceptWord("ONLY");
    const tables: QualifiedName[] = [];
    while (!c.done()) {
      const nm = c.parseName();
      if (!nm) break;
      tables.push(nm);
      if (c.peek()?.value === "*") c.next();
      if (isPunct(c.peek(), ",")) c.next();
      else break;
    }
    return { kind: "truncate", tables, cascade: containsWordSeq(tokens, "CASCADE") };
  }

  if (c.acceptWord("UPDATE")) {
    c.acceptWord("ONLY");
    const table = c.parseName() ?? makeName(null, "?");
    return { kind: "update", table, ...parseWhere(tokens, c.pos) };
  }

  if (c.acceptWord("DELETE")) {
    c.acceptWord("FROM");
    c.acceptWord("ONLY");
    const table = c.parseName() ?? makeName(null, "?");
    return { kind: "delete", table, ...parseWhere(tokens, c.pos) };
  }

  if (c.acceptWord("REINDEX")) {
    if (isPunct(c.peek(), "(")) c.skipParens();
    const target = c.next()?.upper ?? "";
    const concurrently = !!c.acceptWord("CONCURRENTLY");
    return { kind: "reindex", target, concurrently, name: c.parseName() };
  }

  if (c.acceptWord("CLUSTER")) {
    c.acceptWord("VERBOSE");
    return { kind: "cluster", table: c.parseName() };
  }

  if (c.acceptWord("VACUUM")) {
    let full = !!c.acceptWord("FULL");
    if (!full && isPunct(c.peek(), "(")) {
      const end = tokens.findIndex((t, k) => k > c.pos && isPunct(t, ")"));
      full = tokens.slice(c.pos, end).some((t) => isWord(t, "FULL"));
    }
    return { kind: "vacuum", full };
  }

  if (c.acceptSeq("REFRESH", "MATERIALIZED", "VIEW")) {
    return { kind: "refresh_matview", concurrently: !!c.acceptWord("CONCURRENTLY") };
  }

  return { kind: "other", keyword: head.upper };
}

function checkSyntax(tokens: Token[]): { message: string; loc: SourceLocation }[] {
  const errs: { message: string; loc: SourceLocation }[] = [];
  const stack: Token[] = [];
  for (const t of tokens) {
    if (isPunct(t, "(")) stack.push(t);
    else if (isPunct(t, ")")) {
      if (!stack.pop()) errs.push({ message: "Unmatched closing parenthesis", loc: tokenLoc(t) });
    }
  }
  for (const t of stack) errs.push({ message: "Unclosed parenthesis", loc: tokenLoc(t) });
  const head = tokens[0];
  if (head && !(head.type === "word" && KNOWN_COMMANDS.has(head.upper)) && !isPunct(head, "(")) {
    errs.push({
      message: `Unrecognized statement starting with ${JSON.stringify(head.raw.slice(0, 40))}`,
      loc: tokenLoc(head),
    });
  }
  return errs;
}

export function parseFile(path: string, source: string): ParsedFile {
  const { tokens, errors } = tokenize(source);
  const { stmts, comments } = splitStatements(tokens);
  const statements: Statement[] = [];
  let prevEnd = -1;
  stmts.forEach((toks, index) => {
    const first = toks[0];
    const last = toks[toks.length - 1];
    const lastLine = tokenLoc(last).endLine;
    const leadingComments = comments.filter((cm) => cm.start > prevEnd && cm.start < first.start);
    const trailingComments = comments.filter(
      (cm) => cm.start > first.start && (cm.start < last.end || cm.line === lastLine),
    );
    statements.push({
      index,
      tokens: toks,
      leadingComments,
      trailingComments,
      text: source.slice(first.start, last.end),
      loc: tokenLoc(first, last),
      parsed: parseStatementTokens(toks),
      syntaxErrors: checkSyntax(toks),
    });
    prevEnd = last.end;
  });
  return {
    path,
    source,
    statements,
    comments,
    lexErrors: errors,
    empty: statements.length === 0,
  };
}
