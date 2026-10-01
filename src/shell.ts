// Shell parsing: small and quote-aware, enough to read package-manager and fetch commands.

/** Splits a command line into simple commands at `&&`, `||`, `;`, `|` and newlines; `$(...)` bodies become commands of their own. */
export function splitShell(command: string): string[] {
  const segments: string[] = [];
  let cur = "";
  let quote = "";
  const src = String(command || "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1] || "";
    if (quote) {
      cur += ch;
      if (ch === "\\" && quote === "\"") { cur += next; i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === "\"") { quote = ch; cur += ch; continue; }
    if (ch === "\\") { cur += ch + next; i += 1; continue; }
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) { segments.push(cur); cur = ""; i += 1; continue; }
    // A lone `&` backgrounds the command before it; `2>&1` and `&>file` are redirections, not separators.
    if (ch === "&" && next !== ">" && src[i - 1] !== ">" && src[i - 1] !== "<") { segments.push(cur); cur = ""; continue; }
    if (ch === ";" || ch === "|" || ch === "\n") { segments.push(cur); cur = ""; continue; }
    if (ch === "$" && next === "(") {
      let depth = 1;
      let j = i + 2;
      let body = "";
      while (j < src.length && depth > 0) {
        if (src[j] === "(") depth += 1;
        else if (src[j] === ")") { depth -= 1; if (depth === 0) break; }
        body += src[j];
        j += 1;
      }
      segments.push(...splitShell(body));
      i = j;
      continue;
    }
    cur += ch;
  }
  segments.push(cur);
  return segments.map((s) => s.trim()).filter(Boolean);
}

// A redirection operator alone (`>`, `2>>`, `&>`), whose target is the next word.
const REDIRECT_ALONE_RE = /^(\d*|&)[<>]{1,2}$/;
// A redirection with its target attached (`2>&1`, `>/dev/null`, `2>err.log`).
const REDIRECT_ATTACHED_RE = /^(\d*|&)[<>]{1,2}\S/;

/**
 * Splits one simple command into words, dropping redirections, leading `VAR=value` assignments,
 * and a leading `sudo` or `env`.
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
  while (out.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0] ?? "")) out.shift();
  if (out[0] === "sudo" || out[0] === "env") out.shift();
  return out;
}

/** The program name of a tokenized command, without its directory. */
export function head(tokens: readonly string[]): string {
  return (tokens[0] || "").replace(/^.*\//, "");
}

/** The simple commands of a command line, tokenized, skipping empty ones. */
export function commands(command: string): string[][] {
  return splitShell(command).map(tokenize).filter((t) => t.length > 0);
}
