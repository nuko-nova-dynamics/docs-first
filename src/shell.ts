// Shell parsing: small and quote-aware, enough to read package-manager and fetch commands.

/** What joins a simple command to the one before it. Only `&&` means "runs only if the previous one succeeded". */
export type Connector = "start" | "&&" | "||" | ";" | "|" | "&" | "newline" | "substitution";

/**
 * One simple command of a command line: its text, the connector before it, and whether it runs inside
 * a `$(...)`, backticks or an expanded heredoc, where its exit status decides nothing outside.
 */
export type Segment = { text: string; after: Connector; nested: boolean };

type Heredoc = { delimiter: string; quoted: boolean; dash: boolean };

// `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`: the delimiter is a whole shell word, dots and all.
const HEREDOC_RE = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()'"`]+))/;

function heredocAt(src: string, i: number): { length: number; heredoc: Heredoc } | null {
  if (src[i] !== "<" || src[i + 1] !== "<" || src[i + 2] === "<") return null;
  const m = src.slice(i).match(HEREDOC_RE);
  const delimiter = m?.[2] ?? m?.[3] ?? m?.[4] ?? "";
  if (!m || !delimiter) return null;
  return { length: m[0].length, heredoc: { delimiter, quoted: m[2] !== undefined || m[3] !== undefined, dash: m[1] === "-" } };
}

/**
 * Skips the bodies of the heredocs pending at the newline at `i`. Returns the index of the last character
 * consumed, and the bodies the shell expands (unquoted delimiters), whose substitutions run.
 */
function skipHeredocs(src: string, i: number, pending: Heredoc[]): { end: number; expanded: string[] } {
  const expanded: string[] = [];
  let pos = i;
  for (const doc of pending) {
    const lines: string[] = [];
    while (pos < src.length) {
      const next = src.indexOf("\n", pos + 1);
      const line = src.slice(pos + 1, next < 0 ? src.length : next);
      pos = next < 0 ? src.length : next;
      if ((doc.dash ? line.replace(/^\t+/, "") : line) === doc.delimiter) break;
      lines.push(line);
    }
    if (!doc.quoted) expanded.push(lines.join("\n"));
  }
  pending.length = 0;
  return { end: pos, expanded };
}

/** The index of the parenthesis that closes a `$(...)` whose body starts at `start`; heredoc bodies inside are skipped. */
function substitutionEnd(src: string, start: number): number {
  let depth = 1;
  let quote = "";
  const pending: Heredoc[] = [];
  for (let j = start; j < src.length; j += 1) {
    const ch = src[j];
    if (quote) {
      if (ch === "\\" && quote === "\"") j += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\\") { j += 1; continue; }
    if (ch === "'" || ch === "\"") { quote = ch; continue; }
    const doc = heredocAt(src, j);
    if (doc) { pending.push(doc.heredoc); j += doc.length - 1; continue; }
    if (ch === "\n" && pending.length) { j = skipHeredocs(src, j, pending).end; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")" && --depth === 0) return j;
  }
  return src.length;
}

/** The index of the backtick that closes one opened at `start`. */
function backtickEnd(src: string, start: number): number {
  let j = start + 1;
  while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
  return j;
}

/**
 * Splits a command line into simple commands at `&&`, `||`, `;`, `|`, `&` and newlines. The bodies of
 * `$(...)` and backticks, quoted or not, and of those inside unquoted heredocs, become commands of their
 * own, since the shell runs them. Comments and quoted heredoc bodies are data and are skipped.
 */
export function segments(command: string, nested = false): Segment[] {
  const out: Segment[] = [];
  const src = String(command || "");
  let cur = "";
  let quote = "";
  let pending: Connector = "start";
  const heredocs: Heredoc[] = [];
  // Ends the current command. A blank or comment line keeps the connector before it, so `a &&` + newline + `b` stays chained.
  const end = (next: Connector) => {
    if (cur.trim()) { out.push({ text: cur.trim(), after: pending, nested }); pending = next; }
    else if (next !== "newline") pending = next;
    cur = "";
  };
  const substitute = (body: string) => {
    segments(body, true).forEach((s, k) => out.push({ ...s, after: k === 0 ? "substitution" : s.after, nested: true }));
  };
  // The substitutions an expanded heredoc body runs.
  const expand = (body: string) => {
    for (let k = 0; k < body.length; k += 1) {
      if (body[k] === "\\") { k += 1; continue; }
      if (body[k] === "$" && body[k + 1] === "(") { const close = substitutionEnd(body, k + 2); substitute(body.slice(k + 2, close)); k = close; }
      else if (body[k] === "`") { const close = backtickEnd(body, k); substitute(body.slice(k + 1, close)); k = close; }
    }
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";
    if (quote === "'") {
      cur += ch;
      if (ch === "'") quote = "";
      continue;
    }
    if (ch === "\\") { cur += ch + next; i += 1; continue; }
    if (ch === "$" && next === "(") {
      const close = substitutionEnd(src, i + 2);
      substitute(src.slice(i + 2, close));
      i = close;
      continue;
    }
    if (ch === "`") {
      const close = backtickEnd(src, i);
      substitute(src.slice(i + 1, close));
      i = close;
      continue;
    }
    if (quote === "\"") {
      cur += ch;
      if (ch === "\"") quote = "";
      continue;
    }
    if (ch === "'" || ch === "\"") { quote = ch; cur += ch; continue; }
    // A comment runs to the end of its line; a `#` inside a word (a URL fragment) is not one.
    if (ch === "#" && (cur === "" || /\s$/.test(cur))) {
      const nl = src.indexOf("\n", i);
      i = (nl < 0 ? src.length : nl) - 1;
      continue;
    }
    const doc = heredocAt(src, i);
    if (doc) { heredocs.push(doc.heredoc); cur += src.slice(i, i + doc.length); i += doc.length - 1; continue; }
    if (ch === "\n") {
      end("newline");
      if (heredocs.length) {
        const skipped = skipHeredocs(src, i, heredocs);
        skipped.expanded.forEach(expand);
        i = skipped.end;
      }
      continue;
    }
    if (ch === "&" && next === "&") { end("&&"); i += 1; continue; }
    if (ch === "|" && next === "|") { end("||"); i += 1; continue; }
    // A lone `&` backgrounds the command before it; `2>&1` and `&>file` are redirections, not separators.
    if (ch === "&" && next !== ">" && src[i - 1] !== ">" && src[i - 1] !== "<") { end("&"); continue; }
    if (ch === ";") { end(";"); continue; }
    if (ch === "|") { end("|"); continue; }
    cur += ch;
  }
  end("start");
  return out;
}

/** The simple commands of a command line, as text. */
export function splitShell(command: string): string[] {
  return segments(command).map((s) => s.text);
}

// A redirection operator alone (`>`, `2>>`, `&>`), whose target is the next word.
const REDIRECT_ALONE_RE = /^(\d*|&)[<>]{1,2}$/;
// A redirection with its target attached (`2>&1`, `>/dev/null`, `2>err.log`).
const REDIRECT_ATTACHED_RE = /^(\d*|&)[<>]{1,2}\S/;
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Commands that run the command after them, and their flags that take a value.
const WRAPPERS = new Set(["sudo", "env", "command", "exec", "time", "nohup", "nice"]);
const WRAPPER_VALUE_FLAGS = new Set(["-u", "-g", "-C", "-n", "-S"]);

/**
 * Splits one simple command into words, dropping redirections, leading `VAR=value` assignments,
 * and wrappers such as `sudo` and `env`, so the first word is the program that runs.
 */
export function tokenize(segment: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  let skipTarget = false;
  while ((m = re.exec(segment))) {
    const bare = m[3];
    if (skipTarget) { skipTarget = false; continue; }
    if (bare !== undefined && REDIRECT_ALONE_RE.test(bare)) { skipTarget = true; continue; }
    if (bare !== undefined && REDIRECT_ATTACHED_RE.test(bare)) continue;
    out.push(m[1] ?? m[2] ?? bare ?? "");
  }
  for (;;) {
    while (out.length && ASSIGNMENT_RE.test(out[0] ?? "")) out.shift();
    const word = out[0] ?? "";
    if (!WRAPPERS.has(word)) break;
    // `command -v` and `command -V` only describe a command; they run nothing.
    if (word === "command" && (out[1] === "-v" || out[1] === "-V")) break;
    out.shift();
    while ((out[0] ?? "").startsWith("-")) {
      const flag = out.shift() ?? "";
      if (WRAPPER_VALUE_FLAGS.has(flag)) out.shift();
    }
  }
  return out;
}

/** The program name of a tokenized command, without its directory. */
export function head(tokens: readonly string[]): string {
  return (tokens[0] || "").replace(/^.*\//, "");
}

/**
 * A simple command's words; whether it runs only when the command before it succeeded; and whether it
 * runs nested inside a substitution, where its failure does not stop the commands outside.
 */
export type Step = { tokens: string[]; chained: boolean; nested: boolean };

/** The simple commands of a command line, tokenized, skipping empty ones. */
export function commands(command: string): Step[] {
  return segments(command)
    .map((s) => ({ tokens: tokenize(s.text), chained: s.after === "&&", nested: s.nested }))
    .filter((s) => s.tokens.length > 0);
}
