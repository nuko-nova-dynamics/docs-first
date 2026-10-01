// Test support for the *.spec.ts files: an in-memory project and import-line builders.

import type { ProjectFiles } from "./model.ts";

/** A project in memory: file paths map to their text; a path that only prefixes others is a directory. */
export function fakeFiles(tree: Record<string, string>): ProjectFiles {
  return {
    read: async (path) => (path in tree ? tree[path] : null),
    exists: async (path) => path in tree || Object.keys(tree).some((k) => k.startsWith(`${path}/`))
  };
}

/** A quoted module specifier, so fixture source does not read as this file's own imports. */
export const q = (spec: string) => JSON.stringify(spec);

/** One default-import line for a specifier. */
export const imp = (spec: string) => `import x from ${q(spec)};`;
