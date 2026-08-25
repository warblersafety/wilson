import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Unit #40 AC-1 — a lock-test for the design tokens: a future edit that
 * references a custom property without declaring it (typo, or a rename that
 * missed a call site) fails here instead of silently rendering unstyled.
 *
 * No jsdom and no CSS parser in the dependency tree (same call lucy made for
 * its own globals.test.ts) — the stylesheets are small and regular, so
 * reading them as text is enough to catch a missing declaration. Comments
 * are stripped first so a name only mentioned in a comment can't satisfy
 * either side of the check.
 */
function readCss(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const BRAND_TOKENS = readCss("src/app/brand-tokens.css");
const GLOBALS = readCss("src/app/globals.css");
const LAYOUT = readCss("src/app/layout.tsx");
const COMBINED = `${BRAND_TOKENS}\n${GLOBALS}`;

/** Every capture-group-1 match of `pattern` across `text`, as a Set. */
function namesMatching(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map((m) => m[1]));
}

const DECLARED_PATTERN = /--([\w-]+)\s*:/g;
const REFERENCED_PATTERN = /var\(--([\w-]+)/g;
// --font-hanken/--font-schibsted are declared outside any stylesheet: Next
// injects them at build time from `localFont({ variable: "--font-x" })` in
// layout.tsx. Read from there rather than hand-listed, so a rename that
// misses a call site still fails this check instead of the allow-list
// quietly covering for it.
const FONT_LOADER_PATTERN = /variable:\s*"--([\w-]+)"/g;

const DECLARED = new Set([
  ...namesMatching(COMBINED, DECLARED_PATTERN),
  ...namesMatching(LAYOUT, FONT_LOADER_PATTERN),
]);

describe("design tokens", () => {
  it("declares every custom property globals.css references", () => {
    const used = namesMatching(GLOBALS, REFERENCED_PATTERN);
    const missing = [...used].filter((name) => !DECLARED.has(name));
    expect(missing).toEqual([]);
  });

  it("carries the semantic tokens the app shell consumes", () => {
    for (const name of ["accent-wilson", "accent-lucy", "font-body", "font-display", "danger"]) {
      expect(DECLARED.has(name), `--${name} is not declared`).toBe(true);
    }
  });

  it("invents a danger color locally rather than adding one to the transcribed file", () => {
    // brand-tokens.css's own header says the upstream palette has none and
    // nothing here was invented — this AC's addition belongs in globals.css.
    expect(BRAND_TOKENS).not.toMatch(/--danger/);
    expect(GLOBALS).toMatch(/--danger:/);
  });
});

describe("self-hosted fonts", () => {
  const files = [
    "src/app/fonts/hanken-grotesk-latin.woff2",
    "src/app/fonts/schibsted-grotesk-latin.woff2",
    "src/app/fonts/OFL-hanken-grotesk.txt",
    "src/app/fonts/OFL-schibsted-grotesk.txt",
  ];

  it.each(files)("%s is present", (relPath) => {
    expect(existsSync(join(process.cwd(), relPath))).toBe(true);
  });

  it.each(["OFL-hanken-grotesk.txt", "OFL-schibsted-grotesk.txt"])(
    "%s is the SIL Open Font License",
    (name) => {
      const text = readFileSync(join(process.cwd(), "src/app/fonts", name), "utf8");
      expect(text).toMatch(/SIL OPEN FONT LICENSE/i);
    },
  );
});
