// Test scaffolding: a Topic built from a shape, with one synthetic ask
// covering every field it names.
//
// A Topic carries the authored asks it voices (topics.ts), because
// talk.ts's Deps lets a caller substitute its own topic list and a global
// inventory lookup would either throw on every synthetic topic or need a
// fallback ask — and ask-copy.md rule 1 admits no fallback. That leaves
// the many suites that drive the WALK against a handful of made-up
// topics (talk, topics, extract, followup-sweep, the prompt builders)
// needing an ask apiece. They are testing traversal, not copy —
// ask-inventory.test.ts and ask.test.ts own the authored inventory — so
// one ask per topic, asking for everything, is exactly the right stand-in.
//
// Imported only by tests; nothing in the app reaches for it.
import type { AuthoredAsk } from "./ask-inventory";
import type { Topic, TopicShape } from "./topics";

export function syntheticAsk(topicId: string, fieldIds: string[]): AuthoredAsk {
  return {
    id: `${topicId}-ask`,
    topicId,
    copy: `synthetic ask for ${topicId}`,
    askFieldIds: fieldIds,
    companionFieldIds: [],
  };
}

export function syntheticTopic(shape: TopicShape): Topic {
  return { ...shape, asks: [syntheticAsk(shape.id, shape.fieldIds)] };
}
