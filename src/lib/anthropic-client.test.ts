// The one behavioural claim this refactor makes (Issue #74, closes #57):
// the client is shared rather than rebuilt per call. Everything else in
// this unit is refactor-only and proven by the existing suite staying
// green — this is the one thing the existing suite could not have caught,
// because nothing before now asserted the identity.
import { describe, expect, it } from "vitest";
import { sharedAnthropicClient } from "./anthropic-client";

describe("sharedAnthropicClient", () => {
  it("returns the same instance every call", () => {
    expect(sharedAnthropicClient()).toBe(sharedAnthropicClient());
  });

  it("constructs without an API key present", () => {
    // The keyless-dev-machine property this whole codebase relies on: the
    // SDK resolves credentials at request time, not construction, so
    // importing and calling this on a box with no key (this one, and CI)
    // must not throw. If that ever changes, every test and the build break
    // at import — this fails first, and says why.
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => sharedAnthropicClient()).not.toThrow();
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
