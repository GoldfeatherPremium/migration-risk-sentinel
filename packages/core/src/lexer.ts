/**
 * PostgreSQL-aware lexer.
 *
 * Understands the parts of PostgreSQL lexical structure that matter for safe
 * statement splitting and classification: single-quoted strings (including
 * E'', B'', X'', U&'' prefixes), dollar-quoted strings ($$ / $tag$), quoted
 * identifiers, nested block comments, line comments, positional parameters,
 * numbers, operators and punctuation. Every token carries 1-based line and
 * column positions so findings can point at exact source locations.
 */

export type TokenType =
  | "word"
  | "qident"
  | "string"
  | "number"
  | "param"
  | "punct"
  | "op"
  | "comment"
  | "meta";

export interface Token {
  type: TokenType;
  /** Normalized value: identifiers unquoted, strings without quotes. */
  value: string;
  /** Upper-cased value for word tokens (keywords / unquoted identifiers). */
  upper: string;
  /** Raw source slice. */
  raw: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

export interface LexError {
  message: string;
  line: number;
  col: number;
}

export interface LexResult {
  tokens: Token[];
  errors: LexError[];
}

const OP_CHARS = new Set("+-*/<>=~!@#%^&|`?".split(""));
const PUNCT_CHARS = new Set("(),;[].:".split(""));

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}
function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

export function tokenize(src: string): LexResult {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  const advance = (to: number) => {
    for (let k = i; k < to && k < n; k++) {
      if (src[k] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    i = Math.min(to, n);
  };

  const push = (type: TokenType, start: number, end: number, value: string, sl: number, sc: number) => {
    const raw = src.slice(start, end);
    tokens.push({
      type,
      value,
      upper: type === "word" ? value.toUpperCase() : value,
      raw,
      start,
      end,
      line: sl,
      col: sc,
    });
  };

  // Track whether we're at the start of a line (for psql meta-commands).
  let atLineStart = true;

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    const sl = line;
    const sc = col;
    const start = i;

    // Whitespace
    if (/\s/.test(ch)) {
      if (ch === "\n") atLineStart = true;
      advance(i + 1);
      continue;
    }

    // psql meta-command (e.g. \set, \i) at start of a line.
    if (ch === "\\" && atLineStart) {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      push("meta", start, j, src.slice(start, j), sl, sc);
      advance(j);
      continue;
    }
    atLineStart = false;

    // Line comment
    if (ch === "-" && next === "-") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      push("comment", start, j, src.slice(i + 2, j), sl, sc);
      advance(j);
      continue;
    }

    // Block comment (nesting allowed in PostgreSQL)
    if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === "/" && src[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (src[j] === "*" && src[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      if (depth > 0) {
        errors.push({ message: "Unterminated block comment", line: sl, col: sc });
      }
      push("comment", start, j, src.slice(i + 2, Math.max(i + 2, j - 2)), sl, sc);
      advance(j);
      continue;
    }

    // String literal with optional prefix: E'..', B'..', X'..', N'..', U&'..'
    {
      let prefixLen = 0;
      if ((ch === "E" || ch === "e" || ch === "B" || ch === "b" || ch === "X" || ch === "x" || ch === "N" || ch === "n") && next === "'") {
        prefixLen = 1;
      } else if ((ch === "U" || ch === "u") && next === "&" && src[i + 2] === "'") {
        prefixLen = 2;
      }
      if (ch === "'" || prefixLen > 0) {
        const backslashEscapes = prefixLen === 1 && (ch === "E" || ch === "e");
        let j = i + prefixLen + 1;
        let value = "";
        let closed = false;
        while (j < n) {
          const c = src[j];
          if (backslashEscapes && c === "\\") {
            value += src.slice(j, j + 2);
            j += 2;
            continue;
          }
          if (c === "'") {
            if (src[j + 1] === "'") {
              value += "'";
              j += 2;
              continue;
            }
            closed = true;
            j++;
            break;
          }
          value += c;
          j++;
        }
        if (!closed) errors.push({ message: "Unterminated string literal", line: sl, col: sc });
        push("string", start, j, value, sl, sc);
        advance(j);
        continue;
      }
    }

    // Dollar-quoted string or positional parameter
    if (ch === "$") {
      if (/[0-9]/.test(next ?? "")) {
        let j = i + 1;
        while (j < n && /[0-9]/.test(src[j])) j++;
        push("param", start, j, src.slice(start, j), sl, sc);
        advance(j);
        continue;
      }
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 256));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const close = src.indexOf(tag, bodyStart);
        let j: number;
        let value: string;
        if (close === -1) {
          errors.push({ message: `Unterminated dollar-quoted string ${tag}`, line: sl, col: sc });
          j = n;
          value = src.slice(bodyStart);
        } else {
          j = close + tag.length;
          value = src.slice(bodyStart, close);
        }
        push("string", start, j, value, sl, sc);
        advance(j);
        continue;
      }
    }

    // Quoted identifier
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += src[j];
        j++;
      }
      if (!closed) errors.push({ message: "Unterminated quoted identifier", line: sl, col: sc });
      push("qident", start, j, value, sl, sc);
      advance(j);
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(next ?? ""))) {
      const m = /^(\d[\d_]*)?(\.\d*)?([eE][+-]?\d+)?/.exec(src.slice(i));
      const len = m && m[0].length > 0 ? m[0].length : 1;
      push("number", start, i + len, src.slice(i, i + len), sl, sc);
      advance(i + len);
      continue;
    }

    // Words (keywords / unquoted identifiers)
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j])) j++;
      push("word", start, j, src.slice(start, j), sl, sc);
      advance(j);
      continue;
    }

    // Typecast operator
    if (ch === ":" && next === ":") {
      push("op", start, i + 2, "::", sl, sc);
      advance(i + 2);
      continue;
    }

    if (PUNCT_CHARS.has(ch)) {
      push("punct", start, i + 1, ch, sl, sc);
      advance(i + 1);
      continue;
    }

    if (OP_CHARS.has(ch)) {
      let j = i + 1;
      while (j < n && OP_CHARS.has(src[j]) && !(src[j] === "-" && src[j + 1] === "-") && !(src[j] === "/" && src[j + 1] === "*")) j++;
      push("op", start, j, src.slice(start, j), sl, sc);
      advance(j);
      continue;
    }

    errors.push({ message: `Unexpected character ${JSON.stringify(ch)}`, line: sl, col: sc });
    advance(i + 1);
  }

  return { tokens, errors };
}
