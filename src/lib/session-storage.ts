// Persists a TalkSession (transcript, record, repeatCounts — Issue #32's
// wizard UI) across page reloads. StorageLike, not the real DOM Storage
// type, so this stays testable with a plain in-memory fake and typechecks
// under tsconfig.node.json, whose lib list has no "dom" — window.localStorage
// already satisfies this interface structurally, so call sites pass it
// directly with no adapter.
import type { TalkSession } from "./talk";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "wilson.talk-session.v1";

function isTalkSession(value: unknown): value is TalkSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.transcript) &&
    typeof candidate.record === "object" &&
    candidate.record !== null &&
    typeof candidate.repeatCounts === "object" &&
    candidate.repeatCounts !== null
  );
}

// Returns null on a missing key, corrupted JSON, or well-formed JSON that
// doesn't look like a TalkSession — a stale/foreign value under this key
// should never crash the wizard, just be treated as "no saved session".
export function loadSession(storage: StorageLike): TalkSession | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isTalkSession(parsed) ? parsed : null;
}

export function saveSession(storage: StorageLike, session: TalkSession): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY);
}
