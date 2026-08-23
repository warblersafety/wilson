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
