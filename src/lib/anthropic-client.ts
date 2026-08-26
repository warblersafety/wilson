// One Anthropic client for the process (Issue #74, closes #57).
//
// createExtractFn() and createNarrativeExtractFn() each default-construct
// their own, and src/app/actions.ts calls those per Server Action — so
// every turn built a fresh client, discarding the SDK's connection pooling
// and re-reading credentials each time. The client is a stateless wrapper
// over HTTP with its own pooling and retry config; sharing one is the
// SDK's own documented default usage, and on a warm serverless instance it
// is the difference between reusing a connection and opening one per turn.
//
// Lazy rather than a module-level `new Anthropic()`: constructing at import
// time would run on every module graph load, including the test and build
// paths that never make a request. `new Anthropic()` does NOT throw without
// an API key (verified against the installed SDK — it resolves credentials
// at request time), so this is about not doing pointless work at import,
// not about avoiding a crash on a keyless machine.
//
// The `client` parameter on both factories stays: it is how the tests
// inject a client with a fake key, and this function is only what the
// DEFAULT resolves to.
import Anthropic from "@anthropic-ai/sdk";

let shared: Anthropic | undefined;

export function sharedAnthropicClient(): Anthropic {
  shared ??= new Anthropic();
  return shared;
}
