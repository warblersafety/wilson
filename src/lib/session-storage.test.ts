import { describe, expect, it } from "vitest";
import { initAgenda } from "./agenda";
import { initRepeatCounts } from "./topics";
import { clearSession, loadSession, saveSession, type StorageLike } from "./session-storage";
import type { TalkSession } from "./talk";

// A minimal in-memory StorageLike — proves loadSession/saveSession/
// clearSession need no DOM (tsconfig.node.json's lib list has no "dom"),
// matching the acceptance criteria's "testable without a DOM" requirement.
function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function sessionOf(overrides: Partial<TalkSession> = {}): TalkSession {
  return {
    transcript: [{ role: "talker", text: "hi" }],
    record: initAgenda(),
    repeatCounts: initRepeatCounts(),
    ...overrides,
  };
}

describe("loadSession / saveSession", () => {
  it("round-trips a session through save then load", () => {
    const storage = fakeStorage();
    const session = sessionOf();
    saveSession(storage, session);
    expect(loadSession(storage)).toEqual(session);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSession(fakeStorage())).toBeNull();
  });

  it("returns null, not a throw, on corrupted JSON", () => {
    const storage = fakeStorage();
    storage.setItem("wilson.talk-session.v1", "{not json");
    expect(loadSession(storage)).toBeNull();
  });

  it("returns null, not a throw, on well-formed JSON with the wrong shape", () => {
    const storage = fakeStorage();
    storage.setItem("wilson.talk-session.v1", JSON.stringify({ foo: "bar" }));
    expect(loadSession(storage)).toBeNull();
  });

  it("saveSession overwrites a previously saved session", () => {
    const storage = fakeStorage();
    saveSession(storage, sessionOf());
    const updated = sessionOf({ transcript: [] });
    saveSession(storage, updated);
    expect(loadSession(storage)).toEqual(updated);
  });
});

describe("clearSession", () => {
  it("removes a saved session so loadSession returns null afterward", () => {
    const storage = fakeStorage();
    saveSession(storage, sessionOf());
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });

  it("is a no-op when nothing was saved", () => {
    const storage = fakeStorage();
    expect(() => clearSession(storage)).not.toThrow();
    expect(loadSession(storage)).toBeNull();
  });
});

// --- the pre-confirmation intake draft (Issue #72, closes #56) ------------

import {
  clearIntakeState,
  loadIntakeDraft,
  resolveResumeSurface,
  saveIntakeDraft,
  type IntakeDraft,
} from "./session-storage";
import type { NarrativeExtractResult, NarrativeProposal } from "./narrative-extract";
import type { ReadBackHandoff } from "./start-surface";

function proposalOf(fieldId: string, value: string, quoteText: string): NarrativeProposal {
  return { action: { fieldId, type: "answer", value }, quote: { turnIndex: 0, text: quoteText } };
}

function resultOf(proposals: NarrativeProposal[]): NarrativeExtractResult {
  return { proposals, repeatDecisions: [], rejected: [] };
}

function handoffOf(narrative: string, proposals: NarrativeProposal[]): ReadBackHandoff {
  return { session: sessionOf({ transcript: [] }), narrative, result: resultOf(proposals) };
}

const PROPOSAL_A = proposalOf("Page1.SecA_Patient.AgeValue", "42", "42-year-old");
const PROPOSAL_B = proposalOf("Page1.SecA_Patient.AgeValue", "43", "forty-three");

describe("the Start draft", () => {
  it("round-trips the dictated narrative", () => {
    const storage = fakeStorage();
    const draft: IntakeDraft = { kind: "start", narrative: "42-year-old woman, amoxicillin…" };
    saveIntakeDraft(storage, draft);
    expect(loadIntakeDraft(storage)).toEqual(draft);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadIntakeDraft(fakeStorage())).toBeNull();
  });
});

describe("the Read-back draft", () => {
  it("round-trips the handoff, the open edit, and the collision selections", () => {
    const storage = fakeStorage();
    const handoff = handoffOf("42-year-old woman", [PROPOSAL_A, PROPOSAL_B]);
    saveIntakeDraft(storage, {
      kind: "read-back",
      handoff,
      selectedProposalIndexes: { "Page1.SecA_Patient.AgeValue": 1 },
      editing: true,
      draftNarrative: "42-year-old woman, corrected",
    });
    const loaded = loadIntakeDraft(storage);
    expect(loaded?.kind).toBe("read-back");
    if (loaded?.kind !== "read-back") throw new Error("expected a read-back draft");
    expect(loaded.handoff).toEqual(handoff);
    expect(loaded.selectedProposalIndexes).toEqual({ "Page1.SecA_Patient.AgeValue": 1 });
    expect(loaded.editing).toBe(true);
    expect(loaded.draftNarrative).toBe("42-year-old woman, corrected");
  });

  it("keeps the record blank — a restored read-back has still written nothing", () => {
    // design.md's gate: the record is unchanged until "Looks right". A
    // reload must not be a way around that, so the persisted handoff
    // carries the same untouched record it was created with.
    const storage = fakeStorage();
    saveIntakeDraft(storage, {
      kind: "read-back",
      handoff: handoffOf("narrative", [PROPOSAL_A]),
      selectedProposalIndexes: {},
      editing: false,
      draftNarrative: "narrative",
    });
    const loaded = loadIntakeDraft(storage);
    if (loaded?.kind !== "read-back") throw new Error("expected a read-back draft");
    expect(loaded.handoff.session.record).toEqual(initAgenda());
  });

  it("stores selections by index so the restored objects are the ones the panel renders", () => {
    // ReadBack compares selection identity (`selections.get(id) ===
    // proposal`) to check a radio. Storing the proposal by value would
    // deserialize into a different object and silently uncheck it, so the
    // index is stored and resolved against the restored array — which
    // groupProposalsByField() passes through by reference.
    const storage = fakeStorage();
    saveIntakeDraft(storage, {
      kind: "read-back",
      handoff: handoffOf("narrative", [PROPOSAL_A, PROPOSAL_B]),
      selectedProposalIndexes: { "Page1.SecA_Patient.AgeValue": 1 },
      editing: false,
      draftNarrative: "narrative",
    });
    const loaded = loadIntakeDraft(storage);
    if (loaded?.kind !== "read-back") throw new Error("expected a read-back draft");
    const index = loaded.selectedProposalIndexes["Page1.SecA_Patient.AgeValue"];
    expect(loaded.handoff.result.proposals[index]).toBe(loaded.handoff.result.proposals[1]);
    expect(loaded.handoff.result.proposals[index].action).toEqual(PROPOSAL_B.action);
  });
});

describe("stale and foreign values never crash a surface", () => {
  it.each([
    ["corrupt JSON", "{not json"],
    ["a bare string", '"hello"'],
    ["null", "null"],
    ["an unknown kind", '{"kind":"whatever","narrative":"x"}'],
    ["a start draft with no narrative", '{"kind":"start"}'],
    ["a start draft with a non-string narrative", '{"kind":"start","narrative":42}'],
    ["a read-back draft with no handoff", '{"kind":"read-back","selectedProposalIndexes":{}}'],
    ["a read-back draft whose handoff has no result", '{"kind":"read-back","handoff":{"narrative":"x"}}'],
  ])("treats %s as no saved draft", (_label, raw) => {
    const storage = fakeStorage();
    storage.setItem("wilson.intake-draft.v1", raw);
    expect(loadIntakeDraft(storage)).toBeNull();
  });

  it("drops a selection index that points past the restored proposals", () => {
    // A stored index that no longer resolves would otherwise leave the
    // panel holding `undefined` as a "choice" and let confirm proceed on
    // it. Out-of-range indexes are dropped, which returns that field to
    // "needs a choice" — the safe direction.
    const storage = fakeStorage();
    saveIntakeDraft(storage, {
      kind: "read-back",
      handoff: handoffOf("narrative", [PROPOSAL_A]),
      selectedProposalIndexes: { "Page1.SecA_Patient.AgeValue": 7 },
      editing: false,
      draftNarrative: "narrative",
    });
    const loaded = loadIntakeDraft(storage);
    if (loaded?.kind !== "read-back") throw new Error("expected a read-back draft");
    expect(loaded.selectedProposalIndexes).toEqual({});
  });
});

describe("clearIntakeState", () => {
  it("clears the talk session AND the draft — one function means 'wipe'", () => {
    // The AC's "'Start over' clears ALL persisted intake state". There is
    // deliberately one function for this rather than two calls at each
    // call site, so a future third persisted shape cannot be forgotten by
    // one of them.
    const storage = fakeStorage();
    saveSession(storage, sessionOf());
    saveIntakeDraft(storage, { kind: "start", narrative: "something" });
    clearIntakeState(storage);
    expect(loadSession(storage)).toBeNull();
    expect(loadIntakeDraft(storage)).toBeNull();
  });

  it("is safe on empty storage", () => {
    const storage = fakeStorage();
    expect(() => clearIntakeState(storage)).not.toThrow();
  });
});

describe("resolveResumeSurface", () => {
  it("resumes Start with nothing to restore on empty storage", () => {
    expect(resolveResumeSurface(fakeStorage())).toEqual({ kind: "start", narrative: "" });
  });

  it("restores the Start composer's draft", () => {
    const storage = fakeStorage();
    saveIntakeDraft(storage, { kind: "start", narrative: "half a sentence" });
    expect(resolveResumeSurface(storage)).toEqual({ kind: "start", narrative: "half a sentence" });
  });

  it("resumes Read-back from its draft", () => {
    const storage = fakeStorage();
    const handoff = handoffOf("narrative", [PROPOSAL_A]);
    saveIntakeDraft(storage, {
      kind: "read-back",
      handoff,
      selectedProposalIndexes: {},
      editing: false,
      draftNarrative: "narrative",
    });
    const resumed = resolveResumeSurface(storage);
    expect(resumed.kind).toBe("read-back");
    if (resumed.kind !== "read-back") throw new Error("expected read-back");
    expect(resumed.draft.handoff).toEqual(handoff);
  });

  it("resumes Follow-ups from a stored session", () => {
    const storage = fakeStorage();
    saveSession(storage, sessionOf());
    expect(resolveResumeSurface(storage).kind).toBe("follow-ups");
  });

  it("prefers a confirmed session over a leftover read-back draft", () => {
    // Both existing is a stale state (confirming clears the draft), and
    // the session is strictly further along. Resuming at an unconfirmed
    // read-back whose confirm would re-apply proposals over an already
    // written record is the one genuinely wrong answer here.
    const storage = fakeStorage();
    saveSession(storage, sessionOf());
    saveIntakeDraft(storage, {
      kind: "read-back",
      handoff: handoffOf("narrative", [PROPOSAL_A]),
      selectedProposalIndexes: {},
      editing: false,
      draftNarrative: "narrative",
    });
    expect(resolveResumeSurface(storage).kind).toBe("follow-ups");
  });

  it("falls back to Start when the stored draft is unreadable", () => {
    const storage = fakeStorage();
    storage.setItem("wilson.intake-draft.v1", "{not json");
    expect(resolveResumeSurface(storage)).toEqual({ kind: "start", narrative: "" });
  });
});
