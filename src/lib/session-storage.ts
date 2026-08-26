// Everything the intake flow persists across page reloads, in two shapes
// with two lifetimes: the TalkSession that exists from Read-back's
// confirmation onward (Issue #32's wizard UI), and the pre-confirmation
// draft that covers Start and Read-back themselves (Issue #72, closes
// #56 — see the second half of this file).
//
// StorageLike, not the real DOM Storage type, so this stays testable with
// a plain in-memory fake and typechecks under tsconfig.node.json, whose
// lib list has no "dom" — window.localStorage already satisfies this
// interface structurally, so call sites pass it directly with no adapter.
import type { NarrativeExtractResult } from "./narrative-extract";
import type { ReadBackHandoff } from "./start-surface";
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

// --- the pre-confirmation intake draft (Issue #72, closes #56) ------------
//
// Everything before Read-back's "Looks right" lived only in React state, so
// a reload during dictation — or right after an extraction landed — dropped
// the clinician back on a blank Start surface with no warning and nothing
// to recover (#56). This is the missing half: the surfaces that come BEFORE
// a TalkSession exists get their own persisted shape.
//
// Deliberately a SEPARATE key from the talk session rather than a widened
// one. The two have different lifetimes (a draft is consumed and cleared at
// confirmation; a session lives from there on), and a stale value under one
// must never be able to make the other unreadable — loadSession()'s
// guarded "treat anything unrecognized as nothing saved" only protects a
// caller if the shapes can't collide in the first place.
//
// What is NOT stored here: which surface is showing. It is derived from
// what exists (resolveResumeSurface below), the same way IntakeFlow has
// always decided between Start and Follow-ups. Review and Ready need
// nothing at all — Issue #45 already resumes them by re-deriving `done`
// from the stored session and forwarding through Wizard's own onDone.
//
// Privacy posture: this writes the dictated narrative to the clinician's
// own browser BEFORE they confirm it, which the confirmed path already
// does immediately afterwards (confirmReadBack appends the narrative as a
// transcript turn, which is then saved). design.md's "state lives
// client-side" is the recorded posture, and the Start surface's privacy
// copy says so plainly — the machinery and the copy have to match
// (design.md's privacy-copy rule). What this does NOT change: the record
// itself stays untouched until "Looks right", so a reload is not a way
// around the read-back gate.
const DRAFT_KEY = "wilson.intake-draft.v1";

export type IntakeDraft =
  | { kind: "start"; narrative: string }
  | {
      kind: "read-back";
      handoff: ReadBackHandoff;
      // Collision choices, stored as an INDEX into
      // handoff.result.proposals rather than the proposal itself.
      // ReadBack.tsx checks a radio by object identity
      // (`selections.get(fieldId) === proposal`), and a proposal stored by
      // value would deserialize into an equal-but-different object — the
      // radio would render unchecked while the choice was really held,
      // which reads as the app having lost the answer. An index resolves
      // against the restored array, and groupProposalsByField() passes
      // those objects through by reference.
      selectedProposalIndexes: Record<string, number>;
      // The in-progress "Edit narrative" state. Not named in this unit's
      // criteria either way; included because it is the same loss from the
      // same cause, and a clinician has no way to tell which composer on
      // the screen is the one a reload will empty.
      editing: boolean;
      draftNarrative: string;
    };

function isQuote(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const quote = value as Record<string, unknown>;
  return typeof quote.turnIndex === "number" && typeof quote.text === "string";
}

function isNarrativeExtractResult(value: unknown): value is NarrativeExtractResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.proposals) || !Array.isArray(result.repeatDecisions) || !Array.isArray(result.rejected)) {
    return false;
  }
  return result.proposals.every((proposal) => {
    if (typeof proposal !== "object" || proposal === null) return false;
    const entry = proposal as Record<string, unknown>;
    if (!isQuote(entry.quote)) return false;
    if (typeof entry.action !== "object" || entry.action === null) return false;
    const action = entry.action as Record<string, unknown>;
    return typeof action.fieldId === "string" && typeof action.type === "string";
  });
}

function isReadBackHandoff(value: unknown): value is ReadBackHandoff {
  if (typeof value !== "object" || value === null) return false;
  const handoff = value as Record<string, unknown>;
  return (
    typeof handoff.narrative === "string" &&
    isTalkSession(handoff.session) &&
    isNarrativeExtractResult(handoff.result)
  );
}

// An out-of-range index is dropped rather than kept: a stored choice that
// no longer resolves would leave the panel holding `undefined` as if it
// were a selection, and resolveConfirmReadiness() would then see a field
// with no pending flag and no action. Dropping returns that field to
// "needs a choice", which is the safe direction — the clinician re-picks.
function sanitizeSelections(raw: unknown, proposalCount: number): Record<string, number> {
  if (typeof raw !== "object" || raw === null) return {};
  const result: Record<string, number> = {};
  for (const [fieldId, index] of Object.entries(raw as Record<string, unknown>)) {
    if (Number.isInteger(index) && (index as number) >= 0 && (index as number) < proposalCount) {
      result[fieldId] = index as number;
    }
  }
  return result;
}

// Same contract as loadSession(): a missing key, corrupt JSON, or a
// well-formed value that isn't a draft is "nothing saved", never a throw.
// A surface must not be taken down by whatever else once wrote to this
// origin.
export function loadIntakeDraft(storage: StorageLike): IntakeDraft | null {
  const raw = storage.getItem(DRAFT_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const draft = parsed as Record<string, unknown>;

  if (draft.kind === "start") {
    return typeof draft.narrative === "string" ? { kind: "start", narrative: draft.narrative } : null;
  }
  if (draft.kind === "read-back") {
    if (!isReadBackHandoff(draft.handoff)) return null;
    return {
      kind: "read-back",
      handoff: draft.handoff,
      selectedProposalIndexes: sanitizeSelections(
        draft.selectedProposalIndexes,
        draft.handoff.result.proposals.length,
      ),
      editing: draft.editing === true,
      draftNarrative: typeof draft.draftNarrative === "string" ? draft.draftNarrative : draft.handoff.narrative,
    };
  }
  return null;
}

export function saveIntakeDraft(storage: StorageLike, draft: IntakeDraft): void {
  storage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearIntakeDraft(storage: StorageLike): void {
  storage.removeItem(DRAFT_KEY);
}

// The one function that means "wipe" (this unit's criteria: "'Start over'
// clears ALL persisted intake state"). Deliberately not two calls at each
// call site — a third persisted shape added later cannot then be forgotten
// by one caller and remembered by another.
export function clearIntakeState(storage: StorageLike): void {
  clearSession(storage);
  clearIntakeDraft(storage);
}

export type ResumeSurface =
  | { kind: "start"; narrative: string }
  | { kind: "read-back"; draft: Extract<IntakeDraft, { kind: "read-back" }> }
  | { kind: "follow-ups" };

// Which surface a fresh mount resumes at, derived from what is actually
// stored rather than from a persisted "current surface" field — the same
// approach IntakeFlow has always taken with loadSession(), and it cannot
// disagree with the data the way a separately-stored pointer could.
//
// The session wins over a read-back draft when both somehow exist.
// Confirming clears the draft, so that combination is already a stale
// state; of the two readings, resuming at an unconfirmed read-back whose
// confirm would re-apply proposals over an already-written record is the
// one genuinely wrong answer.
//
// Review and Ready are absent on purpose: they are reached by Follow-ups
// re-deriving `done` and forwarding through Wizard's onDone (Issue #45),
// so "follow-ups" already resumes them with no clicks and no data loss.
export function resolveResumeSurface(storage: StorageLike): ResumeSurface {
  if (loadSession(storage)) return { kind: "follow-ups" };
  const draft = loadIntakeDraft(storage);
  if (draft?.kind === "read-back") return { kind: "read-back", draft };
  return { kind: "start", narrative: draft?.kind === "start" ? draft.narrative : "" };
}
