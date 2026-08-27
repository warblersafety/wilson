// The one behavioural claim this refactor makes (Issue #74, closes #57):
// the client is shared rather than rebuilt per call. Everything else in
// the unit is refactor-only and proven by the existing suite staying
// green — this is the one thing that suite could not have caught, because
// nothing before now asserted the identity.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sharedAnthropicClient } from "./anthropic-client";

describe("sharedAnthropicClient", () => {
  it("returns the same instance every call", () => {
    expect(sharedAnthropicClient()).toBe(sharedAnthropicClient());
  });
});

describe("constructing without an API key", () => {
  // The keyless-dev-machine property this whole codebase relies on: the
  // SDK resolves credentials at request time, not at construction, so
  // importing and calling this on a box with no key (this one, and CI)
  // must not throw.
  //
  // resetModules() and a fresh import are load-bearing, not ceremony
  // (reviewer pass, PR #83, finding 1): the singleton persists for the
  // module's lifetime, so asserting against the already-constructed
  // instance would pass whatever construction does — the first call in
  // the file would have thrown instead, in a test that says nothing about
  // API keys. Re-importing forces the construction to actually happen
  // under the deleted variable, which is the only way this asserts what
  // its name claims.
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not throw when ANTHROPIC_API_KEY is absent", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const fresh = await import("./anthropic-client");
      expect(() => fresh.sharedAnthropicClient()).not.toThrow();
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
