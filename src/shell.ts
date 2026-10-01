// Shell parsing: small and quote-aware, enough to read package-manager and fetch commands.

/** What joins a simple command to the one before it. Only `&&` means "runs only if the previous one succeeded". */
export type Connector = "start" | "&&" | "||" | ";" | "|" | "&" | "newline" | "substitution";

/** One simple command of a command line, and the connector before it. */
export type Segment = { text: string; after: Connector };

const HEREDOC_RE = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\2/;

/** The end of a `$(...)` body starting at `start` (just past the parenthesis): the index of its closing parenthesis. */
function substitutionEnd(src: string, start: number): number {
  let depth = 1;
  let quote = "";
  for (let j = start; j < src.length; j += 1) {
    const ch = src[j];
    if (quote) {
      if (ch === "\\" && quote === "\"") { j += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === "\"") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")" && --depth === 0) return j;
  }
  return src.length;
}

/**
 * Splits a command line into simple commands at `&&`, `||`, `;`, `|`, `&` and newlines. The bodies of
 * `$(...)` and backticks, quoted or not, become commands of their own, since the shell runs them.
 * Heredoc bodies are data and are skipped.
 */
export function segments(command: string): Segment[] {
  const out: Segment[] = [];
  const src = String(command || "");
  let cur = "";
  let quote = "";
  let pending: Connector = "start";
  const heredocs: string[] = [];
  // Ends the current command. A blank line keeps the connector before it, so `a &&` + newline + `b` stays chained.
  const end = (next: Connector) => {
    if (cur.trim()) { out.push({ text: cur.trim(), after: pending }); pending = next; }
    else if (next !== "newline") pending = next;
    cur = "";
  };
  const substitute = (body: string) => {
    segments(body).forEach((s, k) => out.push({ text: s.text, after: k === 0 ? "substitution" : s.after }));
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";
    if (quote === "'") {
      cur += ch;
      if (ch === "'") quote = "";
      continue;
    }
    if (ch === "$" && next === "(") {
      const close = substitutionEnd(src, i + 2);
      substitute(src.slice(i + 2, close));
      i = close;
      continue;
    }
    if (ch === "`") {
      let close = i + 1;
      while (close < src.length && src[close] !== "`") close += src[close] === "\\" ? 2 : 1;
      substitute(src.slice(i + 1, close));
      i = close;
      continue;
    }
    if (quote === "\"") {
      cur += ch;
      if (ch === "\\") { cur += next; i += 1; continue; }
      if (ch === "\"") quote = "";
      continue;
    }
    if (ch === "'" || ch === "\"") { quote = ch; cur += ch; continue; }
    if (ch === "\\") { cur += ch + next; i += 1; continue; }
    if (ch === "<" && next === "<" && src[i + 2] !== "<") {
      const m = src.slice(i).match(HEREDOC_RE);
      if (m?.[3]) { heredocs.push(m[3]); cur += m[0]; i += m[0].length - 1; continue; }
    }
    if (ch === "\n") {
      end("newline");
      // Skip each pending heredoc body, up to and including its delimiter line.
      while (heredocs.length) {
        const delimiter = heredocs.shift();
        let lineEnd = src.indexOf("\n", i + 1);
        while (true) {
          const line = src.slice(i + 1, lineEnd < 0 ? src.length : lineEnd);
          i = lineEnd < 0 ? src.length : lineEnd;
          if (line.trim() === delimiter || lineEnd < 0) break;
          lineEnd = src.indexOf("\n", i + 1);
        }
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
    if (!WRAPPERS.has(out[0] ?? "")) break;
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

/** A simple command's words, and whether it runs only when the command before it succeeded. */
export type Step = { tokens: string[]; chained: boolean };

/** The simple commands of a command line, tokenized, skipping empty ones. */
export function commands(command: string): Step[] {
  return segments(command)
    .map((s) => ({ tokens: tokenize(s.text), chained: s.after === "&&" }))
    .filter((s) => s.tokens.length > 0);
}
